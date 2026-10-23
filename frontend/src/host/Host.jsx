import { useEffect, useState } from "react";
import { useBus } from "../state/RoomCtx.js";
import { PHASE } from "../state/phases.js";
import { HONEST } from "../data/deck.js";
import Sprite from "../components/Sprite.jsx";
import { unlockAudio } from "../state/sfx.js";
import "./Host.css";

const PHASES = [
  { key: PHASE.LOBBY, label: "LOBBY", api: "lobby", desc: "QR + nickname (0:00–0:25)" },
  { key: PHASE.RAW, label: "ROUND 1 · RAW", api: "startRaw", desc: "No protection (0:25–0:55)" },
  { key: PHASE.SHIELD, label: "ROUND 2 · VAULT", api: "vaultOn", desc: "AegisVault ON + 60s timer" },
  { key: PHASE.OVER, label: "PODIUM", api: "gameOver", desc: "Telemetry + SDK" },
];

export default function Host() {
  const { state, api, mode } = useBus();
  const [log, setLog] = useState([]);
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
          {mode === "real" ? "WS: LIVE" : "MOCK (no backend)"}
        </span>
        <a className="badge" href="/stage" target="_stage" rel="noreferrer">open /stage ↗</a>
        <a className="badge" href="/play" target="_play" rel="noreferrer">open /play ↗</a>
      </header>

      <section className="card hzone">
        <h2 className="purple">1 · Demo Phases (3-minute state machine)</h2>
        <div className="hgrid">
          {PHASES.map((p) => (
            <button
              key={p.key}
              className={`btn ${state.phase === p.key ? "btn--primary" : ""}`}
              onClick={() => act(api.host[p.api], `→ ${p.label}`)}
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
          <button className="btn btn--go" onClick={() => act(api.host.claimVendor, "jury: claim registered vendor")}>
            Claim Registered Vendor (Path A)
          </button>
          <button className="btn btn--go" onClick={() => act(api.host.claimVendor, "jury: claim verified new vendor")}>
            Claim Verified New Vendor (Path B)
          </button>
          <button className="btn" onClick={() => act(api.host.teamAttack, "team example attack")}>
            Team Example Attack
          </button>
          <button className="btn btn--coin" onClick={() => act(api.host.crowd, "crowd simulation")}>
            Crowd Simulation
          </button>
          <button className="btn btn--stop" onClick={() => act(api.panic, HONEST.SENSOR)}>
            Panic Blur [Spacebar]
          </button>
        </div>
        <p className="dim">
          Every host action adds honesty labels to the kill-feed: [{HONEST.TEAMATTACK}] [{HONEST.SIM}].
        </p>
      </section>

      <section className="card hzone">
        <h2 className="purple">3 · Status</h2>
        <div className="hgrid stats">
          <Stat k="Phase" v={state.phase} />
          <Stat k="Vault" v={state.vaultOn ? "ON" : "OFF"} ok={state.vaultOn} />
          <Stat k="Vault balance" v={`${state.bank.vaultMon} MON`} warn={lowBank} virtual={state.virtual} />
          <Stat k="Funds held" v={`${state.bank.heldMon} MON`} virtual={state.virtual} />
          <Stat k="Queue" v={`${state.queueWaiting}/12`} warn={state.queueWaiting >= 10} />
          <Stat k="Players" v={Object.keys(state.players).length} />
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
