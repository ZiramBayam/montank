// Halaman pembuka: CREATE ROOM / JOIN ROOM. Demo lintas-tab — ruang hidup per device.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Sprite from "./components/Sprite.jsx";
import { generateRoomCode, isRoomCode, listRooms } from "./state/room.js";
import "./Welcome.css";

const ROLES = [
  { id: "play", label: "PLAYER" },
  { id: "host", label: "HOST" },
  { id: "stage", label: "STAGE" },
];

export default function Welcome() {
  const [created, setCreated] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [joinRole, setJoinRole] = useState("play");
  const [findOpen, setFindOpen] = useState(false);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState(null);

  useEffect(() => {
    if (!created) { setQr(null); return undefined; }
    let active = true;
    QRCode.toDataURL(`${window.location.origin}/play?room=${created}`, { width: 360, margin: 2 })
      .then((dataUrl) => { if (active) setQr(dataUrl); })
      .catch(() => {});
    return () => { active = false; };
  }, [created]);

  const create = () => {
    setErr("");
    setCreated(generateRoomCode());
  };

  const goJoin = () => {
    const code = joinInput.toUpperCase().trim();
    if (!isRoomCode(code)) {
      setErr("Use the room format: PF-XXXX (4 letters/numbers).");
      return;
    }
    if (!listRooms()[code]) {
      setErr("Room not found on this device. Create it here first — demo rooms are cross-tab only.");
      return;
    }
    window.location.href = `/${joinRole}?room=${code}`;
  };

  return (
    <div className="welcome">
      <header className="brand">
        <span className="wmasc">
          <Sprite name="mascot" size={34} />
          <span className="mkover flick">
            <Sprite name="mascotB" size={34} />
          </span>
        </span>
        <h1>MONTEN</h1>
        <p className="dim">
          Two-round red-team arena. Lure the Cashier Agent, then dodge the AegisVault guards — in 5 minutes.
        </p>
      </header>

      {!created ? (
        <section className="wselect card">
          <button className="btn btn--primary big" onClick={create}>
            CREATE ROOM
          </button>
          <button
            className="btn btn--go big"
            onClick={() => {
              setErr("");
              setFindOpen((o) => !o);
            }}
          >
            JOIN ROOM
          </button>
          {findOpen && (
            <div className="wfind">
              <input
                autoFocus
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") goJoin();
                }}
                placeholder="PF-XXXX"
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
              />
              <div className="wroles">
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    className={`btn ${joinRole === r.id ? "btn--primary" : ""}`}
                    onClick={() => setJoinRole(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button className="btn btn--coin big" onClick={goJoin}>
                JOIN →
              </button>
            </div>
          )}
          {err && <p className="werr">{err}</p>}
        </section>
      ) : (
        <section className="wselect card">
          <h2 className="purple">ROOM READY</h2>
          <b className="wcode t-score">{created}</b>
          {qr && <img className="qr" src={qr} alt={`QR to join room ${created}`} />}
          <p className="dim">Phones scan this QR → they land on /play already inside the room.</p>
          <div className="wroles">
            <a className="btn" href={`/play?room=${created}`}>PHONE /play ↗</a>
            <a className="btn" href={`/host?room=${created}`}>HOST /host ↗</a>
            <a className="btn" href={`/stage?room=${created}`}>TV /stage ↗</a>
          </div>
          <button
            className="btn"
            onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/play?room=${created}`)}
          >
            COPY INVITE LINK
          </button>
          <button className="btn btn--coin" onClick={() => setCreated("")}>
            ← BACK
          </button>
        </section>
      )}

      <p className="footnote dim">
        Demo sync = same device, many tabs (BroadcastChannel). Cross-device play needs the real WS backend.
      </p>
    </div>
  );
}
