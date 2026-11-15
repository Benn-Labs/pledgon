# Sepolia sUSDe/USDC Lending Market — Deployment Package

Testnet end-to-end validation of the real CRE → on-chain reporting path for one
lending market, within the org's 3-active-workflow CRE quota. Follows the plan
agreed 2026-11-15: reuse the two active staging workflow slots for the
sUSDe/USDC market, keep `liquidation-protection-staging-safe` as a no-op, and
deploy the SPYx/USDC market fresh on mainnet later using the production slots.

Complements `docs/production-deployment-runbook.md` (mainnet cutover) — this doc
is the Sepolia-specific how-to.

## Locked decisions

| Item | Value | Notes |
|---|---|---|
| Collateral | mock `msUSDe` (18 decimals) | `DeployMockSUSDe.s.sol`; real sUSDe is mainnet-only. `mint()` is unguarded — testnet faucet. |
| Debt | Sepolia USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 decimals) | Live-verified 2026-11-15: `symbol()="USDC"`, `decimals()=6`. Official Circle testnet token. |
| Feed label | `sUSDe/USD` | Must match between `COLLATERAL_FEED_LABEL` and lending-oracle's `collateralFeedLabel`. |
| Liquidation threshold | 6900 bps (69% LTV) | Same as the locked mainnet design for sUSDe. |
| Borrow rate | 500 bps (5%/yr simple) | DeployLending default. |
| Max utilization | 9000 bps (90%) | Locked mainnet value; keep 10% of deposits idle/withdrawable. |
| `MAX_PRICE_AGE` / `MAX_VERDICT_AGE` | 900 / 900 | 15 min, DeployLending defaults. |
| `MAX_PRICE_DEVIATION_BPS` | 5000 | DeployLending default (single-tick sanity bound). |
| Oracle price source | CoinGecko `ethena-staked-usde` | Live-verified 2026-11-15: `{"ethena-staked-usde":{"usd":1.26}}`. Unauthenticated; bearer header ignored. |
| Liquidation verification source | CoinPaprika `susde-ethena-staked-usde` | Live-verified 2026-11-15. Deliberately a *different* provider than the oracle feed — preserves the independent-corroboration property (see `workflows/liquidation-protection/workflow.go`). |
| Consumers | deployed **unbound** (workflow id 0) | Binding is circular on CRE (workflow ID hashes config bytes, which contain the consumer address). Same accepted staging posture as the current deployment — see production runbook Phase 6. |

This market exercises the differing-decimals path (18-decimal collateral vs
6-decimal USDC) end to end: `LendingPool.collateralValueInDebtUnits()` converts
on-chain, and the frontend's `useLendingPosition` hook now mirrors that math
(uncommitted fix in `frontend/src/hooks/useLendingPosition.ts` — **commit it as
part of this package**; typecheck passes).

Already changed in the repo (review with `git diff`):

- `workflows/lending-oracle/config.staging.json` — CoinGecko sUSDe/USD source, path `ethena-staked-usde.usd`, feed label `sUSDe/USD`. `consumerAddress` still shows the OLD value; `wire-config` (step 4) patches it.
- `workflows/liquidation-protection/config.staging.json` — CoinPaprika source, path `quotes.USD.price`. `lendingPoolAddress`/`consumerAddress`/`borrowers` are stale until steps 4 and 7.
- `scripts/refresh-liquidation-borrowers.sh` — `--from-block` is now required (no default); the old default was the previous pool's deploy block and is dangerous to reuse.
- `contracts/evm/script/DeployMockSUSDe.s.sol` — writes `deployments/mock-susde-<chainId>.json`.

## Step 0 — Pre-flight

