// Bus: satu sumber state untuk /stage, /play, /host.
// Mode real: WebSocket (VITE_WS_URL atau ?ws=...). Tanpa WS -> MODE DEMO (mock),
// mesin simulasi sesuai PRD 2.1 (antrean), 2.2 (poin), 6.1 (penjaga). Angka mock berlabel virtual.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RoomCtx } from "./RoomCtx.js";
import { roomFromUrl } from "./room.js";
import { QUEUE, ROWS, composeAttack } from "../data/deck.js";
import { PHASE } from "./phases.js";

const qs = new URLSearchParams(window.location.search);
const roomCode = roomFromUrl();
const CONFIG = {
  wsUrl: qs.get("ws") || import.meta.env.VITE_WS_URL || "",
  vaultMon: Number(qs.get("vault")) || 24.5, // diganti saldo nyata saat backend memimpin
  rawMon: Number(qs.get("raw")) || 6.0,
  servingMs: 1200, // PRD 2.1: layanan ~1 serangan / 1,2 s
  virtual: false,
};

const BOTS = [
  "palau_mon", "kingLambe", "satriaRampok", "monadLoko", "budi_99",
  "jagotrust", "nongKoin", "rampokTV", "amisMON", "stgKoin",
];

const randInt = (a, b) => Math.round(a + Math.random() * (b - a));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const POINTS = { ATTEMPT: 10, LAYER0: 50, VICTIM: 100, G1: 250, G2: 500, BREACH: 1000 };

function initial() {
  return {
    phase: PHASE.LOBBY,
    startedAt: Date.now(),
    gameStartedAt: null,
    gameEndedAt: null,
    gameElapsedMs: 0,
    vaultOn: false,
    panic: false,
    virtual: CONFIG.virtual,
    bank: { vaultMon: CONFIG.vaultMon, rawMon: CONFIG.rawMon, heldMon: 0 },
    breachRaw: null, // {mon, secs}
    players: {},
    queueWaiting: 0,
    queuePosition: null,
    pending: [], // antrean server
    flight: null, // serangan yang sedang diproses penjaga (arena /play)
    attacks: [], // kill-feed, terbaru dulu
    focusId: null,
    vetoCount: 0,
    clearCount: 0,
    hostAuthorized: false,
    telemetry: { totalAttacks: 0, vetoes: 0, breaches: 0, medianEndToEndMs: null },
  };
}

/* ---------- verdict PRD 2.2 + latensi penjaga PRD 6.1 ---------- */
function guardMs(i) {
  if (i === 0) return randInt(5, 15); // P1 kode murni
  if (i === 1) return randInt(40, 90); // P2 validator
  return randInt(120, 220); // P3 scanner
}
function timelineFor() {
  const tl = { proposed: 0 };
  if (Math.random() < 0.75) tl.voted = randInt(280, 340); // 25% blok melompati Voted (PRD 3.1)
  tl.finalized = (tl.voted ?? 0) + randInt(280, 320);
  return tl;
}
function simulateVerdict(roll = Math.random()) {
  if (roll < 0.42) return { tier: "ATTEMPT", guards: null, timeline: null };
  if (roll < 0.54) return { tier: "LAYER0", guards: null, timeline: null, rejected: true };
  if (roll < 0.8)
    return { tier: "VICTIM", guards: [false, false, false].map((c, i) => ({ clear: c, ms: guardMs(i) })), timeline: timelineFor() };
  if (roll < 0.88)
    return { tier: "G1", guards: [true, false, false].map((c, i) => ({ clear: c, ms: guardMs(i) })), timeline: timelineFor() };
  if (roll < 0.94)
    return { tier: "G2", guards: [true, true, false].map((c, i) => ({ clear: c, ms: guardMs(i) })), timeline: timelineFor() };
  return { tier: "BREACH", guards: [true, true, true].map((c, i) => ({ clear: c, ms: guardMs(i) })), timeline: timelineFor() };
}

/* ---------- delta-bank ---------- */
function bankShift(bank, tier, amt) {
  if (tier === "VICTIM" || tier === "G1" || tier === "G2")
    return { ...bank, vaultMon: +(bank.vaultMon - amt).toFixed(2), heldMon: +(bank.heldMon + amt).toFixed(2) };
  if (tier === "BREACH")
    return { ...bank, vaultMon: +(bank.vaultMon - amt).toFixed(2), heldMon: Math.max(0, +(bank.heldMon - amt).toFixed(2)) };
  return bank;
}

