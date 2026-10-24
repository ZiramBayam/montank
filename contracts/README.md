# AegisVault contracts

Foundry project for the AegisVault demo on Monad. The contract enforces payout
limits and guardian decisions. `evidenceHash` binds a claim to a submitted
evidence reference; the contract does not validate the truth of off-chain
evidence or prove that an AI decision is correct.

## Setup

Install Foundry, then run these commands from this directory:

```sh
cp .env.example .env
# Fill in the network URL, private key, addresses, and block limits in .env.
forge build
forge test -vvv
```

Keep `.env` private. The deployer, three guardians, and workers must be distinct
addresses. The deploy script requires `GUARDIAN_MASK=7`, which activates all
three guardians. `EXPIRY_BLOCKS` and `WINDOW_BLOCKS` are block counts;
`VAULT_FUNDING` and the optional vendor caps are amounts in wei.

## Deploy

Set `MONAD_RPC_URL` and the required values in `.env`, then run:

```sh
forge script script/Deploy.s.sol:Deploy --rpc-url monad --broadcast
```

Optional `VENDOR_ADDR` registers a vendor as a payee. If set, its per-transaction
and per-window caps default to 1 ETH and 2 ETH unless overridden in `.env`.

## Register a Jalur B claim

The backend does not hold the owner key. Register each approved claim with the
deployer key before using it in a live game. Copy the claim's exact `claimId`,
`category`, `recipient`, and decimal `amount` from the backend `claims.json`;
set `CLAIM_AMOUNT_WEI` to that amount in wei and `CLAIM_VALID_UNTIL_BLOCK` to
a future Monad block number. Set `AEGIS_VAULT_ADDRESS` to the deployed vault.
Then run:

```sh
forge script script/RegisterClaim.s.sol:RegisterClaim --rpc-url monad --broadcast
```

The script uses `keccak256(bytes(claimId))` as the on-chain claim ID. Its
`evidenceHash` commits to the exact ledger fields using
`keccak256(abi.encode(keccak256(bytes(claimId)), keccak256(bytes(category)), recipient, amountWei))`.
The backend checks that commitment when a matching ledger record is present.
It is a commitment to the ledger record, not independent proof that an external
bounty or invoice is valid. A claim ID can only be registered once; use a new
ID when an expired or paid claim needs replacement.

## Layout

- `src/AegisVault.sol`: vault and guardian decision logic.
- `script/Deploy.s.sol`: environment-driven deployment script.
- `script/RegisterClaim.s.sol`: owner-only registration for a Jalur B claim.
- `test/`: unit and invariant tests.
- `.github/workflows/test.yml`: formatting, build, and test checks in CI.
