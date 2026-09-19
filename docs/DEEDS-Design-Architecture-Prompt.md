# DEEDS Platform — Design & Architecture Reference

> Originally written as an aspirational design brief before the contracts and
> workflows existed. Amended to match what DEEDS actually is on **Ethereum +
> Chainlink CRE**: real contract names, real Go workflows, and real scope
> boundaries — see [docs/architecture.md](architecture.md) for the
> authoritative build log and design-decision history. Anything below that
> contradicted the built system has been corrected or marked as future
> roadmap, not current scope.

---

## CONTEXT

DEEDS is a milestone-based escrow marketplace with compliance verification
and collateralized lending, built on **Ethereum (EVM)** using **Chainlink
CRE (Chainlink Runtime Environment)** for confidential off-chain
computation. It is the successor to **Garantor**, a prior version built on
TON/Tact (`../garantor-project`). DEEDS keeps Garantor's domain model
(listings, performance bond, milestone docs → confirm → release, dispute as
an escape hatch) and rebuilds it on Solidity + DON-verified confidential
workflows.

---

## WHAT CRE ACTUALLY ENABLES HERE

CRE workflows run on Workflow DON nodes; the code *after* the confidential
callback (`HandlerInTee` / the enclave-entry point) runs inside a **TEE**.
Trigger delivery itself (cron, EVM log, HTTP) is **not** confidential — only
the enclave-side logic and the DON-signed report it produces are. This
matters for what's actually implemented:

1. **Escrow verification** (`escrow-confirmation` workflow) — an EVM log
   trigger fires on `DocsSubmitted` (a seller submitting milestone docs). The
   workflow verifies the off-chain condition inside the enclave, then a
   DON-signed report crosses out via `runtime.UsingTheDons()` to
   `EscrowConfirmationConsumer.onReport()`. `EscrowVault.releaseMilestoneViaDon()`
   is permissionless — anyone can trigger release once
   `confirmationConsumer.isConfirmed()` is true, so a keeper or the seller
   can move things along without waiting on the buyer.

2. **Compliance / KYC** (`compliance-check` workflow) — an **HTTP webhook**
   trigger. Because trigger delivery isn't confidential, the webhook payload
   is deliberately just `{subject, caseId}` — no PII. `caseId` is an opaque
   reference from a KYC provider the subject verified with *directly, out of
   band*; the enclave uses it to fetch the provider's verdict server-side.
   Only a **tier (0/1/2)** with a `verifiedAt` timestamp crosses out to
   `ComplianceConsumer`. Tier 0 = unverified, 1 = basic KYC, 2 = enhanced
   KYC/KYB; a verdict older than `maxValidity` (default 180 days) silently
   reads back as tier 0. `EscrowFactory` tracks each buyer's **rolling
   30-day-bucket trading volume** and gates against tier-specific caps
   (`tier0CapUsd`/`tier1CapUsd`) — not a flat per-trade threshold — so a
   buyer can't dodge KYC by splitting one large purchase into several small
   trades.

3. **Liquidation protection** (`liquidation-protection` workflow) — a cron
   trigger fetches an **independent, second price source** inside the
   enclave and reads `LendingPool`'s on-chain state. `LendingPool.liquidate()`
   requires this DON-attested corroboration *in addition to* its own
   on-chain oracle view — protection against a single manipulated or stale
   primary feed triggering a wrongful liquidation, not a replacement for the
   pool's own oracle.

The UI should communicate this trust layer without requiring users to
understand TEEs: "verified independently, not just trusted" — but every
concrete claim it makes (a confirmation, a tier, a liquidation-eligibility
check) must trace to one of these three real workflows.

---

## ARCHITECTURE

### Smart Contracts (Solidity, Foundry) — as built

Real paths under `contracts/evm/src/`:

- **`marketplace/Marketplace.sol`** — plain Solidity, no CRE involvement.
  Listings are one-shot (unique items/services). `createListing()`,
  `purchase()` (closes the listing and opens an escrow trade via
  `EscrowFactory.createTradeFor()`, naming the real caller as buyer),
  `cancelListing()`.