const addScore = (players, nick, pts) =>
  players[nick] ? { ...players, [nick]: { ...players[nick], score: players[nick].score + pts } } : players;

/* ---------- Provider ---------- */

export function BusProvider({ children, role: appRole }) {
  const [state, setState] = useState(initial);
  const [mode, setMode] = useState("connecting");
  const role = appRole || window.location.pathname.replace(/\/+$/, "").slice(1) || "stage";
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  }, [state]);
  const ws = useRef(null);
  const outbox = useRef([]);
  const push = useCallback((fn) => setState((prev) => fn(prev)), []);

  const send = useCallback((message, { queueWhileConnecting = true } = {}) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      try {
        ws.current.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    }
    if (queueWhileConnecting && ws.current?.readyState === WebSocket.CONNECTING) {
      outbox.current.push(message);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    let dead = false;
    let reconnectTimer;
    if (role === "welcome") {
      if (role === "welcome") setMode("idle");
      return () => { dead = true; };
    }
    const connect = () => {
      if (dead) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = new URL(CONFIG.wsUrl || `${protocol}//${window.location.host}/ws/${role}`);
      if (roomCode) url.searchParams.set("room", roomCode);
      if (["host", "stage"].includes(role) && (qs.has("t") || qs.has("token"))) url.searchParams.set("t", qs.get("t") || qs.get("token"));
      const socket = new WebSocket(url);
      ws.current = socket;
      socket.onopen = () => {
        if (dead) return;
        setMode("real");
        const playerId = localStorage.getItem("pf_player_id");
        if (role === "play" && playerId) socket.send(JSON.stringify({ type: "rejoin", playerId }));
        const pending = outbox.current.splice(0);
        for (const message of pending) {
          if (role === "play" && playerId && ["join", "rejoin"].includes(message.type)) continue;
          socket.send(JSON.stringify(message));
        }
      };
    socket.onmessage = (ev) => {
      if (dead) return;
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "state") push((prev) => ({ ...prev, ...mapServerState(m, prev) }));
        else if (m.type === "game_reset") push((prev) => {
          const base = initial();
          const players = Object.fromEntries((m.players ?? []).map((player) => [player.nickname, { score: player.score ?? 0 }]));
          return {
            ...base,
            ...mapServerState(m.state, prev),
            playerId: prev.playerId,
            nickname: prev.nickname,
            hostAuthorized: prev.hostAuthorized,
            cooldownUntil: 0,
            lastAttackResult: null,
            playerCount: m.players?.length ?? prev.playerCount ?? 0,
            players,
            bank: prev.bank,
            lobbyInfo: prev.lobbyInfo,
            txExplorerBaseUrl: prev.txExplorerBaseUrl,
            telemetry: { totalAttacks: 0, vetoes: 0, breaches: 0, medianEndToEndMs: null },
          };
        });
        else if (m.type === "joined") {
          localStorage.setItem("pf_player_id", m.playerId);
          localStorage.setItem("pf_nick", m.nickname);
          push((prev) => ({ ...prev, playerId: m.playerId, nickname: m.nickname, ...mapServerState(m.state, prev) }));
        }
        else if (m.type === "join_rejected") {
          localStorage.removeItem("pf_player_id");
          if (m.reason === "SESSION_EXPIRED") {
            push((prev) => ({ ...prev, joinError: null, playerId: null, nickname: null, activeAttackId: null, queuePosition: null }));
          } else {
            push((prev) => ({ ...prev, joinError: m.reason, playerId: null, activeAttackId: null, queuePosition: null }));
          }
        }
        else if (m.type === "room_rejected") push((prev) => ({ ...prev, joinError: "ROOM_NOT_FOUND" }));
        else if (m.type === "scoreboard") push((prev) => ({ ...prev, players: mergePlayers(prev.players, m.top), myScore: m.score, myRank: m.rank }));
        else if (m.type === "player_joined") push((prev) => ({ ...prev, playerCount: m.count, players: m.nickname ? { ...prev.players, [m.nickname]: prev.players[m.nickname] ?? { score: 0 } } : prev.players }));
        else if (m.type === "player_left") push((prev) => {
          const players = { ...prev.players };
          if (m.nickname) delete players[m.nickname];
          return { ...prev, playerCount: m.count ?? Math.max(0, (prev.playerCount ?? 0) - 1), players };
        });
        else if (m.type === "queue") push((prev) => ({ ...prev, queueWaiting: m.count ?? prev.queueWaiting }));
        else if (m.type === "queue_update" || m.type === "attack_ack") push((prev) => ({ ...prev, queuePosition: m.queuePos ?? prev.queuePosition, queueEtaMs: m.estMs ?? prev.queueEtaMs, activeAttackId: m.attackId ?? prev.activeAttackId }));
        else if (m.type === "killfeed") push((prev) => ({ ...prev, attacks: upsertAttack(prev.attacks, m.entry) }));
        else if (m.type === "spotlight") push((prev) => applySpotlight(prev, m));
        else if (m.type === "guardian_decision") push((prev) => updateGuard(prev, m));
        else if (m.type === "treasury") push((prev) => ({ ...prev, bank: { ...prev.bank, vaultMon: Number(m.balance) || 0, heldMon: Number(m.held) || 0 } }));
        else if (m.type === "pipeline") push((prev) => updatePipeline(prev, m));
        else if (m.type === "panic_blur") push((prev) => ({ ...prev, panic: Boolean(m.active) }));
        else if (m.type === "attack_status") push((prev) => ({ ...prev, activeAttackId: m.attackId ?? null, queuePosition: ["QUEUED"].includes(m.status) ? prev.queuePosition : null }));
        else if (m.type === "attack_result") push((prev) => updateAttackResult(prev, m));
        else if (m.type === "attack_rejected") {
          const messages = {
            NOT_JOINED: "Sesi pemain belum tersambung ke room. Coba muat ulang room.",
            ROUND_CLOSED: "Ronde belum dibuka atau sudah selesai.",
            QUEUE_FULL: "Antrean serangan penuh. Coba lagi sebentar.",
            COOLDOWN: "Serangan masih dalam cooldown. Tunggu sebentar.",
            ACTIVE_ATTACK: "Serangan sebelumnya masih diproses.",
            CONTENT_FILTERED: "Prompt berisi kata yang tidak diizinkan.",
            MANUAL_TOO_LONG: "Prompt terlalu panjang. Maksimal 1.000 karakter.",
            MANUAL_DISABLED: "Prompt manual tidak tersedia di server ini. Muat ulang halaman untuk mengambil versi terbaru.",
          };
          push((prev) => ({ ...prev, attackError: messages[m.reason] ?? m.reason ?? "Serangan ditolak oleh server.", activeAttackId: null, queuePosition: null }));
        }
        else if (m.type === "cooldown") push((prev) => ({ ...prev, cooldownUntil: m.untilEpochSec * 1000 }));
        else if (m.type === "raw_breach") push((prev) => ({ ...prev, breachRaw: { mon: m.mon, secs: m.secs, txUrl: m.txHash ? prev.txExplorerBaseUrl + m.txHash : null } }));
        else if (m.type === "telemetry") push((prev) => ({ ...prev, telemetry: { totalAttacks: m.totalAttacks ?? prev.telemetry.totalAttacks, vetoes: m.vetoes ?? prev.telemetry.vetoes, breaches: m.breaches ?? prev.telemetry.breaches, medianEndToEndMs: "medianEndToEndMs" in m ? m.medianEndToEndMs : prev.telemetry.medianEndToEndMs } }));
        else if (m.type === "lobby_info") push((prev) => ({ ...prev, lobbyInfo: m }));
        else if (m.type === "host_status") push((prev) => ({ ...prev, hostAuthorized: !!m.authorized, hostStatus: m, playerCount: m.players ?? prev.playerCount }));
        else if (m.type === "host_error" || m.type === "host_alert") push((prev) => ({ ...prev, hostMessage: m.message }));
      } catch { /* payload bukan JSON: abaikan */ }
      };
      socket.onerror = () => { if (!dead) setMode("disconnected"); };
      socket.onclose = (event) => {
        if (ws.current === socket) ws.current = null;
        if (dead) return;
        setMode("disconnected");
        if (event.code === 4404) return;
        reconnectTimer = setTimeout(connect, 1000 + Math.random() * 2000);
      };
    };
    connect();
    return () => {
      dead = true;
      clearTimeout(reconnectTimer);
      ws.current?.close();
      ws.current = null;
    };
  }, [push, role]);

  useEffect(() => {
    let active = true;
    fetch(`/api/lobby${roomCode ? `?room=${encodeURIComponent(roomCode)}` : ""}`).then((response) => response.ok ? response.json() : null)
      .then((lobbyInfo) => {
        if (active && lobbyInfo) push((prev) => ({ ...prev, lobbyInfo, txExplorerBaseUrl: lobbyInfo.txExplorerBaseUrl || prev.txExplorerBaseUrl }));
      }).catch(() => {});
    return () => { active = false; };
  }, [push]);

  const api = useMemo(
    () => ({
      join: (nickname) => {
        push((prev) => ({ ...prev, joinError: null }));
        send({ type: "join", nickname });
      },
      attack: (payload) => {
        push((prev) => ({ ...prev, attackError: null }));
        return send({ type: "attack", payload: payload.payload ?? {}, manual: payload.rawText }, { queueWhileConnecting: false });
      },
      panic: () => send({ type: "host_cmd", cmd: "PANIC_BLUR" }),
      host: {
        lobby: () => send({ type: "host_cmd", cmd: "GOTO:LOBBY_OPEN" }),
        newGame: () => send({ type: "host_cmd", cmd: "NEW_GAME" }),
        startRaw: () => send({ type: "host_cmd", cmd: "ROUND1" }),
        vaultOn: () => send({ type: "host_cmd", cmd: "VAULT_ON" }),
        gameOver: () => send({ type: "host_cmd", cmd: "GOTO:GAME_OVER" }),
        claimVendor: () => send({ type: "host_cmd", cmd: "JUDGE_CLAIM_A" }),
        claimVendorB: () => send({ type: "host_cmd", cmd: "JUDGE_CLAIM_B" }),
        teamAttack: () => send({ type: "host_cmd", cmd: "SAMPLE_ATTACK" }),
        crowd: () => send({ type: "host_cmd", cmd: "SIM_CROWD", count: 5 }),
      },
    }),
    [send],
  );

  return <RoomCtx.Provider value={{ state, api, mode }}>{children}</RoomCtx.Provider>;
}

