# Montank — backend + frontend

Full-stack demo Montank / Aegis-600. Backend menyediakan beberapa arena terpisah dengan kode undangan lintas perangkat, room state machine, host controls, pemain/rejoin, antrean, guard P1–P3, Gemini/fallback, integrasi AegisVault Monad, dedup `monadLogs`, treasury telemetry, dan QR lobby. Frontend React menyediakan layar pemain, panggung, dan host.

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
- `POST /api/rooms` — membuat arena terpisah dan memberi token host kepada pembuat; room lain tetap berjalan
- `POST /api/rooms/:roomCode/start` — memulai permainan; memerlukan token pembuat room
- `GET /api/rooms/:roomCode` — memvalidasi kode undangan dari perangkat peserta
- `GET /qr.png` — QR dari `BASE_URL/play?room=<kode>`
- WebSocket `/ws/play`, `/ws/stage`, `/ws/host?t=<HOST_TOKEN>` (alias kompatibilitas: `/play`, `/stage`, `/host`)

Setiap room memiliki kode, token mulai milik pembuat, pemain, scoreboard, fase permainan, timer, dan antrean serangan sendiri. Pembuat masuk sebagai peserta biasa dan mendapat satu tombol tambahan untuk memulai permainan; tokennya tidak memberi akses ke kontrol host lainnya. Membuat room baru tidak mengubah room yang sedang berjalan; pemain dapat membuat room lain tanpa menunggu peserta room sebelumnya keluar. Daftar room disimpan di `data/room-invite.json`, sementara state tiap room disimpan terpisah di `data/rooms/`. Koneksi Monad dan kontrak vault tetap merupakan layanan bersama backend.

Host tanpa token hanya menerima status dan tidak bisa mengirim perintah. Peserta dapat memakai kartu cepat atau mengirim prompt bebas hingga 1.000 karakter selama ronde aktif. Prompt bebas tidak bergantung pada pengaturan host; filter konten dan batas panjang tetap berlaku.

## Protokol singkat

`/play` menerima `join {nickname}`, `rejoin {playerId}`, dan `attack {payload, manual?}`. Nickname mengikuti `^[a-zA-Z0-9_]{2,12}$`. Nama tabrakan diberi suffix. Batas awal: 40 pemain, 3 join/IP, 1 serangan aktif per pemain, antrean maksimum 12, cooldown 5 detik setelah hasil, dan prompt manual maksimum 1.000 karakter.

`/host` menerima `host_cmd {cmd, ...}`. Host memulai permainan dengan `ROUND1`; lobby tidak mulai otomatis. Setelah dimulai, Round 1 (60 detik) dan Round 2 (120 detik) maju otomatis hingga podium. Host dan panggung menampilkan durasi total serta waktu mulai dan selesai. Perintah lain: `VAULT_ON`, `JUDGE_CLAIM_A`, `JUDGE_CLAIM_B`, `SIM_CROWD`, `SAMPLE_ATTACK`, `PANIC_BLUR`, `REFILL`, `REHEARSAL`, dan `GOTO:<phase>`. `REFILL` hanya memberi pengingat; backend tidak mengirim dana untuk refill.

Panic Blur aktif/nonaktif dengan `PANIC_BLUR`. Prompt bebas selalu tersedia selama ronde aktif. Filter konten tetap berlaku sebelum prompt ditampilkan pada `/stage`.

## Ledger klaim

Siapkan `claims.json` berdasarkan `claims.example.json`. Setiap klaim harus punya `claimId`, `category`, alamat `recipient`, `amount` dalam MON desimal, dan `status` (`unpaid`/`paid`). P2 hanya memberi Clear jika keempat nilai cocok dengan ledger dan klaim belum dibayar. Jangan gunakan alamat contoh untuk demo live.

## Aktifkan koneksi live Monad

Kontrak AegisVault dan suite Foundry ada di `contracts/`. Jalankan tes dengan `forge test --root contracts`. Untuk deployment ke Monad Testnet, siapkan variabel `DEPLOYER_PRIVATE_KEY`, `WORKER_1_ADDRESS`, `GUARDIAN_1_ADDRESS`, `GUARDIAN_2_ADDRESS`, `GUARDIAN_3_ADDRESS`, `GUARDIAN_MASK`, dan `AEGIS_EXPIRY_BLOCKS`, lalu jalankan `forge script --root contracts script/Deploy.s.sol:DeployAegisVault --rpc-url https://testnet-rpc.monad.xyz --broadcast`. `GUARDIAN_MASK=1` hanya membutuhkan Guardian 1; mask `7` membutuhkan ketiganya. Simpan private key hanya di environment lokal yang aman.

Setelah deployment, konfigurasi alamat kontrak, 1+ Worker, Guardian sesuai mask, Executor, RPC yang dapat diakses, dan saldo MON yang memadai di `.env`, lalu atur `REHEARSAL=false`. Backend memakai batas gas tetap dan tidak memanggil `eth_estimateGas`. Kontrak tidak di-deploy otomatis.

Backend mengharapkan ABI/event yang disediakan kontrak: `proposeAction`, `submitDecision`, `executeAction`, `payees`, `actions`, `ActionProposed`, `Layer0Rejected`, `GuardianDecision`, dan `ActionResolved`. Alamat yang sudah dideploy harus diisi manual; backend tidak men-deploy kontrak secara otomatis.

`RAW_DEMO_RECIPIENT` wajib diisi dengan alamat tim/testnet sebelum ronde tanpa Vault dapat mengirim transaksi; backend tidak pernah memakai alamat hasil LLM sebagai tujuan transfer langsung. Transfer langsung dibatasi maksimum 5 MON dan memakai `RAW_DEMO_AMOUNT`. `DEMO_RECIPIENT`/`DEMO_AMOUNT` dipakai tombol klaim juri.

`GUARDIAN_MASK=1` menjalankan konfigurasi P0 satu penjaga (P1 deterministik, guardian EOA pertama). `GUARDIAN_MASK=7` menjalankan tiga penjaga P1–P3 dan memerlukan ketiga key Guardian.

Untuk tunnel, set `BASE_URL` ke URL HTTPS dari `cloudflared` dan `TRUST_PROXY=true` hanya jika server hanya dapat dijangkau melalui proxy tepercaya. URL QR dibuat ulang dari konfigurasi saat server mulai.

## Pemeriksaan

```powershell
npm run typecheck
```

Podium menghitung median waktu dari serangan masuk hingga hasil backend selama proses server aktif. Ini metrik end-to-end aplikasi, bukan finality chain. Durasi, biaya gas, p50/p95 chain, dan laju layanan tetap harus diukur melalui spike sesuai PRD sebelum menampilkan klaim performa ke peserta/juri.
