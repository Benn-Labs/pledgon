# PLEDGON Architecture

PLEDGON is a Garantor successor built on Chainlink CRE: marketplace, milestone
escrow, a confidential compliance layer, and lending/borrowing.

Garantor (predecessor, `../garantor-project`) proved the domain model on TON/Tact:
listings, a performance bond, seller-submits-docs → buyer-confirms → release,
with dispute as an escape hatch (see `../garantor-project/MILESTONE_ACTIONS_FLOW.md`).
PLEDGON keeps that domain model but rebuilds it on EVM + CRE, replacing TON-specific
transaction plumbing with Solidity contracts and DON-verified confidential workflows.

## Feature → CRE mapping

| PLEDGON feature | Maps to | Status |
|---|---|---|
| Marketplace (listings, transfers) | Plain Solidity — CRE doesn't do much here | **Built**: `Marketplace` (Solidity, 16 tests) |
| Escrow + DON confirmation | Confidential workflow verifies an off-chain condition (title recorded, payment cleared) → signed report → escrow contract checks it before releasing funds | **Built**: `EscrowVault`/`EscrowFactory`/`EscrowConfirmationConsumer` (Solidity, 66 tests) + `escrow-confirmation` workflow (Go, 18 tests) |
| Milestone escrows | Same pattern, repeated per milestone. Triggered by an EVM log trigger (fires when a milestone is claimed via `submitMilestoneDocs`) rather than cron polling | Built as part of the row above — `DocsSubmitted` is the claim event |
| Compliance layer (confidentiality) | KYC/AML/sanctions API called inside the enclave — PII and the provider's credentials never leave it, only a tier (0/1/2) crosses out | **Built**: `compliance-check` workflow (Go, 16 tests), writes to `ComplianceConsumer` (Solidity, 16 tests) — rolling-volume + tiering + expiry, see "Compliance hardening" below |
| Lending/borrowing | Its own large protocol: collateral valuation (the RWA oracle feeds this directly), liquidation logic | **Built (minimal substrate)**: `LendingPool`/`LendingOracleConsumer`/`LiquidationConsumer` (Solidity, 20 tests) + `liquidation-protection` workflow (Go, 16 tests). Deliberately not a production money market — see below |

## Prior art (source material, not yet ported)

- `C:\dev\cre-cli\benn-cre` — working CRE CLI project. `contracts/evm/src/RwaOracleConsumer.sol`
  and `hello-confidential/workflow.go` are the reference "verify → DON-signed report →
  consumer contract" shape this repo's `go.mod` and `project.yaml` are copied from.
- `C:\dev\cre-cli\cre-Benn Labs\Templates\confidential-workflows\ai-audit-firewall` —
  `AuditFirewallConsumer.sol` / `ReceiverTemplate.sol`, the second working instance of
  the same verify → signed verdict → consumer pattern.
- `C:\dev\cre-cli\cre-Benn Labs\Templates\confidential-workflows\automated-liquidation-protection` —
  Go and TS variants; starting point for the lending/liquidation workflow.
- `C:\dev\garantor-project` — TON/Tact predecessor. `contracts/escrow_factory.tact` and
  `escrow_vault.tact` are the domain reference (not portable code) for milestone/bond/dispute
  semantics. `MILESTONE_ACTIONS_FLOW.md` documents the action set: depositBond, submitDocs
  (with a doc hash), confirm, dispute.

## Repo layout

```
deeds/
  project.yaml, go.mod, secrets.yaml   CRE project settings (mirrors benn-cre)
  contracts/evm/src/
    keystone/        IReceiver / IERC165 — copied from benn-cre, needed by every consumer
    marketplace/      Marketplace.sol — listings, purchase() opens an escrow trade
    escrow/            milestone escrow, DON-verified release
    compliance/        receives compliant:true/false reports
    lending/           collateral, borrowing, liquidation
  workflows/
    escrow-confirmation/     confidential workflow: verify milestone condition off-chain
    compliance-check/         confidential workflow: KYC/AML/sanctions in-enclave
    liquidation-protection/   confidential workflow: independent price corroboration for liquidation
```

## Decisions

- **Escrow shape: `EscrowFactory` + per-trade vault.** Matches Garantor
  (`escrow_factory.tact` + `escrow_vault.tact`) and keeps each trade's state and
  balance isolated — lower complexity than a single contract with a milestone array
  across all trades.
- **Compliance gates by rolling volume and tier, not a single per-trade check.**
  See "Compliance hardening" below — the original $999 flat threshold was
  reviewed and replaced.
