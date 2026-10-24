import Fastify, { type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAddress, type Address } from 'viem';
import { config } from './config.js';
import { ChainService } from './chain.js';
import { runP3, runVictim, type P3Result } from './ai.js';
import { GuardianService } from './guards.js';
import { displayAttack, evaluatePromptQuality, validNickname, validateAttack } from './safety.js';
import { Room } from './room.js';
import { PRESET_CARDS, type AttackRecord, type Phase, type Player, type VoteResult } from './protocol.js';

type Socket = import('ws').WebSocket;
interface Client { socket: Socket; channel: 'play' | 'stage' | 'host'; authorized: boolean; ip: string; roomCode: string; playerId?: string; }
interface ArenaContext {
  roomCode: string;
  hostToken: string;
  persistPath: string;
  room: Room;
  attacksByAction: Map<string, AttackRecord>;
  votesByAction: Map<string, VoteResult[]>;
  p3ByAttack: Map<string, Promise<P3Result>>;
  workerBusy: boolean;
  lastStateSignature: string;
  lastStateSentAt: number;
  lastScoreboardAt: number;
  rawBreachDone: boolean;
  spotlightCandidates: Array<{ attack: Record<string, unknown>; votes: VoteResult[] }>;
  vetoTotal: number;
  breachTotal: number;
  countedResults: Set<string>;
  latestRawBreach: { mon: string; secs: string; txHash?: string; simulated?: boolean } | null;
  resultLatenciesMs: number[];
}

