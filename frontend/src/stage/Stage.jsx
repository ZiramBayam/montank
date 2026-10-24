import { useEffect, useMemo, useRef, useState } from "react";
import { useBus } from "../state/RoomCtx.js";
import { PHASE, ROUND_MS } from "../state/phases.js";
import { GUARDS, TIERS, HONEST, QUEUE } from "../data/deck.js";
import Sprite from "../components/Sprite.jsx";
import { play, probeFiles, unlockAudio } from "../state/sfx.js";
import "./Stage.css";

export default function Stage() {
  const { state, api, mode } = useBus();
  const { phase } = state;
  const [lobbyInfo, setLobbyInfo] = useState(null);
  useEffect(() => {
    let active = true;
    fetch("/api/lobby").then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data) setLobbyInfo(data); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  // Panic Blur: hotkey Spacebar (PRD 8)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space" && !e.repeat && state.hostAuthorized) {
        e.preventDefault();
        api.panic();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api, state.hostAuthorized]);
  useEffect(() => {
    probeFiles();
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // SFX layar
  const prevBreach = useRef(null);
  const prevVault = useRef(null);
  const prevFocusTier = useRef(null);
  useEffect(() => {
    if (state.breachRaw && !prevBreach.current) play("breach");
    prevBreach.current = state.breachRaw;
    if (state.vaultOn && !prevVault.current) play("vault");
    prevVault.current = state.vaultOn;
  }, [state.breachRaw, state.vaultOn]);

  const focus = useMemo(() => {
    const pid = state.spotlight?.attackId || state.focusId || state.attacks[0]?.id;
    return state.attacks.find((a) => a.id === pid) || state.attacks[0] || null;
  }, [state.focusId, state.spotlight?.attackId, state.attacks]);

  // sfx menuju tier fokus baru
  useEffect(() => {
    const tier = focus?.verdict?.tier;
    if (tier && tier !== prevFocusTier.current) {
      const map = { ATTEMPT: "t10", LAYER0: "t50", VICTIM: "t100", G1: "t250", G2: "t500", BREACH: "t1000" };
      if (map[tier]) play(map[tier]);
      prevFocusTier.current = tier;
    }
  }, [focus?.verdict?.tier]);

  const leftS = () => {
    if (!(phase in ROUND_MS)) return null;
    const ms = Math.max(0, ROUND_MS[phase] - (Date.now() - state.startedAt));
    return Math.ceil(ms / 1000);
  };

  return (
    <div className="stage dither">
      <TopBar state={state} leftS={leftS} mode={mode} />
      {phase === PHASE.LOBBY && <Lobby state={state} lobbyInfo={lobbyInfo} />}
      {phase === PHASE.RAW && <RawRound state={state} />}
      {phase === PHASE.SHIELD && <Shield state={state} focus={focus} api={api} />}
      {phase === PHASE.OVER && <Podium state={state} />}
      {state.hostAuthorized && <button className="hostchip" onClick={api.panic} title="Spacebar = Panic Blur (PRD 8)">
        {state.panic ? `PANIC ON → ${HONEST.SENSOR}` : "[SPACE] PANIC BLUR"}
      </button>}
    </div>
  );
}

/* ---------- Zona atas (PRD 7.2) ---------- */
function TopBar({ state, leftS, mode }) {
  const s = leftS();
  return (
    <header className="topbar card--flat">
      <span className="brand">
        <Sprite name="logo" size={30} />
        <span>MONTANK</span>
      </span>
      <span className="cell">
        <span className="dim small">VAULT</span>
        <b className={state.vaultOn ? "num-ok" : "num-bad"}>{state.vaultOn ? "AEGIS ON" : "OFF"}</b>
      </span>
      {s != null && (
        <span className="cell">
          <span className="dim small">ROUND</span>
          <span className="score t-big">{s}s</span>
        </span>
      )}
      <span className="cell">
        <span className="dim small">VAULT BALANCE</span>
        <b className="score t-big">
          {state.bank.vaultMon.toFixed(1)} MON
        </b>
        {state.virtual && <Badge sim>VIRTUAL</Badge>}
      </span>
      <span className="cell">
        <span className="dim small">FUNDS HELD</span>
        <b className="num-bad score t-big">{state.bank.heldMon.toFixed(1)} MON</b>
      </span>
      <span className="banner card card--flat">
        <span className="msprite idle-bob">
          <Sprite name="mascot" size={22} />
          <span className="mkover flick" style={{ animationDelay: "2.4s" }}>
            <Sprite name="mascotB" size={22} />
          </span>
          <span className="mkover bff" style={{ animationDelay: "1.1s" }}>
            <Sprite name="mascotC" size={22} />
          </span>
        </span>{" "}
        The Cashier Agent is intentionally gullible.
      </span>
      <span className={`badge ${mode === "real" ? "" : "badge--sim"}`}>
        {mode === "real" ? (state.virtual ? "REHEARSAL" : "LIVE") : mode === "connecting" ? "CONNECTING" : "OFFLINE"}
      </span>
    </header>
  );
}

function Badge({ children, sim, warn }) {
  return <span className={`badge ${sim ? "badge--sim" : ""} ${warn ? "badge--warn" : ""}`}>{children}</span>;
}

/* ---------- Lobby: QR + nickname live ---------- */
function Lobby({ state, lobbyInfo }) {
  const joined = Object.keys(state.players);
  return (
    <div className="zone lobby">
      <img src={lobbyInfo?.qrUrl || "/qr.png"} alt="QR to join from a phone" className="qr card card--lift" />
      <div className="lobbyinfo">
        <h1>RAID THE CASHIER</h1>
        <ul className="rules">
          <li>
            Scan the QR → pick <b>disguise + reason + tactic</b> → hit ATTACK.
          </li>
          <li>Nickname 2–12 alphanumeric, <b>no wallet</b>.</li>
          <li>
            Round 2 turns the <b className="num-ok">AegisVault</b> ON — get past all 3 guards!
          </li>
        </ul>
        <p className="dim blink-idle">ATTACK TO SCORE — ROOM IS OPEN</p>
        <p className="dim">Open manually: <b>{lobbyInfo?.manualUrl || `${window.location.origin}/play`}</b></p>
      </div>
      <div className="board card">
        <h2>Players joined ({state.playerCount ?? joined.length})</h2>
        <div className="rows">
          {joined.map((n) => (
            <div className="row slide-in-8" key={n}>
              <span className="dim">@</span>
              {n}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Ronde 1: layar JEBOL (inversi palet) ---------- */
function RawRound({ state }) {
  const b = state.breachRaw;
  return (
    <div className="zone rawbreach">
      {b ? (
        <>
          <h1 className="jebol flash-red">VAULT BREACHED</h1>
          <p className="drain">
            <span className="score t-huge">−{b.mon} MON</span> in <span className="score t-big">{b.secs}</span> seconds
          </p>
          {b.txUrl && <a className="txlink" href={b.txUrl} target="_blank" rel="noreferrer">View breach transaction on MonadScan ↗</a>}
          {b.simulated && <Badge sim>REHEARSAL · VIRTUAL</Badge>}
          <p className="dim">Raw treasury, zero protection. Balance illustrates testnet (virtual) funds.</p>
          <p className="hint blink-idle">Host → [AEGIS VAULT: ON] for Round 2</p>
        </>
      ) : (
        <>
          <h1>Round 1 — No Protection</h1>
          <p className="dim">The agent signs raw transfers. The first convincing attack: empty vault.</p>
          <p className="blink-idle">Waiting for attacks…</p>
        </>
      )}
    </div>
  );
}

/* ---------- Ronde 2: bento 4 zona w/ penjaga + telemetri ---------- */
function Shield({ state, focus, api }) {
  return (
    <>
      <div className="main">
        <section className="spotlight card">
          <Spotlight state={state} atk={state.spotlight?.attackId ? focus : null} />
        </section>
        <aside className="side">
          <Leaderboard state={state} top={5} />
          <QueuePanel state={state} />
          <KillFeed state={state} />
        </aside>
      </div>
      <Telemetry atk={focus} api={api} authorized={state.hostAuthorized} />
    </>
  );
}
function Spotlight({ state, atk }) {
  if (!atk) {
    return (
      <div className="spot">
        <h2>SPOTLIGHT</h2>
        <p className="dim blink-idle">Waiting for the attack wave…</p>
      </div>
    );
  }
  const panic = state.panic;
  return (
    <div className="spot">
      <div className="spotup">
        <span className="who">{atk.nick}</span>
        {atk.labels.map((l) => (
          <span className="badge badge--sim" key={l}>[{l}]</span>
        ))}
        <span className="score t-big">{TIERS[atk.verdict.tier]?.points ?? 0} pts</span>
      </div>
      <p className="prompt">{panic ? HONEST.SENSOR : `"${atk.text}"`}</p>
      {atk.amountMon != null && (
        <p>
          target: <b className="score">{atk.amountMon} MON</b>
          {state.virtual ? <Badge sim>VIRTUAL</Badge> : null}
        </p>
      )}
      {atk.guards ? (
        <GuardCards guards={atk.guards} />
      ) : atk.verdict.tier === "LAYER0" ? (
        <p className="past">REJECTED AT LAYER 0 — per-tx cap (before the guards fire).</p>
      ) : (
        <p className="past">Rejected by the Victim Agent. +10 attempt.</p>
      )}
    </div>
  );
}

function GuardCards({ guards }) {
  const META = [GUARDS.P1, GUARDS.P2, GUARDS.P3];
  const SPR = ["g1", "g2", "g3"];
  return (
    <div className="guards">
      {guards.map((g, i) => (
        <div className={`gcard card card--flat ${g.clear ? "clear" : "veto"}`} key={i}>
          <Sprite name={SPR[i]} size={28} />
          <b>{META[i].id} · {META[i].name}</b>
          <span className="dim">{META[i].blind ? "text-blind" : "text-reader"}</span>
          <span className={`num ${g.clear ? "num-ok" : "num-bad"}`}>{g.clear ? "CLEAR" : "VETO"} · {g.ms}ms</span>
        </div>
      ))}
    </div>
  );
}

function Leaderboard({ state, top }) {
  const rows = Object.entries(state.players)
    .map(([nick, p]) => ({ nick, score: p.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
  return (
    <div className="board card">
      <h2>Scoreboard</h2>
      <div className="rows">
        {rows.map((r, i) => (
          <div className="row" key={r.nick}>
            <span className="rank num">{i + 1}.</span>
            <span className="nick">{r.nick}</span>
            <span className="score">{r.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QueuePanel({ state }) {
  return (
    <div className="queuep card card--flat">
      <Sprite name="coin" size={18} />
      <b>QUEUE:</b> <span className="num">{state.queueWaiting}</span> waiting / max {QUEUE.MAX}
    </div>
  );
}

function KillFeed({ state }) {
  return (
    <div className="kill card">
      <h2>Kill-feed</h2>
      <div className="rows scroll">
        {state.attacks.length === 0 && <p className="dim">No attacks yet.</p>}
        {state.attacks.map((a) => (
          <div className={`krow ${a.verdict.tier === "BREACH" ? "bad" : ""}`} key={a.id}>
            <span className="rank dim t-num">{a.nick}</span>
            <span className={`ktx ${state.panic ? "dim" : ""}`}>
              {state.panic ? HONEST.SENSOR : a.text.slice(0, 60)}
            </span>
            {a.labels.map((l) => (
              <span className="badge" key={l}>[{l}]</span>
            ))}
            <span className={`score ${a.verdict.tier === "BREACH" ? "num-bad" : ""}`}>
              +{a.verdict.points}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Telemetri (PRD 7.2 bottom) ---------- */
function Telemetry({ atk, api, authorized }) {
  const tl = atk?.timeline;
  return (
    <section className="telemetry card">
      <div className="tl">
        <Step on={tl?.proposed != null} ms={tl?.proposed} label="Proposed" />
        <Step on={tl?.voted != null} ms={tl?.voted} label="Voted" optional />
        <Step on={tl?.finalized != null} ms={tl?.finalized} label="Finalized" last />
        {tl == null && (
          <span className="dim">
            no on-chain path{atk?.verdict.tier === "LAYER0" ? " — Layer 0" : " — rejected by agent"}
          </span>
        )}
      </div>
      <a className="txlink" href={atk?.txUrl || "#"} target="_blank" rel="noreferrer" aria-disabled={!atk?.txUrl} onClick={(event) => { if (!atk?.txUrl) event.preventDefault(); }}>
        <Sprite name="txLink" size={14} /> View Tx on MonadScan ↗
      </a>
      <span className="jury dim">jury buttons:</span>
      <JuryButtons api={api} authorized={authorized} />
    </section>
  );
}

function Step({ on, ms, label, optional = false, last = false }) {
  return (
    <span className={`step ${on ? "on" : ""} ${optional && !on ? "opt" : ""}`}>
      <b>{label}</b>
      {on && ms != null && <span className="num">{ms > 0 ? `+${ms}ms` : "0ms"}</span>}
      {!last && <i className="arrow">→</i>}
    </span>
  );
}

function JuryButtons({ api, authorized }) {
  return (
    <div className="buttons">
      <button className="btn btn--go" onClick={api.host.claimVendor} disabled={!authorized}>
        Claim Registered Vendor
      </button>
      <button className="btn" onClick={api.host.claimVendorB} disabled={!authorized} title="Path B 3/3 clear — used when judges test a valid claim">
        Claim Verified New Vendor
      </button>
    </div>
  );
}

/* ---------- Podium (PRD fase 4) ---------- */
function Podium({ state }) {
  const rows = Object.entries(state.players)
    .map(([nick, p]) => ({ nick, score: p.score }))
    .sort((a, b) => b.score - a.score);
  const attacks = state.attacks;
  const median = state.telemetry?.medianEndToEndMs;
  const held = state.bank.heldMon.toFixed(1);
  const breaches = state.telemetry?.breaches ?? attacks.filter((a) => a.verdict.tier === "BREACH").length;
  const code = `import { createWalletClient, http, keccak256, parseEther, toBytes } from "viem";

const worker = createWalletClient({ account, chain, transport: http(RPC_HTTP) });
await worker.writeContract({
  address: VAULT_ADDR, abi: aegisVaultAbi, functionName: "proposeAction",
  args: [actionId, recipient, parseEther(amount), keccak256(toBytes(attackText))],
  gas: 120_000n,
});`;
  return (
    <div className="zone podium">
      <section className="podcard card">
        <h1>Top 3 Scammer</h1>
        <div className="podrow">
          {[1, 0, 2].map((i) => (
            <div className={`ph ph${i}`} key={i}>
              <b>{rows[i]?.nick ?? "—"}</b>
              <span className="score">{rows[i]?.score ?? 0}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="tele card">
        <h2>ARENA TELEMETRY</h2>
        <ul className="tgrid">
          <li><span className="dim">Total attacks</span><b className="num">{state.telemetry?.totalAttacks ?? attacks.length}</b></li>
          <li><span className="dim">Vetoes applied</span><b className="num-bad">{state.telemetry?.vetoes ?? state.vetoCount}</b></li>
          <li><span className="dim">Median result latency</span><b className="num-ok">{median != null ? `${median}ms` : "—"}</b></li>
          <li><span className="dim">Funds held</span><b className="num-bad">{held} MON</b></li>
          <li><span className="dim">Full breach</span><b className="num-ok">{breaches}</b></li>
          <li><span className="dim">Source</span><b className="dim">backend + Monad logs{state.virtual ? " · simulated" : " · live"}</b></li>
        </ul>
        <pre className="code card card--flat">{code}</pre>
      </section>
    </div>
  );
}