const DURATIONS = { LOBBY_OPEN: 60_000, ROUND_1_RAW: 60_000, ROUND_2_SHIELD: 120_000, GAME_OVER: 60_000 };
function applyLocalMessage(message, push, ref) {
  if (!message) return;
  if (message.type === "join") {
    const nickname = message.nickname ?? message.nick ?? "PLAYER";
    applyHost("join", { nick: nickname }, push, ref);
    push((previous) => ({ ...previous, nickname, playerId: `demo-${nickname}`, playerCount: Object.keys(previous.players).length + (previous.players[nickname] ? 0 : 1), joinError: null }));
    return;
  }
  if (message.type === "attack") {
    const payload = message.payload ?? {};
    const text = message.manual || [payload.kedok, payload.alasan, payload.taktik].filter(Boolean).join(". ") || composeAttack([0, 1, 0]);
    const queuePosition = ref.current.queueWaiting + 1;
    applyHost("attack", { nick: ref.current.nickname || localStorage.getItem("pf_nick") || "PLAYER", rawText: text }, push, ref);
    push((previous) => ({ ...previous, queuePosition }));
    return;
  }
  if (message.type === "panic") { applyHost("panic", {}, push, ref); return; }
  if (message.type === "host_cmd") {
    const map = {
      "GOTO:LOBBY_OPEN": "host:lobby", ROUND1: "host:raw", VAULT_ON: "host:vaultOn",
      "GOTO:GAME_OVER": "host:over", JUDGE_CLAIM_A: "host:claimVendor", JUDGE_CLAIM_B: "host:claimVendor",
      SAMPLE_ATTACK: "host:teamAttack", SIM_CROWD: "host:crowd",
    };
    if (message.cmd === "PANIC_BLUR") applyHost("panic", {}, push, ref);
    else if (map[message.cmd]) applyHost(map[message.cmd], message, push, ref);
  }
}

