# DEEDS Frontend — Build Prompt

## What you're building

A frontend for **DEEDS**, an Ethereum + Chainlink CRE milestone-escrow
marketplace. Cover the **full happy path and the full dispute path** for one
trade lifecycle: browse → list → purchase → compliance gate → fund → bond →
milestone docs/confirm → dispute → arbiter resolution. Lending is a separate,
out-of-scope product for this build (contracts exist as a minimal substrate;
no lending UI needed).

A minimal reference implementation already exists at `frontend/` (Next.js +
wagmi v2 + viem + RainbowKit, typed bindings generated from the Foundry
build artifacts). Treat it as a working spec of the contract interactions,
not as the visual target — it's intentionally unstyled. Your job is a real
design pass on top of the same on-chain behavior, not a rewrite of the web3
plumbing unless you have a good reason to change it.

## Visual direction: Ethereum dApp, not a consumer messaging app

Garantor (the predecessor this replaces) was built on TON, where the norm
leans toward a lightweight, chat-app/Telegram-Mini-App feel. DEEDS should
read the opposite way: a **serious, protocol-native Ethereum application** —
closer in spirit to Uniswap, Aave, or Etherscan than to a consumer app.
Concretely:

- Data-dense where it matters (addresses, amounts, statuses, tx hashes) —
  don't hide protocol reality behind over-simplified copy. Users of an
  escrow-with-a-bond-and-an-arbiter product are already somewhat
  sophisticated; a "Confirming your payment" spinner is fine for a wallet
  popup wait, but hide *nothing* about who holds what and why.
- Monospace for addresses/hashes, a clean sans for everything else —
  standard dApp convention, keep it.
- Status as a first-class visual element: every trade and milestone has a
  real on-chain enum state (`Pending`/`DocsSubmitted`/`Released`/`Disputed`/
  `Refunded` for milestones; `Active`/`Cancelled`/`Sold` for listings) —
  design a proper status-badge system, not ad hoc colored text.
- Institutional-but-approachable: think the trust signaling of a title/escrow
  company crossed with the visual clarity of a modern DeFi front-end. Solid,
  not playful.
- Dark mode is a first-class citizen (as is light) — most Ethereum dApps are
  used dark-mode-first.
- No blockchain jargon *for its own sake*, but don't obscure real protocol
  concepts (bond, tier, arbiter, dispute) behind vague consumer language
  either — these are the actual mechanics the user is trusting funds to.

## Full endpoint / flow coverage required

### Happy path

1. **Browse listings** — `Marketplace.listingCount()` +
   `Marketplace.listings(id)` + `Marketplace.listingMilestones(id)`. Show
   status, seller, bond, total price, milestone breakdown.
2. **Create listing** (seller) — `Marketplace.createListing(token,
   bondAmount, milestoneAmounts[], arbiter, metadataURI)`. **The arbiter
   must be a distinct address from the seller** — the contract will reject
   `arbiter == seller` at the vault level once a purchase happens, but
   validate it in the form too, don't wait for the revert.
3. **Purchase** (buyer) — `Marketplace.purchase(listingId)`. This closes the
   listing and opens an `EscrowVault` via `EscrowFactory.createTradeFor`,
   naming the caller as buyer. **Also block/warn if the connecting wallet
   equals the listing's arbiter** — same reasoning, `arbiter == buyer` is
   rejected on-chain.
4. **Seller deposits bond** — ERC-20 `approve(vault, bondAmount)` then
   `EscrowVault.depositBond()`. Skippable if `bondAmount == 0`.
5. **Buyer funds** — ERC-20 `approve(vault, totalAmount)` then
   `EscrowVault.fund()`. **Compliance gate**: `fund()` reverts with
   `ComplianceRequired` if the buyer's rolling 30-day volume
   (`EscrowFactory.currentPeriodVolume(buyer)` + this trade's total) exceeds
   their tier's cap (`EscrowVault.tier0Cap`/`tier1Cap`, tier from
   `ComplianceConsumer.tierOf(buyer)`). Surface this *before* the revert:
   compute the projected volume client-side and show the gate proactively.
6. **KYC step (stub only — see below)** — a "Verify identity" affordance
   that generates a mock caseId and a mock "verified" response. This is
   real, deliberate UX work, but it **does not and should not** change
   on-chain state — only a live `compliance-check` CRE workflow running on
   an actual DON can call `ComplianceConsumer.onReport`, and none is
   registered against a live DON in this build. Design the gate honestly:
   showing what a real KYC step would feel like, without claiming a real
   provider is behind it. If a real provider integration exists in your
   scope, wire it behind the same `{subject, caseId}` shape the workflow
   already expects — don't invent a different contract for it.
