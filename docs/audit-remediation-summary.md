# PLEDGON Security Audit — Findings & Remediation Summary

**Handoff document for the developer agent.** Covers what the audit found, what was
fixed, how it was verified, and what remains.

- Audit date: 2026-09-26 (fixes); deployment to Sepolia: 2026-11-04
- Scope: all contracts in `contracts/evm/src`, all 5 CRE workflows in `workflows/`, deploy scripts/config, Next.js frontend in `frontend/`
- Verification baseline after fixes: `forge test` **254/254 pass** (7 suites, was 243 before fixes), `go test ./workflows/...` **5/5 packages pass**, `npx tsc --noEmit` **clean**, `next build` **passes** (13 routes — see font caveat in §6)

---

## 0. Deployment status (Sepolia, 2026-11-04)

The lending stack with all audit fixes is **live**:

| Component | Address | Notes |
|---|---|---|
| LendingPool | `0xD389c90a61F4de210D2632Df1545082D53d41ed9` | maxPriceAge 900s, threshold 8000, rate 500 |
| LendingOracleConsumer | `0xe94F2C9654c84091bbbF82c8Cac07e606215A84D` | **unbound** (workflowId 0), deviation cap 5000 |
| LiquidationConsumer | `0xa2695De5596537D12e256C033a94f0fE35196e24` | **unbound**, maxVerdictAge 900s |

DON workflows (all ACTIVE): `lending-oracle-staging`, `liquidation-protection-staging`,
`liquidation-protection-staging-safe` (hourly tier). Staging configs carry
`gasLimitWei: 3000000` — **required** (see §6). `trade-expiry-staging` NOT deployed:
org quota is 3 active workflows on don_family zone-a. `escrow-confirmation` /
`compliance-check` undeployed (need real `vaultAddresses` / webhook signer resp.).

**The MEDIUM-5 workflowId binding is deployed but set to 0 (unbound) — deferred.**
Reason: the CRE workflow ID is a function of the **exact config file bytes**
(verified: changing `consumerAddress` or even a trailing newline changes the ID),
and the consumer address is itself in the config → constructor-level binding is
circular (no fixed point). The Chainlink-standard fix is a post-deploy setter
(`setExpectedWorkflowId`, as in the official `ReceiverTemplate`): deploy consumers
unbound → deploy workflows → bind via setter. Implement later; consumers are no
worse than pre-audit until then (they trust the forwarder/DON).

---

## 1. Executive summary

The audit found **no critical fund-loss bugs**. Two high-severity issues in the
lending pipeline — both variants of "an attested value trusted beyond its
freshness window" — plus a trust-boundary gap in all five CRE consumer
contracts, and a set of frontend crash/UX bugs. All high and medium findings
are fixed; low-priority items are listed in §7 as deliberately deferred.

Theme of the fixes: **attestations are point-in-time — bind their validity at
use time** (verdict recency, price age, execution-time re-check), and
**authenticate the author, not just the messenger** (workflowId binding on
consumers).

---

## 2. HIGH-1 — `liquidate()` executed on a stale, permanent DON verdict

**Location:** `contracts/evm/src/lending/LendingPool.sol` (`liquidate()`),
`contracts/evm/src/lending/LiquidationConsumer.sol`

**Finding:** `liquidate()` gated solely on `LiquidationConsumer.isEligible()`,
which returned a stored bool with **no recency bound** and no on-chain
re-check. A borrower who topped up collateral after a `eligible=true` verdict
could still be liquidated until the next workflow tick overwrote it (5 min
close-watch, 1 h safe tier) — at 80% LTV that's an instant ~25% profit for the
liquidator taken from a solvent borrower. A halted workflow made `true` valid
forever. The pool's own `isUndercollateralized()` view was never consulted in
the liquidation path.

**Fix implemented:**
- `liquidate()` now re-checks `_isUndercollateralizedAmounts(collateral, debt)`
  at execution time, after the verdict check. Both conditions are required.