function mapServerState(server = {}, prev = initial()) {
  const phase = server.phase ?? prev.phase;
  const duration = DURATIONS[phase] ?? 60_000;
  return { phase, startedAt: Date.now() - Math.max(0, duration - (server.tMsLeft ?? duration)), vaultOn: !!server.vaultOn,
    gameStartedAt: server.gameStartedAt ?? null, gameEndedAt: server.gameEndedAt ?? null, gameElapsedMs: server.gameElapsedMs ?? 0,
    roundStartsAt: typeof server.roundStartsAt === "number" ? server.roundStartsAt : null,
    panic: !!server.panicBlur, virtual: !!server.rehearsal };
}
function mergePlayers(previous, rows = []) {
  return Object.fromEntries(rows.map((p) => [p.nickname, { score: p.score ?? 0 }]));
}
function tierFor(entry = {}) {
  if (entry.verdict === "RAW_BREACH" || entry.verdict === "EXECUTED") return "BREACH";
  const basePoints = entry.basePoints ?? entry.points ?? 0;
  if (entry.verdict === "VETOED") return basePoints >= 500 ? "G2" : basePoints >= 250 ? "G1" : "VICTIM";
  if (entry.verdict === "REJECTED") return basePoints >= 50 ? "LAYER0" : "ATTEMPT";
  if (["PROPOSAL_FAILED", "LIVE_CHAIN_UNAVAILABLE"].includes(entry.verdict)) return "LAYER0";
  return "ATTEMPT";
}
function upsertAttack(attacks, entry = {}) {
  const id = entry.attackId ?? entry.id;
  if (!id) return attacks;
  const previous = attacks.find((a) => a.id === id);
  const tier = tierFor(entry);
  const item = { ...previous, id, nick: entry.nickname ?? previous?.nick ?? "—", text: entry.text ?? previous?.text ?? "",
    labels: [entry.source === "fallback parser" ? "fallback parser" : null, entry.source === "rehearsal" || entry.rehearsal ? "REHEARSAL" : null, entry.simulated ? "SIM" : null].filter(Boolean),
    verdict: { tier, points: entry.points ?? previous?.verdict?.points ?? 0 }, promptQuality: entry.promptQuality ?? previous?.promptQuality ?? null, guards: previous?.guards ?? null,
    timeline: previous?.timeline ?? null, amountMon: Number(entry.amount) || null, ts: Date.now(), virtual: !!entry.rehearsal };
  return [item, ...attacks.filter((a) => a.id !== id)].slice(0, 60);
}
function updateGuard(prev, m) {
  const target = prev.attacks.find((a) => a.id === (m.attackId ?? m.actionId));
  if (!target) return prev;
  const guards = [...(target.guards ?? Array(3).fill(null))];
  guards[m.guardianId - 1] = { clear: m.decision === "CLEAR", ms: m.measuredMs ?? 0 };
  return { ...prev, attacks: prev.attacks.map((a) => a.id === target.id ? { ...a, guards } : a) };
}
function updatePipeline(prev, m) {
  const target = prev.attacks.find((a) => a.id === (m.attackId ?? m.actionId));
  if (!target) return prev;
  const timeline = { ...(target.timeline ?? {}) };
  if (m.commitState === "Proposed") timeline.proposed = m.measuredMs ?? 0;
  else if (m.commitState === "Voted") timeline.voted = m.measuredMs ?? 0;
  else if (m.commitState === "Finalized") timeline.finalized = m.measuredMs ?? 0;
  return { ...prev, attacks: prev.attacks.map((a) => a.id === target.id ? { ...a, timeline, txUrl: m.txHash ? prev.txExplorerBaseUrl + m.txHash : a.txUrl } : a) };
}
function updateAttackResult(prev, m) {
  const basePoints = m.basePoints ?? m.points;
  const tier = m.verdict === "RAW_BREACH" || m.verdict === "EXECUTED" ? "BREACH" : m.verdict === "VETOED" ? (basePoints >= 500 ? "G2" : basePoints >= 250 ? "G1" : "VICTIM") : m.layer === "LAYER0" ? "LAYER0" : "ATTEMPT";
  return { ...prev, attacks: prev.attacks.map((a) => a.id === m.attackId ? { ...a, verdict: { tier, points: m.points }, promptQuality: m.promptQuality ?? a.promptQuality, labels: [...new Set([...a.labels, ...(m.breakdown ?? []).filter((x) => /fallback parser|rehearsal/i.test(x))])] } : a), activeAttackId: null, queuePosition: null, lastAttackResult: m };
}

