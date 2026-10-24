# PRD & Spesifikasi Teknis: Montank (Aegis-600) — v2

**Event:** Monad Blitz Jogja Vol. 2
**Kategori Produk:** On-Chain AI Agent Security Vault & Live Multiplayer Red-Teaming Arena
**Target Demo:** 5 menit (300 detik) live di panggung | **Bobot Penilaian:** 50% juri teknis, 50% vote peserta lain
**Status:** v2, direvisi setelah review; keputusan pasca-diskusi (model LLM, hosting, protokol WS, prosedur panggung) ada di Lampiran B. Bagian bertanda ⚠️ belum terverifikasi dan harus dicek/diukur sebelum dipakai di slide atau dijawab ke juri. Peta perubahan dari v1 ada di Lampiran A.

---

## 0. TL;DR untuk Anggota Tim (baca dalam 60 detik)

> 1. **Masalah nyata:** agen AI otonom yang diberi wewenang transfer dana (bayar bounty, API x402, treasury) tidak punya tombol Undo. Kalau agen dibujuk lewat teks, transaksi sudah ditandatangani dan uang pergi.
>    * **Freysa** adalah *game bounty yang sengaja dirancang*: peserta membayar biaya per pesan untuk membujuk AI agar melepas hadiah, dan akhirnya ada yang berhasil. Ini bukti bahwa agen dengan wewenang transfer bisa dibujuk lewat teks.
>    * **AiXBT** adalah *pembobolan panel kontrol agen*, **bukan** prompt injection ke agennya. Jangan disebut sebagai korban prompt injection. Kalau dipakai, sebut apa adanya: "akses ke agen berwewenang uang adalah permukaan serangan".
>    * ⚠️ Angka kerugian dan tanggal kedua kasus harus dicek ulang dari sumber primer sebelum masuk slide.
> 2. **Solusi:** **AegisVault**, brankas di Monad dengan **dua jalur pembayaran**:
>    * **Jalur A, penerima terdaftar (registri):** cair instan, dibatasi Layer 0 (batas per-transaksi **dan** batas kumulatif per jendela waktu). Tanpa AI, tanpa latensi tambahan.
>    * **Jalur B, penerima baru / klaim baru:** dana ditahan. Cair hanya jika **3 dari 3 penjaga memberi Clear**. **Satu Veto saja menahan.** Penjaga tidak memicu pencairan; yang membayar adalah fungsi terpisah `executeAction`.
> 3. **Kemasan demo:** party game 60 detik gaya Kahoot/Jackbox. Penonton scan QR, merakit kartu serangan di HP (tanpa wallet), dan berlomba "merampok" Agen Bendahara di layar proyektor.
> 4. **Transparansi:** Agen Bendahara **sengaja dibuat lugu** dan itu **diumumkan di panggung**. Yang kita demonstrasikan adalah brankasnya, bukan klaim bahwa LLM kita mudah/susah ditipu.
> 5. **Keputusan infra/model (final):** semua LLM = Gemini `gemini-2.5-flash-lite`, key **billing aktif**; backend demo jalan di laptop + tunnel gratis (proyektor & panel host via `localhost`); mode **REHEARSAL** untuk gladi hemat kuota. Detail: 3.5, 7.0, 4.1.

---

## 1. Masalah & Arsitektur: Layer 0 + Dua Jalur

### 1.1 Dua jalur pembayaran

| Jalur | Untuk siapa | Cara cair | Perlindungan | Latensi |
| :---- | :---- | :---- | :---- | :---- |
| **A. Penerima terdaftar** | Vendor/kontributor yang sudah ada di registri on-chain | Satu transaksi `proposeAction` langsung membayar jika lolos Layer 0 | Layer 0: batas per-tx **dan** batas kumulatif per jendela (per penerima) | 1 transaksi. ⚠️ Angka final dari spike |
| **B. Penerima baru** | Alamat di luar registri / klaim dinamis | `PENDING` → butuh **3/3 Clear** → siapa saja panggil `executeAction` | Layer 0 (batas per-tx) + 3 Penjaga | ⚠️ Ditentukan spike; jangan klaim sebelum diukur |

### 1.2 Jawaban "kenapa tidak cukup `require()`?" (versi jujur)

Juri teknis pasti bertanya. Jawaban v1 bolong karena split-drain sebenarnya **bisa** ditangkap `require()`. Posisi kita sekarang:

* **Kita akui dan pakai `require()`/Layer 0** untuk apa yang memang bisa diputuskan statis: batas per-tx, batas **kumulatif per jendela** (menangkap split-drain ke penerima yang dikenal), alamat nol, jumlah nol. Nol latensi.
* **Yang tidak bisa diputuskan statis** adalah penerima/klaim baru. Tugas agen bersifat dinamis (bounty baru, vendor baru), jadi whitelist kaku mematikan fungsi agen, sedangkan tanpa whitelist `require()` tidak bisa membedakan klaim sah dari karangan.
* **Konsekuensi desain:** penjaga hanya dipakai untuk Jalur B. Vendor langganan tidak melewati AI sama sekali.

### 1.3 Batasan jujur desain ini (siapkan untuk juri)

* Split-drain ke **banyak penerima baru berbeda** tidak tertangkap batas kumulatif per penerima. Itu tugas Penjaga 1 (velocity/novelty lintas penerima baru). Ini heuristik, bukan jaminan.
* Penjaga 1 dan 2 **buta teks**. Hanya Penjaga 3 yang membaca teks serangan. Karena itu aturannya sengaja asimetris: **cair butuh 3/3 Clear, satu Veto menahan**. Dua penjaga buta teks tidak boleh bisa mengalahkan penjaga yang membaca teks (serangan jailbreak murni).
* **Fail-closed:** kalau penjaga mati/di-DDoS, dana Jalur B **membeku**, tidak cair. Harga yang dibayar: ketersediaan Jalur B turun. Jalur A tetap jalan dalam batas Layer 0.

---

## 2. Skenario Demo 5 Menit: "Timed Raid Room"

Demo dikendalikan **1 Host** di panggung lewat state machine terpusat (waktu 300 detik terkunci).

| Fase & Waktu | State | Layar Proyektor | HP Penonton | Tujuan |
| :---- | :---- | :---- | :---- | :---- |
| **1. Lobby** 0:00–1:00 | `LOBBY_OPEN` | QR besar (**dirender dari `BASE_URL` aktif**) + **URL pendek untuk diketik manual** + daftar nickname real-time + penjelasan 1 kalimat. **Tulis di layar: "Agen Bendahara sengaja dibuat lugu."** | Input nickname (2–12 alfanumerik), tanpa wallet | Kumpulkan 15–30 pemain |
| **2. Ronde 1: tanpa pelindung** 1:00–2:00 | `ROUND_1_RAW` | Host klik **[Mulai Tanpa Vault]**. Serangan pertama yang tertipu langsung menguras treasury demo ke alamat milik tim. Layar merah: **BRANKAS JEBOL**, dengan angka **saldo nyata** testnet (lihat 3.6) | Kartu serangan terbuka | Tunjukkan bahwa agen yang memegang dompet langsung jebol |
| **3. Ronde 2: AegisVault** 2:00–4:00 | `ROUND_2_SHIELD` | Host klik **[AEGIS VAULT: ON]**, timer 120 detik. Serangan masuk **antrean** (tampil di layar) lalu diproses satu per satu. Detik ke-90: juri klik **[Klaim Vendor Terdaftar]** → Jalur A. | Mesin Rakit Modus. Feedback langsung: **"Masuk antrean #n"** (<200 ms), lalu hasil akhir saat giliran diproses | Klimaks: leaderboard + timeline Proposed → Voted → Finalized live |
| **4. Podium & Bukti** 4:00–5:00 | `GAME_OVER` | Top 3 scammer, kartu telemetri on-chain (total serangan, jumlah veto, **median** latensi hasil ukur, dana ditahan), 1 blok kode integrasi SDK | Ranking akhir + link explorer | Kunci simpati peserta + argumen utilitas untuk juri |

