// Pixelmap -> SVG. Sumber palet: DESIGN.md v2 (PRD 7).
// Jalankan: node scripts/gen-sprites.mjs
// Output: src/assets/sprites/*.svg (shape-rendering crispEdges)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "assets", "sprites");
mkdirSync(outDir, { recursive: true });

const C = {
  ".": null,
  k: "#000000", // ink / outline
  p: "#F5F3EE", // paper
  n: "#141420", // panel
  d: "#1E1E2E", // panel2 (shading)
  u: "#836EF9", // purple
  y: "#FFD600", // yellow (koin/skor)
  r: "#FF3B30", // red (veto/jebol)
  g: "#00E676", // green (CLEAR)
  b: "#2B3A67", // navy (seragam satpam & celana)
  s: "#8A8F98", // steel medium (bodi brankas)
  t: "#B9BEC7", // steel terang (sorot/rivet)
  f: "#EFC29B", // kulit (avatar)
  h: "#4A2F1B", // rambut coklat tua
  // 8 warna baju avatar player (hash nickname)
  "0": "#FFD600",
  "1": "#836EF9",
  "2": "#00E676",
  "3": "#FF3B30",
  "4": "#3B82F6",
  "5": "#FF9D2E",
  "6": "#35C9D6",
  "7": "#FF61D5",
};

function svg(cells) {
  const h = cells.length;
  const w = Math.max(...cells.map((r) => r.length));
  const byColor = new Map();
  cells.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = C[row[x]];
      if (!fill) continue;
      if (!byColor.has(fill)) byColor.set(fill, []);
      byColor.get(fill).push(x, y);
    }
  });
  let body = "";
  for (const [fill, pts] of byColor) {
    let d = "";
    for (let i = 0; i < pts.length; i += 2) {
      d += `M${pts[i]} ${pts[i + 1]}h1v1h-1z`;
    }
    body += `<path fill="${fill}" d="${d}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" width="${w}" height="${h}">${body}</svg>`;
}

const S = {};

/* == Logo MONTANK: kupola AegisVault + roda 8 juru, hub = koin huruf M, 20x18 == */
function logoSprite() {
  const W = 20, H = 18;
  const G = Array.from({ length: H }, () => Array(W).fill(null));
  const P = (x, y, c) => { if (G[y]?.[x] !== undefined) G[y][x] = c; };
  const cx = 9.5, cy = 8.0;
  const dist = (x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy);

  // kupola lingkaran baja + outline
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = dist(x, y);
    if (r <= 7.4) P(x, y, "s");
    else if (r <= 8.2) P(x, y, "k");
  }
  // sorot kiri-atas + bayang kanan-bawah pada ring dalam
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (G[y][x] !== "s") continue;
    const r = dist(x, y);
    if (r <= 6.0) continue;
    const ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
    if (ang > -Math.PI * 0.75 && ang < -Math.PI * 0.2) P(x, y, "t");
    if (ang > Math.PI * 0.25 && ang < Math.PI * 0.75) P(x, y, "d");
  }
  // roda: ring gelap d, rim k, 8 juru kuning (4 lurus + 4 diagonal) berhenti di rim
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = dist(x, y);
    if (r <= 1.4 || r > 5.1) continue;
    if (r > 4.4) { P(x, y, "k"); continue; }
    P(x, y, "d");
    const dx = Math.abs(x + 0.5 - cx), dy = Math.abs(y + 0.5 - cy);
    if (dx < 0.75 || dy < 0.75 || Math.abs(dx - dy) < 0.75) P(x, y, "y");
  }

  // koin hub: kotak 6x6 (sudut di-trim) + 'M' 3x3 tinta
  for (let y = 5; y <= 10; y++) for (let x = 7; x <= 12; x++) {
    const corner = (y === 5 || y === 10) && (x === 7 || x === 12);
    P(x, y, corner ? "d" : "y");
  }
  P(9, 6, "k"); P(11, 6, "k");
  P(9, 7, "k"); P(10, 7, "k"); P(11, 7, "k");
  P(9, 8, "k"); P(11, 8, "k");

  // bar base baja di bawah kupola + kaki
  for (let x = 3; x <= 16; x++) { P(x, 15, "s"); P(x, 16, "s"); }
  for (let x = 3; x <= 16; x++) P(x, 16, "d");
  P(3, 15, "k"); P(16, 15, "k"); P(3, 16, "k"); P(16, 16, "k");
  P(4, 17, "k"); P(5, 17, "k"); P(14, 17, "k"); P(15, 17, "k");

  return svg(G.map((row) => row.map((c) => c ?? ".").join("")));
}
S.logo = logoSprite();