function applySpotlight(prev, m) {
  const incoming = m.attack ?? {};
  const id = incoming.attackId ?? incoming.id;
  if (!id) return { ...prev, spotlight: m };
  const votes = m.votes ?? [];
  const vetoes = votes.filter((vote) => vote.decision === "VETO").length;
  const clears = votes.length - vetoes;
  const points = vetoes ? (clears === 1 ? 250 : clears === 2 ? 500 : 100) : 1000;
  const entry = { attackId: id, nickname: incoming.nickname, text: incoming.text, verdict: vetoes ? "VETOED" : "EXECUTED", points };
  const attacks = upsertAttack(prev.attacks, entry).map((attack) => attack.id === id && votes.length
    ? { ...attack, guards: votes.map((vote) => ({ clear: vote.decision === "CLEAR", ms: vote.ms ?? 0 })) }
    : attack);
  return { ...prev, spotlight: { ...m, attackId: id }, attacks };
}

/* =================== Aksi (dipakai mode real & mock) =================== */

function applyHost(type, p, push, ref) {
  const now = Date.now();
  switch (type) {
    case "join":
      push((st) => (st.players[p.nick] ? st : { ...st, players: { ...st.players, [p.nick]: { score: 0 } } }));
      break;
    case "attack": {
      const st = ref.current;
      if (st.queueWaiting >= QUEUE.MAX) return;
      const payload = {
        nick: p.nick,
        text: p.rawText || composeAttack(p.picked),
        simLabel: p.simLabel || null,
        ts: now,
      };
      push((s2) => ({ ...s2, queueWaiting: s2.queueWaiting + 1, pending: [...s2.pending, payload] }));
      break;
    }
    case "panic":
      push((st) => ({ ...st, panic: !st.panic }));
      break;
    case "host:lobby":
      push((st) => ({ ...st, phase: PHASE.LOBBY, startedAt: now, gameStartedAt: null, gameEndedAt: null, gameElapsedMs: 0, breachRaw: null, flight: null, players: {}, pending: [], queueWaiting: 0 }));
      break;
    case "host:raw":
      push((st) => ({ ...st, phase: PHASE.RAW, startedAt: now, gameStartedAt: st.gameStartedAt ?? now, gameEndedAt: null, gameElapsedMs: 0, vaultOn: false, breachRaw: null, flight: null }));
      break;
    case "host:vaultOn":
      push((st) => ({ ...st, phase: PHASE.SHIELD, startedAt: now, vaultOn: true, flight: null, players: fillBots(st) }));
      break;
    case "host:over":
      push((st) => ({ ...st, phase: PHASE.OVER, startedAt: now, gameEndedAt: now, gameElapsedMs: st.gameStartedAt ? now - st.gameStartedAt : st.gameElapsedMs }));
      break;
    case "host:claimVendor":
      push((st) => ({
        ...st,
        attacks: [
          { id: `j-${now}`, nick: "JURY", text: "Registered Vendor Claim — Path A, instant release", labels: [], verdict: { tier: "VENDORA" }, guards: null, timeline: { proposed: 0, finalized: randInt(560, 640) }, ts: now, virtual: true },
          ...st.attacks,
        ].slice(0, 60),
      }));
      break;
    case "host:teamAttack":
      injectAttack(push, ref, { nick: pick(BOTS), simLabel: "Example Attack" });
      break;
        case "host:crowd":
      push((st) => ({ ...st, players: { ...st.players, ...fillBots(st), ...fillBots(st) } }));
      break;
    default:
      break;
  }
}

