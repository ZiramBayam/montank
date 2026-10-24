import { useEffect, useRef, useState } from "react";
import { useBus } from "../state/RoomCtx.js";
import { PHASE } from "../state/phases.js";
import { ROWS, composeAttack, TIERS, QUEUE, HONEST } from "../data/deck.js";
import Sprite from "../components/Sprite.jsx";
import Avatar from "../components/Avatar.jsx";
import QRCode from "qrcode";
import { play, unlockAudio, probeFiles } from "../state/sfx.js";
import { roomFromUrl } from "../state/room.js";
import "./Play.css";

const NICK_RE = /^[a-zA-Z0-9_]{2,12}$/;
const TIER_SFX = { ATTEMPT: "t10", LAYER0: "t50", VICTIM: "t100", G1: "t250", G2: "t500", BREACH: "t1000" };
const BOLT_MS = 380;
const GAP_MS = 420;
const BOOT_MS = 900;
const BOOT_LINES = ["CONNECTING TO ARENA…", "SYNC LEDGER…", "ARMING PROMPT ENGINE…"];
const GUARD_FALLBACK = [
  { clear: false, ms: 0 },
  { clear: false, ms: 0 },
  { clear: false, ms: 0 },
];

export default function Play() {
  const { state, api, mode } = useBus();
  const ownerToken = new URLSearchParams(window.location.search).get("owner") || "";
  const [nick, setNick] = useState(() => localStorage.getItem("pf_nick") || "");
  const [joined, setJoined] = useState(false);
  const [booting, setBooting] = useState(false);
  const [picked, setPicked] = useState([0, 1, 0]);
  const [draft, setDraft] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const [coolUntil, setCoolUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [leaveError, setLeaveError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const seen = useRef(new Set());
  const bootTimer = useRef(null);
  const [localFlight, setLocalFlight] = useState(null);

  useEffect(() => { probeFiles(); }, []);
  useEffect(() => {
    if (state.playerId) {
      setNick(state.nickname || localStorage.getItem("pf_nick") || "");
      setJoined(true);
    }
  }, [state.playerId, state.nickname]);
  useEffect(() => {
    if (state.joinError === "SESSION_EXPIRED") setJoined(false);
  }, [state.joinError]);
  useEffect(() => {
    if (state.lastAttackResult) setInFlight(false);
  }, [state.lastAttackResult]);
  useEffect(() => {
    if (state.attackError) {
      setInFlight(false);
      setError(state.attackError);
    }
  }, [state.attackError]);
  useEffect(() => {
    setCoolUntil(state.cooldownUntil ?? 0);
  }, [state.cooldownUntil]);

  // putus timer boot saat keluar dari /play
  useEffect(() => () => clearTimeout(bootTimer.current), []);

  // jam nyala tiap 200ms: cooldown + animasi arena
  useEffect(() => {
    if (!joined) return;
    const t0 = setTimeout(() => setNow(Date.now()), 200);
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [joined]);

  // deteksi hasil serangan sendiri di kill-feed
  useEffect(() => {
    if (!joined) return;
    const mine = state.attacks.find((a) => a.nick === nick && !seen.current.has(a.id));
    if (mine) {
      seen.current.add(mine.id);
      setInFlight(false);
      setCoolUntil(Date.now() + QUEUE.COOLDOWN_S * 1000); // cooldown SETELAH hasil (PRD 2.1)
      play(TIER_SFX[mine.verdict.tier] ?? "t10");
      navigator.vibrate?.(mine.verdict.tier === "BREACH" ? [60, 40, 60] : 30);
      // mode real: backend tidak mengirim event flight — arena animasikan
      // mundur dari hasil yang baru tiba di feed.
      if (mode !== "mock") {
        setLocalFlight({
          startedAt: Date.now(),
          guards: mine.guards ?? GUARD_FALLBACK,
          tier: mine.verdict.tier,
        });
        setTimeout(() => setLocalFlight(null), BOLT_MS + 3 * GAP_MS + 600);
      }
    }
  }, [state.attacks, nick, joined, mode]);

  const join = () => {
    if (booting || joined) return;
    if (!NICK_RE.test(nick)) {
      setError("2–12 letters, numbers, underscores.");
      return;
    }
    setError("");
    localStorage.setItem("pf_nick", nick);
    unlockAudio(); // sinkron — butuh gesture user, jangan dipindah ke dalam timeout
    play("ack");
    navigator.vibrate?.(20);
    setBooting(true);
    bootTimer.current = setTimeout(() => {
      api.join(nick);
      setJoined(true);
      setDraft("");
      setBooting(false);
    }, BOOT_MS);
  };

  if (booting && !joined) {
    return (
      <div className="play">
        <header className="phead">
          <Sprite name="shield" size={26} />
          <b>MONTANK</b>
        </header>
        <section className="card pjoin">
          <h1>Join The Raid</h1>
          <div className="boot" role="status" aria-live="polite">
            <span className="blink-idle">
              <Sprite name="bolt" size={22} />
            </span>
            {BOOT_LINES.map((line, i) => (
              <span key={line} className="bootline slide-in-8" style={{ animationDelay: `${i * 240}ms` }}>
                {line}
              </span>
            ))}
            <div className="cd" aria-hidden="true"><i /></div>
            {mode !== "real" && <p className="dim center">DEMO MODE — backend not connected</p>}
          </div>
        </section>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="play">
        <header className="phead">
          <Sprite name="shield" size={26} />
          <b>MONTANK</b>
        </header>
        <section className="card pjoin">
          <h1>Join The Raid</h1>
          <label className="dim">Nickname — 2–12 alphanumeric, no wallet</label>
          <input
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") join(); }}
            placeholder="e.g. rampok_budi"
            maxLength={12}
            autoCapitalize="off"
            autoComplete="off"
          />
          {(error || state.joinError) && <p className="err">{error || (state.joinError === "ROOM_NOT_FOUND" ? "Kode room tidak valid atau sudah tidak aktif. Kembali dan minta kode terbaru dari host." : state.joinError)}</p>}
          <button className="btn btn--coin big" onClick={join} disabled={booting || !nick.trim()}>
            Join
          </button>
          <p className="dim center">Nickname is saved on this device. No wallet connection.</p>
          {mode !== "real" && <p className="dim center">{mode === "connecting" ? "Connecting to backend…" : "Backend disconnected"}</p>}
        </section>
      </div>
    );
  }

  const standing = Object.entries(state.players)
    .map(([n, p]) => ({ n, s: p.score }))
    .sort((a, b) => b.s - a.s);
  const rank = state.myRank ?? (standing.findIndex((r) => r.n === nick) + 1);
  const myScore = state.myScore ?? state.players[nick]?.score ?? 0;
  const over = state.phase === PHASE.OVER;
  const lobby = state.phase === PHASE.LOBBY;
  const raw = state.phase === PHASE.RAW;
  const myHistory = state.attacks.filter((a) => a.nick === nick);
  const playerCount = state.playerCount ?? standing.length;
  const cooling = now > 0 && now < coolUntil;
  const coolLeft = cooling ? Math.ceil((coolUntil - now) / 1000) : QUEUE.COOLDOWN_S;
  const queueFull = state.queueWaiting >= QUEUE.MAX;
  const attackActive = inFlight || Boolean(state.activeAttackId);
  const transactionUrl = state.attacks.find((attack) => attack.txUrl)?.txUrl ?? state.breachRaw?.txUrl ?? null;

  const send = () => {
    const text = draft.trim();
    if (!text) {
      setError("Write a prompt or pick template cards first.");
      return;
    }
    setError("");
            const fromCards = text === composeAttack(picked);
    const sent = api.attack({ payload: fromCards ? {
              kedok: ROWS[0].cards[picked[0]].text,
              alasan: ROWS[1].cards[picked[1]].text,
              taktik: ROWS[2].cards[picked[2]].text,
            } : {}, rawText: fromCards ? undefined : text });
    if (!sent) {
      setError(mode === "connecting" ? "Koneksi ke server sedang disiapkan. Tunggu tersambung lalu kirim ulang." : "Koneksi ke server terputus. Serangan belum terkirim; tunggu tersambung lalu kirim ulang.");
      return;
    }
    setInFlight(true);
    play("ack");
    navigator.vibrate?.(15);
  };

  const leaveRoom = async () => {
    if (leaving) return;
    setLeaveError("");
    setLeaving(true);
    const roomCode = roomFromUrl();
    const playerId = localStorage.getItem("pf_player_id");
    try {
      if (roomCode && playerId && mode === "real") {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId }),
        });
        if (!response.ok) throw new Error("Tidak dapat keluar dari room. Periksa koneksi lalu coba lagi.");
      }
      localStorage.removeItem("pf_player_id");
      window.location.href = "/";
    } catch (leaveError) {
      setLeaveError(leaveError instanceof Error ? leaveError.message : "Tidak dapat keluar dari room. Coba lagi.");
      setLeaving(false);
    }
  };

  const startGame = async () => {
    if (!ownerToken || starting) return;
    setStartError("");
    setStarting(true);
    try {
      const roomCode = roomFromUrl();
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: state.playerId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error === "GAME_ALREADY_STARTED" ? "Permainan sudah dimulai." : result.error === "CREATOR_NOT_JOINED" ? "Gabung sebagai pemain sebelum memulai." : "Hak mulai room tidak valid.");
    } catch (startError) {
      setStartError(startError instanceof Error ? startError.message : "Tidak dapat memulai permainan.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="play joined">
      <header className="phead">
        <span className="me">
          <Sprite name="shield" size={22} />
          <b>{nick}</b>
        </span>
        <span className="me-stats">
          <span className="score">{myScore}</span>
          <span className="dim">#{rank > 0 ? rank : "-"}</span>
          <button className="btn btn--go phead-leave" type="button" onClick={leaveRoom} disabled={leaving}>
            {leaving ? "KELUAR…" : "KELUAR ROOM"}
          </button>
        </span>
      </header>
      {leaveError && <p className="err center" role="alert">{leaveError}</p>}

      {over ? (
        <FinalBoard rank={rank} myScore={myScore} standing={standing} me={nick} txUrl={transactionUrl} rehearsal={state.virtual} />
      ) : lobby ? (
        <WaitingRoom nick={nick} playerCount={playerCount} others={standing} ownerToken={ownerToken} canStart={Boolean(state.playerId)} onStart={startGame} starting={starting} startError={startError} roundStartsAt={state.roundStartsAt} />
      ) : (
        <>
          {/* 1 Leaderboard */}
          <section className="iboard card">
            <h2 className="purple">Scoreboard</h2>
            <div className="brows">
              {standing.map((r, i) => (
                <div className={`brow ${r.n === nick ? "me" : ""}`} key={r.n}>
                  <span className="dim t-num">{i + 1}.</span>
                  <span>{r.n}</span>
                  <span className="score">{r.s}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 2 Arena brankas + penjaga */}
          <Arena rawPhase={raw} flight={state.flight ?? localFlight} now={now} />

          {/* 3 History milikku */}
          <section className="hist">
            <h2 className="purple">Your Attacks ({myHistory.length})</h2>
            {myHistory.length === 0 && <p className="dim center">No attacks yet.</p>}
            {myHistory.map((a) => (
              <div className="hrow" key={a.id}>
                <span className="htx">{state.panic ? HONEST.SENSOR : a.text}</span>
                <span className="hmeta">
                  {a.labels.map((l) => (
                    <span className="badge" key={l}>[{l}]</span>
                  ))}
                  <b className="score">{a.verdict.points ?? TIERS[a.verdict.tier]?.points ?? 0}</b>
                  {a.guards && (
                    <span className="mini">
                      {a.guards.map((g, i) => (
                        <Sprite key={i} name={g.clear ? "heart" : "heartVeto"} size={14} />
                      ))}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </section>

          {/* 4 Template cepat (opsional, quick-fill) */}
          <section className="engine card">
            <h2 className="purple">
              Quick Templates <span className="dim">(optional — fills the box below)</span>
            </h2>
            {ROWS.map((row, ri) => (
              <div className="crow" key={row.id}>
                <span className="ctitle dim">{row.title}</span>
                <div className="cards">
                  {row.cards.map((c, ci) => (
                    <button
                      key={c.text}
                      className={`ccard card ${picked[ri] === ci ? "sel" : ""}`}
                      onClick={() => {
                        const np = picked.map((v, k) => (k === ri ? ci : v));
                        setPicked(np);
                        setDraft(composeAttack(np));
                        navigator.vibrate?.(10);
                      }}
                    >
                      <Sprite name={c.icon} size={20} />
                      <span>{c.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* 5 Prompt manual + tombol serang */}
          <section className="fire card">
            <h2 className="purple">Your Attack Prompt</h2>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
              placeholder={raw ? "No guards — type your pitch…" : "Write the prompt to trick the Cashier Agent & slip past 3 guards…"}
              rows={3}
              maxLength={1000}
            />
            <div className="fireline">
              <span className="dim t-num">{draft.length}/1000</span>
              <span className="dim t-num">Queue {state.queueWaiting}/{QUEUE.MAX}</span>
            </div>
            {state.queuePosition != null && <p className="dim">Masuk antrean #{state.queuePosition}{state.queueEtaMs ? ` · estimasi ${Math.ceil(state.queueEtaMs / 1000)} dtk` : ""}</p>}
            <small className="dim">Spectator text passes the backend profanity filter before it appears on /stage (PRD 8).</small>
            {mode !== "real" && <p className="err" role="status">{mode === "connecting" ? "Menghubungkan ke server…" : "Koneksi terputus. Menghubungkan ulang…"}</p>}
            <button className="btn btn--stop big sendbtn" onClick={send} disabled={mode !== "real" || attackActive || cooling || queueFull}>
              {mode !== "real" ? (mode === "connecting" ? "MENGHUBUNGKAN…" : "MENYAMBUNG ULANG…") : queueFull ? "Queue full" : attackActive ? (state.queuePosition ? `Queue #${state.queuePosition}` : "Attack in progress…") : cooling ? `Cooldown ${coolLeft}s` : "ATTACK"}
            </button>
            {cooling && <div className="cd"><i style={{ width: `${(coolLeft / QUEUE.COOLDOWN_S) * 100}%` }} /></div>}
            {(error || state.attackError) && <p className="err">{error || state.attackError}</p>}
          </section>
        </>
      )}
    </div>
  );
}

/* ===== arena ===== */
function Arena({ rawPhase, flight, now }) {
  const el = flight ? now - flight.startedAt : 0;
  const hits = flight ? flight.guards.map((_, i) => BOLT_MS + i * GAP_MS) : [];
  const finish = hits.length ? hits[hits.length - 1] + 480 : 0;
  const boltOn = flight && el < BOLT_MS;
  const stage = flight
    ? el >= finish ? "done" : "fight"
    : "";
  const outcome = stage === "done" ? flight.tier : "";
  const guardStages = flight
    ? flight.guards.map((g, i) => {
        if (stage !== "fight") return 0;
        if (el < hits[i]) return 0;
        if (el < hits[i] + 260) return g.clear ? 2 : 3;
        return 0;
      })
    : [0, 0, 0];

  const gameOver = state2tierLabel(outcome);
  const guards = [0, 1, 2].map((i) => ({
    i,
    name: ["g1", "g2", "g3"][i],
    st: guardStages[i],
    ms: flight ? flight.guards[i].ms : null,
    delay: hits[i] ?? 0,
  }));
  return (
    <section className={`arena sticky card ${gameOver.cls}`}>
      {flight && (
        <span key={flight.startedAt} className={`bolt ${boltOn ? "fly" : ""}`} aria-hidden="true">
          <Sprite name="bolt" size={20} />
        </span>
      )}
      {rawPhase ? (
        <>
          <div className="scene">
            <Sprite name="vault" size={104} className="vdoor" />
            <span className="vled" aria-hidden="true" />
          </div>
          <p className="rawline dim blink-idle">NO GUARDS — agent pays raw…</p>
        </>
      ) : (
        <div className="formation">
          <GuardSlot g={guards[0]} size={54} flight={flight} />
          <div className="scene">
            <Sprite name={gameOver.open ? "vaultOpen" : "vault"} size={104} className="vdoor" />
            <span className="vled" aria-hidden="true" />
            {flight && stage === "done" && gameOver.coins &&
              Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="coin-pop" style={{ animationDelay: `${i * 70}ms`, left: `${18 + i * 11}%` }}>
                  <Sprite name="coin" size={16} />
                </span>
              ))}
          </div>
          <GuardSlot g={guards[2]} size={54} flight={flight} />
          <GuardSlot g={guards[1]} size={52} flight={flight} front />
        </div>
      )}
      <StatusLine stage={stage} outcome={outcome} />
    </section>
  );
}

/* Penjaga berdiri di posisi formasi (kiri/depan/kanan brankas) + idle anim */
function GuardSlot({ g, size, flight, front }) {
  return (
    <div className={`gpos gpos--${front ? "front" : "flank"}`}>
      <span
        className={`gseat st${g.st}`}
        style={{ "--bobd": `${(g.i * 0.4).toFixed(1)}s`, "--blinkd": `${((g.i * 1.3) % 2.9).toFixed(1)}s` }}
      >
        <span className="gmain">
          <Sprite name={g.name} size={size} />
        </span>
        <span className="gblink mkover">
          <Sprite name={`${g.name}b`} size={size} />
        </span>
        <span className={`spark ${flight ? "" : "off"}`} style={{ animationDelay: `${Math.max(0, g.delay)}ms` }}>
          <Sprite name="hit2" size={34} />
        </span>
      </span>
      <span className={`gheart ${g.st === 2 ? "on" : ""} ${g.st === 3 ? "is-veto" : ""} ${g.st === 0 ? "gray" : ""}`}>
        <Sprite name={g.st === 3 ? "heartVeto" : "heart"} size={22} />
      </span>
      <span className="gms dim t-num">{g.st ? `${g.ms}ms` : "…"}</span>
    </div>
  );
}

function state2tierLabel(tier) {
  if (tier === "BREACH") return { cls: "won", open: true, coins: true, exit: true };
  if (tier === "G2") return { cls: "hold" };
  if (tier === "LAYER0") return { cls: "l0" };
  return {};
}

function StatusLine({ stage, outcome }) {
  if (stage === "done") {
    if (outcome === "BREACH") return <p className="astatus num-ok">3/3 CLEAR — VAULT OPEN, FUNDS RELEASED!</p>;
    if (outcome === "G2") return <p className="astatus verdict">2 CLEAR, 1 VETO — funds HELD (+500 lesson).</p>;
    if (outcome === "G1") return <p className="astatus verdict">1 CLEAR, 2 VETO — funds HELD.</p>;
    if (outcome === "VICTIM") return <p className="astatus verdict">All hearts CLEAR — but poisoned funds hit the victim.</p>;
    if (outcome === "LAYER0") return <p className="astatus verdict">Rejected at Layer 0 — the guards never fired.</p>;
    if (outcome === "ATTEMPT") return <p className="astatus verdict">Fizzle — logged as a plain attempt.</p>;
  }
  if (stage === "fight") return <p className="astatus dim blink-idle">Guards judging…</p>;
  return <p className="astatus dim blink-idle">ATTACK TO SCORE</p>;
}

function FinalBoard({ rank, myScore, standing, me, txUrl, rehearsal }) {
  const found = standing.some((r) => r.n === me) ? rank : 0;
  return (
    <section className="card final">
      <h1>Finished</h1>
      <p>
        Your rank: <b className="gold t-num"># {found > 0 ? found : "-"}</b>
      </p>
      <p>
        Final score: <b className="score">{myScore}</b>
      </p>
      <p className="dim">Mau main lagi? Tetap di halaman ini. Host akan membuka lobby baru dan skor ronde berikutnya mulai dari nol.</p>
      {txUrl ? (
        <a className="txlink" href={txUrl} target="_blank" rel="noreferrer">
          View transaction on MonadScan ↗
        </a>
      ) : (
        <p className="dim" role="status">
          {rehearsal ? "Mode rehearsal: tidak ada transaksi on-chain yang dikirim." : "Tidak ada transaksi on-chain untuk sesi ini."}
        </p>
      )}
    </section>
  );
}

/* ===== ruang tunggu (fase LOBBY — game belum dibuka host) ===== */
function WaitingRoom({ nick, playerCount, others, ownerToken, canStart, onStart, starting, startError, roundStartsAt }) {
  const room = roomFromUrl();
  const [qr, setQr] = useState(null); // { room, url } — codec QRCode async
  const [copied, setCopied] = useState("");
  const [, sweep] = useState(0);

  useEffect(() => {
    if (!roundStartsAt || roundStartsAt <= Date.now()) return undefined;
    const id = setInterval(() => sweep((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [roundStartsAt]);
  const msLeft = roundStartsAt ? Math.max(0, roundStartsAt - Date.now()) : null;

  useEffect(() => {
    if (!room) return undefined;
    let dead = false;
    QRCode.toDataURL(`${window.location.origin}/play?room=${room}`, { width: 320, margin: 2 })
      .then((url) => {
        if (!dead) setQr({ room, url });
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [room]);

  const copyText = (text, msg) => {
    navigator.clipboard?.writeText(text);
    setCopied(msg);
    setTimeout(() => setCopied(""), 1200);
  };
  const qrUrl = qr && qr.room === room ? qr.url : null;

  return (
    <section className="wroom card slide-in-8" aria-live="polite">
      <h1>WAITING ROOM</h1>
      <p className="dim">
        You're in, <b className="gold">{nick}</b>. The raid opens when the host starts Round 1.
      </p>
      {room && (
        <>
          <div className="wroomrow">
            <b
              className="wcode t-score"
              title="Tap to copy room code"
              onClick={() => copyText(room, "ROOM CODE COPIED!")}
            >
              {room}
            </b>
            <button
              className="btn"
              onClick={() => copyText(`${window.location.origin}/play?room=${room}`, "INVITE LINK COPIED!")}
            >
              COPY INVITE LINK
            </button>
          </div>
          {copied && <p className="wcopied">{copied}</p>}
          {qrUrl && <img className="wqr" src={qrUrl} alt={`QR to join room ${room}`} />}
          {qrUrl && <p className="dim wqrnote">Friends scan this QR — they land here, in this waiting room.</p>}
        </>
      )}
      {ownerToken && (
        <div className="wroom-owner">
          <button
            className="btn btn--primary big"
            onClick={onStart}
            disabled={starting || !canStart || !!msLeft}
          >
            {starting || msLeft ? "MEMULAI…" : canStart ? "MULAI PERMAINAN" : "BERGABUNG DULU…"}
          </button>
          <p className="dim">Khusus pembuat room. Setelah mulai, kedua ronde berjalan otomatis.</p>
          {startError && <p className="err" role="alert">{startError}</p>}
        </div>
      )}
      <span className="badge badge--sim">
        {playerCount} PLAYER{playerCount === 1 ? "" : "S"} IN
      </span>
      {others.length > 0 && (
        <div className="wlist">
          {others.map((r, i) => (
            <div className="wlrow" key={r.n}>
              <Avatar nick={r.n} size={18} idx={i} />
              <span className="dim t-num">{i + 1}.</span>
              <span>{r.n}</span>
              {r.n === nick && <span className="badge">YOU</span>}
              <span className="score">{r.s}</span>
            </div>
          ))}
        </div>
      )}
      <span className="wrmasc idle-bob">
        <Sprite name="mascot" size={30} />
        <span className="mkover flick" style={{ animationDelay: "0.8s" }}>
          <Sprite name="mascotB" size={30} />
        </span>
        <span className="mkover bff" style={{ animationDelay: "1.9s" }}>
          <Sprite name="mascotC" size={30} />
        </span>
      </span>
      {msLeft !== null && <p className="wcountlabel dim small">ROUND 1 STARTS IN</p>}
      {msLeft !== null
        ? <p className="wcount t-score">{Math.max(1, Math.ceil(msLeft / 1000))}</p>
        : <p className="astatus dim blink-idle">WAITING FOR THE HOST…</p>}
      <ul className="wroomhint dim">
        <li>
          <b>Round 1 RAW</b> — no guards. Catch the Cashier Agent completely off guard.
        </li>
        <li>
          <b>Round 2 VAULT</b> — AegisVault ON, 3 guards reading your prompt.
        </li>
        <li>One attack per 25s cooldown. Top 3 podium at the end.</li>
      </ul>
    </section>
  );
}
