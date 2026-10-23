# PromptFortress — backend + frontend

Full-stack demo PromptFortress/Aegis-600. Backend menyediakan room state machine, host controls, pemain/rejoin, antrean, guard P1–P3, Gemini/fallback, integrasi AegisVault Monad, dedup `monadLogs`, treasury telemetry, dan QR lobby. Frontend React menyediakan layar pemain, panggung, dan host.

## Jalankan mode gladi

Persyaratan: Node.js 20 atau lebih baru.

```powershell
Copy-Item .env.example .env
```

Atur `HOST_TOKEN` di `.env` dengan token acak panjang. Contoh membuat token:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Pasang dependensi backend dan frontend lalu buat build:

```powershell
npm install
npm install --prefix frontend
npm run build
npm start
```

Buka `http://localhost:3000/stage`; pemain di `/play`; host di `/host?t=<HOST_TOKEN>`. Untuk pengembangan dengan hot reload, jalankan `npm run dev` dan `npm run frontend:dev` pada dua terminal, lalu buka `http://localhost:5173/stage`.

Default `REHEARSAL=true`: LLM diganti stub lokal, tidak ada transaksi RPC, dan `RAW_DEMO_RECIPIENT` kosong. Buka:

- `GET /`, `/play`, `/stage`, `/host` — layar frontend
- `GET /health` — status layanan dan mode
- `GET /api/lobby` — `BASE_URL`, tautan `/play`, jumlah pemain, dan fase
- `GET /qr.png` — QR dari `BASE_URL/play`
- WebSocket `/ws/play`, `/ws/stage`, `/ws/host?t=<HOST_TOKEN>` (alias kompatibilitas: `/play`, `/stage`, `/host`)

Host tanpa token hanya menerima status dan tidak bisa mengirim perintah. Serangan dari kartu cepat bisa digunakan langsung; input prompt bebas perlu diaktifkan lewat tombol `Manual attacks` di panel host.

## Protokol singkat

`/play` menerima `join {nickname}`, `rejoin {playerId}`, dan `attack {payload, manual?}`. Nickname mengikuti `^[a-zA-Z0-9_]{2,12}$`. Nama tabrakan diberi suffix. Batas awal: 40 pemain, 3 join/IP, 1 serangan aktif per pemain, antrean maksimum 12, dan cooldown 25 detik setelah hasil.

`/host` menerima `host_cmd {cmd, ...}`. Perintah yang tersedia: `ROUND1`, `VAULT_ON`, `JUDGE_CLAIM_A`, `JUDGE_CLAIM_B`, `SIM_CROWD`, `SAMPLE_ATTACK`, `PANIC_BLUR`, `REFILL`, `REHEARSAL`, `MANUAL_ATTACKS`, dan `GOTO:<phase>`. `REFILL` hanya memberi pengingat; backend tidak mengirim dana untuk refill.

Panic Blur aktif/nonaktif dengan `PANIC_BLUR`. Teks manual terkunci kecuali operator menjalankan `MANUAL_ATTACKS` dengan `{ "enabled": true }`; filter konten tetap berlaku. Disarankan tidak mengaktifkan input manual sampai host dapat mengoperasikan blur pada UI panggung.

## Ledger klaim

Siapkan `claims.json` berdasarkan `claims.example.json`. Setiap klaim harus punya `claimId`, `category`, alamat `recipient`, `amount` dalam MON desimal, dan `status` (`unpaid`/`paid`). P2 hanya memberi Clear jika keempat nilai cocok dengan ledger dan klaim belum dibayar. Jangan gunakan alamat contoh untuk demo live.

## Aktifkan koneksi live Monad

Mode live membutuhkan kontrak AegisVault yang sudah di-deploy ke Monad Testnet (chain ID 10143), alamat kontrak, 1+ Worker, tiga Guardian, Executor, RPC yang dapat diakses, dan saldo MON yang memadai. Isi nilai tersebut di `.env`, lalu atur `REHEARSAL=false`. Backend memakai batas gas tetap dan tidak memanggil `eth_estimateGas`.

Backend mengharapkan ABI/event yang ditulis di PRD: `proposeAction`, `submitDecision`, `executeAction`, `payees`, `actions`, `ActionProposed`, `Layer0Rejected`, `GuardianDecision`, dan `ActionResolved`. Sumber kontrak/deployment belum ada di folder proyek ini; backend tidak membuat atau men-deploy kontrak secara otomatis.

`RAW_DEMO_RECIPIENT` wajib diisi dengan alamat tim/testnet sebelum ronde tanpa Vault dapat mengirim transaksi; backend tidak pernah memakai alamat hasil LLM sebagai tujuan transfer langsung. Transfer langsung dibatasi maksimum 5 MON dan memakai `RAW_DEMO_AMOUNT`. `DEMO_RECIPIENT`/`DEMO_AMOUNT` dipakai tombol klaim juri.

`GUARDIAN_MASK=1` menjalankan konfigurasi P0 satu penjaga (P1 deterministik, guardian EOA pertama). `GUARDIAN_MASK=7` menjalankan tiga penjaga P1–P3 dan memerlukan ketiga key Guardian.

Untuk tunnel, set `BASE_URL` ke URL HTTPS dari `cloudflared` dan `TRUST_PROXY=true` hanya jika server hanya dapat dijangkau melalui proxy tepercaya. URL QR dibuat ulang dari konfigurasi saat server mulai.

## Pemeriksaan

```powershell
npm run typecheck
```

Durasi, biaya gas, p50/p95, dan laju layanan belum merupakan klaim hasil ukur. Ukur spike sesuai PRD sebelum menampilkan angka performa ke peserta/juri.