- **Lending gets its own RWA oracle DON, separate from escrow's.** Reusing the
  escrow `RwaOracleConsumer` deployment was considered and rejected: its producing
  workflow (`benn-cre/hello-confidential/workflow.go`) is cron-triggered, has no
  staleness enforcement on read (only rejects out-of-order writes) and no
  deviation/circuit-breaker — acceptable for a one-off trade valuation, not for the
  number that drives liquidations. A dedicated lending oracle can be tuned
  independently: its own cadence matched to collateral volatility, a staleness
  check at every read site, and a deviation cap in the write path — without those
  constraints leaking into or being loosened by escrow's needs. Same
  `RwaOracleConsumer` *contract shape* (feedId-keyed round store) is still the
  right pattern to copy; it's the deployment and producing workflow that stay
  separate.

## Known limitation: per-vault log triggers don't scale automatically

The pinned SDK's EVM log trigger (`evm.LogTrigger`, in `capabilities/blockchain/evm`
— there is no separate `triggers/evmlogtrigger` package at this SDK version,
despite some generic docs suggesting one) takes a list of contract addresses to
watch (`FilterLogTriggerRequest.Addresses [][]byte`), not a wildcard. Since
`EscrowFactory` deploys a new vault per trade, the `escrow-confirmation` workflow's
`vaultAddresses` config has to be updated — a config update and workflow
redeploy, not a code change — every time a new trade is created. This is a real
operational cost worth automating later (e.g. a small service that watches
`EscrowFactory`'s `VaultCreated` event and pushes config updates), not something
to solve by re-architecting the trigger right now.

## Known limitation: HTTP trigger delivery is not confidential

Confirmed against the confidentiality-boundary docs before building
`compliance-check`: trigger delivery — cron, EVM log, or HTTP/webhook alike —
always runs on Workflow DON nodes, never inside the enclave. Only the code
*after* the `HandlerInTee` callback starts is confidential. A webhook carrying
raw PII (name, date of birth, ID number) in its request body would leak that PII
to node operators at delivery time, before the enclave ever runs — defeating the
entire point of using a Confidential Workflow for KYC.

`compliance-check`'s webhook payload is therefore just `{subject, caseId}` — no
PII. `caseId` is an opaque reference issued by the KYC provider when the subject
completed verification directly with that provider, out of band. The enclave uses
it to fetch the provider's verdict (the provider looks up the PII server-side);
only the resulting tier (see "Compliance hardening" below) ever crosses
`UsingTheDons()`. This means PLEDGON's frontend needs a direct integration with the
KYC provider to obtain `caseId` before calling this workflow — not yet built,
and out of scope for the workflow itself.

Also unresolved: the webhook's `authorizedKeys` field takes a raw ECDSA public
key per the SDK's proto definition, but some docs describe it as an address.
Config ships with `authorizedKeys: []` for staging (simulation only — accepts any
caller) and an obviously-fake placeholder for production (fails closed — accepts
no caller — until replaced with a real key). Confirm the exact key encoding CRE
expects against `cre workflow simulate` output before deploying with a real
signer.

## Compliance hardening: rolling volume, tiers, expiry

The original design — a flat $999 per-trade threshold, `compliant: true/false`
that never expired — was reviewed and found to have one real gap and two
lower-urgency ones:

1. **Stateless per trade.** A buyer could structure a $5,000 purchase as six
   $900 trades and never trigger KYC — classic structuring, the first thing an
   actual AML review would flag.
2. **No expiry.** `compliant: true` was permanent once set — a buyer who
   passed a one-time small-trade check stayed "compliant" forever, including
   for arbitrarily large future trades, even after e.g. landing on a sanctions
   list later.
3. **Binary, not tiered.** No distinction between a lightly-verified buyer and
   an enhanced-KYC/KYB one — real compliance regimes usually grade this.

All three are now addressed together, since the fix for (1) turned out to
subsume (3) naturally:

- **`ComplianceConsumer` reports a tier (0/1/2), not a bool.** 0 = unverified,
  1 = basic KYC, 2 = enhanced KYC/KYB. `tierOf(subject)` is the only way callers
  read it — never the raw stored struct — so expiry enforcement can't be
  bypassed by reading the wrong field. `verifiedAt` older than `maxValidity`
  (a constructor param, default 180 days) makes `tierOf` read back 0 regardless
  of what tier was actually stored, addressing (2). A tier-0 report is a real,
  intentional verdict (e.g. an explicit revocation) and is written and read
  like any other — not treated as "no change."
- **`EscrowFactory` tracks rolling per-buyer volume**, addressing (1). Every
  `EscrowVault.fund()` calls back into `EscrowFactory.recordVolume(buyer,
  amount)` before deciding whether the trade needs compliance — so the check
  is against the buyer's *cumulative* volume for the period, not just this
  trade's amount. Each tier has its own volume cap (`tier0CapUsd`/
  `tier1CapUsd`, constructor params on `EscrowFactory`; tier 2 is uncapped) —
  which is what actually resolves (3): a trade that pushes a buyer's rolling
  total past their tier's cap is what requires the next tier up, not a single
  static number.