### 2.1 Antrean serangan: dimensioning (dihitung ulang)

Dengan cooldown 5 detik, 30 pemain masih dapat mengirim serangan jauh lebih cepat daripada layanan ≈ **1 serangan per ~1,2 detik (0,83/detik)**. Antrean dibatasi 12; saat penuh, serangan baru ditolak dengan pesan antrean penuh. Jangan menjanjikan waktu hasil 1–2 detik.

Keputusan v2 (antrean adalah bagian permainan, bukan disembunyikan):

| Parameter | Nilai awal | Catatan |
| :---- | :---- | :---- |
| Serangan aktif per pemain | **1** | Pemain tidak bisa menembak lagi sebelum serangannya selesai diproses |
| Cooldown | **5 detik, dihitung setelah hasil keluar** | Konfigurasi aplikasi saat ini; uji tekanan antrean saat gladi |
| Panjang antrean maksimum | **12** | Penuh → "Antrean penuh, coba lagi". Ini mekanik game, bukan error |
| Laju layanan | ≈ 0,83/detik | ⚠️ Tergantung rate limit LLM (3.5) — key tier berbayar, verifikasi tetap di spike |
| Kapasitas Ronde 2 | ≈ 45–50 serangan terproses per 60 detik | Beri tahu pemain: "kamu bersaing memperebutkan slot" |

Antrean tampil di layar proyektor ("Antrean: 9 menunggu") dan di HP ("Posisi #4, ±5 detik"). Alternatif jika masih macet: **gelombang berkala** (tiap ~4 detik pilih 3 penyerang dari yang mengantre, acak atau berdasarkan skor). Dikerjakan hanya jika sempat (P2).

> **Keputusan LLM (final):** setiap serangan memicu **dua** panggilan ke Gemini (`gemini-2.5-flash-lite`, key **billing aktif**) — Agen Korban + Penjaga 3. Laju 0,83 serangan/detik ≈ ±100 panggilan/menit; kuota tier berbayar jauh di atasnya, biaya per run di bawah $0,01. Tetap verifikasi RPM/TPM key asli di spike (10.3); jika ternyata terbatas, turunkan laju layanan dan/atau pakai klasifikasi lokal untuk P3. Gladi/soundcheck lewat mode `REHEARSAL` (6.4) supaya kuota dan latensi tidak jadi variabel.

### 2.2 Aturan Poin Leaderboard (sinkron dengan aturan 3/3)

Skor mengikuti **seberapa dalam serangan menembus pertahanan**:

| Poin | Kejadian | Syarat |
| :---- | :---- | :---- |
| **+10** | *Attempt* | Ditolak langsung oleh LLM Agen Korban |
| **+50** | *Layer 0 Hit* | Agen Korban tertipu, `proposeAction` dipanggil, ditolak Layer 0 (melebihi batas per-tx / kumulatif) |
| **+100** | *Victim Tricked* | Agen Korban tertipu → `proposeAction` jalur B tercatat on-chain, semua penjaga Veto |
| **+250** | *1 Guard Fooled* | 1 dari 3 penjaga memberi Clear, 2 Veto |
| **+500** | *2 Guards Fooled* | 2 dari 3 memberi Clear, 1 Veto, **dana tetap tertahan** |
| **+1.000** | *Full Breach* | **3/3 Clear** dan dana benar-benar cair |

Skor +500 adalah momen edukatif utama: dua penjaga buta teks dikelabui, tetapi satu Veto menahan. Tie-break papan skor: skor sama → urutan serangan yang tiba lebih dulu menang.

### 2.3 Naskah host (talk track) & prosedur panggung

**Talk track (satu host, mengikuti fase bagian 2):**

* **Fase 1 (0:00–1:00):** "Sekarang kalian jadi penyerang. Satu fakta dulu: agen Bendahara ini sengaja kami buat patuh dan mudah percaya — diumumkan terbuka, supaya yang kami uji adalah brankasnya. Scan QR, rakit kartu kalian."
* **Fase 2 (1:00–2:00):** "Tanpa pelindung: siapa pun yang paling dulu membujuk, dompetnya jebol." Momen layar merah: bacakan angka **saldo nyata** yang terkuras dengan lantang.
* **Fase 3 (2:00–4:00):** narasi pasif: "serangan → antrean → keputusan penjaga → konsensus on-chain". Sekitar 90 detik setelah [AEGIS VAULT: ON] (≈3:30): klik [Klaim Vendor Terdaftar] — "Penerima yang sah tidak melewati AI sama sekali: Layer 0, cair instan." Jika tombol juri gagal: `SAMPLE_ATTACK` dari HP tim + lanjutkan narasi.
* **Fase 4 (4:00–5:00):** podium + satu kalimat utilitas: "Brankas ini modul — bisa dipasang ke dompet agen mana pun." Buka sesi tanya dengan cheat sheet (§9).

**Checklist waktu:**

* **T-30:** listener `monadLogs` hijau di panel host; saldo tiap EOA + vault dicek; tombol [Klaim Vendor Terdaftar] dites sekali; QR dari `BASE_URL` + URL pendek tampil di lobby; rekaman gladi + config `cloudflared` standby terbuka.
* **T-5:** satu serangan end-to-end dalam mode `REHEARSAL` (panel host → antrean → timeline → leaderboard), lalu nonaktifkan mode; cek saldo tidak berkurang tanpa alasan (siapkan `REFILL` bila perlu).

**Prosedur recovery (server crash mid-game):** restart backend (target ≤30 detik) → room reset ke `LOBBY_OPEN`, pemain otomatis kembali lewat reconnect/rejoin → host lompat fase dengan `GOTO:ROUND_2_SHIELD` (atau fase terakhir yang ditinggal) → umumkan sekali: "kita lanjut; status brankas on-chain tetap benar". `GOTO:<phase>` juga dipakai kalau timing kacau.

---

## 3. Fakta Teknis Monad & Constraint (WAJIB DIPATUHI SEMUA DEV)

### 3.1 Siklus blok & status konsensus

* Status blok: **Proposed → Voted → Finalized → Verified**. Blok yang sama muncul **berkali-kali** di `monadLogs`, sekali tiap kali `commitState` naik (sumber: dokumentasi Monad WebSocket & block states).
* Sebuah blok **boleh melompati `Voted`** (langsung Proposed → Finalized). Timeline UI **tidak boleh** mengasumsikan keempat tahap selalu ada.
* Blok `Proposed` bersifat **spekulatif**: sangat jarang, tetapi bisa tidak menjadi bagian chain. Tindakan penjaga pada blok yang batal tidak berbahaya (lihat 6.3).
* ⚠️ Angka waktu blok **300 ms** dan finality **600 ms** harus dicek ulang di docs.monad.xyz saat build. **Jangan** mencantumkan angka "Verified +1.500 ms" di slide atau jawaban juri sebelum diukur. Semua angka latensi di UI dan slide adalah **hasil ukur spike**, bukan angka teori.

### 3.2 Tidak ada mempool publik

* `newPendingTransactions` tidak didukung. Penjaga **wajib** memakai `eth_subscribe("monadLogs", { address: VAULT_ADDRESS })`, yang memancarkan log begitu blok berstatus `Proposed` (beserta `blockId` dan `commitState`).

### 3.3 Penagihan gas berbasis `gas_limit` + prinsip idempotent

