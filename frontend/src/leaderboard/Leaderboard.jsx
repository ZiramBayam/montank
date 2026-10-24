import { useEffect, useState } from "react";
import "./Leaderboard.css";

function roomFromUrl() {
  const p = new URLSearchParams(window.location.search);
  return p.get("room") || "";
}

export default function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetch_ = async () => {
      try {
        setLoading(true);
        const roomCode = roomFromUrl();
        if (!roomCode) throw new Error("Kode room tidak ditemukan.");
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/leaderboard`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(result.standings)) throw new Error("Detail leaderboard tidak dapat dimuat.");
        setLeaderboard(result.standings);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Detail leaderboard tidak dapat dimuat.");
      } finally {
        setLoading(false);
      }
    };
    void fetch_();
  }, []);

  const goBack = () => {
    window.location.href = "/";
  };

  const top3 = leaderboard ? leaderboard.slice(0, 3) : [];

  return (
    <div className="leaderboard">
      <header className="lb-header">
        <h1>TOP 3 SCAMMER</h1>
      </header>

      {loading && <p className="dim center">Memuat leaderboard…</p>}
      {error && <p className="err center">{error}</p>}

      {!loading && !error && top3.length === 0 && (
        <p className="dim center">Belum ada pemain di leaderboard.</p>
      )}

      {!loading && !error && top3.length > 0 && (
        <section className="lb-podium">
          {top3.map((player, idx) => (
            <div key={player.nickname} className={`podium-slot podium-${idx + 1}`}>
              <div className="podium-rank">
                <span className="medal">
                  {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}
                </span>
                <span className="rank-num">#{player.rank}</span>
              </div>
              <div className="podium-info">
                <b className="nickname">{player.nickname}</b>
                <span className="score t-score">{player.score}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {!loading && !error && leaderboard && leaderboard.length > 3 && (
        <section className="lb-rest" aria-label="Peringkat selanjutnya">
          <h2 className="dim small">RANKING LANJUTAN</h2>
          {leaderboard.slice(3).map((player) => (
            <div key={player.nickname} className="lb-row">
              <span className="dim t-num">#{player.rank}</span>
              <b>{player.nickname}</b>
              <span className="score">{player.score}</span>
            </div>
          ))}
        </section>
      )}

      <button className="btn btn--go big lb-back" onClick={goBack}>
        KEMBALI KE HALAMAN AWAL
      </button>
    </div>
  );
}
