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
import { QUEUE, ROWS, composeAttack } from "../data/deck.js";
import { PHASE } from "./phases.js";

const qs = new URLSearchParams(window.location.search);
const CONFIG = {
  wsUrl: qs.get("ws") || import.meta.env.VITE_WS_URL || "",
  vaultMon: Number(qs.get("vault")) || 24.5, // diganti saldo nyata saat backend memimpin
  rawMon: Number(qs.get("raw")) || 6.0,
  servingMs: 1200, // PRD 2.1: layanan ~1 serangan / 1,2 s
  virtual: !qs.get("ws") && !import.meta.env.VITE_WS_URL,
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
    vaultOn: false,
    panic: false,
    virtual: CONFIG.virtual,
    bank: { vaultMon: CONFIG.vaultMon, rawMon: CONFIG.rawMon, heldMon: 0 },
    breachRaw: null, // {mon, secs}
    players: {},
    queueWaiting: 0,
    pending: [], // antrean server
    flight: null, // serangan yang sedang diproses penjaga (arena /play)
    attacks: [], // kill-feed, terbaru dulu
    focusId: null,
    vetoCount: 0,
    clearCount: 0,
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

export function BusProvider({ children }) {
  const [state, setState] = useState(initial);
  const [mode, setMode] = useState(CONFIG.wsUrl ? "connecting" : "mock");
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  }, [state]);
  const ws = useRef(null);
  const push = useCallback((fn) => setState((prev) => fn(prev)), []);

  const cmd = useCallback(
    (type, payload = {}) => {
      if (mode === "real" && ws.current?.readyState === 1) {
        ws.current.send(JSON.stringify({ type, ...payload }));
        return;
      }
      // jelaskan intent sebagai perubahan state (mock)
      applyHost(type, payload, push, ref);
    },
    [mode, push],
  );

  useEffect(() => {
    if (!CONFIG.wsUrl) return;
    let dead = false;
    const socket = new WebSocket(CONFIG.wsUrl);
    ws.current = socket;
    socket.onopen = () => !dead && setMode("real");
    socket.onmessage = (ev) => {
      if (dead) return;
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "room") setState((prev) => ({ ...prev, ...m.state, virtual: false }));
        else if (m.type === "queue") setState((prev) => ({ ...prev, queueWaiting: m.waiting }));
        else if (m.type === "feed") push((prev) => ({ ...prev, attacks: [m.item, ...prev.attacks].slice(0, 60) }));
        else if (m.type === "phase") setState((prev) => ({ ...prev, phase: m.phase, startedAt: Date.now() }));
        else if (m.type === "panic") setState((prev) => ({ ...prev, panic: true }));
      } catch { /* payload bukan JSON: abaikan */ }
    };
    socket.onerror = () => setMode("mock");
    socket.onclose = () => !dead && setMode("mock");
    return () => {
      dead = true;
      socket.close();
    };
  }, [push]);

  useEffect(() => {
    if (mode !== "mock") return;
    const t = setInterval(() => tickEngine(push, ref, CONFIG.servingMs), 250);
    return () => clearInterval(t);
  }, [mode, push]);

  const api = useMemo(
    () => ({
      join: (nick) => cmd("join", { nick }),
      attack: (payload) => cmd("attack", payload),
      panic: () => cmd("panic"),
      host: {
        lobby: () => cmd("host:lobby"),
        startRaw: () => cmd("host:raw"),
        vaultOn: () => cmd("host:vaultOn"),
        gameOver: () => cmd("host:over"),
        claimVendor: () => cmd("host:claimVendor"),
        teamAttack: () => cmd("host:teamAttack"),
        crowd: () => cmd("host:crowd"),
      },
    }),
    [cmd],
  );

  return <RoomCtx.Provider value={{ state, api, mode }}>{children}</RoomCtx.Provider>;
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
      push((st) => ({ ...st, panic: true }));
      break;
    case "host:lobby":
      push((st) => ({ ...st, phase: PHASE.LOBBY, startedAt: now, breachRaw: null, flight: null, players: {}, pending: [], queueWaiting: 0 }));
      break;
    case "host:raw":
      push((st) => ({ ...st, phase: PHASE.RAW, startedAt: now, vaultOn: false, breachRaw: null, flight: null }));
      break;
    case "host:vaultOn":
      push((st) => ({ ...st, phase: PHASE.SHIELD, startedAt: now, vaultOn: true, flight: null, players: fillBots(st) }));
      break;
    case "host:over":
      push((st) => ({ ...st, phase: PHASE.OVER, startedAt: now }));
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
    attacks: [item, ...s2.attacks].slice(0, 60),
    focusId: focusWeight(s2.focusId, item),
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
