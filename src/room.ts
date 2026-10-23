import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';
import { PHASE_DURATIONS, type AttackRecord, type GameState, type Phase, type Player } from './protocol.js';

interface PersistedRoom {
  players: Array<Omit<Player, 'ip'>>;
}

export class Room {
  readonly players = new Map<string, Player>();
  readonly queue: AttackRecord[] = [];
  readonly attacks = new Map<string, AttackRecord>();
  readonly nicknames = new Set<string>();
  readonly joinsByIp = new Map<string, number>();
  phase: Phase = 'LOBBY_OPEN';
  phaseStartedAt = Date.now();
  phaseDuration = PHASE_DURATIONS.LOBBY_OPEN;
  vaultOn = false;
  manualAttacksEnabled = config.manualAttacksEnabled;
  rehearsal = config.rehearsal;
  panicBlur = config.panicBlur;
  globalQueueEpoch = 0;
  private attackCounter = 0;
  private persistTimer: NodeJS.Timeout | undefined;

  constructor(private readonly persistPath = resolve(process.cwd(), 'data/room-state.json')) {}

  async restore(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.persistPath, 'utf8')) as PersistedRoom;
      for (const p of saved.players ?? []) {
        const player: Player = { ...p, ip: '', disconnectedAt: Date.now() };
        delete player.activeAttackId;
        this.players.set(player.playerId, player);
        this.nicknames.add(player.nickname.toLowerCase());
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Could not restore room state:', error);
    }
    // On crash/restart, keep identities and scores, but discard in-flight work and reopen the lobby.
    this.queue.length = 0;
    this.attacks.clear();
    this.vaultOn = false;
    this.phase = 'LOBBY_OPEN';
    this.phaseStartedAt = Date.now();
    this.phaseDuration = PHASE_DURATIONS.LOBBY_OPEN;
    this.schedulePersist();
  }

  createPlayer(nickname: string, ip: string): { player?: Player; reason?: 'ROOM_FULL' | 'IP_LIMIT' } {
    if (this.players.size >= config.playerCap) return { reason: 'ROOM_FULL' };
    const joins = this.joinsByIp.get(ip) ?? 0;
    if (joins >= config.joinsPerIp) return { reason: 'IP_LIMIT' };
    let unique = nickname;
    let suffix = 2;
    while (this.nicknames.has(unique.toLowerCase())) {
      const tag = `-${suffix++}`;
      unique = `${nickname.slice(0, 12 - tag.length)}${tag}`;
    }
    const player: Player = { playerId: randomUUID(), nickname: unique, ip, score: 0, joinedAt: Date.now(), cooldownUntil: 0 };
    this.players.set(player.playerId, player);
    this.nicknames.add(unique.toLowerCase());
    this.joinsByIp.set(ip, joins + 1);
    this.schedulePersist();
    return { player };
  }

  rejoin(playerId: string): Player | undefined {
    const player = this.players.get(playerId);
    if (player) delete player.disconnectedAt;
    return player;
  }

  disconnect(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) player.disconnectedAt = Date.now();
  }

  uniqueNickname(nickname: string): boolean {
    return this.nicknames.has(nickname.toLowerCase());
  }

  queuePosition(): number { return this.queue.length; }

  nextAttack(): AttackRecord | undefined {
    const attack = this.queue.shift();
    if (attack) attack.status = 'PROCESSING';
    this.globalQueueEpoch++;
    return attack;
  }

  addAttack(attack: AttackRecord): void {
    attack.arrivalOrder = Date.now() * 1000 + (++this.attackCounter % 1000);
    this.queue.push(attack);
    this.attacks.set(attack.attackId, attack);
    this.globalQueueEpoch++;
  }

  finishAttack(attack: AttackRecord, points: number): void {
    attack.status = 'RESOLVED';
    attack.points = points;
    const player = this.players.get(attack.playerId);
    if (player) {
      const oldScore = player.score;
      player.score += points;
      if (points > 0 && player.score > oldScore) player.scoreOrderAt = attack.arrivalOrder ?? attack.createdAt * 1000;
      player.cooldownUntil = Date.now() + config.attackCooldownMs;
      delete player.activeAttackId;
    }
    this.schedulePersist();
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseStartedAt = Date.now();
    this.phaseDuration = PHASE_DURATIONS[phase];
    if (phase === 'LOBBY_OPEN' || phase === 'ROUND_1_RAW') this.vaultOn = false;
    if (phase === 'ROUND_2_SHIELD') this.vaultOn = true;
    if (phase === 'GAME_OVER') this.vaultOn = true;
    this.schedulePersist();
  }

  gameState(): GameState {
    return {
      phase: this.phase,
      tMsLeft: Math.max(0, this.phaseDuration - (Date.now() - this.phaseStartedAt)),
      vaultOn: this.vaultOn,
      manualAttacksEnabled: this.manualAttacksEnabled,
      rehearsal: this.rehearsal,
      panicBlur: this.panicBlur,
    };
  }

  advancePhase(): void {
    const order: Phase[] = ['LOBBY_OPEN', 'ROUND_1_RAW', 'ROUND_2_SHIELD', 'GAME_OVER'];
    const index = order.indexOf(this.phase);
    this.setPhase(order[Math.min(index + 1, order.length - 1)]!);
  }

  scoreboard(): Player[] {
    return [...this.players.values()].sort((a, b) => b.score - a.score || (a.scoreOrderAt ?? a.joinedAt * 1000) - (b.scoreOrderAt ?? b.joinedAt * 1000));
  }

  queuedForPlayer(playerId: string): boolean {
    return this.queue.some((attack) => attack.playerId === playerId) || [...this.attacks.values()].some((attack) => attack.playerId === playerId && attack.status === 'PROCESSING');
  }

  stop(): void { if (this.persistTimer) clearTimeout(this.persistTimer); }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist().catch((error) => console.error('Could not persist room state:', error));
    }, 250);
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.persistPath), { recursive: true });
    const temp = `${this.persistPath}.tmp`;
    const body = JSON.stringify({ players: [...this.players.values()].map(({ ip: _ip, ...player }) => player) }, null, 2);
    await writeFile(temp, body, 'utf8');
    await rename(temp, this.persistPath);
  }
}
