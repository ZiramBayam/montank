import { useEffect, useState } from "react";
import { useBus } from "../state/RoomCtx.js";
import { PHASE } from "../state/phases.js";
import { roomFromUrl } from "../state/room.js";
import { HONEST } from "../data/deck.js";
import Sprite from "../components/Sprite.jsx";
import { unlockAudio } from "../state/sfx.js";
import "./Host.css";

const PHASES = [
  { key: PHASE.LOBBY, label: "LOBBY", api: "lobby", desc: "Room stays open until host starts" },
  { key: PHASE.RAW, label: "MULAI PERMAINAN", api: "startRaw", desc: "Round 1 · 60 seconds" },
  { key: PHASE.SHIELD, label: "ROUND 2 · VAULT", api: "vaultOn", desc: "AegisVault ON · 120 seconds" },
  { key: PHASE.OVER, label: "AKHIRI PERMAINAN", api: "gameOver", desc: "Show results + telemetry" },
];

const formatDuration = (ms = 0) => {
  const totalSeconds = Math.floor(ms / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
};
const formatClock = (time) => time ? new Date(time).toLocaleString() : "—";

export default function Host() {
  const { state, api, mode } = useBus();
  const room = roomFromUrl();
  const [log, setLog] = useState([]);
  const [activeRoom, setActiveRoom] = useState("");
  const readOnly = mode !== "real" || state.hostAuthorized === false;
  useEffect(() => {
    let active = true;
    fetch(`/api/lobby${room ? `?room=${encodeURIComponent(room)}` : ""}`).then((response) => response.ok ? response.json() : null)
      .then((lobby) => { if (active && lobby?.roomCode) setActiveRoom(lobby.roomCode); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => { unlockAudio(); }, []);

  const act = (fn, label) => {
    fn();
    setLog((l) => [`${new Date().toLocaleTimeString()} ${label}`, ...l].slice(0, 12));
  };

  const lowBank = state.bank.vaultMon < 5;
  const invite = room || activeRoom;
  const hostToken = new URLSearchParams(window.location.search).get("t") || new URLSearchParams(window.location.search).get("token");
  const stageUrl = `/stage${invite ? `?room=${encodeURIComponent(invite)}` : ""}${hostToken ? `${invite ? "&" : "?"}t=${encodeURIComponent(hostToken)}` : ""}`;
  const playUrl = invite ? `/play?room=${encodeURIComponent(invite)}` : "/";

  return (
    <div className="host">
      <header className="hhead card--flat">
        <Sprite name="logo" size={24} />
        <b>HOST PANEL</b>
        <span className={`badge ${mode === "real" ? "" : "badge--sim"}`}>
          {mode === "real" ? (state.virtual ? "WS: REHEARSAL" : "WS: LIVE") : mode === "connecting" ? "CONNECTING" : "BACKEND OFFLINE"}
        </span>
        {invite && <b className="badge">ROOM {invite}</b>}
        <a className="badge" href={stageUrl} target="_stage" rel="noreferrer">open /stage ↗</a>
        <a className="badge" href={playUrl} target="_play" rel="noreferrer">open /play ↗</a>
      </header>

      <section className="card hzone">
        <h2 className="purple">1 · Pengaturan Permainan</h2>
        <div className="hgrid">
          {PHASES.map((p) => (
            <button
              key={p.key}
              className={`btn ${p.api === "startRaw" ? "btn--primary" : ""} ${state.phase === p.key ? "btn--go" : ""}`}
              onClick={() => act(api.host[p.api], `→ ${p.label}`)}
              disabled={readOnly
                || (p.api === "startRaw" && state.phase !== PHASE.LOBBY)
                || (p.api === "vaultOn" && (!state.gameStartedAt || state.phase === PHASE.OVER))
                || (p.api === "gameOver" && (!state.gameStartedAt || state.phase === PHASE.OVER))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="dim">Room menunggu di lobby sampai host memilih <b>MULAI PERMAINAN</b>. Setelah dimulai, Round 1 berlangsung 60 detik, Round 2 berlangsung 120 detik, lalu podium tampil otomatis.</p>
        <div className="hgrid stats">
          <Stat k="Game duration" v={state.gameStartedAt ? formatDuration(state.gameElapsedMs) : "Belum dimulai"} />
          <Stat k="Started at" v={formatClock(state.gameStartedAt)} />
          <Stat k="Finished at" v={formatClock(state.gameEndedAt)} />
        </div>
        {state.phase === PHASE.OVER && (
          <button className="btn btn--primary" onClick={() => act(api.host.newGame, "start next game")} disabled={readOnly}>
            START NEXT GAME → LOBBY
          </button>
        )}
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
