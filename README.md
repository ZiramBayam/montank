# Montank — backend + frontend + contracts

Full-stack demo Montank / Aegis-600. Backend menyediakan beberapa arena terpisah dengan kode undangan lintas perangkat, room state machine, host controls, pemain/rejoin, antrean, guard P1–P3, Gemini/fallback, integrasi AegisVault Monad, dedup `monadLogs`, treasury telemetry, dan QR lobby. Frontend React menyediakan layar pemain, panggung, dan host.

Kode backend berada di `backend/src/`, UI di `frontend/`, dan smart contract serta script Foundry di `contracts/`. Perintah `npm run` tetap dijalankan dari root repo.

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

Siapkan `claims.json` berdasarkan `claims.example.json`. Setiap klaim harus punya `claimId`, `category`, alamat `recipient`, `amount` dalam MON desimal, dan `status` (`unpaid`/`paid`). P2 hanya memberi Clear jika data klaim cocok dengan ledger dan statusnya masih `unpaid`.

Untuk Jalur B live, daftarkan klaim yang sama ke kontrak dengan owner/deployer melalui `contracts/script/RegisterClaim.s.sol:RegisterClaim` sebelum bermain. Backend mengirim `keccak256(bytes(claimId))` sebagai ID klaim; kontrak mengikat ID itu ke recipient, amount, dan blok kedaluwarsa. Jika ID ada di ledger backend, backend mencocokkan `evidenceHash` on-chain dengan record tersebut sebelum mengirim proposal. Owner key hanya dipakai oleh script Foundry dan tidak disimpan di backend. Klaim yang sudah expired atau dipakai tidak dapat didaftarkan ulang dengan ID yang sama; gunakan ID baru. `evidenceHash` adalah komitmen ke record ledger, bukan bukti independen bahwa bounty atau invoice benar. Jangan gunakan alamat contoh untuk demo live.

## Aktifkan koneksi live Monad

Kontrak AegisVault dan suite Foundry ada di `contracts/`. Jalankan tes dengan `forge test --root contracts`. Untuk deployment ke Monad Testnet, salin `contracts/.env.example` ke `contracts/.env`, isi variabel yang diperlukan, lalu jalankan `forge script --root contracts script/Deploy.s.sol:Deploy --rpc-url https://testnet-rpc.monad.xyz --broadcast`. Deploy demo mensyaratkan `GUARDIAN_MASK=7`. Simpan private key hanya di environment lokal yang aman.

Setelah deployment, konfigurasi alamat kontrak, 1+ Worker, tiga Guardian, Executor, RPC yang dapat diakses, dan saldo MON yang memadai di `.env`, lalu atur `REHEARSAL=false`. Backend memakai batas gas tetap dan tidak memanggil `eth_estimateGas`. Kontrak tidak di-deploy otomatis. Ledger hanya ditandai `paid` setelah kontrak mengeluarkan `ActionResolved` dengan status `EXECUTED`.

Backend mengharapkan ABI/event yang disediakan kontrak: `proposeAction`, `submitDecision`, `executeAction`, `payees`, `claims`, `actions`, `ActionProposed`, `Layer0Rejected`, `ClaimRejected`, `GuardianDecision`, dan `ActionResolved`. Alamat yang sudah dideploy harus diisi manual; backend tidak men-deploy kontrak secara otomatis.

`RAW_DEMO_RECIPIENT` opsional untuk ronde tanpa Vault; jika diisi, gunakan alamat testnet yang dikendalikan tim karena worker mengirim transfer langsung (maksimum 5 MON) sebesar `RAW_DEMO_AMOUNT`. `DEMO_RECIPIENT`/`DEMO_AMOUNT` dipakai klaim Jalur B dan harus cocok dengan `claims.json`. `VENDOR_RECIPIENT` dipakai klaim Jalur A dan harus sama dengan `VENDOR_ADDR` di `contracts/.env`. Gunakan alamat berbeda untuk Jalur A dan Jalur B agar klaim B tetap melewati guardian.

`GUARDIAN_MASK=1` menjalankan konfigurasi P0 satu penjaga (P1 deterministik, guardian EOA pertama). `GUARDIAN_MASK=7` menjalankan tiga penjaga P1–P3 dan memerlukan ketiga key Guardian.

Untuk tunnel, set `BASE_URL` ke URL HTTPS dari `cloudflared` dan `TRUST_PROXY=true` hanya jika server hanya dapat dijangkau melalui proxy tepercaya. URL QR dibuat ulang dari konfigurasi saat server mulai.

## Deploy demo gratis ke Render

`render.yaml` membuat satu web service Render Free untuk frontend, API, dan WebSocket dari origin yang sama. Di Render Dashboard pilih **New → Blueprint**, hubungkan repo dan branch yang berisi file ini, lalu terapkan Blueprint. Build, start, dan health-check sudah ditentukan di file tersebut. Blueprint memulai dengan `REHEARSAL=true`; buka `/stage` dan `/host?t=<HOST_TOKEN>` setelah deploy. `HOST_TOKEN` dibuat oleh Render dan dapat dilihat di Environment service.

Untuk mengirim transaksi Monad Testnet, isi Environment service dengan `WORKER_PRIVATE_KEYS`, `GUARDIAN_1_PRIVATE_KEY`, `GUARDIAN_2_PRIVATE_KEY`, `GUARDIAN_3_PRIVATE_KEY`, dan `EXECUTOR_PRIVATE_KEY` dari konfigurasi lokal yang aman, lalu ubah `REHEARSAL=false` dan redeploy. **Jangan masukkan `DEPLOYER_PRIVATE_KEY` ke backend.** Blueprint memakai ledger demo `claims.render.json` dan alamat yang sudah didaftarkan di testnet; jika klaim sudah dipakai atau kedaluwarsa, daftarkan klaim baru dan samakan ledger serta `DEMO_RECIPIENT`/`DEMO_AMOUNT`.

Render Free menidurkan service setelah 15 menit tanpa trafik dan filesystem-nya tidak persisten. Panaskan `/health` sebelum demo; setelah service bangun ulang, room dapat berganti. Perubahan status ledger lokal dapat hilang saat service tidur atau restart, sedangkan kontrak tetap mencegah klaim on-chain yang sudah dipakai dibayar lagi.

## Pemeriksaan

```powershell
npm run typecheck
```

Podium menghitung median waktu dari serangan masuk hingga hasil backend selama proses server aktif. Ini metrik end-to-end aplikasi, bukan finality chain. Durasi, biaya gas, p50/p95 chain, dan laju layanan tetap harus diukur melalui spike sesuai PRD sebelum menampilkan klaim performa ke peserta/juri.