- `LiquidationConsumer` gained `maxVerdictAge` (immutable, constructor param;
  `0` = no expiry). `isEligible()` returns false once `block.timestamp -
  checkedAt > maxVerdictAge` — fail closed.
- New regression tests: `test_Liquidate_RevertsWhenHealthyDespiteFreshVerdict`
  (the HIGH-1 pin), `test_Liquidate_RevertsWhenVerdictExpired`,
  `test_Liquidate_SucceedsWithVerdictInsideMaxAge`. Three pre-existing success
  tests updated to crash the price first (corrected semantics — verdict alone
  is no longer sufficient).

---

## 3. HIGH-2 — price path had no freshness bound; one future report bricked the feed

**Location:** `contracts/evm/src/lending/LendingPool.sol`,
`contracts/evm/src/lending/LendingOracleConsumer.sol`,
`contracts/evm/src/lending/LiquidationConsumer.sol`

**Findings:**
- `collateralValueInDebtUnits()` only rejected `updatedAt == 0` — a frozen
  price was used by borrow/withdraw **indefinitely**.
- Neither lending consumer rejected **future timestamps** (unlike
  `ComplianceConsumer`, which had the guard + regression test). One buggy
  report with `updatedAt = now + N` made every subsequent genuine report
  revert `StaleReport` for N seconds — and in `LiquidationConsumer`, pinned a
  borrower at `eligible=true` while corrective reports reverted (directly
  widening HIGH-1).
- No deviation bound existed despite `docs/architecture.md` describing one as
  part of the lending oracle's design (doc-vs-code gap).

**Fix implemented:**
- `LendingPool.maxPriceAge` (immutable; `0` = off): reverts `StalePrice` at
  the single valuation read site once the last report is older than the bound.
  Covers `borrow()`, `withdrawCollateral()`, `liquidate()` (fail closed).
- `LendingOracleConsumer.onReport` reverts `FutureUpdatedAt` when
  `updatedAt > block.timestamp` (mirrors `ComplianceConsumer.FutureVerifiedAt`).
- `LiquidationConsumer.onReport` reverts `FutureCheckedAt` likewise.
- `LendingOracleConsumer.maxDeviationBps` (immutable; `0` = off) rejects
  single-tick moves where `|value - stored| * 10_000 > stored * cap`, both
  directions. Deliberately a **garbage-input sanity bound, not a crash
  circuit-breaker** — a hard cap would keep rejecting through a sustained
  real crash and freeze the feed at the pre-crash price; freshness is handled
  by `maxPriceAge` instead.
- New tests: `test_OracleConsumer_RevertsOnFutureUpdatedAt`,
  `test_LiquidationConsumer_RevertsOnFutureCheckedAt`,
  `test_OracleConsumer_RejectsMoveExceedingDeviationCap` (incl. exactly-at-cap
  boundary accepted, re-measurement against new stored value),
  `test_Pool_RevertsOnStalePrice`.

---

## 4. MEDIUM-5 — consumers authenticated the forwarder, not the workflow

**Location:** all five consumers (`EscrowConfirmationConsumer`,
`ComplianceConsumer`, `TradeExpiryKeeper`, `LendingOracleConsumer`,
`LiquidationConsumer`)

**Finding:** every consumer gated only on `msg.sender == forwarder` and
ignored the `metadata` argument. Since one chain uses one shared
`KeystoneForwarder`, the real boundary was "any workflow registered on this
DON can get a report delivered to any of these consumers if the payload
ABI-decodes." Cross-shape collisions among the platform's own report layouts
were checked: most revert, but an escrow confirmation report decodes cleanly
as a liquidation verdict (`eligible=true`) for milestone index 0/1. Practical
exploitability today is low (platform controls all workflows; private
deployment registry) but the boundary was weaker than documented.

**Fix implemented:**
- New shared base `contracts/evm/src/keystone/WorkflowBoundReceiver.sol`:
  forwarder auth + optional `expectedWorkflowId` binding validated against the
  metadata workflowId. Metadata layout verified against Chainlink's official
  docs: production delivery is a 64-byte slice —
  `abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner)`
  + 2 bytes reportId; only the leading workflowId is checked; lengths < 62
  revert `InvalidMetadataLength` (fail closed).