function fillBots(st) {
  const add = {};
  for (const n of BOTS) if (!st.players[n]) add[n] = { score: 0 };
  return add;
}

/* =================== MESIN MOCK =================== */

function tickEngine(push, ref, servingMs) {
  const st = ref.current;
  const now = Date.now();

  // Ronde: bot menembak agar antrean hidup (PRD: antrean tampil, bukan disembunyikan)
  if (st.phase === PHASE.RAW || st.phase === PHASE.SHIELD) {
    if (st.queueWaiting < QUEUE.MAX && Math.random() < (st.phase === PHASE.RAW ? 0.06 : 0.14)) {
      injectAttack(push, ref, { nick: pick(BOTS) });
    }
  }
  // layani 1 serangan per ~servingMs
  const due = st.pending[0];
  if (due && now - due.ts >= (st.phase === PHASE.RAW ? 700 : servingMs)) {
    let served = null;
    push((s2) => {
      served = s2.pending[0];
      return { ...s2, pending: s2.pending.slice(1), queueWaiting: Math.max(0, s2.queueWaiting - 1) };
    });
    if (served) resolve(push, ref, served);
  }
}

function injectAttack(push, ref, { nick, simLabel }) {
  const st = ref.current;
  if (st.queueWaiting >= QUEUE.MAX) return;
  if (st.phase !== PHASE.RAW && st.phase !== PHASE.SHIELD) return;
  const picked = ROWS.map(() => randInt(0, 3));
  push((s2) => ({
    ...s2,
    queueWaiting: s2.queueWaiting + 1,
    pending: [...s2.pending, { nick, text: composeAttack(picked), simLabel, ts: Date.now() }],
  }));
}