/* == Brand: perisai brankas, 12x14 == */
S.shield = svg([
  "....kkkkkk..",
  "...kuuuuuuk.",
  "..kuuuuuuuuk",
  ".kuuukkpppuk",
  ".kuukkkppppk",
  "kuuuuukpkkpk",
  "kuuuuukkpppk",
  ".kuuuuuuppuk",
  ".kkuuuuuupuk",
  "..kkuuuuuuk.",
  "...kkuuuuk..",
  "....kkuuk...",
  ".....kkpk...",
  "......kk....",
]);

/* == Mascot: Si Agen Bendahara (manusia 8-bit: rambut, wajah, baju, tangan, celana, sepatu), 12x16 ==
   mascot   = baju kuning (brand), idle
   mascotB  = mata ketutup (kedip)
   mascotC  = torso naik 1px (bertindik bernafas)
   mascotV0..7 = baju warna player (hash nickname), + suffix B/C untuk kedip/bernapas */
function mascotSprite(shirt, { closed = false, breath = false } = {}) {
  const W = 12, H = 16;
  const G = Array.from({ length: H }, () => Array(W).fill(null));
  const R = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (G[y]?.[x] !== undefined) G[y][x] = c;
  };
  const P = (x, y, c) => { if (G[y]?.[x] !== undefined) G[y][x] = c; };

  // rambut atas kepala
  R(2, 0, 9, 2, "h");
  // wajah
  R(2, 3, 9, 6, "f");
  if (closed) {
    P(4, 4, "k"); P(5, 4, "k"); P(7, 4, "k"); P(8, 4, "k"); // mata ketutup: garis
  } else {
    P(4, 4, "k"); P(7, 4, "k"); // mata terbuka
  }
  P(6, 6, "k"); P(7, 6, "k"); // mulut kecil
  // leher — hilang saat napas (baju naik)
  if (!breath) R(5, 7, 6, 7, "f");
  // torso baju; saat napas, dada naik 1px menutup leher
  R(2, breath ? 7 : 8, 9, 11, shirt);
  // lengan baju di sisi + tangan kulit
  R(1, breath ? 8 : 9, 1, 11, shirt);
  R(10, breath ? 8 : 9, 10, 11, shirt);
  P(1, 12, "f"); P(10, 12, "f");
  // celana + kaki + sepatu
  R(3, 12, 8, 13, "b");
  R(3, 14, 4, 14, "b"); R(7, 14, 8, 14, "b");
  R(3, 15, 4, 15, "k"); R(7, 15, 8, 15, "k");

  // garis tepi otomatis (keliling 1px, 4 arah)
  const edge = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (G[y][x]) continue;
    if (G[y]?.[x - 1] || G[y]?.[x + 1] || G[y - 1]?.[x] || G[y + 1]?.[x]) edge.push([x, y]);
  }
  for (const [x, y] of edge) G[y][x] = "k";
  return svg(G.map((row) => row.map((c) => c ?? ".").join("")));
}

S.mascot = mascotSprite("y");
S.mascotB = mascotSprite("y", { closed: true });
S.mascotC = mascotSprite("y", { breath: true });
for (let i = 0; i < 8; i++) {
  const key = String(i);
  S[`mascotV${i}`] = mascotSprite(key);
  S[`mascotV${i}B`] = mascotSprite(key, { closed: true });
  S[`mascotV${i}C`] = mascotSprite(key, { breath: true });
}