7. **Seller submits milestone docs** — `EscrowVault.submitMilestoneDocs(index,
   docHash)`. `docHash` is a `bytes32` — hash whatever proof text/reference
   the seller enters (`keccak256`).
8. **Buyer confirms** — `EscrowVault.confirmMilestone(index)`. Releases that
   milestone's payment to the seller; once *every* milestone is `Released`,
   the bond auto-returns to the seller in the same flow.
9. **(Alternative release path)** — `EscrowVault.releaseMilestoneViaDon(index)`
   is permissionless once `EscrowConfirmationConsumer.isConfirmed(vault, index)`
   is true (set by the `escrow-confirmation` DON workflow, not by this
   frontend). Worth a UI affordance ("Check DON confirmation") even though
   it'll typically be false in a build with no live DON — document it as a
   real path, don't hide it because it's rarely hit in testing.

### Dispute path

1. **Raise a dispute** — either buyer or seller, on a milestone in
   `Pending` or `DocsSubmitted` status: `EscrowVault.disputeMilestone(index,
   reason)`. Design this as a deliberate, secondary action — not
   equal-weight with the happy-path "Submit docs"/"Confirm delivery"
   buttons. (A real bug from the reference build: putting both at equal
   visual weight caused a tester to land on Dispute by accident. Don't
   repeat it — require a confirm step or a clear visual demotion.)
2. **Dispute visibility for everyone** — once a milestone is `Disputed`,
   every party (buyer, seller, arbiter, and arguably any viewer) should see
   *who* raised it and *why*. That reason isn't stored on-chain past the
   `Disputed(indexed milestoneIndex, indexed raisedBy, reason)` event — read
   it via an event-log query (`getContractEvents`/`getLogs`), not a contract
   read.
3. **Arbiter resolution** — only the trade's `arbiter` can call
   `EscrowVault.resolveDispute(index, releaseToSeller: bool)`. Give this its
   own clearly-labeled panel (not just two bare buttons): show the dispute
   reason, who raised it, the milestone amount at stake, and two decisive
   actions — "Release to seller" / "Refund buyer" — with a confirm step
   given money is moving.
4. **Bond slashing** (separate from dispute resolution) —
   `EscrowVault.slashBond(to)`, arbiter-only, independent of
   `resolveDispute` (a refunded milestone otherwise leaves the bond locked,
   since the auto-return-on-completion path only fires when every milestone
   reaches `Released`). Needs its own explicit affordance in the arbiter's
   view — don't fold it silently into dispute resolution, it's a distinct
   decision (a milestone can be refunded to the buyer *without* the arbiter
   deciding to also forfeit the seller's bond).
5. **Role clarity throughout** — a wallet may be buyer, seller, or arbiter
   depending on which trade it's viewing (never more than one of those
   *per trade*, now that `arbiter != buyer/seller` is enforced on-chain).
   Every trade view should say plainly which role the connected wallet is
   playing, and hide/show actions strictly by that role — no relying on the
   user to infer it from which buttons happen to be enabled.

## Constraints carried over from the real contracts

- **Three-wallet testing is required**: buyer, seller, and arbiter must be
  three distinct addresses — the contract will revert
  (`EscrowVault.ArbiterConflict`) if the arbiter matches either party. Build
  and test against three real accounts, not two.
- Milestone escrow is **phased**: the buyer pays the full total upfront in
  one `fund()` call, but each milestone releases independently. Don't design
  the UI as if funding and releasing are one combined event.
- Tier caps are USD-flat numbers scaled by the payment token's `decimals()`
  — they assume a stablecoin pegged ~1:1 to USD. If you support arbitrary
  ERC-20s, that assumption should be visible in the UI (e.g., don't label a
  volatile token's cap as "$999" without a caveat).
- No PII ever crosses the frontend→workflow boundary. The compliance
  webhook payload is `{subject, caseId}` only — never build a form that
  collects name/DOB/ID-number and sends it anywhere in this system.
- Sepolia only for now. Contract addresses are wired via `NEXT_PUBLIC_*` env
  vars (see `frontend/.env.example`) — read from `contracts/evm/deployments/
  11155111.json` after any redeploy, never hardcode addresses in source.

## Reference

- [docs/architecture.md](architecture.md) — authoritative build log, exact
  contract behavior, known limitations.
- [docs/DEEDS-Design-Architecture-Prompt.md](DEEDS-Design-Architecture-Prompt.md)
  — corrected architecture reference (contract names, workflow language,
  what's built vs. future roadmap).
- `contracts/evm/src/` — read the actual Solidity if anything here is
  ambiguous; it's the ground truth, this document is a summary of it.
- `frontend/src/generated/contracts.ts` — typed ABIs, regenerate with
  `npm run wagmi:generate` after any contract change.
