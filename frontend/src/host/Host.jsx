import { useEffect, useState } from "react";
import { useBus } from "../state/RoomCtx.js";
import { PHASE } from "../state/phases.js";
import { roomFromUrl } from "../state/room.js";
import { HONEST } from "../data/deck.js";
import Sprite from "../components/Sprite.jsx";
import { unlockAudio } from "../state/sfx.js";
import "./Host.css";

const PHASES = [
  { key: PHASE.LOBBY, label: "LOBBY", api: "lobby", desc: "QR + nickname (0:00–1:00)" },
  { key: PHASE.RAW, label: "ROUND 1 · RAW", api: "startRaw", desc: "No protection (1:00–2:00)" },
  { key: PHASE.SHIELD, label: "ROUND 2 · VAULT", api: "vaultOn", desc: "AegisVault ON (2:00–4:00)" },
  { key: PHASE.OVER, label: "PODIUM", api: "gameOver", desc: "Results + telemetry (4:00–5:00)" },
];

export default function Host() {
  const { state, api, mode } = useBus();
  const room = roomFromUrl();
  const [log, setLog] = useState([]);
  const readOnly = mode === "real" && state.hostAuthorized === false;
  useEffect(() => { unlockAudio(); }, []);

  const act = (fn, label) => {
    fn();
    setLog((l) => [`${new Date().toLocaleTimeString()} ${label}`, ...l].slice(0, 12));
  };

  const lowBank = state.bank.vaultMon < 5;

  return (
    <div className="host">
      <header className="hhead card--flat">
        <Sprite name="shield" size={24} />
        <b>HOST PANEL</b>
        <span className={`badge ${mode === "real" ? "" : "badge--sim"}`}>
          {mode === "real" ? (state.virtual ? "WS: REHEARSAL" : "WS: LIVE") : mode === "connecting" ? "CONNECTING" : room ? "ROOM DEMO (cross-tab)" : "BACKEND OFFLINE"}
        </span>
        {room && <b className="badge">ROOM {room}</b>}
        <a className="badge" href={room ? `/stage?room=${room}` : "/stage"} target="_stage" rel="noreferrer">open /stage ↗</a>
        <a className="badge" href={room ? `/play?room=${room}` : "/play"} target="_play" rel="noreferrer">open /play ↗</a>
      </header>

      <section className="card hzone">
        <h2 className="purple">1 · Demo Phases (5-minute state machine)</h2>
        <div className="hgrid">
          {PHASES.map((p) => (
            <button
              key={p.key}
              className={`btn ${state.phase === p.key ? "btn--primary" : ""}`}
              onClick={() => act(api.host[p.api], `→ ${p.label}`)}
              disabled={readOnly}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="dim">
          Order: LOBBY → RAW → VAULT → OVER. Round timers show on /stage.
        </p>
      </section>

      <section className="card hzone">
        <h2 className="purple">2 · Judge Tests &amp; Fallbacks</h2>
        <div className="hgrid">
          <button className="btn btn--go" onClick={() => act(api.host.claimVendor, "jury: claim registered vendor")} disabled={readOnly}>
            Claim Registered Vendor (Path A)
          </button>
          <button className="btn btn--go" onClick={() => act(api.host.claimVendorB, "jury: claim verified new vendor")} disabled={readOnly}>
            Claim Verified New Vendor (Path B)
          </button>
          <button className="btn" onClick={() => act(api.host.teamAttack, "team example attack")} disabled={readOnly}>
            Team Example Attack
          </button>
          <button className="btn btn--coin" onClick={() => act(api.host.crowd, "crowd simulation")} disabled={readOnly}>
            Crowd Simulation
          </button>
          <button className="btn btn--stop" onClick={() => act(api.panic, HONEST.SENSOR)} disabled={readOnly}>
            Panic Blur [Spacebar]
          </button>
          <button className={`btn ${state.manualAttacksEnabled ? "btn--primary" : ""}`} onClick={() => act(() => api.host.manualAttacks(!state.manualAttacksEnabled), `manual attacks ${state.manualAttacksEnabled ? "off" : "on"}`)} disabled={readOnly}>
            Manual attacks: {state.manualAttacksEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <p className="dim">
          Every host action adds honesty labels to the kill-feed: [{HONEST.TEAMATTACK}] [{HONEST.SIM}].
        </p>
      </section>

      <section className="card hzone">
        <h2 className="purple">3 · Status</h2>
        {state.hostAuthorized === false && <p className="num-bad">Host read-only. Open this page with ?t=HOST_TOKEN to enable controls.</p>}
        {state.hostMessage && <p className="dim">{state.hostMessage}</p>}
        <div className="hgrid stats">
          <Stat k="Phase" v={state.phase} />
          <Stat k="Vault" v={state.vaultOn ? "ON" : "OFF"} ok={state.vaultOn} />
          <Stat k="Vault balance" v={`${state.bank.vaultMon} MON`} warn={lowBank} virtual={state.virtual} />
          <Stat k="Funds held" v={`${state.bank.heldMon} MON`} virtual={state.virtual} />
          <Stat k="Queue" v={`${state.queueWaiting}/12`} warn={state.queueWaiting >= 10} />
          <Stat k="Players" v={state.playerCount ?? Object.keys(state.players).length} />
          <Stat k="Veto / Clear" v={`${state.vetoCount} / ${state.clearCount}`} />
        </div>
        {lowBank && <p className="num-bad">WARNING: EOA/vault balance low — request MON from the committee (PRD 3.6)</p>}
      </section>

      <section className="card hzone">
        <h2 className="purple">4 · Log</h2>
        <pre className="hlog card card--flat">{log.join("\n") || "—"}</pre>
      </section>
    </div>
  );
}

function Stat({ k, v, ok, warn, virtual }) {
  return (
    <div className="stat card card--flat">
      <span className="dim small">{k}</span>
      <b className={`t-num ${ok ? "num-ok" : ""} ${warn ? "num-bad" : ""}`}>{String(v)}</b>
      {virtual && <span className="badge badge--sim">VIRTUAL</span>}
    </div>
  );
}