function resolve(push, ref, atk) {
  const st = ref.current;
  const now = Date.now();
  const inRaw = st.phase === PHASE.RAW;

  let v = simulateVerdict();
  // Ronde 1 tanpa pelindung: pertama yang menipu agen langsung jebol (PRD fase 2)
  if (inRaw && v.tier === "ATTEMPT" && Math.random() < 0.5) v = { ...v, tier: "BREACH" };

  const amt = atk.text.includes("4.9") ? 4.9 : Math.round((0.4 + Math.random() * 4.4) * 10) / 10;
  const item = {
    id: `a-${now}-${Math.random().toString(36).slice(2, 7)}`,
    nick: atk.nick,
    text: atk.text,
    labels: [atk.simLabel, !inRaw && Math.random() < 0.1 ? "fallback parser" : null].filter(Boolean),
    verdict: { tier: v.tier, points: POINTS[v.tier] ?? 0 },
    guards: v.guards,
    timeline: v.timeline,
    amountMon: ["VICTIM", "G1", "G2", "BREACH"].includes(v.tier) ? amt : null,
    ts: now,
    virtual: true,
  };

  const commit = (s2) => ({
    ...s2,
    players: addScore(s2.players, atk.nick, POINTS[v.tier] ?? 0),
    bank: inRaw && v.tier === "BREACH"
      ? s2.bank
      : bankShift(s2.bank, v.tier, v.tier === "ATTEMPT" || v.tier === "LAYER0" ? 0 : amt),
    breachRaw:
      inRaw && v.tier === "BREACH"
        ? { mon: s2.bank.rawMon, secs: ((now - s2.startedAt) / 1000).toFixed(1) }
        : s2.breachRaw,
    vetoCount: s2.vetoCount + (item.guards?.filter((g) => !g.clear).length || 0),
    clearCount: s2.clearCount + (item.guards?.filter((g) => g.clear).length || 0),
    telemetry: {
      totalAttacks: s2.telemetry.totalAttacks + 1,
      vetoes: s2.telemetry.vetoes + (item.guards?.filter((g) => !g.clear).length || 0),
      breaches: s2.telemetry.breaches + (v.tier === "BREACH" ? 1 : 0),
    },
    attacks: [item, ...s2.attacks].slice(0, 60),
    queuePosition: null,
    focusId: focusWeight(s2.focusId, item),
    spotlight: { attackId: item.id },
  });

  // Ronde 2 dengan penjaga: arena /play melihat reaksi berurutan dulu
  // (flight), verdict baru masuk kill-feed sehabis penjaga terakhir bersuara.
  if (!inRaw && v.guards) {
    const maxMs = Math.max(...v.guards.map((g) => g.ms));
    push((s2) => ({ ...s2, flight: { nick: atk.nick, startedAt: now, guards: v.guards, tier: v.tier } }));
    setTimeout(() => {
      push((s2) => ({ ...commit(s2), flight: s2.flight?.nick === atk.nick && s2.flight.startedAt === now ? null : s2.flight }));
    }, maxMs + 400);
    return;
  }
  push(commit);
}

const FOCUS_W = { BREACH: 10, G2: 9, G1: 8, VENDORA: 7, VICTIM: 6 };
function focusWeight(prevId, item) {
  if ((FOCUS_W[item.verdict.tier] ?? 0) >= 6) return item.id;
  return prevId ?? item.id;
}
