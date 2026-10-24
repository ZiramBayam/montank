// Halaman pembuka dengan pilihan membuat room atau bergabung dengan kode undangan.
import { useState } from "react";
import Sprite from "./components/Sprite.jsx";
import { isRoomCode } from "./state/room.js";
import "./Welcome.css";

export default function Welcome() {
  const params = new URLSearchParams(window.location.search);
  const invitedRoom = params.get("room") || "";
  const leftRoom = params.get("left") === "1";
  const [joinInput, setJoinInput] = useState(() => invitedRoom.toUpperCase());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(() => invitedRoom || leftRoom ? "join" : "choices");

  const createRoom = async () => {
    setErr("");
    setBusy(true);
    try {
      const response = await fetch("/api/rooms", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Room tidak dapat dibuat. Coba lagi.");
      if (!isRoomCode(result.roomCode)) throw new Error("Kode room dari server tidak valid.");
      if (typeof result.ownerToken !== "string" || result.ownerToken.length < 32) {
        throw new Error("Sesi pemilik room tidak dapat diamankan. Coba lagi.");
      }
      const destination = new URL("/play", window.location.origin);
      destination.searchParams.set("room", result.roomCode);
      destination.searchParams.set("owner", result.ownerToken);
      window.location.href = destination.toString();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Server room tidak dapat dijangkau. Coba lagi.");
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
      const destination = new URL("/play", window.location.origin);
      destination.searchParams.set("room", code);
      const ownerToken = params.get("owner");
      if (ownerToken && code === invitedRoom.toUpperCase()) destination.searchParams.set("owner", ownerToken);
      window.location.href = destination.toString();
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
        {leftRoom && <p className="wnotice" role="status">Kamu sudah keluar dari room{invitedRoom ? ` ${invitedRoom}` : ""}. Masukkan kembali kode undangan untuk bergabung lagi.</p>}
        {view === "choices" ? (
          <div className="wchoices">
            <button className="btn btn--primary big" type="button" onClick={() => void createRoom()} disabled={busy}>
              {busy ? "MEMBUAT ROOM…" : "CREATE ROOM"}
            </button>
            <button className="btn btn--go big" type="button" onClick={() => { setErr(""); setView("join"); }}>
              JOIN ROOM
            </button>
          </div>
        ) : (
          <form className="wfind" onSubmit={(event) => { event.preventDefault(); void goJoin(); }}>
            <label htmlFor="room-code">Kode undangan</label>
            <input
              id="room-code"
              autoFocus
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
              placeholder="PF-XXXX"
              maxLength={7}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <button className="btn btn--coin big" type="submit" disabled={busy || !joinInput.trim()}>
              {busy ? "MEMERIKSA…" : "GABUNG ROOM →"}
            </button>
            {!invitedRoom && <button className="wback" type="button" onClick={() => setView("choices")}>← Kembali</button>}
          </form>
        )}
        {err && <p className="werr">{err}</p>}
      </section>
    </div>
  );
}