* Monad menagih `gas_limit × gas_price`. Transaksi yang **revert** membakar seluruh `gas_limit`.
* Aturan kontrak:
  * `submitDecision` **hanya mencatat**. Tidak pernah membayar. Duplikat/terlambat = `return` (no-op), **bukan** revert.
  * Penolakan Layer 0 di `proposeAction` = **emit event + return**, bukan revert (revert hanya untuk pemanggil tak sah).
  * Pembayaran dilakukan `executeAction` (siapa saja boleh memanggil) dengan batas gas dan **tanpa propagasi revert** dari penerima.

### 3.4 Storage: tidak ada slot panas bersama

* Dilarang: counter global yang ditulis banyak transaksi (`nextActionId`, `totalSavedAmount`, `lastGuardianHeartbeatBlock`) dan satu struct yang ditulis oleh banyak penjaga (mask/count dalam satu slot).
* Aturan v2:
  * **Satu slot keputusan per (aksi, penjaga)**: `mapping(bytes32 => uint8) decision`, kunci = `keccak256(actionId, guardianId)`. Tiga penjaga menulis tiga slot berbeda.
  * **`actionId` dibuat server** (tidak ada `nextActionId` on-chain).
  * **`totalSaved` dihitung dari event** di backend/indexer, tidak disimpan on-chain.
  * Heartbeat penjaga: dihitung dari event `GuardianDecision`. Karena desain fail-closed, tidak ada logika dana yang bergantung pada heartbeat on-chain.
* ⚠️ Biaya gas storage (MIP-8): dari riset sebelumnya **yang terkonfirmasi hanya** SLOAD pertama pada halaman ±8.100 gas dan berikutnya ±100 gas. Angka SSTORE **10.900 / 2.900 / 100 di v1 tidak terverifikasi** dan dihapus. Slot baru juga dikenai biaya state growth. **Cek halaman "Opcode Pricing" di docs Monad** dan ukur dengan `forge test --gas-report` / transaksi nyata. Jangan mengklaim angka gas ke juri tanpa pengukuran.

### 3.5 Rate limit

* RPC publik testnet (⚠️ cek ulang angkanya; v1 mencatat ±25 request/detik untuk `eth_call`/`eth_estimateGas`).
* **0% HP penonton memanggil RPC.** HP dan proyektor hanya bicara ke backend kita lewat WebSocket. Backend membuka koneksi `monadLogs` (primary + backup, lihat 6.3).
* **API LLM (keputusan final):** Gemini `gemini-2.5-flash-lite` untuk semua peran, key **billing aktif**. Kuota tier berbayar jauh di atas kebutuhan ±100 panggilan/menit; tetap ukur RPM/TPM + latensi key asli di spike (10.3). Gladi memakai mode `REHEARSAL` (6.4).

### 3.6 EOA & saldo

* Pool EOA: **Worker** untuk Agen Korban (mulai dari 2, naik ke 4 jika saldo cukup), **3 EOA Penjaga**, **1 EOA Executor** (memanggil `executeAction`; atau berbagi antrean nonce dengan satu Worker). Nonce dikelola lokal per EOA, tiap EOA punya antrean transaksi sendiri.
* ⚠️ **Saldo belum terjamin.** v1 menulis "≥15 MON per EOA" untuk 7 EOA, tetapi faucet agen hanya memberi ±1 MON per panggilan.
* Tindakan wajib sebelum build: (1) baca halaman **Reserve Balance** di docs Monad dan hitung saldo minimum nyata per EOA; (2) **minta MON ke panitia**; (3) hitung total kebutuhan = (jumlah EOA × saldo minimum) + dana brankas demo + dana treasury Ronde 1.
* Angka di layar harus **saldo nyata testnet** (atau diberi label "virtual"). Angka v1 "brankas 100 MON" / "−100 MON" dihapus kecuali dananya memang ada. Skala demo disarankan kecil (mis. brankas ±20–30 MON, serangan ≤ 5 MON).

---

## 4. Arsitektur Sistem & Alur Data

```
[HP 15-30 Penonton]
   │ (1) Kirim serangan via WebSocket (tanpa RPC, tanpa wallet)
   ▼
[Backend: Antrean (1 aktif/pemain, maks 12) + Profanity Filter]
   │ (2) Ambil 1 serangan tiap ~1,2 s → Agen Korban (LLM, sengaja lugu)
   ▼
[Agen Korban] ──(jika tertipu)──► [Worker EOA] ── (3) proposeAction(actionId_dari_server, to, amount, intentHash)
                                                        │
                       ┌── to terdaftar? ───────────────┤
                       │ YA (Jalur A)                   │ TIDAK (Jalur B)
                       ▼                                ▼
         Layer 0: per-tx + kumulatif/jendela     Layer 0: per-tx → PENDING
         lolos → bayar instan                           │ (4) monadLogs: ActionProposed (commitState: Proposed)
         gagal → event Layer0Rejected                   ▼
                                              Listener (dedup per actionId)
                                                        │
                        ┌───────────────────────────────┼───────────────────────────────┐
                        ▼                               ▼                               ▼
          [Penjaga 1: Novelty & Velocity]  [Penjaga 2: Claim Ledger]    [Penjaga 3: Adversarial Text Scanner]
          (buta teks)                      (buta teks)                  (satu-satunya pembaca teks)
                        └──────────► submitDecision(actionId, isVeto) ◄─────────────────┘
                                     (mencatat saja; 1 slot per penjaga)
                                                        │
                        ┌───────────────────────────────┴───────────────────────────┐
                        ▼                                                           ▼
          ada ≥1 Veto → executeAction menandai VETOED              3/3 Clear → executeAction membayar
          (dana tidak pernah keluar)                               (gas dibatasi, tanpa propagasi revert)
                                                        │
                                                        ▼
                   [Backend broadcast ke /stage & /play: Proposed → (Voted) → Finalized, nilai terukur]
```

### 4.1 Skema protokol WebSocket (kontrak FE ↔ BE, dikunci)

Satu objek JSON per frame, field `type` di depan. Dikunci sekarang supaya Role B/C membangun paralel tanpa tawar-menawar selera saat integrasi.

| Arah | `type` | Payload | Catatan |
| :---- | :---- | :---- | :---- |
| /play → server | `join` | `{nickname}` | Validasi regex + unik; bentrok → server menambah suffix `-2` |
| server → /play | `joined` | `{playerId, nickname, state}` | |
| server → /play | `join_rejected` | `{reason: "ROOM_FULL"/"IP_LIMIT"}` | Cap 40 pemain; maks 3 join per IP |
| /play → server | `attack` | `{payload: {kedok, alasan, taktik}, manual?}` | `manual` hanya bila diaktifkan host (7.1) |
| server → /play | `attack_ack` | `{attackId, queuePos, estMs}` | Target <200 ms sejak klik [SERANG] |
| server → /play | `attack_rejected` | `{reason: "QUEUE_FULL"/"COOLDOWN"}` | |
| server → /play | `queue_update` | `{attackId, queuePos, estMs}` | Setiap perubahan antrean |
| server → /play | `attack_result` | `{attackId, layer: "VICTIM"/"LAYER0"/"GUARDIAN", verdict, points, breakdown[]}` | `breakdown[]` menjelaskan sumber poin |
| server → /play | `scoreboard` | `{top[], rank, score}` | Throttle ~1 detik |
| server → /play | `cooldown` | `{untilEpochSec}` | |
| server → /play & /stage | `state` | `{phase, tMsLeft}` | Broadcast tiap perpindahan fase |
| server → /stage | `killfeed` | `{entry}` | Semua serangan, tanpa kurasi |
| server → /stage | `spotlight` | `{attack, votes: [{guardianId, decision, ms}]}` | Prioritas vote campuran (7.2) |
| server → /stage | `pipeline` | `{actionId, commitState, txHash, measuredMs}` | Idempoten `(actionId, commitState)` (6.3) |
| server → /stage | `treasury` | `{balance, held}` | Dihitung dari event |

