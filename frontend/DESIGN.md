# DESIGN.md v2 — Montank (Neobrutalism Dark × 8-bit)

Sumber kebenaran visual. Palet, border, dan struktur wajib mengikuti PRD Bagian 7
(Neobrutalism Dark). Bahasa detail (font pixel, sprite, motion bertingkat)
adalah lapisan 8-bit yang dipakai konsisten, bukan variasi liar.

## Palet (kunci PRD 7)

| Nama | Hex | Peran |
|---|---:|---|
| `bg` | `#0D0D11` | Latar semua layar |
| `panel` | `#141420` | Kartu/konsol, satu tingkat di atas bg |
| `panel2` | `#1E1E2E` | Kartu yang diangkat (kartu terpilih/hover hanya) |
| `ink` | `#000000` | Border 3px + hard-shadow. Tidak pernah teks |
| `paper` | `#F5F3EE` | Teks utama |
| `purple` | `#836EF9` | Aksen utama: CTA fase, brand, status vault ON, kedok "Sistem Internal" |
| `yellow` | `#FFD600` | Koin, skor, timer, peringatan —— SEMUA angka & koin |
| `red` | `#FF3B30` | VETO, layar JEBOL, cooldown, alarm |
| `green` | `#00E676` | CLEAR, hati aktif, jalur sah |

Aturan pakai:
- Merah dan hijau HANYA status hasil; kuning HANYA skor/koin/timer.
- Ungu adalah aksen utama: satu elemen penting per konteks (tombol fase,
  bingkai Vault, kedok premium) — bukan glow di mana-mana.
- Tidak ada gradien, blur, radius. Border `3px solid ink` + shadow
  `6px 6px 0 ink` (satu jenis) di kartu; elemen netral (feed row, dum)
  boleh tanpa shadow.
- Border hitam di atas `bg` tidak terlihat - kartu selalu ada latar `panel`
  atau `paper` sehingga border jelas.

## Tipografi (lapisan 8-bit, self-host @fontsource)

| Peran | Font |
|---|---|
| Display (judul layar, skor phase) | **Silkscreen** 400/700 |
| Skor/angka/timer/ms | **VT323** — SEMUA angka memakai ini |
| Body/UI pendek | **Pixelify Sans** 400/600, min 16px, lh 1.6 |

Uppercase + letter-spacing hanya untuk Silkscreen. VT323 selalu ukuran +25%
dari teks di sekitarnya agar terbaca dari proyektor.

## Sprite

Pixel-art digambar sebagai pixel-grid -> SVG (`scripts/gen-sprites.mjs`).
Emoji pada Rancangan kartu (7.1) TIDAK dirender sebagai emoji — diganti sprite
pixel dengan arti sama (crown, wajah sedih, siren, robot, dsb). Teks kartu
tetap persis seperti PRD.

Wajib: mascot "Si Agen Bendahara" (robot lugu, jabat tangan netral), 3 penjaga
(guardian P1/P2/P3, kartu wajah beda), koin, hati penuh, hati veto, brankas,
sprite kedok 4, sprite alasan 4, sprite taktik 4.

## Motion (dial: MOMEN)

- Transisi `steps(n)` (`step-end`) sepanjang masa; 0 easing halus.
- Yang bergerak: flash JEBOL (3 frame), hujan koin (burst 700ms, hanya tier
  +500 dan +1.000), hati brow   hati remuk (kedip 2x sekali per veto), timeline stage
  (geser steps 120ms), blink standby "TEMBAK UNTUK SERANG" (2 langkah ~1Hz
  saat antrean kosong), cooldown timer (tick 1s).
- Label hitam [SENSOR/FALLBACK/SIMULASI/CONTOH] tampil TANPA animasi (momen
  serius) supaya kejujuran itu khas.
- `prefers-reduced-motion`: semua state akhir statis; koin sebagai angka langsung.

## Layout

- `/stage` 16:9 = konsol bento 4 zona sesuai PRD 7.2: bar atas (timer, VAULT,
  saldo, ditahan, banner), spotlight (kiri-tengah), telemetri (bawah), kolom
  kanan (top 5 + antrean + kill-feed). Zona berbeda panel; satu dither 2x2
  checker `paper @ 10%` HANYA pada bar fase atas sebagai motif.
- `/play` satu kolom; controle minimal 48px; header @nickname + skor + peringkat.
- `/host` grid kontrol kecil, semua tombol >=48px, hotkey Spacebar panic.

## Bahasa UI

- Teks tampil sesuai PRD tanpa emoji di dalam kalimat; perasaan token dari sprite.
- Label kejujuran: `[fallback parser] [Contoh Serangan] [SIMULASI] [SENSOR OTOMATIS]`
  — warna dim (`paper 60%`) tapi tidak disembunyikan.
- Angka: semua nilai latensi/saldo adalah data masuk; UI tidak mengarang angka.
