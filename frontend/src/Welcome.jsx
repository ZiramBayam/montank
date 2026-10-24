// Halaman pembuka: CREATE ROOM / JOIN ROOM. Demo lintas-tab — room hidup per device.
// CREATE langsung masuk lobby /play (QR + invite link ada di ruang tunggu).
import { useState } from "react";
import Sprite from "./components/Sprite.jsx";
import { generateRoomCode, isRoomCode, listRooms } from "./state/room.js";
import "./Welcome.css";

export default function Welcome() {
  const [joinInput, setJoinInput] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [err, setErr] = useState("");

  const create = () => {
    const code = generateRoomCode();
    window.location.href = `/play?room=${code}`;
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
        <h1>MONTANK</h1>
        <p className="dim">
          Two-round red-team arena. Lure the Cashier Agent, then dodge the AegisVault guards — in 5 minutes.
        </p>
      </header>

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

      <p className="footnote dim">
        Demo sync = same device, many tabs (BroadcastChannel). Cross-device play needs the real WS backend.
      </p>
    </div>
  );
}