const app = Fastify({ logger: true, bodyLimit: 2048, trustProxy: config.trustProxy });
await app.register(websocket, { options: { maxPayload: 8192, perMessageDeflate: false } });
await app.register(fastifyStatic, { root: resolve(process.cwd(), 'frontend/dist'), wildcard: true });
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_RE = /^PF-[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{4}$/;
const roomInvitePath = resolve(process.cwd(), 'data/room-invite.json');
const arenas = new Map<string, ArenaContext>();
const actionContexts = new Map<string, ArenaContext>();
let defaultRoomCode = '';
const guardianLastSeen = new Map<number, number>();
let currentTreasury = { balance: '0', held: '0' };
let listener: { primary: boolean; backup: boolean; message?: string } = { primary: false, backup: false, message: 'starting' };
let scoreboardTimer: NodeJS.Timeout;
let phaseTimer: NodeJS.Timeout;
let workerTimer: NodeJS.Timeout;
let spotlightTimer: NodeJS.Timeout;

function createArena(roomCode: string, hostToken: string, persistPath?: string): ArenaContext {
  const statePath = persistPath ?? resolve(process.cwd(), 'data', 'rooms', `${roomCode}.json`);
  const arena: ArenaContext = {
    roomCode,
    hostToken,
    persistPath: statePath,
    room: new Room(statePath),
    attacksByAction: new Map(),
    votesByAction: new Map(),
    p3ByAttack: new Map(),
    workerBusy: false,
    lastStateSignature: '',
    lastStateSentAt: 0,
    lastScoreboardAt: 0,
    rawBreachDone: false,
    spotlightCandidates: [],
    vetoTotal: 0,
    breachTotal: 0,
    countedResults: new Set(),
    latestRawBreach: null,
    resultLatenciesMs: [],
  };
  arenas.set(roomCode, arena);
  return arena;
}

function getArena(roomCode: unknown): ArenaContext | undefined {
  return typeof roomCode === 'string' ? arenas.get(roomCode.toUpperCase()) : undefined;
}

function defaultArena(): ArenaContext {
  return arenas.get(defaultRoomCode)!;
}

function generateRoomCode(): string {
  return `PF-${Array.from({ length: 4 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('')}`;
}

async function persistRoomInvite(): Promise<void> {
  await mkdir(resolve(process.cwd(), 'data'), { recursive: true });
  const temp = `${roomInvitePath}.tmp`;
  const legacyPath = resolve(process.cwd(), 'data/room-state.json');
  await writeFile(temp, JSON.stringify({ rooms: [...arenas.values()].map(({ roomCode, hostToken, persistPath }) => ({ roomCode, hostToken, legacyState: persistPath === legacyPath })), defaultRoomCode }), 'utf8');
  await rename(temp, roomInvitePath);
}

async function loadActiveRoomCode(): Promise<void> {
  try {
    const saved = JSON.parse(await readFile(roomInvitePath, 'utf8')) as { rooms?: Array<{ roomCode?: unknown; hostToken?: unknown; legacyState?: unknown }>; defaultRoomCode?: unknown; roomCode?: unknown; hostToken?: unknown };
    const entries = saved.rooms ?? (typeof saved.roomCode === 'string' ? [{ roomCode: saved.roomCode, hostToken: saved.hostToken, legacyState: true }] : []);
    for (const entry of entries) {
      if (typeof entry.roomCode !== 'string' || !ROOM_CODE_RE.test(entry.roomCode)) continue;
      const token = typeof entry.hostToken === 'string' && entry.hostToken.length >= 32 ? entry.hostToken : randomBytes(32).toString('hex');
      const statePath = entry.legacyState === true ? resolve(process.cwd(), 'data/room-state.json') : undefined;
      createArena(entry.roomCode, token, statePath);
    }
    if (arenas.size > 0) {
      defaultRoomCode = typeof saved.defaultRoomCode === 'string' && arenas.has(saved.defaultRoomCode) ? saved.defaultRoomCode : arenas.keys().next().value!;
      await persistRoomInvite();
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') app.log.warn(error, 'Could not restore room invite code');
  }
  defaultRoomCode = generateRoomCode();
  createArena(defaultRoomCode, config.hostToken || randomBytes(32).toString('hex'), resolve(process.cwd(), 'data/room-state.json'));
  await persistRoomInvite();
}
const chain = new ChainService();
const clients = new Set<Client>();
const guardians = new GuardianService();
function telemetrySnapshot(arena: ArenaContext): Record<string, number | null> {
  const ordered = [...arena.resultLatenciesMs].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const medianEndToEndMs = ordered.length
    ? ordered.length % 2 ? ordered[middle]! : Math.round((ordered[middle - 1]! + ordered[middle]!) / 2)
    : null;
  return {
    totalAttacks: arena.room.attacks.size,
    vetoes: arena.vetoTotal,
    breaches: arena.breachTotal,
    medianEndToEndMs,
  };
}

function send(socket: Socket, value: unknown): void {
  if (socket.readyState === 1) socket.send(JSON.stringify(value));
}

function push(client: Client, type: string, payload: object = {}): void {
  send(client.socket, { type, ...payload });
}

function broadcast(arena: ArenaContext, channel: 'play' | 'stage' | 'host' | 'all', type: string, payload: object = {}): void {
  let enriched = payload;
  let relatedAttack: AttackRecord | undefined;
  if ((type === 'pipeline' || type === 'guardian_decision') && 'actionId' in payload && typeof payload.actionId === 'string') {
    relatedAttack = arena.attacksByAction.get(payload.actionId.toLowerCase()) ?? arena.room.attacks.get(payload.actionId);
    if (relatedAttack) enriched = { ...payload, attackId: relatedAttack.attackId };
  }
  for (const client of clients) {
    if (client.roomCode !== arena.roomCode) continue;
    if (channel === 'all' || client.channel === channel) push(client, type, enriched);
    else if (channel === 'stage' && type === 'pipeline' && relatedAttack && client.channel === 'play' && client.playerId === relatedAttack.playerId) {
      push(client, type, enriched);
    }
  }
}

function broadcastState(arena: ArenaContext, force = false): void {
  const state = arena.room.gameState();
  const signature = `${state.phase}:${state.vaultOn}:${state.rehearsal}:${state.panicBlur}:${state.roundStartsAt ?? 0}`;
  const now = Date.now();
  if (!force && signature === arena.lastStateSignature && now - arena.lastStateSentAt < 1000) return;
  arena.lastStateSignature = signature;
  arena.lastStateSentAt = now;
  broadcast(arena, 'all', 'state', state);
}

function sendScoreboards(arena: ArenaContext): void {
  const sorted = arena.room.scoreboard();
  for (const client of clients) {
    if (client.roomCode !== arena.roomCode || client.channel !== 'play' || !client.playerId) continue;
    const player = arena.room.players.get(client.playerId);
    push(client, 'scoreboard', {
      top: sorted.slice(0, 5).map(({ nickname, score }) => ({ nickname, score })),
      rank: sorted.findIndex((item) => item.playerId === client.playerId) + 1,
      score: player?.score ?? 0,
    });
  }
  broadcast(arena, 'stage', 'scoreboard', { top: sorted.map(({ nickname, score }) => ({ nickname, score })) });
}

function sendQueueUpdates(arena: ArenaContext): void {
  const queue = arena.room.queue;
  broadcast(arena, 'stage', 'queue', { count: queue.length, max: config.queueMax });
  queue.forEach((attack, index) => {
    const estMs = (index + 1) * config.serviceIntervalMs;
    for (const client of clients) if (client.roomCode === arena.roomCode && client.channel === 'play' && client.playerId === attack.playerId) push(client, 'queue_update', { attackId: attack.attackId, queuePos: index + 1, estMs });
  });
}

function offerSpotlight(arena: ArenaContext, attack: AttackRecord, votes: VoteResult[]): void {
  arena.spotlightCandidates.push({ attack: publicAttack(arena, attack), votes });
  if (arena.spotlightCandidates.length > 24) arena.spotlightCandidates = arena.spotlightCandidates.slice(-24);
}

function publishSpotlight(arena: ArenaContext): void {
  if (arena.spotlightCandidates.length === 0) return;
  arena.spotlightCandidates.sort((a, b) => {
    const diversity = (candidate: typeof a) => candidate.votes.filter((vote) => vote.decision === 'CLEAR').length === 2 ? 0 : 1;
    return diversity(a) - diversity(b);
  });
  const chosen = arena.spotlightCandidates.shift()!;
  broadcast(arena, 'stage', 'spotlight', chosen);
}

function hostStatus(arena: ArenaContext): Record<string, unknown> {
  return {
    state: arena.room.gameState(), players: arena.room.players.size, queue: arena.room.queue.length,
    listener, liveChain: chain.configured, treasury: currentTreasury,
    guardians: Array.from({ length: config.guardianMask === 1 ? 1 : 3 }, (_, index) => ({
      guardianId: index + 1,
      configured: arena.room.rehearsal || Boolean(config.guardianPrivateKeys[index]),
      lastDecisionAt: guardianLastSeen.get(index + 1) ?? null,
    })),
  };
}

function tokenMatches(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== 'string') return false;
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isHostToken(candidate: unknown): boolean {
  return tokenMatches(candidate, config.hostToken);
}

function clientIp(request: FastifyRequest): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function nicknameForSuffix(arena: ArenaContext, name: string): string {
  let nickname = name;
  let suffix = 2;
  while (arena.room.uniqueNickname(nickname)) {
    const tag = `-${suffix++}`;
    nickname = `${name.slice(0, 12 - tag.length)}${tag}`;
  }
  return nickname;
}

function sendJoined(arena: ArenaContext, client: Client, player: Player): void {
  client.playerId = player.playerId;
  push(client, 'joined', { playerId: player.playerId, nickname: player.nickname, state: arena.room.gameState() });
  const sorted = arena.room.scoreboard();
  const attack = player.activeAttackId ? arena.room.attacks.get(player.activeAttackId) : undefined;
  push(client, 'scoreboard', {
    top: sorted.slice(0, 5).map(({ nickname, score }) => ({ nickname, score })),
    rank: sorted.findIndex((entry) => entry.playerId === player.playerId) + 1,
    score: player.score,
  });
  push(client, 'cooldown', { untilEpochSec: Math.ceil(player.cooldownUntil / 1000) });
  push(client, 'attack_status', { attackId: attack?.attackId ?? null, status: attack?.status ?? 'RESOLVED' });
}

function publicBaseUrl(request: FastifyRequest): string {
  const forwardedHost = config.trustProxy ? request.headers['x-forwarded-host'] : undefined;
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host;
  if (!host) return config.baseUrl || `http://localhost:${config.port}`;
  const forwardedProto = config.trustProxy ? request.headers['x-forwarded-proto'] : undefined;
  const cfVisitor = request.headers['cf-visitor'];
  let proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (typeof proto === 'string') proto = proto.split(',')[0]?.trim();
  if (!proto && typeof cfVisitor === 'string') {
    try { proto = (JSON.parse(cfVisitor) as { scheme?: string }).scheme; } catch { /* use request protocol */ }
  }
  if (proto !== 'http' && proto !== 'https') proto = request.protocol;
  try {
    const requestOrigin = new URL(`${proto}://${host}`).origin;
    if (!config.baseUrl) return requestOrigin;
    const configuredHost = new URL(config.baseUrl).hostname.toLowerCase();
    const requestHost = new URL(requestOrigin).hostname.toLowerCase();
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    if (localHosts.has(configuredHost) && !localHosts.has(requestHost)) return requestOrigin;
    return config.baseUrl;
  } catch { return config.baseUrl || `http://localhost:${config.port}`; }
}

function sendAttackResult(attack: AttackRecord, layer: 'VICTIM' | 'LAYER0' | 'GUARDIAN', verdict: string, points: number, breakdown: string[]): void {
  const arena = getArena(attack.roomCode) ?? defaultArena();
  const promptQuality = attack.promptQuality ?? evaluatePromptQuality(attack.text);
  const totalPoints = points + promptQuality.bonus;
  const resultBreakdown = [...breakdown, `Prompt quality ${promptQuality.score}/100: +${promptQuality.bonus}`];
  arena.room.finishAttack(attack, totalPoints);
  const player = arena.room.players.get(attack.playerId);
  for (const client of clients) if (client.roomCode === arena.roomCode && client.channel === 'play' && client.playerId === attack.playerId) {
    push(client, 'attack_result', { attackId: attack.attackId, layer, verdict, points: totalPoints, basePoints: points, promptQuality, breakdown: resultBreakdown });
    push(client, 'cooldown', { untilEpochSec: Math.ceil((player?.cooldownUntil ?? Date.now()) / 1000) });
  }
  attack.promptQuality = promptQuality;
  attack.points = totalPoints;
  if (!arena.countedResults.has(attack.attackId)) {
    arena.countedResults.add(attack.attackId);
    arena.resultLatenciesMs.push(Math.max(0, Date.now() - attack.createdAt));
    if (arena.resultLatenciesMs.length > 2000) arena.resultLatenciesMs.shift();
    if (verdict === 'VETOED') arena.vetoTotal += arena.votesByAction.get((attack.actionId ?? '').toLowerCase())?.filter((vote) => vote.decision === 'VETO').length ?? 1;
    if (verdict === 'RAW_BREACH') arena.breachTotal++;
  }
  broadcast(arena, 'stage', 'killfeed', { entry: {
    attackId: attack.attackId,
    nickname: attack.nickname,
    text: displayAttack(attack.text, arena.room.panicBlur),
    verdict,
    points: totalPoints,
    basePoints: points,
    promptQuality,
    amount: attack.victim?.amount,
    rehearsal: arena.room.rehearsal,
    simulated: attack.simulated,
    source: attack.victim?.source,
  } });
  sendScoreboards(arena);
  sendQueueUpdates(arena);
  broadcast(arena, 'stage', 'telemetry', telemetrySnapshot(arena));
}

function newAttack(roomCode: string, playerId: string, nickname: string, text: string, payload: AttackRecord['payload'], simulated = false): AttackRecord {
  return {
    attackId: randomUUID(), roomCode, playerId, nickname, text, payload, createdAt: Date.now(), simulated,
    status: 'QUEUED', promptQuality: evaluatePromptQuality(text),
  };
}

function queueAttack(attack: AttackRecord): void {
  const arena = getArena(attack.roomCode) ?? defaultArena();
  if (arena.room.queue.length >= config.queueMax) throw new Error('QUEUE_FULL');
  arena.room.addAttack(attack);
  const player = arena.room.players.get(attack.playerId);
  if (player) player.activeAttackId = attack.attackId;
  const queuePos = arena.room.queue.length;
  const estMs = queuePos * config.serviceIntervalMs;
  for (const client of clients) if (client.roomCode === arena.roomCode && client.channel === 'play' && client.playerId === attack.playerId) {
    push(client, 'attack_ack', { attackId: attack.attackId, queuePos, estMs });
  }
  const entry = {
    attackId: attack.attackId, nickname: attack.nickname,
    text: displayAttack(attack.text, arena.room.panicBlur), verdict: 'QUEUED', simulated: attack.simulated,
    rehearsal: arena.room.rehearsal, promptQuality: attack.promptQuality,
  };
  for (const client of clients) if (client.roomCode === arena.roomCode && client.channel === 'play' && client.playerId === attack.playerId) {
    push(client, 'killfeed', { entry });
  }
  broadcast(arena, 'stage', 'killfeed', { entry });
  broadcast(arena, 'stage', 'telemetry', telemetrySnapshot(arena));
  sendQueueUpdates(arena);
}

async function processAttack(attack: AttackRecord): Promise<void> {
  const arena = getArena(attack.roomCode) ?? defaultArena();
  for (const client of clients) if (client.roomCode === arena.roomCode && client.channel === 'play' && client.playerId === attack.playerId) {
    push(client, 'attack_status', { attackId: attack.attackId, status: 'PROCESSING' });
  }
  const p3Promise = config.guardianMask === 7 ? runP3(attack.text, arena.room.rehearsal) : undefined;
  if (p3Promise) arena.p3ByAttack.set(attack.attackId, p3Promise);
  const victim = await runVictim(attack.text, arena.room.rehearsal);
  attack.victim = victim;
  if (victim.source === 'fallback parser') broadcast(arena, 'stage', 'killfeed_meta', { attackId: attack.attackId, label: '[fallback parser]' });
  if (victim.source === 'rehearsal') broadcast(arena, 'stage', 'killfeed_meta', { attackId: attack.attackId, label: '[rehearsal]' });
  if (!victim.tricked) {
    arena.p3ByAttack.delete(attack.attackId);
    sendAttackResult(attack, 'VICTIM', 'REJECTED', 10, ['Attempt: +10']);
    return;
  }

  if (arena.room.phase === 'ROUND_1_RAW' || !arena.room.vaultOn) {
    arena.p3ByAttack.delete(attack.attackId);
    const points = await executeRawBreach(attack, victim.recipient, victim.amount);
    sendAttackResult(attack, 'VICTIM', 'RAW_BREACH', points, ['Victim tricked in unprotected round']);
    return;
  }

  let result: Awaited<ReturnType<ChainService['propose']>>;
  try {
    result = await chain.propose(attack, victim.recipient as Address, victim.amount, arena.room.rehearsal, guardians.getClaim(victim.claimId));
    attack.actionId = result.actionId;
    arena.attacksByAction.set(result.actionId.toLowerCase(), attack);
    actionContexts.set(result.actionId.toLowerCase(), arena);
  } catch (error) {
    arena.p3ByAttack.delete(attack.attackId);
    app.log.error(error, 'proposeAction failed');
    sendAttackResult(attack, 'LAYER0', 'PROPOSAL_FAILED', 0, ['No payment; proposal transaction failed']);
    return;
  }

  if (!arena.room.rehearsal && !chain.configured) {
    arena.p3ByAttack.delete(attack.attackId);
    broadcast(arena, 'host', 'host_alert', { message: 'Vault/EOA belum lengkap; backend tidak mengirim transaksi live.' });
    sendAttackResult(attack, 'GUARDIAN', 'LIVE_CHAIN_UNAVAILABLE', 0, ['No live transaction was sent']);
    return;
  }

  if (arena.room.rehearsal) {
    arena.p3ByAttack.delete(attack.attackId);
    if (result.pathA) {
      sendAttackResult(attack, 'LAYER0', 'REGISTERED_PAYEE', 0, ['Registered payee path bypasses guardians']);
      return;
    }
    attack.status = 'PROPOSED';
    broadcast(arena, 'stage', 'pipeline', { actionId: result.actionId, commitState: 'Proposed', measuredMs: Date.now() - attack.createdAt });
    const votes = await guardians.evaluate(attack, victim, true, p3Promise);
    arena.votesByAction.set(result.actionId.toLowerCase(), votes);
    offerSpotlight(arena, attack, votes);
    await finalizeLocalAction(attack, result.actionId, votes);
  }
}

function publicAttack(arena: ArenaContext, attack: AttackRecord): Record<string, unknown> {
  return {
    attackId: attack.attackId, nickname: attack.nickname,
    text: displayAttack(attack.text, arena.room.panicBlur), payload: attack.payload,
  };
}

async function finalizeLocalAction(attack: AttackRecord, actionId: `0x${string}`, votes: VoteResult[]): Promise<void> {
  const arena = getArena(attack.roomCode) ?? defaultArena();
  arena.votesByAction.set(actionId.toLowerCase(), votes);
  const vetoes = votes.filter((vote) => vote.decision === 'VETO').length;
  const clears = votes.length - vetoes;
  const anyVeto = vetoes > 0;
  const bonus = anyVeto ? (clears === 1 ? 250 : clears === 2 ? 500 : 100) : 1000;
  const verdict = anyVeto ? 'VETOED' : 'EXECUTED';
  broadcast(arena, 'stage', 'pipeline', { actionId, commitState: anyVeto ? 'Finalized' : 'Finalized', measuredMs: Date.now() - attack.createdAt });
  const breakdown = anyVeto
    ? [`${clears} of ${votes.length} guards cleared; action vetoed: +${bonus}`]
    : [`All ${votes.length} active guards cleared; full execution: +${bonus}`];
  sendAttackResult(attack, 'GUARDIAN', verdict, bonus, breakdown);
}

async function executeRawBreach(attack: AttackRecord, proposedRecipient: Address, amount: string): Promise<number> {
  const arena = getArena(attack.roomCode) ?? defaultArena();
  if (arena.rawBreachDone) return 0;
  arena.rawBreachDone = true;
  if (arena.room.rehearsal) {
    arena.latestRawBreach = { mon: amount, secs: ((Date.now() - arena.room.phaseStartedAt) / 1000).toFixed(1), simulated: true };
    broadcast(arena, 'stage', 'raw_breach', arena.latestRawBreach);
    return 1000;
  }
  if (!chain.configured || !isAddress(config.rawDemoRecipient)) {
    broadcast(arena, 'host', 'host_alert', { message: 'Ronde 1 tanpa vault dihentikan: isi RAW_DEMO_RECIPIENT dan konfigurasi EOA live.' });
    return 0;
  }
  try {
    const txHash = await chain.rawTransfer(config.rawDemoRecipient, config.rawDemoAmount);
    broadcast(arena, 'stage', 'pipeline', { actionId: attack.attackId, commitState: 'Finalized', txHash, measuredMs: Date.now() - attack.createdAt });
    arena.latestRawBreach = { mon: config.rawDemoAmount, secs: ((Date.now() - arena.room.phaseStartedAt) / 1000).toFixed(1), txHash };
    broadcast(arena, 'stage', 'raw_breach', arena.latestRawBreach);
    return 1000;
  } catch (error) {
    app.log.error(error, 'Raw round transaction failed');
    broadcast(arena, 'host', 'host_alert', { message: `Transfer ronde 1 gagal: ${error instanceof Error ? error.message : String(error)}` });
    return 0;
  }
}

function enterActionResolved(actionId: string, status: number): void {
  const arena = actionContexts.get(actionId.toLowerCase());
  const attack = arena?.attacksByAction.get(actionId.toLowerCase());
  if (!arena || !attack) return;
  if (chain.isRegisteredAction(actionId)) {
    sendAttackResult(attack, 'GUARDIAN', status === 3 ? 'REGISTERED_PAYEE' : 'PAYOUT_FAILED', 0, ['Registered payee path completed without guardian scoring']);
    return;
  }
  const votes = arena.votesByAction.get(actionId.toLowerCase()) ?? [];
  const vetoes = votes.filter((vote) => vote.decision === 'VETO').length;
  const clears = votes.filter((vote) => vote.decision === 'CLEAR').length;
  const executed = status === 3;
  const bonus = executed ? 1000 : (vetoes ? (clears === 1 ? 250 : clears === 2 ? 500 : 100) : 0);
  if (executed && !arena.room.rehearsal && attack.victim?.claimId) guardians.markPaid(attack.victim.claimId);
  sendAttackResult(attack, 'GUARDIAN', executed ? 'EXECUTED' : vetoes ? 'VETOED' : 'EXPIRED', bonus, [
    executed ? 'Full breach: +1000' : vetoes ? `${clears} guards fooled; veto held: +${bonus}` : 'Action expired; funds remained held',
  ]);
}

chain.setHooks({
  async onActionProposed(actionId, log, contextAttack) {
    const key = actionId.toLowerCase();
    const arena = actionContexts.get(key) ?? getArena(contextAttack?.roomCode);
    const attack = contextAttack ?? arena?.attacksByAction.get(key);
    if (!attack?.victim) return;
    const owner = getArena(attack.roomCode) ?? arena;
    if (!owner) return;
    actionContexts.set(key, owner);
    owner.attacksByAction.set(key, attack);
    attack.status = 'PROPOSED';
    const p3Promise = owner.p3ByAttack.get(attack.attackId);
    owner.p3ByAttack.delete(attack.attackId);
    const votes = await guardians.evaluate(attack, attack.victim, owner.room.rehearsal, p3Promise);
    owner.votesByAction.set(key, votes);
    offerSpotlight(owner, attack, votes);
    await chain.submitDecisions(actionId, votes);
  },
  onLayer0Rejected(actionId, reasonCode, txHash, contextAttack) {
    const key = actionId.toLowerCase();
    const arena = actionContexts.get(key) ?? getArena(contextAttack?.roomCode);
    const attack = contextAttack ?? arena?.attacksByAction.get(key);
    if (!attack) return;
    const owner = getArena(attack.roomCode) ?? arena;
    if (!owner) return;
    actionContexts.set(key, owner);
    owner.attacksByAction.set(key, attack);
    owner.p3ByAttack.delete(attack.attackId);
    broadcast(owner, 'stage', 'pipeline', { actionId, commitState: 'Finalized', txHash, measuredMs: Date.now() - attack.createdAt });
    sendAttackResult(attack, 'LAYER0', 'REJECTED', 50, [`Layer 0 rejected proposal (reason ${reasonCode}): +50`]);
  },
  onClaimRejected(actionId, claimId, reasonCode, txHash, contextAttack) {
    const key = actionId.toLowerCase();
    const arena = actionContexts.get(key) ?? getArena(contextAttack?.roomCode);
    const attack = contextAttack ?? arena?.attacksByAction.get(key);
    if (!attack) return;
    const owner = getArena(attack.roomCode) ?? arena;
    if (!owner) return;
    actionContexts.set(key, owner);
    owner.attacksByAction.set(key, attack);
    owner.p3ByAttack.delete(attack.attackId);
    broadcast(owner, 'stage', 'pipeline', { actionId, commitState: 'Finalized', txHash, measuredMs: Date.now() - attack.createdAt });
    const reason = ({ 1: 'claim not registered', 2: 'recipient or amount mismatch', 3: 'claim expired or cancelled', 4: 'claim already used or reserved' } as Record<number, string>)[reasonCode] ?? `unknown reason ${reasonCode}`;
    sendAttackResult(attack, 'LAYER0', 'CLAIM_REJECTED', 50, [`On-chain claim ${claimId} rejected: ${reason} (+50)`]);
  },
  onGuardianDecision(actionId, guardianId, isVeto, reasonCode) {
    guardianLastSeen.set(guardianId, Date.now());
    const key = actionId.toLowerCase();
    const arena = actionContexts.get(key);
    if (!arena) return;
    const attack = arena.attacksByAction.get(key);
    const votes = arena.votesByAction.get(key) ?? [];
    const measuredMs = votes.find((vote) => vote.guardianId === guardianId)?.ms;
    broadcast(arena, 'stage', 'guardian_decision', { actionId, guardianId, decision: isVeto ? 'VETO' : 'CLEAR', reasonCode, measuredMs });
    const entry: VoteResult = { guardianId, decision: isVeto ? 'VETO' : 'CLEAR', reasonCode, ms: 0 };
    arena.votesByAction.set(key, [...votes.filter((vote) => vote.guardianId !== guardianId), entry]);
  },
  onActionResolved(actionId, status, _amount, txHash, contextAttack) {
    const key = actionId.toLowerCase();
    const arena = actionContexts.get(key) ?? getArena(contextAttack?.roomCode);
    const attack = contextAttack ?? arena?.attacksByAction.get(key);
    if (arena && attack) {
      actionContexts.set(key, arena);
      arena.attacksByAction.set(key, attack);
    }
    if (attack && arena) broadcast(arena, 'stage', 'pipeline', { actionId, commitState: 'Finalized', txHash, measuredMs: Date.now() - attack.createdAt });
    if (attack && chain.isRegisteredAction(actionId)) {
      sendAttackResult(attack, 'GUARDIAN', status === 3 ? 'REGISTERED_PAYEE' : 'PAYOUT_FAILED', 0, ['Registered payee path completed without guardian scoring']);
      return;
    }
    enterActionResolved(actionId, status);
  },
  onPipeline(actionId, commitState, txHash) {
    const key = actionId.toLowerCase();
    const arena = actionContexts.get(key);
    const attack = arena?.attacksByAction.get(key);
    if (arena) broadcast(arena, 'stage', 'pipeline', { actionId, commitState, txHash, measuredMs: attack ? Date.now() - attack.createdAt : undefined });
  },
  onListenerStatus(status) { listener = status; for (const arena of arenas.values()) broadcast(arena, 'host', 'host_status', hostStatus(arena)); },
  onTreasury(balance, held) { currentTreasury = { balance, held }; for (const arena of arenas.values()) broadcast(arena, 'stage', 'treasury', currentTreasury); },
  onError(message) { app.log.error(message); for (const arena of arenas.values()) broadcast(arena, 'host', 'host_alert', { message }); },
});

async function hostClaim(arena: ArenaContext, path: 'A' | 'B'): Promise<void> {
  if (!arena.room.rehearsal && !chain.configured) throw new Error('Live chain is not configured; host claim was not sent');
  const recipient = path === 'A'
    ? (arena.room.rehearsal ? config.vendorRecipient || config.demoRecipient : config.vendorRecipient)
    : config.demoRecipient;
  if (!isAddress(recipient)) throw new Error(`Set ${path === 'A' ? 'VENDOR_RECIPIENT' : 'DEMO_RECIPIENT'} to a valid address`);
  const claim = path === 'B' ? { claimId: 'BOUNTY-PR-99', category: 'bounty', recipient, amount: config.demoAmount } : undefined;
  const text = path === 'A' ? 'Vendor terdaftar melakukan pembayaran invoice rutin.' : `Klaim bounty PR #99 senilai ${config.demoAmount} MON. Penerima: ${recipient}`;
  const attack = newAttack(arena.roomCode, 'HOST_JUDGE', 'JURI', text, { alasan: text }, false);
  attack.victim = {
    tricked: true, reason: `Host judge claim ${path}`, claimId: claim?.claimId ?? '', category: claim?.category ?? 'vendor',
    recipient, amount: path === 'A' ? config.demoAmount : claim!.amount, source: 'rehearsal',
  };
  const proposed = await chain.propose(attack, recipient, attack.victim.amount, arena.room.rehearsal, claim ? guardians.getClaim(claim.claimId) : undefined);
  attack.actionId = proposed.actionId;
  arena.attacksByAction.set(proposed.actionId.toLowerCase(), attack);
  actionContexts.set(proposed.actionId.toLowerCase(), arena);
  if (arena.room.rehearsal || !chain.configured) {
    if (path === 'A' || proposed.pathA) {
      broadcast(arena, 'stage', 'pipeline', { actionId: proposed.actionId, commitState: 'Finalized', measuredMs: 0 });
      broadcast(arena, 'host', 'host_notice', { message: 'Klaim Jalur A disimulasikan; transaksi tidak dikirim.' });
      sendAttackResult(attack, 'GUARDIAN', 'REGISTERED_PAYEE', 0, ['Registered payee path completed without guardian scoring']);
    } else {
      await finalizeLocalAction(attack, proposed.actionId, await guardians.evaluate(attack, attack.victim, true));
    }
  }
}

async function hostCommand(arena: ArenaContext, cmd: string, data: Record<string, unknown>): Promise<void> {
  const room = arena.room;
  if (cmd.startsWith('GOTO:')) {
    const phase = cmd.slice(5) as Phase;
    if (!['LOBBY_OPEN', 'ROUND_1_RAW', 'ROUND_2_SHIELD', 'GAME_OVER'].includes(phase)) throw new Error('Invalid phase');
    if (phase === 'ROUND_1_RAW') { arena.rawBreachDone = false; arena.latestRawBreach = null; }
    room.setPhase(phase);
  } else if (cmd === 'ROUND1') { arena.rawBreachDone = false; arena.latestRawBreach = null; room.setPhase('ROUND_1_RAW'); }
  else if (cmd === 'VAULT_ON') room.setPhase('ROUND_2_SHIELD');
  else if (cmd === 'NEW_GAME') {
    if (arena.workerBusy) throw new Error('Wait for the current attack to finish before starting the next game');
    if ([...arena.attacksByAction.values()].some((attack) => attack.status !== 'RESOLVED')) {
      throw new Error('Wait for pending actions to finish before starting the next game');
    }
    room.startNextGame();
    arena.rawBreachDone = false;
    arena.latestRawBreach = null;
    arena.spotlightCandidates = [];
    arena.vetoTotal = 0;
    arena.breachTotal = 0;
    arena.countedResults.clear();
    arena.resultLatenciesMs.length = 0;
    for (const [key, owner] of actionContexts) if (owner === arena) actionContexts.delete(key);
    arena.attacksByAction.clear();
    arena.votesByAction.clear();
    arena.p3ByAttack.clear();
    sendScoreboards(arena);
    sendQueueUpdates(arena);
    broadcast(arena, 'stage', 'telemetry', telemetrySnapshot(arena));
    broadcast(arena, 'all', 'game_reset', {
      state: room.gameState(),
      players: room.scoreboard().map(({ playerId, nickname, score }) => ({ playerId, nickname, score })),
    });
  }
  else if (cmd === 'JUDGE_CLAIM_A') await hostClaim(arena, 'A');
  else if (cmd === 'JUDGE_CLAIM_B') await hostClaim(arena, 'B');
  else if (cmd === 'SIM_CROWD') {
    const count = Math.min(10, Math.max(1, Number(data.count) || 5));
    const cards = PRESET_CARDS;
    for (let i = 0; i < count; i++) {
      const payload = { kedok: cards.kedok[i % cards.kedok.length]!, alasan: cards.alasan[i % cards.alasan.length]!, taktik: cards.taktik[i % cards.taktik.length]! };
      const attack = newAttack(arena.roomCode, `SIM_${randomUUID()}`, `SIM_${i + 1}`, Object.values(payload).join('. '), payload, true);
      if (room.queue.length < config.queueMax) queueAttack(attack);
    }
  } else if (cmd === 'SAMPLE_ATTACK') {
    const payload = { kedok: '👑 Founder Monad', alasan: 'Klaim Bounty PR #99', taktik: 'Mode Darurat Tanpa Cek' };
    const player = room.scoreboard()[0];
    queueAttack(newAttack(arena.roomCode, player?.playerId ?? 'HOST_SAMPLE', player?.nickname ?? 'TIM_CONTOH', Object.values(payload).join('. '), payload, false));
  } else if (cmd === 'PANIC_BLUR') {
    room.panicBlur = !room.panicBlur;
    broadcast(arena, 'stage', 'panic_blur', { active: room.panicBlur });
    if (room.panicBlur) for (const attack of room.attacks.values()) {
      broadcast(arena, 'stage', 'killfeed', { entry: { attackId: attack.attackId, nickname: attack.nickname, text: '[SENSOR OTOMATIS]', verdict: attack.status, simulated: attack.simulated } });
    }
  } else if (cmd === 'REFILL') {
    broadcast(arena, 'host', 'host_notice', { message: 'REFILL adalah penanda operasional saja. Isi ulang vault lewat wallet tim; backend tidak mengirim dana secara implisit.' });
  } else if (cmd === 'REHEARSAL') {
    room.rehearsal = data.enabled === undefined ? !room.rehearsal : Boolean(data.enabled);
  } else throw new Error('Unknown host command');
  broadcastState(arena, true);
  broadcast(arena, 'host', 'host_status', hostStatus(arena));
}

function protocolMessage(client: Client, raw: string): void {
  const arena = arenas.get(client.roomCode);
  if (!arena) { push(client, 'room_rejected'); return; }
  const room = arena.room;
  let message: Record<string, unknown>;
  try { message = JSON.parse(raw) as Record<string, unknown>; }
  catch { push(client, 'error', { reason: 'INVALID_JSON' }); return; }
  const type = message.type;
  if (type === 'join' && client.channel === 'play') {
    const nickname = message.nickname;
    if (!validNickname(nickname)) { push(client, 'join_rejected', { reason: 'INVALID_NICKNAME' }); return; }
    const existing = room.createPlayer(nickname, client.ip);
    if (!existing.player) { push(client, 'join_rejected', { reason: existing.reason }); return; }
    sendJoined(arena, client, existing.player);
    broadcast(arena, 'stage', 'player_joined', { nickname: existing.player.nickname, count: room.players.size });
    return;
  }
  if (type === 'rejoin' && client.channel === 'play' && typeof message.playerId === 'string') {
    const player = room.rejoin(message.playerId);
    if (!player) { push(client, 'join_rejected', { reason: 'SESSION_EXPIRED' }); return; }
    sendJoined(arena, client, player);
    return;
  }
  if (type === 'attack' && client.channel === 'play') {
    const player = client.playerId ? room.players.get(client.playerId) : undefined;
    if (!player) { push(client, 'attack_rejected', { reason: 'NOT_JOINED' }); return; }
    if (!['ROUND_1_RAW', 'ROUND_2_SHIELD'].includes(room.phase)) { push(client, 'attack_rejected', { reason: 'ROUND_CLOSED' }); return; }
    if (room.queue.length >= config.queueMax) { push(client, 'attack_rejected', { reason: 'QUEUE_FULL' }); return; }
    if (player.cooldownUntil > Date.now()) { push(client, 'attack_rejected', { reason: 'COOLDOWN' }); return; }
    if (room.queuedForPlayer(player.playerId)) { push(client, 'attack_rejected', { reason: 'ACTIVE_ATTACK' }); return; }
    const parsed = validateAttack(message.payload, message.manual);
    if (!parsed.ok) { push(client, 'attack_rejected', { reason: parsed.reason }); return; }
    const attack = newAttack(arena.roomCode, player.playerId, player.nickname, parsed.text, parsed.payload);
    queueAttack(attack);
    return;
  }
  if (type === 'host_cmd' && (client.channel === 'host' || client.channel === 'stage')) {
    if (!client.authorized) { push(client, 'host_status', { authorized: false, state: room.gameState() }); return; }
    const cmd = message.cmd;
    if (typeof cmd !== 'string') { push(client, 'host_error', { message: 'Missing cmd' }); return; }
    void hostCommand(arena, cmd, message as Record<string, unknown>).catch((error) => push(client, 'host_error', { message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (type === 'panic' && (client.channel === 'host' || client.channel === 'stage')) {
    if (!client.authorized) { push(client, 'host_status', { authorized: false, readOnly: true }); return; }
    void hostCommand(arena, 'PANIC_BLUR', {}).catch((error) => push(client, 'host_error', { message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  push(client, 'error', { reason: 'UNKNOWN_MESSAGE' });
}

app.get('/health', async () => ({ ok: true, service: 'Montank backend', rooms: arenas.size, chainConfigured: chain.configured }));
app.get('/', async (_request, reply) => reply.sendFile('index.html'));
app.get('/api/lobby', async (request, reply) => {
  const query = request.query as Record<string, unknown>;
  const arena = typeof query.room === 'string' ? getArena(query.room) : defaultArena();
  if (!arena) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' });
  const baseUrl = publicBaseUrl(request);
  const playUrl = `${baseUrl}/play?room=${arena.roomCode}`;
  return {
  baseUrl,
  roomCode: arena.roomCode,
  playUrl,
  manualUrl: playUrl,
  qrUrl: `${baseUrl}/qr.png?room=${encodeURIComponent(arena.roomCode)}`,
  txExplorerBaseUrl: config.monadScanTxBaseUrl,
  players: arena.room.players.size,
  playerCap: config.playerCap,
  phase: arena.room.gameState(),
  message: 'Agen Bendahara sengaja dibuat lugu.',
  };
});
app.post('/api/rooms', async (_request, reply) => {
  let roomCode = generateRoomCode();
  while (arenas.has(roomCode)) roomCode = generateRoomCode();
  const hostToken = randomBytes(32).toString('hex');
  const arena = createArena(roomCode, hostToken);
  await arena.room.restore();
  defaultRoomCode = roomCode;
  await persistRoomInvite();
  reply.header('Cache-Control', 'no-store');
  return { roomCode, ownerToken: hostToken };
});
app.get('/api/rooms/:roomCode', async (request) => {
  const { roomCode } = request.params as { roomCode: string };
  return { valid: Boolean(getArena(roomCode)) };
});
app.get('/api/rooms/:roomCode/leaderboard', async (request, reply) => {
  const { roomCode } = request.params as { roomCode: string };
  const arena = getArena(roomCode);
  if (!arena) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' });
  return {
    standings: arena.room.scoreboard().map(({ nickname, score }, index) => ({ rank: index + 1, nickname, score })),
  };
});
const ROOM_START_COUNTDOWN_MS = 3000;

app.post('/api/rooms/:roomCode/start', async (request, reply) => {
  const { roomCode } = request.params as { roomCode: string };
  const arena = getArena(roomCode);
  if (!arena) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' });
  const authorization = request.headers.authorization ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!tokenMatches(token, arena.hostToken)) return reply.code(403).send({ error: 'HOST_ONLY' });
  const body = request.body as { playerId?: unknown } | undefined;
  if (typeof body?.playerId !== 'string' || !arena.room.players.has(body.playerId)) {
    return reply.code(409).send({ error: 'CREATOR_NOT_JOINED' });
  }
  if (arena.room.phase !== 'LOBBY_OPEN') return reply.code(409).send({ error: 'GAME_ALREADY_STARTED' });
  if (arena.room.roundStartsAt) return { ok: true, state: arena.room.gameState() };
  const startsAt = Date.now() + ROOM_START_COUNTDOWN_MS;
  arena.room.roundStartsAt = startsAt;
  broadcastState(arena, true);
  setTimeout(() => {
    if (arena.room.roundStartsAt === startsAt && arena.room.phase === 'LOBBY_OPEN') {
      void hostCommand(arena, 'ROUND1', {}).catch((error) => app.log.error(error, 'room start failed'));
    }
  }, ROOM_START_COUNTDOWN_MS + 30);
  return { ok: true, state: arena.room.gameState() };
});
app.post('/api/rooms/:roomCode/leave', async (request, reply) => {
  const { roomCode } = request.params as { roomCode: string };
  const arena = getArena(roomCode);
  const body = request.body as { playerId?: unknown } | undefined;
  if (!arena) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' });
  if (typeof body?.playerId !== 'string' || body.playerId.length > 64) {
    return reply.code(400).send({ error: 'INVALID_PLAYER_ID' });
  }

  const player = arena.room.removePlayer(body.playerId);
  if (!player) return reply.code(404).send({ error: 'PLAYER_NOT_FOUND' });
  for (const client of clients) {
    if (client.roomCode === arena.roomCode && client.playerId === player.playerId) delete client.playerId;
  }
  broadcast(arena, 'all', 'player_left', { nickname: player.nickname, count: arena.room.players.size });
  sendScoreboards(arena);
  sendQueueUpdates(arena);
  broadcast(arena, 'host', 'host_status', hostStatus(arena));
  return { ok: true, count: arena.room.players.size };
});
app.get('/qr.png', async (request, reply) => {
  const query = request.query as Record<string, unknown>;
  const arena = typeof query.room === 'string' ? getArena(query.room) : defaultArena();
  if (!arena) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' });
  const png = await QRCode.toBuffer(`${publicBaseUrl(request)}/play?room=${arena.roomCode}`, { width: 480, margin: 2, errorCorrectionLevel: 'M' });
  return reply.type('image/png').send(png);
});

for (const channel of ['play', 'stage', 'host'] as const) {
  for (const url of [`/${channel}`, `/ws/${channel}`]) app.route({ method: 'GET', url, handler: async (_request, reply) => reply.sendFile('index.html'), wsHandler: (socket, request) => {
    const query = request.query as Record<string, unknown>;
    const roomCode = typeof query.room === 'string' ? query.room.toUpperCase() : channel === 'play' ? '' : defaultRoomCode;
    const arena = arenas.get(roomCode);
    if (!arena) {
      send(socket as unknown as Socket, { type: 'room_rejected' });
      socket.close(4404, 'Invalid or missing room code');
      return;
    }
    const token = query.t ?? query.token;
    const client: Client = {
      socket: socket as unknown as Socket,
      channel,
      authorized: channel === 'play' ? false : isHostToken(token),
      ip: clientIp(request),
      roomCode,
    };
    clients.add(client);
    if (channel === 'play') push(client, 'state', arena.room.gameState());
    else if (channel === 'stage') {
      push(client, 'state', arena.room.gameState());
      push(client, 'scoreboard', { top: arena.room.scoreboard().map(({ nickname, score }) => ({ nickname, score })) });
      push(client, 'player_joined', { count: arena.room.players.size });
      push(client, 'treasury', currentTreasury);
      push(client, 'queue', { count: arena.room.queue.length, max: config.queueMax });
      push(client, 'host_status', { authorized: client.authorized, readOnly: !client.authorized });
      push(client, 'telemetry', telemetrySnapshot(arena));
      if (arena.latestRawBreach) push(client, 'raw_breach', arena.latestRawBreach);
    } else {
      push(client, 'host_status', { ...hostStatus(arena), authorized: client.authorized, readOnly: !client.authorized });
    }
    socket.on('message', (data: { toString(): string }) => protocolMessage(client, data.toString()));
    socket.on('close', () => {
      clients.delete(client);
      if (client.playerId) arena.room.disconnect(client.playerId);
    });
    socket.on('error', (error: Error) => app.log.warn(error, 'WebSocket client error'));
  } });
}

async function start(): Promise<void> {
  await loadActiveRoomCode();
  for (const arena of arenas.values()) await arena.room.restore();
  await guardians.loadClaims();
  chain.start();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Montank listening on ${config.host}:${config.port}; rooms=${arenas.size}`);
  scoreboardTimer = setInterval(() => {
    for (const arena of arenas.values()) {
      if (Date.now() - arena.lastScoreboardAt >= 1000) { arena.lastScoreboardAt = Date.now(); sendScoreboards(arena); }
      broadcastState(arena);
    }
  }, 250);
  phaseTimer = setInterval(() => {
    for (const arena of arenas.values()) {
      if (arena.room.phase === 'LOBBY_OPEN' || arena.room.gameState().tMsLeft > 0 || arena.room.phase === 'GAME_OVER') continue;
      arena.room.advancePhase();
      if (arena.room.phase === 'ROUND_1_RAW') arena.latestRawBreach = null;
      broadcastState(arena, true);
      broadcast(arena, 'host', 'host_status', hostStatus(arena));
    }
  }, 250);
  workerTimer = setInterval(() => {
    for (const arena of arenas.values()) {
      if (arena.workerBusy || arena.room.queue.length === 0) continue;
      arena.workerBusy = true;
      const attack = arena.room.nextAttack();
      if (!attack) { arena.workerBusy = false; continue; }
      sendQueueUpdates(arena);
      void processAttack(attack)
        .catch((error) => {
          app.log.error(error, 'Attack processing failed');
          sendAttackResult(attack, 'VICTIM', 'PROCESSING_ERROR', 0, ['Backend fallback; no payment was triggered']);
        })
        .finally(() => { arena.workerBusy = false; });
    }
  }, config.serviceIntervalMs);
  spotlightTimer = setInterval(() => { for (const arena of arenas.values()) publishSpotlight(arena); }, 3000);
  spotlightTimer.unref();
}

async function stop(): Promise<void> {
  clearInterval(scoreboardTimer);
  clearInterval(phaseTimer);
  clearInterval(workerTimer);
  clearInterval(spotlightTimer);
  for (const arena of arenas.values()) arena.room.stop();
  chain.stop();
  await app.close();
}

process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });

await start();
