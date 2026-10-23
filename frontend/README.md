# PromptFortress Frontend

Tiga layar untuk demo 3 menit **PromptFortress (AegisVault)** — PRD v2,
jenis gaya "Neobrutalism Dark × 8-bit" (lihat `DESIGN.md`).

## Jalankan

```bash
npm install
npm run dev                     # buka http://localhost:5173/stage
npm run build && npm run preview
```

## Rute (SPA fallback)

| Rute | Layar |
|---|---|
| `/stage` | Proyektor 16:9 — bento 4 zona (PRD 7.2), telemetri, tombol juri, kill-feed |
| `/play` | HP penonton — nickname + Mesin Rakit Modus 3 baris (PRD 7.1) |
| `/host` | Panel host — kontrol fase, uji juri, Panic Blur (Spacebar, PRD 8) |

## Mode koneksi

- **Mock (default, jalan offline)** — mesin simulasi yang mengikuti PRD 2.1
  (antrean: 1 aktif/pemain, maks 12, cooldown 25 dtk), 2.2 (poin 6 tier),
  dan 6.1 (P1 buta teks 5–15 ms, P2 buta teks 40–90 ms, P3 scanner 120–220 ms).
  Semua angka ditandai `VIRTUAL` karena tidak digiring on-chain.
- **Real** — isi `VITE_WS_URL` env atau `?ws=wss://...` untuk memandu pesan
  backend; kontrak pesan: `docs/ws-schema.md`. HP dan proyektor sama sekali
  tidak memanggil RPC Monad (PRD 3.5).

## Aset

- `DESIGN.md` — token palet PRD (bg `#0D0D11`, aksen `#836EF9` `#FFD600`
  `#FF3B30` `#00E676`), border 3px, hard-shadow, motion bertingkat.
- `scripts/gen-sprites.mjs` — generator pixel-art → SVG. Jalankan:
  `node scripts/gen-sprites.mjs` (menghasilkan 22 sprite di `src/assets/sprites/`
  + favicon).
- `public/audio/` — 11 SFX chiptune dari paket **Kenney "Digital Audio"**,
  lisensi **CC0** (bukti di `public/audio/KENNEY-CC0-License.txt`). Loader
  memutarkan file bila ada, dan fallback WebAudio-disinyal bila file hilang.
- Font self-hosted `@fontsource` (Silkscreen, Pixelify Sans, VT323) — jaminan
  offline untuk panggung tanpa internet.

## Verifikasi cepat

```bash
npm run lint     # 0 temuan
npm run build    # sukses
```

Manual: buka `/host` → klik [RONDE 1 · RAW] → lihat layar JEBOL → [RONDE 2 · VAULT]
→ tier poin muncul di kill-feed + hati penjaga di spotlight → tombol juri
[Klaim Vendor Terdaftar] memicu timeline Jalur A.
