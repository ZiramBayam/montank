// Halaman pembuka: CREATE ROOM / JOIN ROOM. Demo lintas-tab — ruang hidup per device.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Sprite from "./components/Sprite.jsx";
import { isRoomCode } from "./state/room.js";
import "./Welcome.css";

export default function Welcome() {
  const [created, setCreated] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState(null); // { room, url } — codec QRCode async
  const [busy, setBusy] = useState(false);

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

  const create = async () => {
    setErr("");
    setBusy(true);
    try {
      const response = await fetch("/api/rooms", { method: "POST" });
      if (!response.ok) throw new Error("Room service unavailable");
      const result = await response.json();
      setCreated(result.roomCode);
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
          <span className="mkover flick">
            <Sprite name="mascotB" size={34} />
          </span>
        </span>
        <h1>MONTANK</h1>
        <p className="dim">
          Two-round red-team arena. Lure the Cashier Agent, then dodge the AegisVault guards — in 5 minutes.
        </p>
      </header>

      {!created ? (
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
        Kode undangan dikelola server dan dapat dipakai peserta dari perangkat berbeda.
      </p>
    </div>
  );
}
