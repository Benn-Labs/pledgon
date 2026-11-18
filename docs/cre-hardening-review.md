# CRE oracle-workflow hardening review

Status of the three oracle-network areas, what this change set hardened, and
what is still open. Written 2026-11-18 alongside the marketplace/escrow
tweaks; test counts refer to that tree.

## 1. Oracle validation for bulk deliveries (IoT sensor provider)

**Implemented now — `escrow-confirmation` workflow:**

- Optional second confidential leg, `config.bulkDeliveryIoT`: maps an
  EscrowVault to the IoT provider's shipment id. A `DocsSubmitted` claim on a
  mapped vault is attested only when BOTH the primary verification source and
  the IoT provider's delivery telemetry agree (`confirmed = primary && iot`).
- Both fetches run inside the enclave before a single `UsingTheDons()`
  crossover; the provider credential, the raw telemetry and the primary
  source's response never leave it (a test pins the no-leak property).
- Fail-closed everywhere: a non-2xx/erroring IoT leg aborts the claim with no
  report; `delivered=false` suppresses the attestation; a half-configured IoT
  block (`providerUrl`/`iotSecretId`/`responseDeliveredPath`/`shipments`
  missing or malformed) fails workflow init, not mid-tick.
- Unmapped vaults keep the original single-source behavior — the leg is
  strictly opt-in per vault.
- 10 new Go tests (URL building, config validation, both-agree write,
  disagree suppress, unmapped skip, provider failure, telemetry leak).

**Still open:**

- **A real provider contract.** The leg is shaped for a REST "shipment
  delivery" endpoint (query params + boolean dot-path); no live IoT provider
  is integrated yet. When one is chosen, re-verify the response mapping and
  decide whether a numeric delivered-quantity comparison (against the
  purchase quantity in the vault) should replace/augment the boolean.
- **Shipment-id mapping is manual ops.** `shipments` is config, so a new bulk
  trade needs a config update + redeploy (same known limitation as
  `vaultAddresses`).
- **docHash is not bound to the shipment.** The IoT query carries the
  docHash for the provider to correlate, but nothing forces the seller's
  anchored docHash to reference the same consignment as the mapped shipment
  id — a seller could anchor a different shipment's docs. Provider-side
  correlation (shipment id embedded in the docHash preimage) is the fix.
- **Per-vault log triggers still don't scale automatically** — pre-existing
  known limitation, unchanged (see architecture.md).

## 2. Liquidation protection (lending/borrowing)

**Already in place before this review:** independent confidential price
corroboration, per-borrower verdicts, `checkedAt`-monotonic reports with
false verdicts written to clear stale trues, on-chain re-check at
`liquidate()` execution, `maxVerdictAge` verdict expiry, pool-side
`maxPriceAge`/`maxDeviationBps`/future-timestamp guards, risk-tiered
close-watch/safe cadence, external borrower discovery.

**Hardened now — `liquidation-protection` workflow:**

- **Cross-source deviation gate** (`maxSourceDeviationBps`, 0 = off): reads
  the pool's on-chain feed round once per tick
  (`collateralFeedId()` → `oracleConsumer()` → `latestRound(feedId)`) and
  attests NOTHING — not even eligible=false — when the independent price and
  the on-chain feed diverge beyond the bound. Rationale: at that magnitude
  the two are indistinguishable from "one of them is compromised", and a DON
  attestation under that uncertainty could green-light a wrongful
  liquidation. Unseeded feed (updatedAt 0) and decimals mismatch also fail
  closed. 9 new Go tests (bound math, within/beyond bound, unseeded, decimal
  mismatch, and the existing stub's fatal-on-unknown-call default proves the
  check reads nothing when disabled).
- Config docs updated; production/staging configs unchanged (default off).

**Still open:**

- **Consumer ↔ workflow binding.** Every consumer still deploys unbound
  (`expectedWorkflowId = 0`); the runbook's Phase 6 (`setExpectedWorkflowId`
  owner-setter) is the tracked fix.
- **No partial liquidation / liquidator incentive.** Full-liquidation-only,
  no bonus — right at the threshold a liquidator earns almost nothing, so
  unhealthy positions can sit unliquidated. A real money market wants a
  deliberate bonus and partial liquidation.
- **In-workflow borrower discovery** stays external by design (no persistent
  storage across ticks); the ops path is `cmd/discover-borrowers` +
  `scripts/refresh-liquidation-borrowers.sh`.
- **Quota.** Three lending workflows per market (oracle + liquidation ×2
  tiers) against the 3-active private-registry cap — the increase request in
  `docs/cre-quota-increase-request.md` (3 → 10) is the blocker for staging
  multi-market and production; portfolio-rebalancing adds one more per
  market to that math.

## 3. Portfolio rebalancing (lending/borrowing)

**Implemented now — new workflow + consumer:**

- `workflows/portfolio-rebalancing`: cron-triggered Confidential Workflow,
  same proven shape as liquidation-protection (independent in-enclave price,
  per-borrower `positions()`, one report per borrower, false verdicts
  written, one borrower failing doesn't abort the tick). Verdict band: debt >
  0, NOT undercollateralized, LTV > `rebalanceTargetBps` — the window where
  rebalancing prevents liquidation instead of reacting to it.
- `contracts/evm/src/lending/RebalancingConsumer.sol`: per-borrower verdict
  store mirroring LiquidationConsumer (forwarder + workflow binding,
  `checkedAt`-monotonic, future-timestamp guard, `maxVerdictAge` expiry,
  fail-closed reads). 14 Solidity tests.
- 13 Go tests including band-boundary cases (at-target = not advised,
  underwater = never advised — that's liquidation-protection's verdict).
- Deploy wiring: `Deploy.s.sol` deploys the consumer with lending and writes
  it to the deployment record; `cmd/wire-config` patches
  `lendingPoolAddress`/`consumerAddress` into the workflow configs;
  `cmd/discover-borrowers` now also patches this workflow's `borrowers` with
  the full discovered list; `scripts/refresh-liquidation-borrowers.sh`
  deploys/activates it alongside the liquidation tiers; production runbook
  worksheet updated.
- Config convention: a THIRD price provider for this workflow, keeping
  lending-oracle / liquidation-protection / portfolio-rebalancing genuinely
  independent readings.

**Still open:**

- **No executor consumes the verdict yet.** `isAdvised()` is substrate for a
  keeper/frontend that tops up collateral or repays debt — nothing on-chain
  acts on it automatically (deliberately: auto-moving user funds from a DON
  attestation needs a consent/envelope design, e.g. a borrower-funded
  reserve with allowance, before it is safe to build).
- **Borrower notification UX** (email/Telegram/webhook on advised=true) is
  the cheapest first consumer and isn't built.
- The deviation gate from §2 is NOT ported here (an erroneous advisory moves
  no funds, so the risk profile doesn't justify the extra reads); port it if
  an executor starts acting automatically on these verdicts.
- Workflow WASM `binary.wasm.br.b64` is produced by `cre workflow build`/
  `deploy` (the repo only force-tracks binaries for the two original lending
  workflows).

## Cross-cutting (still open, unchanged by this review)

- Consumer workflow-binding (Phase 6 of the runbook) — see §2.
- CRE org quota increase — see §2.
- `escrow-confirmation` per-vault trigger scaling; compliance-check KYC
  `caseId` frontend integration; HTTP-trigger `authorizedKeys` encoding
  confirmation — all documented known limitations in architecture.md.