- `expectedWorkflowId == bytes32(0)` = **unbound** (any workflow). This is
  required for `cre workflow simulate` — the `MockKeystoneForwarder` supplies
  no metadata — and is the only intended unbound configuration.
- All 5 consumers migrated (duplicated forwarder/onlyForwarder/
  supportsInterface removed). New constructor arg (trailing `bytes32`).
- Deploy scripts take per-consumer env vars, all defaulting to unbound with a
  logged warning: `ESCROW_CONFIRMATION_WORKFLOW_ID`, `COMPLIANCE_WORKFLOW_ID`,
  `TRADE_EXPIRY_WORKFLOW_ID`, `LENDING_ORACLE_WORKFLOW_ID`,
  `LIQUIDATION_WORKFLOW_ID`.
- New binding tests in `ComplianceConsumer.t.sol`: accepts 62-byte and
  64-byte metadata from the bound workflow, reverts `UnexpectedWorkflowId` on
  mismatch, reverts `InvalidMetadataLength` on empty/short metadata.

**Gotcha discovered (do not re-introduce):** solc does not reliably resolve
*inherited* custom errors via derived contract names (`Derived.Error.selector`)
— access them via the declaring base (`WorkflowBoundReceiver.ZeroAddress.selector`)
in tests. Also: name collisions between locals and public functions broke this
lookup — locals in `onReport` are suffixed (`verifiedAt_`, `checkedAt_`).

---

## 5. Frontend fixes (22 files)

**HIGH**
- **Render-time crash on non-numeric input** — `parseUnits`/`parseEther`
  during render crashed the whole tree. Fixed via a safe-parse helper
  (`frontend/src/lib/units.ts`) used for all input-derived computations in
  `lending/page.tsx`, `admin/page.tsx`, `escrow/create/page.tsx`, plus submit
  guards.
- **`useListingTitleByVault` permanently broken** — destructured `listings()`
  as a 7-tuple; the getter returns 5 fields and has no vault field at all.
  Rewritten to enumerate `listingVaultCount(listingId)` /
  `listingVaults(listingId, i)`; SOLD gate removed (partially-purchased
  listings stay Active). Marketplace trades now show titles.
- **No data freshness anywhere** — no polling/invalidation; counterparty
  actions invisible until remount. `refetchInterval: 15_000` +
  `staleTime: 5_000` added to `useEscrowAttention`, `useLendingPosition`,
  `useMyVaults`; loading tiles now render skeletons instead of false zeros
  (`app/page.tsx` dashboard + recent activity).

**MEDIUM**
- Lending banner no longer claims a live feed when none exists (gated on
  `hasPrice`); `useLendingPosition` exposes `priceUpdatedAt`.
- `toastTxError` helper in `lib/toast.ts`: wallet rejection → neutral
  "Cancelled"; reverts shortened from raw JSON dumps (capped ~120 chars). All
  15 raw `toast(error.message)` call sites converted.
- Silent approve failures surfaced in `BondPanel`/`FundPanel`
  (`approveError` destructured + toasted).
- Dead-end pages: `escrow/[address]` validates address + isVault with a proper
  "not found" state; `marketplace/[id]` validates the id (no `BigInt(abc)`
  crash) and distinguishes Cancelled vs Sold copy.
- `EditListingMetadata` no longer seeds from a not-yet-loaded prop (blank
  overwrites).
- `MilestoneRow` rolls back the Supabase upload on signature rejection / tx
  revert (was leaving orphaned invisible rows).
- `useMyVaults` gated on wallet connection (logged-out visitors no longer fire
  hundreds of multicalls).
- Missing success toasts added (`ArbiterPanel`, `ExitTradePanel`).

**LOW (fixed as drive-bys)** — `badges.tsx` bounds guards,
`useRecentTrades.ts` 4-tuple type fix (drift hazard).

---

## 6. Handoff notes for the developer agent