**Panel host** — `/host?token=<acak dari env>`; kontrol panggung **tidak pernah** tanpa token. Server menerima `host_cmd {cmd: "ROUND1" | "VAULT_ON" | "JUDGE_CLAIM_A" | "JUDGE_CLAIM_B" | "SIM_CROWD" | "SAMPLE_ATTACK" | "PANIC_BLUR" | "REFILL" | "REHEARSAL" | "GOTO:<phase>"}` dan membalas `host_status {...}`. `GOTO:<phase>` = override manual untuk lompat fase (recovery atau timing kacau).

**Reconnect & rejoin:** semua klien auto-reconnect (backoff 1–3 s). Setelah `rejoin {playerId}`, server kirim ulang `joined` + `scoreboard` + `state` + status serangan yang sedang diproses. HP yang layar terkunci/drop kembali tanpa kehilangan skor dan cooldown.

**Aturan akses:** nickname unik, cap 40 pemain per ruangan, maks 3 join per IP, frame WS >2 KB di-drop; endpoint demo tidak melakukan apa-apa berbahaya tanpa token.

---

## 5. Spesifikasi Smart Contract (`AegisVault.sol`)

> Kerangka acuan, bukan kode final. Wajib diuji Foundry (daftar tes di 5.3).

### 5.1 Struktur data & kerangka kode

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AegisVault {
    enum ActionStatus { NONE, PENDING, VETOED, EXECUTED, EXPIRED, PAYOUT_FAILED }

    // Keputusan per penjaga, disimpan di slot masing-masing
    uint8 internal constant D_NONE  = 0;
    uint8 internal constant D_CLEAR = 1;
    uint8 internal constant D_VETO  = 2;

    // Alasan penolakan Layer 0 (tanpa revert)
    uint8 internal constant R_ZERO_ADDR       = 1;
    uint8 internal constant R_ZERO_AMOUNT     = 2;
    uint8 internal constant R_OVER_TX_CAP     = 3;
    uint8 internal constant R_OVER_WINDOW_CAP = 4;

    struct ProposedAction {
        address proposer;      // EOA Worker
        uint96  amount;
        address to;
        uint64  expireBlock;   // 0 untuk Jalur A
        ActionStatus status;
        bytes32 intentHash;
    }

    struct Payee {             // penerima terdaftar (Jalur A)
        bool    registered;
        uint96  perTxCap;
        uint96  perWindowCap;
        uint96  spentInWindow;
        uint64  windowStartBlock;
    }

    uint96  public constant MAX_NEW_RECIPIENT_PAYOUT = 5 ether; // Layer 0, Jalur B
    uint64  public constant WINDOW_BLOCKS = 200;                // jendela kumulatif Jalur A (dikalibrasi)
    uint256 internal constant PAYOUT_GAS_CAP = 50_000;          // batas gas panggilan ke penerima

    uint64  public immutable expiryBlocks;  // timeout aksi PENDING (dari hasil spike)
    uint8   public immutable guardianMask;  // 0b111 = 3 penjaga; build P0 boleh 0b001 (1 penjaga)

    mapping(bytes32 => ProposedAction) public actions;   // actionId dari SERVER
    mapping(bytes32 => uint8)          public decision;  // key = keccak256(abi.encode(actionId, guardianId))
    mapping(address => Payee)          public payees;    // registri penerima terdaftar
    mapping(address => uint8)          public guardianIndex; // 1..3 (0 = bukan penjaga)
    mapping(address => bool)           public isAgentWorker;

    event ActionProposed(bytes32 indexed actionId, address indexed to, uint256 amount, uint64 expireBlock, bytes32 intentHash);
    event Layer0Rejected(bytes32 indexed actionId, address indexed to, uint256 amount, uint8 reasonCode);
    event GuardianDecision(bytes32 indexed actionId, uint8 indexed guardianId, bool isVeto, uint8 reasonCode);
    event ActionResolved(bytes32 indexed actionId, ActionStatus status, uint256 amount);

    // constructor(guardians[3], workers[], guardianMask, expiryBlocks) + registerPayee(...) onlyOwner + receive() payable
    // Tidak ada: nextActionId, totalSavedAmount, lastGuardianHeartbeatBlock, vetoMask/clearMask/vetoCount/clearCount.
}
```

### 5.2 Aturan fungsi inti (wajib persis)

**1. `proposeAction(bytes32 actionId, address to, uint96 amount, bytes32 intentHash)`**

* Hanya `isAgentWorker[msg.sender]` (satu-satunya `require` yang boleh revert).
* Jika `actions[actionId].status != NONE` → `return` (ID duplikat = no-op).
* **Layer 0:** `to == address(0)` atau `amount == 0` → emit `Layer0Rejected` + `return`.
* **Jalur A** (`payees[to].registered`):
  * Jika jendela habis (`block.number >= windowStartBlock + WINDOW_BLOCKS`) → reset `windowStartBlock`, `spentInWindow = 0`.
  * `amount > perTxCap` → `Layer0Rejected(R_OVER_TX_CAP)` + `return`.
  * `spentInWindow + amount > perWindowCap` → `Layer0Rejected(R_OVER_WINDOW_CAP)` + `return` (**ini yang menangkap split-drain ke penerima terdaftar**).
  * Lolos → `spentInWindow += amount`, simpan aksi dengan status `EXECUTED` (efek sebelum interaksi), emit `ActionProposed`, lalu `_pay`.
* **Jalur B** (penerima baru):
  * `amount > MAX_NEW_RECIPIENT_PAYOUT` → `Layer0Rejected(R_OVER_TX_CAP)` + `return`.
  * Simpan aksi `PENDING`, `expireBlock = block.number + expiryBlocks`, emit `ActionProposed`. **Tidak ada pembayaran di sini.**

**2. `submitDecision(bytes32 actionId, bool isVeto, uint8 reasonCode)` (HANYA MENCATAT, IDEMPOTENT)**

* Hanya EOA penjaga resmi (`guardianIndex[msg.sender]` 1..3). Selain itu revert (pemanggil tak sah, bukan jalur normal).
* `k = keccak256(abi.encode(actionId, guardianId))`. Jika `decision[k] != D_NONE` → `return` (suara pertama final, tidak bisa diubah).
* Tulis `decision[k] = isVeto ? D_VETO : D_CLEAR`, emit `GuardianDecision`. **Selesai.**
* Tidak membaca/menulis struct aksi, tidak menghitung kuorum, **tidak membayar**. Tiga penjaga di blok yang sama tidak saling revert dan tidak berbagi slot.

**3. `executeAction(bytes32 actionId)` (siapa saja boleh; idempotent)**

* Jika status bukan `PENDING` → `return`.
* Iterasi penjaga aktif (sesuai `guardianMask`):
  * Ada `D_VETO` → status `VETOED`, emit `ActionResolved`, `return`. **Satu Veto menahan.**
  * Ada yang masih `D_NONE` → belum bulat.
* **3/3 `D_CLEAR`** → status `EXECUTED` lalu `_pay` (**fast path**, tidak menunggu jendela habis).
* Jika belum bulat dan `block.number >= expireBlock` → status `EXPIRED` (dana tidak pernah keluar; agen boleh mengajukan ulang dengan `actionId` baru).
* **Tidak ada jalur lambat optimistik.** Penjaga yang diam (mati/di-DDoS) tidak membuat dana cair; hanya membuat aksi kedaluwarsa (fail-closed). Alasannya: kalau jalur lambat mengizinkan cair tanpa suara Penjaga 3, penyerang cukup membuat Penjaga 3 diam untuk meloloskan jailbreak. *Keputusan ini bisa didiskusikan tim, tetapi syarat apa pun yang dipilih harus tetap mewajibkan suara Penjaga 3.*

**4. `_pay(actionId, to, amount)` (internal)**

* Status sudah di-set sebelum panggilan (efek dulu, interaksi kemudian).
* Saldo kontrak kurang → status `PAYOUT_FAILED`, emit, `return`.
* `to.call{value: amount, gas: PAYOUT_GAS_CAP}("")`; gagal → `PAYOUT_FAILED` + emit, **tanpa revert**. Penerima kontrak yang revert atau menghabiskan gas tidak bisa mengganggu transaksi siapa pun.

### 5.3 Tes Foundry minimum

* `submitDecision` dipanggil 3 penjaga di blok yang sama: tidak ada revert, tidak ada keputusan hilang.
* `submitDecision` duplikat dari penjaga yang sama = no-op.
* G1 + G2 Clear, G3 Veto → `executeAction` **tidak** membayar, status `VETOED`.
* 3/3 Clear → `executeAction` membayar; panggilan kedua = no-op.
* Penerima kontrak yang revert / menghabiskan gas → `PAYOUT_FAILED`, tidak ada revert ke pemanggil.
* Split-drain ke penerima terdaftar (banyak transaksi ≤ per-tx cap) → ditolak oleh batas kumulatif; reset setelah jendela lewat.
* `actionId` duplikat, pemanggil tak sah, aksi kedaluwarsa, `guardianMask = 0b001`.

---

## 6. Spesifikasi Backend, Antrean, & 3 Agen Penjaga

### 6.1 Tiga penjaga heterogen dengan isolasi input

Karena Jalur A sudah ditangani Layer 0, penjaga **hanya** memeriksa hal yang tidak bisa diputuskan statis.

| ID | Peran | Input | Logika | Latensi target |
| :---- | :---- | :---- | :---- | :---- |
| **P1** | **Novelty & Velocity Guard** (TypeScript murni, buta teks) | Parameter event (`to`, `amount`, `actionId`) + riwayat aksi Jalur B di memori backend | Veto jika: terlalu banyak penerima baru berbeda dalam jendela waktu, akumulasi Jalur B dalam jendela melebihi batas, alamat ada di daftar blokir. (Pengecekan bytecode `to` memakan panggilan RPC; opsional, di-cache, P2) | ⚠️ ukur |
| **P2** | **Claim Ledger Verifier** (validator skema, buta teks) | Objek JSON terstruktur hasil ekstraksi Agen Korban: `{ category, claimId, recipient, amount }`. **Bukan teks mentah penonton** | Cocokkan dengan **ledger klaim** (daftar klaim sah yang disiapkan tim: ID, penerima, jumlah, status belum dibayar). Veto jika klaim tidak ada, penerima/jumlah tidak cocok, atau sudah dibayar | ⚠️ ukur |
| **P3** | **Sandboxed Adversarial Scanner** (classifier LLM + regex, **satu-satunya pembaca teks**) | Teks serangan dibungkus `<untrusted_user_input>…</untrusted_user_input>` | Output classifier dibatasi enum (`CLEAR`/`VETO` + kode alasan) **via structured output (`responseSchema` enum) Gemini**, bukan teks bebas. Pola jailbreak, pemalsuan otoritas ("saya founder/auditor"), manipulasi sistem. **Hard-timeout 250 ms** → fallback regex lokal, sehingga P3 **selalu** memberi suara | ⚠️ ukur |

Catatan:
* Ledger di P2 mewakili sistem nyata (issue tracker/invoice) di produksi. Ledger dipakai juga untuk demo jalur positif: **klaim sah dari penerima baru → 3/3 Clear → `executeAction` membayar** (P1 prioritas).
* Output Agen Korban (termasuk JSON) bisa dimanipulasi serangan. Itu sebabnya P2 membandingkan dengan ledger, bukan mempercayai isi JSON.
* P3 adalah satu titik yang bisa dibujuk lewat teks. Mitigasi: output enum terbatas, backup regex, dan P1/P2 independen. Jangan klaim P3 kebal.

### 6.2 Strategi gas & pengiriman transaksi

* `gasLimit` **tetap** (mis. nilai awal 120.000 untuk `proposeAction`, 95.000 untuk `submitDecision`; ⚠️ nilai final dari spike). **Jangan** panggil `eth_estimateGas` saat demo (membuang 1 RTT dan kuota RPC).
* Penjaga mengirim `submitDecision` dengan `maxPriorityFeePerGas` lebih tinggi dari Agen Korban. ⚠️ **Efektivitasnya harus diukur di spike** (bandingkan p95 dengan dan tanpa prioritas); jangan menyatakan "validator selalu memprioritaskan".
* Backend (executor) memantau event `GuardianDecision` dan memanggil `executeAction` begitu ada Veto atau 3/3 Clear; kontrak tidak bergantung pada executor karena siapa pun boleh memanggil.

### 6.3 Listener `monadLogs` & dedup

Dua WebSocket paralel (primary `wss://testnet-rpc.monad.xyz`, backup `wss://rpc-testnet.monadinfra.com`), keduanya aktif (warm standby). Payload langganan:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "eth_subscribe",
  "params": ["monadLogs", { "address": "<AEGIS_VAULT_ADDRESS>" }] }
