// SFX chiptune: disintesis WebAudio lokal (square wave) — bebas lisensi & tanpa jaring.
// Fu CC0 (paket Kenney) bisa dipasang di /public/audio/<name>.ogg; loader memilih file bila ada.
let ctx = null;
let unlocked = false;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function unlockAudio() {
  unlocked = true;
  try { ac(); } catch { /* audio diblokir browser */ }
}

function tone(t0, freq, dur, { type = "square", vol = 0.12 } = {}) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const N = (semisFromC4) => 261.63 * Math.pow(2, semisFromC4 / 12);

const SOUNDS = {
  ack: (t) => { // masuk antrean
    tone(t, N(7), 0.07);
    tone(t + 0.08, N(12), 0.09);
  },
  veto: (t) => { // hati remuk
    tone(t, N(-5), 0.16, { type: "sawtooth", vol: 0.1 });
    tone(t + 0.14, N(-10), 0.22, { type: "sawtooth", vol: 0.1 });
  },
  ticker: (t) => tone(t, N(12), 0.03, { vol: 0.05 }),
  t10: (t) => tone(t, N(4), 0.08, { vol: 0.08 }),
  t50: (t) => { tone(t, N(4), 0.07); tone(t + 0.07, N(9), 0.11); },
  t100: (t) => { tone(t, N(9), 0.08); tone(t + 0.08, N(13), 0.13); },
  t250: (t) => [4, 9, 13, 16].forEach((n, i) => tone(t + i * 0.07, N(n), 0.1)),
  t500: (t) => { // +500 momen edukatif: fanfare turun setengah nada dramatik
    [12, 9, 7].forEach((n, i) => tone(t + i * 0.12, N(n), 0.18, { type: "triangle", vol: 0.14 }));
    tone(t + 0.45, N(0), 0.5, { type: "triangle", vol: 0.12 });
  },
  t1000: (t) => { // jackpot 3/3 clear
    [0, 4, 7, 12, 7, 12, 16, 19].forEach((n, i) => tone(t + i * 0.09, N(n), 0.14, { vol: 0.13 }));
  },
  breach: (t) => { // layar JEBOL: alarm turun
    [0, -4, -7, -12].forEach((n, i) => tone(t + i * 0.18, N(n), 0.35, { type: "sawtooth", vol: 0.15 }));
  },
  vault: (t) => { // vault ON: naik triumf
    [0, 5, 9, 12].forEach((n, i) => tone(t + i * 0.08, N(n), 0.2, { type: "triangle", vol: 0.13 }));
  },
};

export const SFX = [
  "ack", "veto", "t10", "t50", "t100", "t250", "t500", "t1000", "breach", "vault",
];

export function play(name) {
  if (!unlocked || !SOUNDS[name]) return;
  try {
    if (hasFile(name)) {
      playFile(name);
      return;
    }
    SOUNDS[name](ac().currentTime + 0.01);
  } catch { /* AudioContext macet: abaikan */ }
}

const fileCache = new Map();
function hasFile(name) {
  return fileCache.has(name);
}

export async function probeFiles() {
  const head = await Promise.all(
    SFX.map((n) => fetch(`/audio/${n}.ogg`, { method: "HEAD" }).then((r) => (r.ok ? n : null)).catch(() => null)),
  );
  head.filter(Boolean).forEach((n) => fileCache.set(n, new Audio(`/audio/${n}.ogg`)));
}

function playFile(name) {
  const a = fileCache.get(name);
  if (a) {
    a.currentTime = 0;
    a.play().catch(() => { /* autoplay ditolak: synth tetap bunyi */ });
  }
}