- [ ] `cre whoami` — logged in, deploy access enabled.
- [ ] Verify the Sepolia Keystone forwarder is still `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`: `cre workflow supported-chains` → `ethereum-testnet-sepolia` row (tenants can change — don't trust the runbook worksheet blindly).
- [ ] `.env` has `CRE_RPC_SEPOLIA` set (used below as `$CRE_RPC_SEPOLIA`); the deployer forge account (`--account deployer`) has Sepolia ETH and is not EIP-7702 delegated.
- [ ] Confirm quota headroom: `cre workflow list` shows exactly the three staging workflows and nothing else active.

## Step 1 — Archive the old mCOL/mUSD deployment records

`DeployLending.s.sol` overwrites `deployments/lending-<chainId>.json`; keep the
old market's record under a distinct name (the old pool stays on-chain, just
unfed).

```bash
cd contracts/evm
cp deployments/lending-11155111.json         deployments/lending-mcol-11155111.json
cp deployments/lending-tokens-11155111.json  deployments/lending-tokens-mcol-11155111.json
git add deployments/lending-mcol-11155111.json deployments/lending-tokens-mcol-11155111.json
```

## Step 2 — Deploy the mock msUSDe collateral token

The Sepolia deployers `deployer` and `deployer2` are EIP-7702 delegated
(`cast code` shows `0xef0100…`) and cannot raw-CREATE. **Use `deployer3`**
(`0x2ec717584c96d81bea7ce9c979a354f169f01093`, clean, funded) for every
`forge` command below, not the runbook worksheet's `deployer`.

```powershell
cd contracts\evm; forge script script/DeployMockSUSDe.s.sol --rpc-url https://ethereum-sepolia-rpc.publicnode.com --account deployer3 --broadcast --gas-estimate-multiplier 900 --slow
```