- **Volume resets in fixed 30-day calendar buckets** (`EscrowFactory
  .VOLUME_WINDOW`), not a continuously-rolling window — an intentional
  cost/precision tradeoff. A true rolling window needs a timestamped ring
  buffer summed at read time; real gas cost for a real edge case (a buyer can
  still move up to ~2x a tier's cap by timing trades across a bucket
  boundary). Worth revisiting if that boundary-timing gap is ever an actual
  observed problem rather than a theoretical one.
- **`EscrowVault` calls back into its deploying `EscrowFactory`** via a
  minimal `IEscrowFactory` interface (one function: `recordVolume`) rather
  than importing the full factory contract — avoids an import cycle (the
  factory already imports `EscrowVault` to `new` it) and keeps the coupling to
  exactly the one call the vault actually needs. The vault never receives the
  factory's address as a constructor argument either: it captures `msg.sender`
  at construction, which is always the factory, since the factory is the only
  thing that ever deploys an `EscrowVault`.

**A real bug the new `ComplianceConsumer.t.sol` test suite caught before it
shipped**: `tierOf` computes `block.timestamp - verifiedAt`. A `verifiedAt` in
the future — from a malicious or simply buggy DON report — would underflow
that subtraction and revert *every subsequent `tierOf` read for that subject*
until real time caught up, effectively bricking their compliance status. Fixed
by rejecting any report whose `verifiedAt` exceeds `block.timestamp` at
`onReport` time (`ComplianceConsumer.FutureVerifiedAt`). The test that
surfaced this (`test_OnReport_NewerReportOverwritesTier`, originally written
with unrealistic literal timestamps that were "in the future" relative to
Foundry's default test-chain clock) is kept, fixed, alongside a dedicated
regression test for the guard itself.

Still open, deliberately not solved here: `maxValidity` and the tier caps are
set once at deploy time (constructor params, not owner-adjustable) — changing
them means a new `EscrowFactory`/`ComplianceConsumer` deployment. Given
neither contract has any other admin/owner concept, adding one just for this
felt like solving a problem PLEDGON doesn't have yet.

## Deployment

`contracts/evm/script/Deploy.s.sol` (Foundry script) deploys the system
contracts — see the [README](../README.md#deploying-the-contracts) for the
command. Escrow/compliance/marketplace always deploy; lending deploys only if
both token addresses are configured, since that pairing isn't decided yet for
any real network. One run targets one chain (one `FORWARDER_ADDRESS`, since a
chain's `KeystoneForwarder` is shared by every consumer on it). Every address
is written to `deployments/<chainId>.json`, which needs `fs_permissions` in
`foundry.toml` (write access is denied by default).

`cmd/wire-config` (`go run ./cmd/wire-config --chain-id <id> --target staging`)
then copies the relevant addresses from that record into each workflow's
`config.<target>.json` — `confirmationConsumerAddress`,
`consumerAddress` (compliance-check and liquidation-protection each have their
own), `lendingPoolAddress`. It's a narrow, explicit field-by-field mapping
(`wirings` in `cmd/wire-config/main.go`), not a generic JSON merge: it edits
the raw file bytes with a targeted regex substitution rather than
unmarshal/remarshal, specifically so it doesn't reorder keys or reformat
anything else in the file — a real deployment's diff should be exactly the
address lines that changed, nothing more. Fields a deployment record can't
supply (`vaultAddresses`, `borrower` — per-trade and per-position values, not
system addresses) are left untouched by construction: they're simply not in
the `wirings` table. A deployment field that's still the zero address
(lending, when it wasn't deployed) is skipped with a logged reason rather than
overwriting the config's existing placeholder.

## Marketplace ↔ escrow integration

`Marketplace.purchase()` needs to open an escrow trade where the real buyer is
whoever called `purchase()`, not the `Marketplace` contract itself. `EscrowFactory
.createTrade()` hard-codes `buyer = msg.sender`, which would have made
`Marketplace` the buyer on every trade it orchestrates — breaking `fund()`'s
`onlyBuyer` gate for the actual purchaser. Resolved by adding
`createTradeFor(address buyer, ...)` alongside the original `createTrade()`
(now both call a shared private `_createTrade`), rather than changing
`createTrade`'s own semantics or bypassing the buyer gate. `createTradeFor` is
left permissionless: `fund()` on the resulting vault still requires the named
buyer's own token approval, so naming an arbitrary buyer can't move anyone's
funds without their consent — it only decides who the vault will later require
to fund and confirm it. `EscrowFactory` and its existing 50 tests already had to
be touched for this (now 69 across the three Solidity test files); flagging it
here since it's a change to previously-shipped, tested code rather than
purely-additive work.

Listings are one-shot (unique items/services, matching the RWA/"deed" theme):
once `purchase()`d, a listing can't be bought again. `purchase()` does not move
funds — it only creates the vault; the buyer still calls `fund()` and the seller
`depositBond()` afterward, same as calling `EscrowFactory` directly.

## Lending: DON-verified liquidation trigger, not a CEX-funded protection bot

The actual `automated-liquidation-protection` CRE template is a proactive bot:
it monitors a position on an *existing* lending platform and, before liquidation,
uses exchange-account credentials (in-enclave) to pull funds and add collateral
or repay debt. That doesn't fit PLEDGON, which has no lending contracts yet and no
external-exchange custody story. Chose instead to mirror the pattern already
proven twice (escrow-confirmation, compliance-check): a workflow verifies
something independently, attests it with a DON-signed report, and a consumer
contract acts on the verdict.

**Why a DON verdict is needed at all** — a fair question, since Aave/Compound-style
protocols compute liquidation eligibility entirely on-chain from their own oracle,
no off-chain attestation involved. `LendingPool.isUndercollateralized()` does
exactly that here too, and it's real, callable, on-chain. But `liquidate()`
deliberately does *not* trust that view alone — it additionally requires
`LiquidationConsumer.isEligible()`, a verdict the workflow only attests after
fetching an **independent** price from a separate (paid/authenticated) source
inside the enclave and finding *that* the position is underwater too. This is
the actual value the confidential workflow adds: protection against a single
manipulated or stale primary oracle triggering a wrongful liquidation — a real,
well-known DeFi attack class. `test_Liquidate_RevertsIfNotAttestedEligible` in
`LendingPool.t.sol` pins down exactly this: it crashes the on-chain price so the
pool's own view says "liquidatable," and confirms `liquidate()` still refuses
without the DON's independent corroboration.

**Minimal pool, not a money market.** `LendingPool` is one fixed
collateral/debt token pair, no interest accrual, no lender shares or utilization
curve, debt liquidity assumed pre-funded. It exists to make the liquidation
mechanism real and testable, not to be a production lending product — building
that is explicitly flagged in the mapping table above as its own large protocol.
`collateralValueInDebtUnits` also assumes `collateralToken` and `debtToken` share
the same `decimals()`; a market pairing tokens of different decimals needs that
conversion added.

**Liquidator incentive**: full liquidation only — repay 100% of the debt, receive
100% of the collateral. No partial liquidation, no separately-configured bonus
percentage; the liquidator's profit is whatever gap exists between collateral
value and debt value at the liquidation threshold. Simple, but means a position
right at the threshold offers a liquidator very little incentive to act quickly
— a real money market would want a more deliberate bonus mechanism.

**One workflow deployment per borrower** (like the RWA oracle watching one feed),
not a list — same shape as `escrow-confirmation`'s original per-vault
constraint, chosen for the same reason: no proven example of one cron invocation
safely generating multiple reports in a single execution to build on, so scope
to what's verified. Multi-borrower monitoring means either multiple deployments
or a later, carefully-tested extension.

**Confidential-workflow call ordering** — discovered while writing this
workflow, worth keeping in mind for the next one: every proven example in this
codebase calls `runtime.UsingTheDons()` exactly once, at the end, after all
confidential work (`GetSecret`, `SendRequestInTee`) is done, and uses the
resulting `cre.Runtime` for every chain read/write that follows. `onCronTrigger`
here does the same — fetches the independent price first, crosses
once, then does both on-chain `positions()`/`liquidationThresholdBps()` reads and
the final report write through that one `donRuntime`. Nothing confirms whether
calling `UsingTheDons()` earlier (e.g. to read on-chain state before the
confidential leg) is safe, so this stuck to the verified ordering rather than
assume it.