/* == Penjaga satpam 8-bit, 17x22; bentuk sama, chip dada beda warna; closed = frame kedip == */
function guardSprite(emblem, closed = false) {
  const W = 17, H = 22;
  const G = Array.from({ length: H }, () => Array(W).fill(null));
  const R = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (G[y]?.[x] !== undefined) G[y][x] = c;
  };
  const P = (x, y, c) => { if (G[y]?.[x] !== undefined) G[y][x] = c; };

  // topi pet: mahkota + pita emas + brim
  R(5, 0, 11, 1, "b");
  R(6, 2, 10, 2, "y");
  R(3, 3, 13, 3, "k");
  // wajah + mata + mulut (closed = mata ketutup, garis k)
  R(6, 4, 10, 8, "p");
  if (closed) {
    P(7, 5, "k"); P(8, 5, "k"); P(9, 5, "k");
  } else {
    P(7, 5, "k"); P(9, 5, "k");
  }
  P(7, 7, "k"); P(8, 7, "k"); P(9, 7, "k");
  // leher + torso seragam + dasi + lencana bahu & chip dada
  R(7, 9, 9, 9, "b");
  R(3, 10, 13, 20, "b");
  R(8, 10, 8, 12, "k");
  R(3, 10, 3, 11, "y");
  R(4, 12, 5, 13, emblem);
  // kaki
  R(4, 21, 6, 21, "b");
  R(10, 21, 12, 21, "b");

  // garis tepi otomatis (keliling 1px, 4 arah)
  const edge = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (G[y][x]) continue;
    if (G[y]?.[x - 1] || G[y]?.[x + 1] || G[y - 1]?.[x] || G[y + 1]?.[x]) edge.push([x, y]);
  }
  for (const [x, y] of edge) G[y][x] = "k";
  return svg(G.map((row) => row.map((c) => c ?? ".").join("")));
}
S.g1 = guardSprite("y"); // Novelty & Velocity
S.g2 = guardSprite("t"); // Claim Ledger
S.g3 = guardSprite("g"); // Adversarial Scanner
S.g1b = guardSprite("y", true); // frame kedip
S.g2b = guardSprite("t", true);
S.g3b = guardSprite("g", true);

/* == Koin, 10x10 == */
S.coin = svg([
  "...kkkk...",
  "..kyyyykd.",
  ".kyynnyyk.",
  "kyyndnnyyk",
  "kyndynnnyk",
  "kyndynnnyk",
  "kyyndnnyyk",
  ".kyynnyyk.",
  "..kdyyyyk.",
  "...kkkk...",
]);