- **`escrow/EscrowFactory.sol`** — deploys one full `EscrowVault` per trade
  (**not** a minimal-proxy/clone pattern — considered and rejected; each
  vault's isolated state/balance was judged worth the extra deployment gas,
  matching Garantor's factory+vault split). Also the shared home for
  per-buyer rolling volume (`recordVolume`, `currentPeriodVolume`) and the
  tier caps compliance gating reads from. `createTrade()` (caller is buyer)
  and `createTradeFor(buyer, ...)` (for an orchestrator like `Marketplace`)
  both funnel through a private `_createTrade`.
- **`escrow/EscrowVault.sol`** — one per trade. Holds the seller's
  performance bond and per-milestone payments. Milestones release
  individually (`confirmMilestone()` by the buyer, or permissionlessly via
  `releaseMilestoneViaDon()` once the DON confirms) — this is phased/
  milestone escrow, not a single lump-sum release. `fund()` gates on the
  buyer's compliance tier vs. their rolling volume. The constructor rejects
  an arbiter who is also the buyer or seller (`ArbiterConflict`) — an
  arbiter can't neutrally resolve a dispute they're a party to.
- **`compliance/ComplianceConsumer.sol`** — receives DON-signed tier
  verdicts (`onReport`, forwarder-only), exposes `tierOf(subject)` as the
  only read path so expiry can't be bypassed by reading a raw stored field.
- **`escrow/EscrowConfirmationConsumer.sol`** — receives DON-signed
  milestone-confirmation verdicts, shared by every vault (one
  `KeystoneForwarder` trust relationship configured once, not per-trade).
- **`lending/LendingPool.sol` + `LendingOracleConsumer.sol` +
  `LiquidationConsumer.sol`** — a deliberately **minimal single-market
  pool** (no interest accrual, no lender shares, no utilization curve, full
  liquidation only) built to make the DON-corroborated liquidation
  mechanism real and testable — not a production money market. Building
  that out is separate, future-roadmap work.
- **`keystone/IReceiver.sol` + `IERC165.sol`** — the minimal interface every
  CRE consumer implements to receive forwarder-relayed reports.

There is no separate `AccessControl`/role-registry contract — buyer/seller/
arbiter permissions live as constructor-captured addresses and
`onlyBuyer`/`onlySeller`/`onlyArbiter` modifiers directly on `EscrowVault`,
since each vault's role set is fixed at creation and scoped to that one
trade.

### CRE Workflows (Go, not TypeScript)

Real paths under `workflows/`: `escrow-confirmation/`, `compliance-check/`,
`liquidation-protection/`. All three are written in **Go** against
`cre-sdk-go`, matching this project's `go.mod`/`project.yaml` convention —
not TypeScript. Confirmed call ordering (every workflow in this repo follows
it): all confidential work (`GetSecret`, `SendRequestInTee`) happens first,
`runtime.UsingTheDons()` is called exactly once at the end, and every
on-chain read/write goes through the resulting `cre.Runtime`.

Known, documented limitations (see `docs/architecture.md`):
- `evm.LogTrigger`'s watched-address list is fixed at config time — a new
  `EscrowVault` needs a config update + redeploy of `escrow-confirmation`,
  not automatic discovery. Worth automating later (watch `VaultCreated`,
  push config).
- One `liquidation-protection` deployment monitors one borrower, mirroring
  the RWA-oracle-per-feed pattern — no proven multi-subject-per-invocation
  example to build on yet.

### Frontend Stack — as built

`frontend/`: **Next.js (App Router) + wagmi v2 + viem + RainbowKit**,
targeting Sepolia. wagmi is pinned to v2 because RainbowKit 2.x doesn't yet
support wagmi v3. Contract bindings are generated from the Foundry build
artifacts (`contracts/evm/out/`) via `@wagmi/cli`'s Foundry plugin — never
hand-copied. State management is whatever wagmi/TanStack Query already
provides (query cache, mutation state) — no separate global-state library
needed at this scope. Transaction/confirmation states use wagmi's
`useWriteContract`/`useWaitForTransactionReceipt` directly, with plain
loading-state copy ("Approving…", "Funding…") rather than a bespoke
stepper component (see "Future roadmap" below for a proper
`TransactionStepper`).

---

## UI/UX — BUILT THIS SESSION vs. FUTURE ROADMAP

### Design principles (still the right target, largely not yet realized visually)

1. **Trust is visual** — verification status, DON attestation, and
   compliance tier should be first-class UI, not footnotes.
2. **Progress is tangible** — milestone status should be obvious at a
   glance.
3. **Compliance is seamless, not scary.**
4. **No blockchain jargon unless necessary.**

The current UI is functional and honest, not yet polished to this bar —
plain text/status badges rather than a designed visual system. That's the
real gap between this document's ambition and today's build.

### Pages — built this session

One coherent buyer journey, Sepolia only, lending excluded by explicit
scope decision:

1. **Browse** (`/`) — listing list with status, bond, a "View trade" link
   once sold.
2. **Create listing** (`/create`) — single-step form: token, bond,
   milestone amounts, arbiter, description. (Not the multi-step
   wizard-with-drag-drop described in the original brief — that's future
   roadmap if the milestone count/complexity ever warrants it.)
3. **Listing detail** (`/listing/[id]`) — full listing info, Purchase
   button (blocked if you're the seller or the listing's arbiter — you
   can't buy your own listing or purchase into a trade where you'd also be
   expected to arbitrate).
4. **Trade / escrow status** (`/trade/[address]`) — role banner ("You are
   the buyer/seller/arbiter"), bond deposit, funding (with the compliance
   gate surfaced inline via a KYC stub when a purchase would exceed the
   buyer's tier cap), per-milestone docs/confirm/dispute, and a dedicated
   dispute panel for the arbiter showing who raised it and why (read from
   the `Disputed` event log, not stored contract state) with resolve
   actions.

**KYC is a deliberate UI-only stub this session**, not the tiered
Tier-1/2/3 flow described in the original brief: `ComplianceConsumer.onReport`
only accepts calls relayed by the real `KeystoneForwarder`, so only a live
`compliance-check` workflow running on an actual DON can change a buyer's
on-chain tier — no such workflow is registered with a DON in this session,
only the contracts are deployed. The "Verify identity" step generates a
fake caseId and a mock response to make that step's UX real to build
against, without touching chain state or claiming a real provider
integration exists.

### Pages — future roadmap, not yet built

These remain good ideas from the original brief, not contradicted by
anything built — just not in scope yet:

- **Landing/marketing page** — hero, how-it-works, trust indicators.
- **Dashboard** (buyer & seller) — active deals, pending actions,
  transaction history across every trade a wallet is party to (today you
  navigate to one trade at a time by address/listing id).
- **Lending pages** — collateral deposit, borrow position with health
  factor, liquidation-protection indicator. Blocked on `LendingPool`
  remaining a deliberately minimal substrate, not a production money
  market — building real lending UI without a real lending product to
  back it would be misleading.
- **Dedicated verification-status page** — a step-by-step live view of a
  pending CRE workflow run ("milestone claimed → workflow triggered →
  external check → DON report → funds released"). Meaningful once a
  workflow is actually registered against a live DON; not buildable
  against contract state alone.
- **Real KYC provider integration** — swapping the stub for a real
  provider's hosted widget (Persona, Sumsub, etc.), behind the same
  `caseId` contract the stub already establishes.

### Component library — partially built, partially aspirational

Built (informally, not yet extracted into a shared design-system package):
milestone status badges, the role banner, the dispute panel, the KYC-gate
card, bond/fund panels with approve→act two-step flows.

Not yet built as reusable, named components: `MilestoneTimeline` (currently
a plain list, not a visual timeline), `VerificationBadge` (currently plain
text status), `CREAttestationCard`, `DealCard` (currently a plain list
row), `HealthFactorGauge` (blocked on real lending UI), `TransactionStepper`.
Worth formalizing if/when the visual design system work above happens.

### Visual direction — not yet applied

No color palette, typography pairing, or motion system has been designed
or implemented — the current UI uses default Tailwind grays plus the
existing Next.js template's light/dark CSS variables. The original brief's
direction (deep navy/ink base, trust-blue accent, institutional-but-
approachable) is a reasonable starting point whenever visual design work
happens, not something to invent unprompted mid-build.

---

## COMPARISON TO GARANTOR (still valid)

1. TON-specific limitations (immature lending ecosystem, limited oracle
   support) → solved by moving to Ethereum + CRE.
2. Opaque verification → DEEDS's whole point is DON attestation being
   visible, once the UI catches up to that principle.
3. Compliance bolted on → the tier/rolling-volume model is core to
   `EscrowFactory`/`EscrowVault`, not an afterthought, even though its UI
   is still a stub.
4. No lending UX → still true today (deliberately deferred), but the
   contracts exist as a real substrate to build UI against later.
5. Basic milestone UI → still basic today (a list with status badges);
   the interactive timeline remains future roadmap.
6. No verification-status transparency → still true; needs a live DON
   workflow to build against meaningfully.

---

## CONSTRAINTS

- Gas efficiency: achieved via **shared singleton consumers**
  (`EscrowConfirmationConsumer`, `ComplianceConsumer` used by every vault,
  one `KeystoneForwarder` trust relationship configured once) rather than a
  clone-factory pattern, which was considered and rejected for
  `EscrowVault` — see `docs/architecture.md`.
- No PII on-chain, ever — enforced by construction: the `compliance-check`
  webhook payload is `{subject, caseId}` only.
- Frontend must work on mobile (responsive) — not yet verified at small
  viewport widths; worth a pass before calling the UI done.
- Wallet support: RainbowKit gives MetaMask, WalletConnect, Coinbase Wallet,
  and others out of the box — already satisfied by the stack choice.
- Accessibility (WCAG AA) — not yet audited.
- Feel fast: current UI shows plain "Approving…/Funding…/Submitting…"
  loading states rather than optimistic UI; acceptable for a testing build,
  worth revisiting for a polished release.
