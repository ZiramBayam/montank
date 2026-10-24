# Montank Frontend

Tiga layar untuk demo 5 menit **Montank (AegisVault)** — PRD v2,
jenis gaya "Neobrutalism Dark × 8-bit" (lihat `DESIGN.md`).

## Jalankan

From the project root, install with `npm install --prefix frontend`. For hot reload,
run `npm run frontend:dev` while the backend runs on port 3000. For one combined
deployment, run `npm run build` at the root and then `npm start`; Fastify serves
the built frontend and backend together on port 3000.

## Rute (SPA fallback)

| Rute | Layar |
|---|---|
| `/stage` | Proyektor 16:9 — bento 4 zona (PRD 7.2), telemetri, tombol juri, kill-feed |
| `/play` | HP penonton — nickname + Mesin Rakit Modus 3 baris (PRD 7.1) |
| `/host` | Panel host — kontrol fase, uji juri, Panic Blur (Spacebar, PRD 8) |

## Mode koneksi

- Frontend connects to `/ws/play`, `/ws/stage`, or `/ws/host` on the same origin.
  During Vite development, `/ws` is proxied to backend port 3000.
- Host authorization is supplied in the page URL as `?t=<HOST_TOKEN>`; the token
  is never baked into the frontend build. Without it, `/host` is read-only.
- The UI consumes the backend WebSocket protocol and never calls Monad RPC from
  the browser (PRD 3.5). Values are marked `VIRTUAL` when the backend is in
  rehearsal mode.

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

Build from the project root with `npm run build`.

Manual: buka `/host` → klik [RONDE 1 · RAW] → lihat layar JEBOL → [RONDE 2 · VAULT]
→ tier poin muncul di kill-feed + hati penjaga di spotlight → tombol juri
[Klaim Vendor Terdaftar] memicu timeline Jalur A.
