# Skema Pesan WS — PromptFortress (frontend ⇄ backend)

Dipakai oleh `src/state/Bus.jsx`. JSON tunggal per frame; backend = sumber kebenaran
(HP & proyektor TIDAK memanggil RPC Monad — PRD 3.5).

## Client → Server
| type | payload | arti |
|---|---|---|
| `join` | `{nick}` | masuk room (regex `^[a-zA-Z0-9_]{2,12}$` tervalidasi ulang server) |
| `attack` | `{nick, picked:[3]}` ATAU `{nick, rawText}` (maks 140) | kombinasi kartu PRD 7.1 / teks manual |
| `panic` | `{}` | Panic Blur aktif |
| `host:*` | `host:lobby \| host:raw \| host:vaultOn \| host:over \| host:claimVendor \| host:teamAttack \| host:crowd` | kontrol host panel |

## Server → Client
| type | payload | arti |
|---|---|---|
| `room` | snapshot state penuh (phase, bank w/ saldo NYATA, players, vaultOn, virtual:false) | resync saat join/reconnect |
| `phase` | `{phase, startedAt}` | transisi state machine |
| `queue` | `{waiting, max: 12}` | panel antrean |
| `feed` | item serangan (kill-feed), semua serangan tampil | lihat bentuk `feed` di bawah |
| `panic` | `{}` | sensor teks di UI |

### Bentuk item `feed`
```json
{
  "id": "srv-6f1c2", "nick": "rampok_budi", "ts": 1760000000000,
  "text": "…teks serangan…",
  "labels": ["Contoh Serangan", "fallback parser"],   // label kejujuran PRD 6.4/8
  "verdict": { "tier": "G2", "points": 500 },          // tier PRD 2.2; VENDORA utk klaim juri
  "guards": [ { "clear": true, "ms": 8 }, { "clear": true, "ms": 71 }, { "clear": false, "ms": 183 } ],
  "timeline": { "proposed": 0, "voted": 312, "finalized": 604 },  // voted BOLEH tidak ada (PRD 3.1)
  "amountMon": 4.9,
  "txUrl": "https://monadscan/tx/0x…"

}
```

## Larangan untuk frontend
- Tidak ada `eth_*` dari browser; angka saldo/latensi harus dari pesan ini (result ukur), bukan hardcode.
- Timeline UI hanya boleh maju Proposed→Voted→Finalized; jika `voted` tidak ada, tampilkan Finalized langsung.
- Field `ms` wajib hasil ukur backend; frontend tidak mengarang angka.
