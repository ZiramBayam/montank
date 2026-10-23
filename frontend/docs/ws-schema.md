# WebSocket contract

The frontend uses the backend as the source of truth. Connections share the page
origin and use `/ws/play`, `/ws/stage`, and `/ws/host`; the host token is passed
as the `t` query parameter. The browser does not connect to Monad RPC.

## Client to server

| Channel | Message | Purpose |
|---|---|---|
| play | `join { nickname }` | Join the room |
| play | `rejoin { playerId }` | Restore a saved player session |
| play | `attack { payload, manual? }` | Queue a card combination or enabled manual prompt |
| stage | `panic` | Toggle text blur |
| host | `host_cmd { cmd, ... }` | Change phase, toggle settings, or run demo actions |

## Server to client

The UI consumes `state`, `joined`, `join_rejected`, `scoreboard`, `queue`,
`queue_update`, `killfeed`, `guardian_decision`, `pipeline`, `treasury`,
`panic_blur`, `attack_ack`, `attack_result`, `attack_rejected`, `cooldown`,
`host_status`, and host notices/errors. Queue and attack validation, scores,
phase transitions, balances, and guard measurements come from the backend.

Manual prompts remain disabled unless the host enables them. Text is validated
and filtered by the backend before it reaches the stage feed.