/* == Brankas kupola: pintu bundar + roda tangan 8 juru, 22x20 == */
function vaultSprite(open = false) {
  const W = 22, H = 20;
  const G = Array.from({ length: H }, () => Array(W).fill(null));
  const cx = 10.5, cy = 10.0;
  const dist = (x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
  const P = (x, y, c) => { if (G[y]?.[x] !== undefined) G[y][x] = c; };

  // bodi baja + sorot terang & bayang
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) P(x, y, "s");
  for (let x = 1; x < W - 1; x++) { P(x, 1, "t"); P(x, H - 2, "d"); }
  for (let y = 1; y < H - 1; y++) { P(1, y, "t"); P(W - 2, y, "d"); }
  // dial kombinasi merah + LED kunci hijau
  P(4, 3, "r"); P(5, 3, "r"); P(4, 4, "r"); P(5, 4, "d");
  P(17, 3, "g"); P(18, 3, "g"); P(17, 4, "d"); P(18, 4, "d");

  // daun pintu bundar (ring gelap, muka baja / mulut gelap saat terbuka)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = dist(x, y);
    if (r <= 6.1) P(x, y, open ? "n" : "d");
    else if (r <= 7.2) P(x, y, "k");
  }
  // engsel di sisi daun pintu
  P(2, 8, "k"); P(3, 8, "k"); P(2, 9, "k"); P(3, 9, "k");
  P(18, 8, "k"); P(19, 8, "k"); P(18, 9, "k"); P(19, 9, "k");

  // roda tangan 8 juru: hub emas + juru + rim
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = dist(x, y);
    if (r <= 0.9 || r > 5.1) continue;
    if (r <= 2.4 || r > 4.1) { P(x, y, "y"); continue; }
    const ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
    const v = ((ang / (Math.PI / 4)) % 1 + 1) % 1;
    const dev = Math.min(v, 1 - v) * (Math.PI / 4);
    if (dev <= Math.atan2(0.7, r)) P(x, y, "y");
  }
  P(10, 9, "k"); P(11, 9, "k"); P(10, 10, "k"); P(11, 10, "k"); // lubang pegangan

  if (open) {
    // tumpukan emas di mulut gelap + kilau
    const coins = [
      [6, 14], [7, 14], [8, 14], [7, 15],
      [10, 13], [11, 13], [12, 13], [11, 14], [10, 15],
    ];
    for (const [x, y] of coins) P(x, y, "y");
    P(14, 5, "t"); P(15, 6, "t");
  } else {
    // cincin rivet di tepi daun pintu
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6 + Math.PI / 12;
      const x = Math.round(cx + Math.cos(a) * 5.6 - 0.5);
      const y = Math.round(cy + Math.sin(a) * 5.6 - 0.5);
      if (G[y]?.[x] === "d") P(x, y, "t");
    }
  }

  // bingkai luar
  for (let x = 0; x < W; x++) { P(x, 0, "k"); P(x, H - 1, "k"); }
  for (let y = 0; y < H; y++) { P(0, y, "k"); P(W - 1, y, "k"); }
  return svg(G.map((row) => row.map((c) => c ?? ".").join("")));
}
S.vault = vaultSprite(false);
S.vaultOpen = vaultSprite(true);

/* == Hati penjaga (CLEAR merah; VETO = penuh retak bernuansa panel) == */
S.heart = svg([
  ".kk...kk.",
  "krrkkrrk.",
  "krrrrrrk.",
  "krrrrrrk.",
  ".krrrrk..",
  "..krrk...",
  "...kk....",
]);
S.heartVeto = svg([
  ".kk...kk.",
  "krnkkrrk.",
  "krnrrrrk.",
  "krrnrrrk.",
  ".krrnrrk.",
  "..krrrk..",
  "...kkk...",
]);

/* == Kedok (emoji PRD 7.1 -> sprite) == */
S.maskCrown = svg([
  ".u.........u.",
  ".uu...uuu..uu",
  ".uuu.uuu.uuu.",
  ".uuuuuuuuuuu.",
  ".uuuuuuuuuuu.",
  ".uuuuuuuuuuu.",
  ".kuuuuuuuuuk.",
  "..kkkkkkkkk..",
]);
S.maskSad = svg([
  ".kkkkkkkk.",
  ".kppppppk.",
  ".krrpprrk.",
  ".krrpprrk.",
  ".kppppppk.",
  ".kprrrrpk.",
  ".kppppppk.",
  "..kkkkkk..",
]);
S.maskSiren = svg([
  "....kk....",
  "...krrk...",
  "..krrrrk..",
  "..krddrk..",
  "..krrrrk..",
  ".kkrrrrkk.",
  "krpppppppk",
  "krpppppppk",
  "kkkkkkkkkk",
  ".kk....kk.",
]);
S.maskBot = svg([
  "...kuuk...",
  "....kk....",
  ".kkkkkkkk.",
  ".kuuuuuuk.",
  ".ukkkkkku.",
  ".ukkppkku.",
  ".kuuuuuuk.",
  ".kuuuuuuk.",
  "..kkkkkk..",
  ".ku....uk.",
  ".kk....kk.",
]);