(On PowerShell use `;` between commands — `&&` and `\` continuations are not
valid there; paste your own RPC URL if you prefer it over the public node.)

> **Forge quirk (observed 2026-11-16):** with `--account <keystore>`, forge
> signs the broadcast txs with the account but runs the script's simulation
> with its default sender (`0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38`) as
> `msg.sender`. `DeployMockSUSDe`'s `token.mint(msg.sender, …)` therefore
> minted to the default sender, not deployer3. Fix by minting directly
> (run first, before Step 3):
>
> ```powershell
> cast send 0xC55567bAE87AC56e2B38fDa62F4dBC0d6Db6C23F "mint(address,uint256)" 0x2ec717584c96d81bea7ce9c979a354f169f01093 1000000000000000000000000 --rpc-url https://ethereum-sepolia-rpc.publicnode.com --account deployer3
> ```
>
> `DeployLending.s.sol` (Step 3) is unaffected — it never reads `msg.sender`.

Record: msUSDe address = `________________` (also in `deployments/mock-susde-11155111.json`).

Sanity-check it:

```bash
cast call <msUSDe> "symbol()(string)"   --rpc-url "$CRE_RPC_SEPOLIA"   # "msUSDe"
cast call <msUSDe> "decimals()(uint8)"  --rpc-url "$CRE_RPC_SEPOLIA"   # 18
cast call <msUSDe> "balanceOf(address)(uint256)" <deployer> --rpc-url "$CRE_RPC_SEPOLIA"  # 1_000_000e18
```

## Step 3 — Deploy the sUSDe/USDC lending stack

Dry-run first (drop `--broadcast`) to validate env + gas, then broadcast.
`COLLATERAL_TOKEN_ADDRESS` below is the already-deployed msUSDe
(`0xC55567bAE87AC56e2B38fDa62F4dBC0d6Db6C23F`) — update the record if yours
differs.

```powershell
cd contracts\evm; $env:FORWARDER_ADDRESS="0xF8344CFd5c43616a4366C34E3EEE75af79a74482"; $env:COLLATERAL_TOKEN_ADDRESS="0xC55567bAE87AC56e2B38fDa62F4dBC0d6Db6C23F"; $env:DEBT_TOKEN_ADDRESS="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; $env:COLLATERAL_FEED_LABEL="sUSDe/USD"; $env:LIQUIDATION_THRESHOLD_BPS="6900"; $env:BORROW_RATE_BPS="500"; $env:MAX_PRICE_AGE="900"; $env:MAX_VERDICT_AGE="900"; $env:MAX_UTILIZATION_BPS="9000"; $env:MAX_PRICE_DEVIATION_BPS="5000"; forge script script/DeployLending.s.sol --rpc-url https://ethereum-sepolia-rpc.publicnode.com --account deployer3 --broadcast --gas-estimate-multiplier 900 --slow
```

`LENDING_ORACLE_WORKFLOW_ID` / `LIQUIDATION_WORKFLOW_ID` intentionally left
unset → consumers deployed unbound (see "Locked decisions"). The script warns
about this; the warning is expected on staging.

Record from the output / `deployments/lending-11155111.json`:

| Component | Address |
|---|---|
| LendingPool | `________________` |
| LendingOracleConsumer | `________________` |
| LiquidationConsumer | `________________` |
| **Pool deployment block** | `________________` (needed for steps 4 and 7) |

On-chain verification (getters):

```bash
cast call <LENDING_POOL> "liquidationThresholdBps()(uint256)" --rpc-url "$CRE_RPC_SEPOLIA"   # 6900
cast call <LENDING_POOL> "collateralToken()(address)"  --rpc-url "$CRE_RPC_SEPOLIA"          # msUSDe
cast call <LENDING_POOL> "debtToken()(address)"        --rpc-url "$CRE_RPC_SEPOLIA"          # USDC
cast call <LENDING_ORACLE_CONSUMER> "expectedWorkflowId()(bytes32)" --rpc-url "$CRE_RPC_SEPOLIA"  # 0x0... (unbound)
```

## Step 4 — Wire the new addresses into the deployment record and configs

`cmd/discover-borrowers` and `cmd/wire-config` both read the pool addresses
from `contracts/evm/deployments/11155111.json` — merge the three new lending
keys in (jq is not installed here; use node):

```bash
cd contracts/evm
node -e '
  const fs = require("fs");
  const p = "deployments/11155111.json";
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.lendingPool = "________________";            // LendingPool
  j.lendingOracleConsumer = "________________";  // LendingOracleConsumer
  j.liquidationConsumer = "________________";    // LiquidationConsumer
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
'
cd ../..
go run ./cmd/wire-config --chain-id 11155111 --target staging
git diff --stat -- workflows/    # expect consumerAddress in lending-oracle, pool+consumer in liquidation-protection
```

Then repoint the `-safe` tier by hand (wire-config only touches
`config.<target>.json`). It keeps `borrowers: []` — a deliberate no-op until a
safe borrower exists:

```bash
node -e '
  const fs = require("fs");
  const p = "workflows/liquidation-protection/config.staging-safe.json";
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.lendingPoolAddress = "________________";   // LendingPool
  j.consumerAddress = "________________";      // LiquidationConsumer
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
'
```

## Step 5 — Simulate, then deploy + activate the two workflows

Proposed workflow operations (executed by you, not the agent):

- Action: simulate → deploy → activate; Network: testnet (Sepolia); Target: `staging-settings`
- `lending-oracle-staging` — secrets: `LENDING_ORACLE_API_TOKEN` (unchanged; CoinGecko ignores the bearer header); consumer: new LendingOracleConsumer
- `liquidation-protection-staging` — secrets: `LENDING_PRICE_API_TOKEN` (unchanged); consumer: new LiquidationConsumer
- Expected effect: both workflows replace the mCOL/mUSD monitoring of the same two names; org stays at 3 active workflows.

```bash
cre -e .env workflow simulate workflows/lending-oracle --target staging-settings --non-interactive --trigger-index 0
cre -e .env workflow simulate workflows/liquidation-protection --target staging-settings --non-interactive --trigger-index 0

cre -e .env workflow hash workflows/lending-oracle --target staging-settings
cre -e .env workflow hash workflows/liquidation-protection --target staging-settings

cre -e .env workflow deploy   workflows/lending-oracle --target staging-settings --yes
cre -e .env workflow activate workflows/lending-oracle --target staging-settings --yes
cre -e .env workflow deploy   workflows/liquidation-protection --target staging-settings --yes
cre -e .env workflow activate workflows/liquidation-protection --target staging-settings --yes
```

The hash output is the intended workflow ID — the deploy output must match it
(config bytes hash into the ID). Confirm both report `Active` via
`cre workflow list --target staging-settings`.

**Do not touch** `liquidation-protection-staging-safe`: it stays active with an
empty borrower list and no-ops each tick. Repointing its config (step 4) does
nothing until it is next redeployed — that's fine.

## Step 6 — Refresh borrowers onto the new pool

The stale borrower `0xe713…96BB` in `config.staging.json` deposited on the OLD
pool; on the new pool it reads as a zero position. Re-run discovery so the
deployed configs reflect reality (close-watch list will be empty until the
first real deposit — that's correct):

```bash
scripts/refresh-liquidation-borrowers.sh --rpc-url "$CRE_RPC_SEPOLIA" \
  --target staging --from-block <pool deployment block from Step 3>
```

The script redeploys + reactivates both liquidation tiers at the end (empty
lists, no-op) — their workflow IDs change again. If you'd rather skip this
redeploy cycle, clear the stale borrower by hand instead and run the refresh
after the first real `depositCollateral`.

## Step 7 — Record workflow IDs and commit

```bash
cre workflow list --target staging-settings
```

Update `WorkflowID.txt` (lending-oracle-staging, liquidation-protection-staging,
liquidation-protection-staging-safe rows + the redeploy note), then commit:
the archived mCOL records, `deployments/11155111.json`,
`deployments/lending-11155111.json`, `deployments/mock-susde-11155111.json`,
both staging configs (+`-safe`), the refresh-script patch, the
`DeployMockSUSDe` record write, the frontend `useLendingPosition` fix, and this
doc.

## Step 8 — Frontend (Vercel / .env.local)

Set the sUSDe market vars (from Step 3):

```
NEXT_PUBLIC_SUSDE_LENDING_POOL_ADDRESS=
NEXT_PUBLIC_SUSDE_LENDING_ORACLE_CONSUMER_ADDRESS=
NEXT_PUBLIC_SUSDE_LIQUIDATION_CONSUMER_ADDRESS=
NEXT_PUBLIC_SUSDE_COLLATERAL_TOKEN_ADDRESS=        # msUSDe
NEXT_PUBLIC_SUSDE_DEBT_TOKEN_ADDRESS=              # 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
NEXT_PUBLIC_SUSDE_MARKET_NAME="sUSDe / USDC"
```

And **clear** the six legacy `NEXT_PUBLIC_LENDING_*` vars: the old mCOL/mUSD
pool loses its price feed when the staging workflows move, and the frontend
would otherwise show it as a perpetually stale primary market. Redeploy; the
market picker should show exactly one healthy market.

## Step 9 — End-to-end verification (all must pass)

Give the workflow two 5-minute ticks after activation, then:

```bash
# Oracle price landed (~1.26e8 at priceDecimals 8 at lock time; ±10% plausible drift)
cast call <LENDING_ORACLE_CONSUMER> "latestRound(bytes32)(uint256,uint8,uint256)" \
  $(cast keccak $(cast --from-utf8 "sUSDe/USD")) --rpc-url "$CRE_RPC_SEPOLIA"

# Decimal conversion: 1 msUSDe ≈ 1.05 USDC in debt units (6 decimals) — fork-verified value
cast call <LENDING_POOL> "collateralValueInDebtUnits(uint256)(uint256)" \
  1000000000000000000 --rpc-url "$CRE_RPC_SEPOLIA"   # expect ≈ 1_050_000

# Liquidation verdicts advance for monitored borrowers
cast call <LIQUIDATION_CONSUMER> "checkedAt(address)(uint256)" <borrower> --rpc-url "$CRE_RPC_SEPOLIA"
```

- [ ] `cre execution list workflows/lending-oracle --target staging-settings` — recent runs SUCCESS, WriteReport tx succeeded.
- [ ] Full user path: mint msUSDe (unguarded `mint`) → `depositCollateral` → borrow USDC against it → position + health factor render in the `/lending` UI.
- [ ] After the first deposit, re-run Step 6 so the borrower enters the close-watch list.
