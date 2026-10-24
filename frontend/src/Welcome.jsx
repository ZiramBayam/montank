// Halaman pembuka: CREATE ROOM / JOIN ROOM. Kode undangan dikelola server (lintas perangkat).
// CREATE langsung masuk lobby /play (QR + invite link ada di ruang tunggu).
import { useState } from "react";
import Sprite from "./components/Sprite.jsx";
import { isRoomCode } from "./state/room.js";
import "./Welcome.css";

export default function Welcome() {
  const [joinInput, setJoinInput] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setErr("");
    setBusy(true);
    try {
      const response = await fetch("/api/rooms", { method: "POST" });
      if (!response.ok) throw new Error("Room service unavailable");
      const result = await response.json();
      if (!isRoomCode(result.roomCode)) throw new Error("Invalid room code");
      window.location.href = `/play?room=${result.roomCode}`;
    } catch {
      setErr("Server room tidak dapat dijangkau. Coba lagi saat koneksi tersedia.");
    } finally {
      setBusy(false);
    }
  };

  const goJoin = async () => {
    const code = joinInput.toUpperCase().trim();
    if (!isRoomCode(code)) {
      setErr("Use the room format: PF-XXXX (4 letters/numbers).");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
      const result = response.ok ? await response.json() : null;
      if (!result?.valid) {
        setErr("Kode undangan tidak aktif. Minta kode terbaru dari host.");
        return;
      }
      window.location.href = `/play?room=${encodeURIComponent(code)}`;
    } catch {
      setErr("Kode tidak dapat diperiksa. Periksa koneksi lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <header className="brand">
        <span className="wmasc">
          <Sprite name="mascot" size={34} />
          <span className="mkover flick" style={{ animationDelay: "1.2s" }}>
            <Sprite name="mascotB" size={34} />
          </span>
          <span className="mkover bff" style={{ animationDelay: "0.6s" }}>
            <Sprite name="mascotC" size={34} />
          </span>
        </span>
        <h1>MONTANK</h1>
        <p className="dim">
          Two-round red-team arena. Lure the Cashier Agent, then dodge the AegisVault guards — in 5 minutes.
        </p>
      </header>

      <section className="wselect card">
        <button className="btn btn--primary big" onClick={create} disabled={busy}>
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
              onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") goJoin();
              }}
              placeholder="PF-XXXX"
              maxLength={7}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <button className="btn btn--coin big" onClick={goJoin} disabled={busy}>
              JOIN →
            </button>
          </div>
        )}
        {err && <p className="werr">{err}</p>}
      </section>

      <p className="footnote dim">
        Kode undangan dikelola server dan dapat dipakai peserta dari perangkat berbeda.
      </p>
    </div>
  );
}