/* == Alasan == */
S.reasonFlame = svg([
  "....rr....",
  "...rrrr...",
  "...rrrr...",
  "..rrrrrr..",
  "..ryrryr..",
  ".rryyyyrr.",
  ".rryyyyrr.",
  ".rdyyyydr.",
  "..rdyydr..",
  "...rrrr...",
  "....rr....",
]);
S.reasonPr = svg([
  "kk..........",
  "kuk.........",
  "kuk.........",
  "kukk........",
  "...kkuukkk..",
  ".....kkuukk.",
  "......kuuuyy",
  ".......kuuyy",
  "........kuyy",
  ".........yyy",
  "..........kk",
]);
S.reasonCoffee = svg([
  "kkkkkkkkkkk",
  "knnnnnnnnnk",
  "kndnndnnnnk",
  "knnndnnndnk",
  "knnnnnnnnnk",
  "kkkkkkkkukk",
  "kkkkkkkuukk",
  ".kkkkkkkkk.",
  ".kkkkkkk...",
]);
S.reasonRefund = svg([
  "....kkkkk..",
  "...kpppppk.",
  "..kppkkkpk.",
  ".kppkkkkpk.",
  "kkuuukkppk.",
  "kkpuuuukkk.",
  ".kkpukkuuk.",
  ".kppkkuuuk.",
  ".kpppkkkuuk",
  "..kpppkkkk.",
  "...kpppk...",
  "....kkk....",
]);

/* == Taktik == */
S.actCap = svg([
  "kkkkkkkkkkkk",
  "kyyyyyyyyydk",
  "kydnnnnnnkyk",
  "kydpkknndkyk",
  "kydpkknndkyk",
  "kydpkknndkyk",
  "kydnnnnnndkk",
  "kyyyyyyyyydk",
  "kkkkkkkkkkkk",
]);
S.actBypass = svg([
  "...kkkkkk....",
  "..kuuuuuudk..",
  ".kuuukuukuuk.",
  "kuuk.kuukuuk.",
  "kuuk..kuukuk.",
  "kuuk..kuukuk.",
  "kuuu..kuuuuk.",
  "kuuuk.kuuuuk.",
  ".kuuukuuuuk..",
  "..kuuuuuuuk..",
  "...kkkkkkk...",
]);
S.actGhost = svg([
  "...kkkk...",
  "..kppppdk.",
  ".kpppppdk.",
  "kpukkppdk.",
  "kpkppppdk.",
  "kppppppdk.",
  "kpppppddk.",
  "kppddppdk.",
  "kpppdppdk.",
  ".kppdppdk.",
  "..kkdkkdk.",
  "....d..d..",
]);
S.actSplit = svg([
  "....kkk.....",
  "...kuuuk....",
  "....kkuuk...",
  "kk...kkk....",
  "yuk..kkkuuk.",
  "kyk.kkkuuuk.",
  "kkkuukkuuuk.",
  "kkkuukkuuk..",
  ".kkuukkuuk..",
  "...kuuuuk...",
  "...kuuuuk...",
  "....kkkk....",
]);

/* == Ikon UI == */
S.txLink = svg([
  "..kkkkkkkk",
  "..kukppppk",
  "..kuk..ppk",
  "..kuk.ppuk",
  "..kuk.puuk",
  "..kk.kukuk",
  "kkkk.kuuk.",
  "kppkkkkk..",
  ".kpppuk...",
  "..kkkuuk..",
  "....kkuuk.",
]);

/* == Fontura serangan (arena /play) == */
S.bolt = svg([ // proyektil serangan
  "..kkkk..",
  ".kyuuyk.",
  ".kuuuuk.",
  "..kkkk..",
]);
S.hit1 = svg([ // ekspresi tetes 1
  "...rr...",
  "..ryyr..",
  "...rr...",
]);
S.hit2 = svg([ // kartek cuma 2
  ".r..r..r.",
  "..ryyry..",
  "r.yyyyr.r",
  "..ryyry..",
  ".r..r..r.",
]);
S.hit3 = svg([ // ring ujung
  ".r.....r.",
  "r.......r",
  "r.......r",
  ".r.....r.",
]);

/* == Brankas kupola terbuka (3/3 clear) versi di atas, tandem vaultSprite(true) == */

for (const [name, data] of Object.entries(S)) {
  writeFileSync(join(outDir, `${name}.svg`), data);
}

writeFileSync(join(root, "public", "favicon.svg"), S.logo);
console.log(`OK — ${Object.keys(S).length} sprite ditulis ke src/assets/sprites`);