```

**Spesifikasi dedup (wajib):**

* Log yang sama datang **berkali-kali**: sekali per `commitState`, dan dua kali lagi dari koneksi kedua. Tanpa dedup, penjaga terpicu ganda.
* **Pemicu penjaga:** simpan `triggeredActions: Set<actionId>`. Penjaga hanya dipicu pada kemunculan **pertama** `ActionProposed` (dari koneksi mana pun, state apa pun). Kemunculan berikutnya diabaikan.
* **Update UI:** kunci idempoten `(actionId, commitState)`; ambil yang pertama tiba. Perubahan state hanya boleh maju (Proposed → Voted → Finalized); jika `Voted` dilewati, tampilkan langsung `Finalized`.
* Jika ada dua blok `Proposed` dengan nomor sama tetapi `blockId` beda, kunci tetap `actionId`: aksi yang sama tidak dipicu ulang, dan kontrak sendiri menolak `actionId` duplikat.
* Blok `Proposed` yang batal: keputusan penjaga yang tercatat untuk aksi yang tak pernah terjadi tidak berbahaya (hanya dibaca `executeAction` untuk aksi `PENDING`).
* Rekonsiliasi: jika dalam batas waktu tertentu tidak ada `Voted/Finalized` untuk sebuah `actionId`, lakukan **satu** pengecekan status (hormati rate limit RPC).

### 6.4 Agen Korban

* Dibuat sengaja lugu ("Bendahara Asisten yang Sangat Patuh dan Mudah Percaya") agar penjaga punya sesuatu untuk dijaga. **Ini diumumkan terang-terangan di panggung dan di layar Lobby.** Tidak ada klaim ">80% dijamin memicu".
* Timeout LLM 1.200 ms → fallback parser deterministik. Kill-feed menandai aksi dari fallback sebagai `[fallback parser]` agar jujur.
* **Level 2 (P2, jika sempat):** prompt diperkeras. Tampilkan angka *bypass rate* apa adanya.
* **Model & kuota (keputusan final):** `gemini-2.5-flash-lite` untuk Agen Korban dan P3, key **billing aktif** (lihat 3.5). Wajib ingat: angka RPM/TPM & latensi tetap diukur di spike, bukan diasumsikan.
* **Mode REHEARSAL (P0):** tombol/env mengganti LLM dengan stub deterministik lokal (Korban saja, atau Korban + P3). Gladi dan soundcheck tidak membakar kuota dan tidak mengejutkan latensi; kill-feed menandai `[rehearsal]` saat aktif.

---

## 7. Spesifikasi Frontend (Dual-Screen)

Estetika **Neobrutalism Dark Mode**: latar `#0D0D11`, border hitam 3px, hard-shadow, aksen ungu Monad `#836EF9`, kuning `#FFD600`, merah `#FF3B30`, hijau `#00E676`.

