// Halaman pembuka: CREATE ROOM / JOIN ROOM. Demo lintas-tab — ruang hidup per device.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Sprite from "./components/Sprite.jsx";
import { generateRoomCode, isRoomCode, listRooms } from "./state/room.js";
import "./Welcome.css";

export default function Welcome() {
  const [created, setCreated] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState(null); // { room, url } — codec QRCode async

  // QRCode.toDataURL async — hasil disimpan ke state + room pemiliknya
  useEffect(() => {
    if (!created) return undefined;
    let dead = false;
    QRCode.toDataURL(`${window.location.origin}/play?room=${created}`, { width: 360, margin: 2 })
      .then((url) => {
        if (!dead) setQr({ room: created, url });
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [created]);
  const qrUrl = qr && qr.room === created ? qr.url : null;

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
    window.location.href = `/play?room=${code}`;
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
        <h1>PROMPTFORTRESS</h1>
        <p className="dim">
          Two-round red-team arena. Lure the Cashier Agent, then dodge the AegisVault guards — in 3 minutes.
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
          {qrUrl && <img className="qr" src={qrUrl} alt={`QR to join room ${created}`} />}
          <p className="dim">Phones scan this QR → they land on /play already inside the room.</p>
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