**Redeploy required.** All contract fixes are new constructor params/immutables
— they take effect only via new deployments. Existing vaults/pools are
unaffected and keep working.

**New env vars for deploy scripts** (`Deploy.s.sol`, `DeployLending.s.sol`):
- `MAX_PRICE_AGE` (default 900s), `MAX_VERDICT_AGE` (default 900s),
  `MAX_PRICE_DEVIATION_BPS` (default 5000)
- `*_WORKFLOW_ID` per consumer (default `bytes32(0)` = unbound + warning log).
  **Before production: bind these.** Workflow IDs are known after
  `cre workflow deploy`; redeploy the consumer with the ID and update the
  workflow config's receiver address if it changed. Unbound consumers accept
  any DON-signed workflow.

**Font build caveat (environmental, not a code issue).** `npm run build`
fails on machines that cannot reach `fonts.googleapis.com`
(`next/font/google` fetches at build time; ENOTFOUND here). Verification was
done with a temporary stub of the three fonts in `src/app/layout.tsx`, reverted
after the build. On any networked machine `npm run build` passes as-is. If
offline builds ever become a requirement, switch to `next/font/local` with
checked-in font files.

**Metadata reference:** consumer metadata layout was verified at audit time
against Chainlink's "Building Consumer Contracts" docs (production forwarder =
64-byte slice; layout quoted in `WorkflowBoundReceiver.sol` natspec). If CRE
changes this layout, the `_checkWorkflow` length assumptions are the place to
look.

**Docs synced:** `docs/architecture.md` lending section now describes the
both-directions liquidation checks, `maxPriceAge`/`maxDeviationBps`, and the
future-timestamp guards (previously described as aspirational).

**Full audit report** (pre-fix findings incl. verified-safe inventory):
`C:\Users\pc\PLEDGON-Security-Audit.md`.

---

## 7. Deliberately deferred (low priority — not yet done)

1. **`vaultsByBuyer` stuffing** — `createTradeFor` is permissionless; anyone
   can push entries into a buyer's array (~20k gas, attacker-paid). No on-chain
   iteration exists; off-chain enumeration annoyance only. Fix if it becomes an
   observed problem: per-buyer vault creation notes or off-chain filtering.
2. **Rolling volume over-counts refunds** — `EscrowFactory.recordVolume` only
   adds; refunded-then-refunded volume counts twice against a buyer's tier cap.
   Conservative direction (no KYC evasion), but can lock out legitimate buyers
   with recycled capital. Fix: subtract on terminal refund paths, or document
   as intended.
3. **Owner fee-change front-run grief** — `setVaultCreationFee` mid-flight
   reverts in-flight `createTrade` txs via exact-equality `msg.value` check.
   Gas grief only; no funds at risk.
4. **EscrowConfirmationConsumer observability** — `confirmed=false` reports
   are silently dropped (by design, "no new information"), making a failed
   verification indistinguishable from "workflow never ran" in logs.
5. **Frontend a11y/copy polish** — label `htmlFor` associations, toast
   `aria-live`, TransactionReviewModal focus trap, swap-widget load retry,
   seller thumbnail URL scheme allowlist, formatting consistency
   (`formatToken` `maxDecimals`).
6. **Milestone-document rollback is incomplete** — `MilestoneRow.tsx` declares
   `uploadedDocToRollBack`/`isReceiptError` (lint-flagged as unused) but the
   cleanup effect was never wired, and there is no delete counterpart to the
   `write-milestone-document` edge function. Finish properly: add a signed
   `delete-milestone-document` function (lookup `storage_path` from
   `escrow_milestone_documents`, delete the Storage object + row), return
   `storagePath` from the upload hook, and roll back on signature rejection /
   revert.
7. **Duplicate vault-lifecycle flattening** in `useRecentTrades` /
   `useEscrowAttention` / `escrow/page.tsx` — extract one `useVaultLifecycle`
   hook when next touching all three.

None of these have user fund-loss paths; items 1–3 are documented in the
contracts' natspec where relevant.