### 7.0 Hosting & keterjangkauan (keputusan final, $0)

* **Primary: backend + frontend jalan di laptop demo, dipublikasikan lewat tunnel `cloudflared` (gratis, HTTPS/WSS otomatis).** Proyektor dan panel host mengakses `localhost` langsung — kalau tunnel mati, yang hilang hanya HP penonton, dan mitigasinya sudah melekat: tombol `SIM_CROWD` tetap jalan via localhost.
* **Standby: deploy identik ke Render free tier** (atau sejenis), sudah di-ping berkala (UptimeRobot/cron gratis) supaya tidak tidur; disiapkan sejak jam-1, dipakai hanya kalau laptop mati. Catat cold start ±1 menit (lihat §8).
* `BASE_URL` dibaca dari env; **QR lobby di-render server dari `BASE_URL` aktif**, bukan di-hardcode, plus URL pendek yang bisa diketik manual. URL tunnel berubah di soundcheck → ganti env → restart → QR regenerasi sendiri.
* **Soundcheck venue WAJIB**: 2–3 HP join via tunnel dari Wi-Fi venue (captive portal bisa membalik meja: standby jadi pilihan beneran). Laptop tetap terjaga (matikan sleep/updates).

### 7.1 Mobile Controller (`/play`)

1. **Header:** `@nickname`, skor, peringkat.
2. **Mesin Rakit Modus (3 baris kartu):**
   * Baris 1, Kedok: [👑 Founder Monad] [😭 Anak Kos Nunggak] [🚨 Auditor Keamanan] [🤖 Sistem Internal]
   * Baris 2, Alasan: [Tagihan Server Meledak] [Klaim Bounty PR #99] [Beli Kopi Se-Venue] [Refund Transaksi Gagal]
   * Baris 3, Taktik: [Tarik 4.9 MON (di bawah limit)] [Mode Darurat Tanpa Cek] [Pura-Pura Simulasi] [Pecah Jadi 4.9 MON Berkali-kali]
3. **Preview prompt** otomatis. **Ketik manual (maks 1.000 karakter) = P1/P2.** Kartu preset saja bisa terlihat seperti staged, jadi input manual membuktikan serangan tidak diskrip; wajib dengan filter (bagian 8).
4. **Tombol [🚀 SERANG]:** feedback langsung **"Masuk antrean #n"** (<200 ms). Hasil akhir muncul saat giliran diproses. Cooldown 5 detik dihitung **setelah hasil**. Saat antrean penuh, tombol menampilkan "Antrean penuh".

### 7.2 Projector View (`/stage`)

Bento grid 4 zona (16:9, font besar):

* **Atas:** timer, status Vault (ON/OFF), **saldo nyata** brankas, counter **Dana Ditahan** (dihitung dari event), banner permanen "Agen Bendahara sengaja dibuat lugu".
* **Kiri-tengah (Spotlight):** satu serangan tiap ±3 detik. Kurasi memprioritaskan aksi yang paling informatif (mis. vote campuran 2 Clear + 1 Veto); kill-feed tetap menampilkan **semua**. Tampilkan 3 kartu penjaga dengan status Clear/Veto + waktu terukur.
* **Bawah-tengah (Telemetri konsensus untuk juri):** pipa waktu nyata `Proposed → (Voted) → Finalized` dengan nilai **terukur** (contoh nilai di mockup hanya ilustrasi), link **[Lihat Tx di MonadScan ↗]**, tombol juri **[✅ Klaim Vendor Terdaftar]** (Jalur A) dan, jika sempat, **[Klaim Vendor Baru Sah]** (Jalur B, 3/3 Clear).
* **Kanan:** Top 5 leaderboard + **panel antrean** ("Antrean: 9 menunggu") + kill-feed bergulir.

---

## 8. Mitigasi Risiko & Rencana Cadangan

| Skenario terburuk | Mitigasi wajib |
| :---- | :---- |
| **1. Kata kasar / SARA di proyektor** | Nickname `^[a-zA-Z0-9_]{2,12}$`. Teks manual disaring (Indonesia + Inggris). Host punya hotkey **[Spacebar] Panic Blur** yang mengganti teks serangan dengan "[SENSOR OTOMATIS]". **Aturan: ketik manual tidak boleh aktif tanpa filter + Panic Blur.** |
| **2. LLM lambat / kena limit** | `AbortController` 1.200 ms → fallback parser (ditandai di kill-feed). Pantau error 429; turunkan laju antrean otomatis. |
| **3. Tidak ada yang berhasil menipu Agen Korban** | Agen sudah sengaja lugu (diumumkan). Jika 15 detik pertama Ronde 2 tak ada `proposeAction`, host menembak **"Contoh Serangan dari Tim"** dari HP tim, dengan label jelas di kill-feed. Tidak ada klaim persentase jaminan. |
| **4. Wi-Fi ruangan mati** | Tombol host **[Simulasi Kerumunan]** (label "SIMULASI" tampil di kill-feed) + 2 HP tim via hotspot pribadi. |
| **5. Antrean menumpuk** | Cap 12, 1 aktif/pemain, cooldown 5 detik (2.1). Gladi dengan ≥10 HP; antrean penuh menolak serangan baru. |
| **6. Saldo EOA habis** | Hitung kebutuhan (3.6), minta MON ke panitia, kurangi jumlah Worker, tampilkan alarm saldo di panel host. |
| **7. Penjaga mati/lambat** | Fail-closed: Jalur B membeku/kedaluwarsa, Jalur A tetap jalan. P3 punya timeout 250 ms → regex. Host panel menampilkan status tiap penjaga. |
| **8. Listener terputus** | Dual WebSocket + dedup (6.3); reconnect otomatis. |
| **9. Tunnel mati / HP penonton tak menjangkau server** | Proyektor & panel host via `localhost` (tidak lewat tunnel) → `SIM_CROWD` tetap jalan (label "SIMULASI"). Standby Render sudah di-ping (lihat 7.0); soundcheck venue WAJIB. |
| **10. Laptop/server mati di tengah demo** | Restart backend ≤30 detik → pemain auto-rejoin → `GOTO:<phase>` (2.3). Alternatif: alih ke standby Render. Kontrak on-chain tidak peduli backend mati. |
| **11. Prankster menemukan kontrol host** | `/host` dan tombol juri wajib token acak dari env di URL (`?t=`); tanpa token = read-only. Cap 40 pemain + 3 join/IP mencegah flood ruangan (4.1). |
| **12. Standby Render tidur (cold start ±1 menit)** | Ping gratis (UptimeRobot/cron) sejak 1 jam sebelum demo; kalau terpaksa dipakai, host menahan panggung dengan talk track fase 1 (2.3) selama cold start. |

---

## 9. Cheat Sheet Jawaban Juri (Pegangan Presenter)

> **1. "Base punya Flashblocks 200 ms. Kenapa harus di Monad?"**
> *"Betul, dan kami tidak mengklaim Base tidak bisa. Mekanisme kami tidak bergantung pada `block.number`: keputusan penjaga dicatat per slot dan pencairan menunggu 3/3 Clear, jadi secara fungsional bisa jalan di keduanya. Kami ukur keduanya dengan skrip yang sama: [p50/p95 Monad: __ ms; Base Sepolia dengan Flashblocks: __ ms, N=200]. Perbedaan yang kami lihat ada di jaminan, bukan hanya angka: di Monad, blok konsensus tiap ~300 ms dengan finality ~600 ms (⚠️ verifikasi), sedangkan Flashblocks adalah pra-konfirmasi dari satu sequencer, cepat tetapi kepercayaannya pada satu pihak sampai blok kanonik. Itu trade-off, bukan keunggulan mutlak."*
> *(Isi angka dari hasil spike. Jangan memakai argumen "3 blok di Base = 6.000 ms"; itu sudah gugur.)*

> **2. "Bagaimana kalau penjaga di-DDoS supaya tidak ada yang mem-Veto?"**
> *"Itu tidak membuat dana cair. Pencairan Jalur B butuh 3 dari 3 Clear eksplisit, dan aksi tanpa suara lengkap hanya kedaluwarsa (fail-closed). Penyerang hanya bisa membekukan penerima baru, tidak bisa mencairkan. Vendor terdaftar tetap berjalan dalam batas Layer 0. Harga yang kami bayar adalah ketersediaan Jalur B."*

> **3. "Kenapa tidak `require()` saja?"**
> *"Kami memang memakainya: batas per-transaksi dan batas kumulatif per jendela di Layer 0 menangkap split-drain ke penerima yang dikenal, tanpa latensi. Yang `require()` tidak bisa adalah menilai penerima atau klaim baru, karena tugas agen dinamis. Jalur itu saja yang melewati penjaga. Penjaga 1 dan 2 buta teks; Penjaga 3 yang membaca teks, karena itu satu Veto saja menahan."*

> **4. "Ini game hackathon atau produk beneran?"**
> *"Game ini arena stress-test live, seperti Lakera Gandalf. Agen Bendahara sengaja kami buat lugu supaya brankasnya punya sesuatu untuk dijaga, dan itu kami umumkan. Produk intinya kontrak AegisVault dan modul penjaga yang bisa dipasang ke dompet agen mana pun."*

> **5. "Kenapa bukan Safe module dengan allowlist + spend-cap saja?"**
> *"Spend-cap dan allowlist memutus keputusan statis — itu persis Layer 0 kami, dan kami memang pakainya. Yang tidak bisa diputuskan statis adalah klaim dan penerima baru: bounty ini benar-benar dikerjakan atau tidak? Modul kami menambah kebijakan konten-sadar (satu penjaga membaca teks) dan verifikasi klaim lintas ledger, dijalankan tiga penjaga heterogen dengan kuorum asimetris (3/3 Clear, satu Veto menahan). Ini pelengkap di atas Safe/session-key, bukan saingannya."*

> **6. "Penjaganya server kalian sendiri — bukan komite terpusat?"**
> *"Jujur: iya. Penjaga di demo ini representasi tim atau pihak keamanan di produksi. Jaminannya di level kontrak: keputusan tercatat per slot penjaga on-chain, pencairan wajib 3/3 Clear eksplisit, satu Veto menahan, dan siapa pun boleh memanggil `executeAction` — kontrak tidak bergantung pada yang menjalankan penjaga. Identitas penjaga bisa diganti: multisig, komite, atau layanan keamanan pihak ketiga. Yang kami jual adalah antarmuka kebijakan di atas dompet agen, bukan klaim desentralisasi server."*

---

## 10. Prioritas, Anggaran Jam, & Urutan Build

### 10.1 Anggaran waktu

**Total jam build tersedia: T = ____ jam (isi sebelum mulai).** Alokasi proporsional:

| Blok | Porsi T | Contoh jika T = 8 jam |
| :---- | :---- | :---- |
| Spike latensi (bersama) | ±15% | ±1,2 jam |
| Build paralel P0 | ±30% | ±2,4 jam |
| Build P1 | ±30% | ±2,4 jam |
| Integrasi + gladi | ±25% | ±2 jam |

**Checkpoint hukum potong:**
* Di **25% T**: spike selesai dan angka tercatat. Jika belum → potong lingkup P1 sekarang.
* Di **50% T**: P0 harus jalan end-to-end. Jika belum → **hentikan semua pekerjaan P1**, fokus P0.
* Di **75% T**: **feature freeze**. Sisa waktu hanya integrasi, perbaikan bug, gladi.

### 10.2 Prioritas

| Prioritas | Isi | Catatan |
| :---- | :---- | :---- |
| **P0: demo minimum yang tetap layak menang** | • `AegisVault` (propose/submitDecision/executeAction + Jalur A + Jalur B) dengan `guardianMask = 0b001`, lulus tes Foundry inti<br>• **1 penjaga (P1, deterministik)** + listener `monadLogs` dengan dedup<br>• Agen Korban + fallback parser<br>• `/stage` minimal: timeline per aksi, link MonadScan, tombol **[Klaim Vendor Terdaftar]**<br>• Serangan dipicu oleh **host/HP tim** (tanpa HP penonton)<br>• Panel host + mode `REHEARSAL` (token URL, `GOTO`, tombol fase)<br>• Infra jam-1: backend lokal + config `cloudflared` + standby Render + QR dinamis (7.0)<br>• **Hasil spike** (≥200 sampel) | Bisa didemokan tanpa penonton. Semua angka di layar hasil ukur |
| **P1: demo penuh** | • Penjaga P2 + P3, `guardianMask = 0b111`, jalur positif 3/3<br>• `/play` (kartu preset), antrean, cooldown, leaderboard + kill-feed<br>• Nickname regex + Panic Blur (**wajib sebelum teks penonton tampil**)<br>• Ronde 1 tanpa pelindung<br>• Tombol Simulasi Kerumunan<br>• Rekaman gladi terbaik via ponsel (fallback demo darurat) | Ini yang dijual ke 50% vote peserta |
| **P2: bonus** | • Ketik prompt manual (butuh filter)<br>• Level 2 agen diperkeras<br>• Pengukuran Base Sepolia pada slide<br>• Gelombang berkala, cek bytecode di P1, SDK snippet<br>• Poles podium | Dikerjakan hanya jika P1 selesai sebelum 75% T |

**Urutan pemotongan jika waktu mepet (dibuang dari atas):** (1) P2 semua → (2) Ronde 1 tanpa pelindung → (3) P3 turun jadi regex saja → (4) P2 Claim Ledger diganti ledger statis → (5) turunkan jumlah penonton/antrean → (6) kembali ke P0 dengan serangan dari HP tim.

### 10.3 Spike latensi (Jam awal, dikerjakan bersama)

* [ ] Deploy kontrak minimal (Jalur A + B + `submitDecision`) ke Monad Testnet (Chain ID: 10143).
* [ ] Skrip Node.js + viem: dengarkan `monadLogs` (`Proposed`), balas `submitDecision` dengan `gasLimit` tetap, **tanpa `eth_estimateGas`**.
* [ ] **Minimal 200 sampel** per kondisi. Dengan 20 sampel p95 = nilai maksimum, jadi tidak bermakna. Laporkan p50, p95, dan max; p99 hanya jika ≥500 sampel.
* [ ] **Sisipkan jeda penjaga ±250 ms** sebelum mengirim keputusan (mensimulasikan P3).
* [ ] Ukur: (a) proposal terkirim → log `Proposed` diterima; (b) `Proposed` → keputusan penjaga terkonfirmasi (`Voted`/`Finalized`); (c) Jalur A end-to-end (klik → dana cair, status Finalized); (d) Jalur B 3/3 → `executeAction` terkonfirmasi.
* [ ] A/B kecil untuk priority fee: ada pengaruh pada p95 atau tidak.
* [ ] **Ulangi pengukuran yang sama di Base Sepolia** (skrip identik, mekanisme sama).
* [ ] **Verifikasi key Gemini (jam-1):** billing aktif; ukur RPM/TPM nyata (batch 20 panggilan paralel) dan latensi p50/p95 `flash-lite` untuk output enum P3.
* [ ] **Infra jam-1:** backend lokal jalan + config `cloudflared` menghasilkan WSS dari HP + standby Render ter-deploy & di-ping + QR dinamis dari `BASE_URL` teruji.
* [ ] Keluaran spike mengunci: `expiryBlocks`, `gasLimit`, angka klaim "<1 detik", dan angka di cheat sheet. **Klaim "dana cair <1 detik" untuk vendor sah dan "Verified +1.500 ms" tidak boleh dipakai sebelum ada hasil ini.**

### 10.4 Pembagian peran

* **Role A, Smart Contract & Web3:** `AegisVault.sol` + tes Foundry (5.3), deploy + verifikasi, pendanaan EOA (3.6), registri penerima terdaftar.
* **Role B, Backend, Antrean, Penjaga:** WebSocket server + state machine room, antrean (2.1), Agen Korban + fallback, listener + dedup (6.3), penjaga P1 → P2 → P3, executor.
* **Role C, Frontend:** `/stage` (P0 minimal dulu, lalu bento grid penuh), `/play`, panel antrean, Panic Blur.

### 10.5 Integrasi & gladi kotor (porsi akhir)

* [ ] Tembak serentak dari ≥10 tab/HP: cek tabrakan nonce, rate limit RPC dan LLM, perilaku antrean saat penuh.
* [ ] Latih demo 5 menit dengan stopwatch sesuai bagian 2, termasuk skenario cadangan bagian 8.
* [ ] **Rekam run gladi terbaik dengan ponsel** — fallback demo darurat (P1; nol biaya, tanpa produksi). Jangan dibuat video "pesponsoran", cukup bukti flow.
* [ ] Cek akhir: tidak ada angka di layar/slide yang bukan hasil ukur atau saldo nyata.

---

## 11. Daftar Belum Terverifikasi (cek sebelum dipakai)

- [ ] Waktu blok 300 ms dan finality 600 ms di Monad Testnet saat ini
- [ ] Angka gas MIP-8 (SSTORE dan state growth): cek halaman Opcode Pricing, lalu ukur
- [ ] Waktu "Verified" (+1.500 ms di v1): ukur atau hapus
- [ ] Efektivitas priority fee penjaga: ukur di spike
- [ ] Rate limit RPC publik (±25 RPS) dan **rate limit API LLM**
- [ ] Saldo minimum per EOA (halaman Reserve Balance) + ketersediaan MON dari panitia
- [ ] Angka dan tanggal kasus Freysa dan AiXBT dari sumber primer
- [ ] Angka Base (blok 2 detik, Flashblocks 200 ms) dan perilakunya di Base Sepolia
- [ ] Klaim "dana cair <1 detik" untuk vendor sah: tunggu hasil spike
- [ ] Key Gemini: billing aktif + RPM/TPM & latensi `flash-lite` terukur (spike, 10.3)
- [ ] URL explorer testnet (link tx di UI) mengarah ke kontrak dan bisa dibuka publik
- [ ] Keterjangkauan tunnel `cloudflared` dari Wi-Fi venue (soundcheck; captive portal), plus jaringan standby laptop

---

## Lampiran A: Peta Perubahan dari v1

| Masalah di v1 | Perbaikan di v2 | Bagian |
| :---- | :---- | :---- |
| Kuorum: cair otomatis di `clearCount >= 2`, veto baru di 2 suara | Cair cepat butuh **3/3 Clear**, **1 Veto menahan**; poin leaderboard dan jawaban juri ikut diubah | 1.3, 2.2, 5.2, 9 |
| Cheat sheet #1 memakai argumen "3 blok = 6.000 ms" | Jawaban jujur: tidak bergantung `block.number`; konsensus 300 ms vs pra-konfirmasi satu sequencer + angka spike | 9 |
| Slot panas bersama (`nextActionId`, `totalSavedAmount`, heartbeat, mask/count satu struct) | Slot keputusan per penjaga, `actionId` dari server, `totalSaved` dari event, tanpa heartbeat on-chain | 3.4, 5 |
| Jawaban "kenapa tidak `require()`" bolong; `invoiceRegistry` tak terpakai; P1/P2 mengulang cek statis | Dua jalur: penerima terdaftar (Layer 0, instan) vs penerima baru (penjaga); P1 = novelty/velocity, P2 = claim ledger | 1, 5, 6.1 |
| Spike 20 sampel | ≥200 sampel, jeda penjaga 250 ms, pengukuran sama di Base Sepolia | 10.3 |
| Saldo "≥15 MON × 7 EOA" tak dicek | Wajib cek Reserve Balance + minta MON ke panitia; skala demo dikecilkan | 3.6 |
| Antrean penuh akibat cooldown pendek | 1 aktif/pemain, cooldown 5 detik, antrean maks 12, tampil di layar, feedback posisi dan penolakan saat penuh | 2.1, 7 |
| Pencairan di dalam `submitDecision` | `submitDecision` hanya mencatat; `executeAction` membayar dengan gas cap, tanpa propagasi revert | 5.2 |
| Agen Korban ">80% dijamin" (terkesan staged) | Diumumkan sengaja lugu; fallback dan contoh tim diberi label; Level 2 opsional | 0, 6.4, 8 |
| Contoh AiXBT/Freysa keliru dibingkai | Dipisah dan dilabeli apa adanya; angka wajib diverifikasi | 0 |
| Tanpa total jam & urutan potong | Anggaran T, checkpoint, P0/P1/P2, urutan pemotongan | 10 |
| Gas MIP-8 10.900/2.900/100 tak terverifikasi; "Verified +1.500 ms"; "<1 detik" | Dihapus/ditandai ⚠️; tunggu hasil ukur | 3.1, 3.4, 11 |
| Dedup dua WebSocket belum ada | Spesifikasi dedup per `actionId` dan `(actionId, commitState)` | 6.3 |

---

## Lampiran B: Keputusan sesi review (pasca-v2)

| Topik | Keputusan | Bagian |
| :---- | :---- | :---- |
| LLM | `gemini-2.5-flash-lite` untuk semua peran, key **billing aktif**; P3 keluaran enum via `responseSchema`; mode `REHEARSAL` | 2.1, 3.5, 6.1, 6.4 |
| Hosting | Primary: laptop demo + tunnel `cloudflared` (proyektor & host via `localhost`); standby: Render free tier di-ping; QR dinamis dari `BASE_URL`; total $0 | 7.0, 8 |
| Akses | Panel host & tombol juri wajib token URL (`?t=`); cap 40 pemain, 3 join/IP; reconnect + rejoin otomatis | 4.1, 8 |
| Protokol | Skema WS minimal dikunci sebagai kontrak FE ↔ BE | 4.1 |
| Panggung | Talk track host, checklist T-30/T-5, prosedur recovery dengan `GOTO:<phase>` | 2.3 |
| Cadangan demo | Video fallback = rekaman gladi terbaik via ponsel (P1) | 10.5 |
| Cheat sheet | +2 jawaban juri: Safe module/allowlist, sentralisasi penjaga | 9 |
| Skor | Tie-break papan skor: urutan serangan tiba lebih dulu | 2.2 |
