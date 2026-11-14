# Pledgon milestone escrow (EVM) vs Garantor escrow (TON)

Developer brief for assessing which Pledgon `EscrowFactory` / `EscrowVault` features
can be ported into Garantor's milestone vault creation on TON.

Sources:
- Pledgon: `contracts/evm/src/escrow/EscrowFactory.sol`, `EscrowVault.sol`,
  `ArbitratorRegistry.sol`, `EscrowConfirmationConsumer.sol`, `TradeExpiryKeeper.sol`,
  `workflows/escrow-confirmation/` (Chainlink CRE workflow).
- Garantor: `docs/garantor-escrow-15 (1).pdf` — generated vault sheet describing the
  deployed factory/vault behaviour (Two-Party Confirmation and Oracle-Settled models).

---

## 1. Garantor model as documented (baseline)

Factory deploys one vault per trade with: trade value, seller address, deadline, and
seller performance-bond % (1–20% of value) fixed on-chain. No funds move at creation.

- **Funding**: buyer deposits full value; seller deposits the bond %. Vault locks until
  BOTH deposits land. Before both land, either side can cancel and reclaim only what
  they deposited.
- **Two-Party Confirmation**: seller confirms delivery (optional document hash); buyer
  independently confirms receipt with the matching hash. Matching confirmations release
  the full pool (value + bond) to the seller automatically — no manual settlement.
- **Oracle-Settled variant** (marketplace listings): seller ships and submits carrier
  tracking; an independent oracle reports Delivered / Failed / Partial. Partial goes
  straight to dispute; Delivered/Failed opens a fixed objection window during which
  either party may dispute. Undisputed → anyone triggers settlement permissionlessly:
  Delivered pays seller, Failed pays buyer (including the forfeited bond).
- **Dispute**: DAO arbitrator allocates the pool, or both parties bypass arbitration by
  mutually agreeing a split. Timeout → split fallback if arbitration lapses.

Note: the sheet documents a single-value vault (10 GRAM, one pool). The milestone
variant is what this brief targets.

---

## 2. Pledgon features the Garantor dev should evaluate

### A. Factory level (`EscrowFactory`)

| # | Feature | How it works | Effort on TON |
|---|---------|--------------|----------------|
| A1 | **Milestone decomposition at creation** | `milestoneAmounts: uint256[]` — a trade is an ordered list of milestones with individual amounts, deployed into one vault. Buyer funds all milestones in a single transfer. | Low–medium. Store milestone dict in vault state; watch TON cell/storage limits; consider bounded milestone count. |
| A2 | **Delegated creation (`createTradeFor`)** | A marketplace/orchestrator creates the vault on the buyer's behalf. Safe permissionless because `fund()` still requires the buyer's own token approval. | Low. Anyone can deploy a state-init; keep funding permission on the real buyer. |
| A3 | **Flat creation fee in native coin** | Exact `msg.value` per creation; owner-adjustable; fees accumulate in the contract and are pulled via `withdrawFees` (push on every creation would brick vault creation if the recipient can't receive). | Low. Fee in TON at deploy; pull-based withdrawal. |
| A4 | **Per-buyer rolling volume (anti-structuring)** | Vault calls back `factory.recordVolume(buyer, total)` during `fund()`; volume buckets are fixed 30-day calendar periods. Prevents splitting one large purchase into many under-cap trades. Known edge: bucket boundaries allow ~2× cap. | Medium. Dict keyed (wallet, period); note TON users rotate wallets more easily — caps bind per wallet, not per identity. |
| A5 | **Compliance tier caps at funding** | tier0 (unverified) / tier1 (KYC) USD caps scaled by token decimals; tier2 uncapped; owner-managed `isSuperUser` exemption consulted at `fund()` time (applies to already-created, unfunded trades). | Medium. Requires a tier source contract/oracle on TON. Caps assume a USD-stable token. |
| A6 | **Arbiter resolution policy** | `address(0)`/default → platform default arbiter; anything else must be accredited. No trade can end with an unvetted or missing arbiter. | Low. Same resolution logic in factory. |
| A7 | **`ArbitratorRegistry`** | Standalone governance-owned accreditation contract, append-only history, reusable by future factories without redeploying the list. | Low. |
| A8 | **On-chain enumerability** | `allVaults`, `vaultsByBuyer`, `vaultsBySeller`, `isVault`, `vaultCount`. | **Caution on TON**: append-on arrays cost storage rent. Prefer off-chain indexer + events over on-chain lists. |

### B. Vault level (`EscrowVault`) — the core state machine

States per milestone: `Pending → DocsSubmitted → Released | Disputed | Refunded | Split`.

| # | Feature | How it works | Garantor today |
|---|---------|--------------|----------------|
| B1 | **Per-milestone doc hash anchoring** | Seller submits `bytes32 docHash` per milestone; anchors the deadline clock and the oracle query. | Only for the single delivery confirmation. |
| B2 | **Dual release triggers, racing** | A milestone releases on buyer `confirmMilestone` OR permissionless `releaseMilestoneViaDon` once the DON attested the off-chain condition — whichever happens first. | Oracle-settled exists for listings; two-party confirm for direct trades. Not combined per milestone. |
| B3 | **Asymmetric deadline windows (three)** | `fundingWindow` (fund deadline), `milestoneConfirmWindow` (buyer confirm window per milestone, starts at doc submission), `deliveryWindow` (seller must submit docs within window of funding). | One trade-level deadline. |
| B4 | **Permissionless expiry trio** | `expireFunding` (missed fund deadline → bond back, vault closed), `expireMilestone` (buyer silence past confirm window = accepted delivery → pays seller), `expireDelivery` (seller silence past delivery window → refunds buyer). Liveness enforced without any trusted caller. | Only "flag as expired" on unconfirmed deadline. |
| B5 | **Arbiter ruling with basis-point split** | `resolveDispute(index, sellerBps)`: 0 = full refund, 10 000 = full release, between = genuine split; partial split leaves the bond locked for a separate `slashBond` decision. | DAO allocates the pool (per-trade). |
| B6 | **Milestone-level mutual settlement** | Either party proposes `sellerBps`, counterparty accepts verbatim — no arbiter. Works on Pending/DocsSubmitted/Disputed (can short-circuit a live dispute). Accept re-checks milestone status (no double payout); arbiter ruling clears stale proposals. | Mutual split exists at whole-pool level only. |
| B7 | **Whole-trade mutual exit** | `proposeTradeExit`/`acceptTradeExit`: funded-but-stuck trades wind down — open milestones refund buyer, bond returns seller, vault terminal. Works pre- and post-funding; refused once all milestones settled. | Only pre-lock unilateral cancel. |
| B8 | **Bond lifecycle split** | Bond auto-returns to seller when **every** milestone reaches a terminal state (Released/Refunded/Split — not only Released), so a refunded milestone doesn't strand the bond; `slashBond` is an independent arbiter seizure available mid-trade. | Bond returns with the pool at settlement; forfeiture only via Failed oracle outcome. |
| B9 | **Compliance-gated funding** | `fund()` reverts when the buyer's rolling volume exceeds their tier cap (works with A4/A5). | None. |
| B10 | **Safety invariants at construction** | Arbiter == buyer or seller rejected; `cancelled` terminal flag blocks all further state changes; per-index bounds checks everywhere. | — |

### C. Off-chain verification layer (Chainlink CRE — EVM-specific)

- `EscrowConfirmationConsumer` accepts only DON-signed reports bound to one expected
  workflow ID via the KeystoneForwarder; stores `isConfirmed(vault, index)` monotonically
  (a later "false" report is "no new info", never a revocation).
- The workflow runs in an AWS Nitro enclave: it watches `DocsSubmitted` logs, fetches a
  bearer token **inside the enclave** (operators never see it), calls a verification URL
  with `(vault, milestoneIndex, docHash)`, extracts a boolean, and only the boolean
  verdict crosses back to the DON for signing and on-chain delivery.
- `TradeExpiryKeeper` is a cron workflow that relays expiry transactions — pure
  automation, not a trust boundary, since the underlying checks are on-chain timestamp
  comparisons anyone could submit.

**TON implication:** Chainlink CRE does not natively deliver to TON today. The
equivalent is a custom oracle: an ed25519-signed oracle-committee report (or a TON
keeper service) that the vault verifies natively — TON has no `ecrecover`, so DON-style
ECDSA reports do not verify in-contract without a verifier. Design the consumer around
ed25519 signature checks or a multisig oracle committee. The confidential-TEE property
(URL + credential hidden from operators) has no direct TON equivalent; treat the oracle
endpoint credential as trusted-infra instead, or keep verification sources public.

---

## 3. What maps directly vs what needs redesign

**Already equivalent in Garantor** (no port needed): per-trade vault from factory;
buyer full value + seller % bond; both-deposit lock; unilateral pre-lock cancel;
DAO/arbiter dispute; mutual split; deadline-based expiry; permissionless settlement
trigger; oracle-reported outcomes.

**Genuinely new in Pledgon, recommended for the milestone vault:**
1. B1+B3+B4 — per-milestone state machine with anchored doc hashes and three
   asymmetric, permissionless expiry paths (the biggest functional upgrade).
2. B2 — racing dual release (party confirmation OR oracle attestation) per milestone.
3. B6 — settlement proposals at milestone granularity with stale-proposal protection.
4. B7 — post-funding mutual trade exit.
5. B8 — bond auto-return decoupled from "all Released" + independent slashing.
6. A6+A7 — vetted-arbiter-only policy behind a reusable registry.
7. A4+A5+B9 — volume tracking + tier caps (only if compliance gating is in scope;
   biggest infra dependency: needs a tier source).

**Design differently on TON:**
- Jettons (TEP-74) settle asynchronously via wallet notifications — funding and payouts
  need notification-driven state updates, not synchronous `transferFrom`.
- Keep vault storage small (storage rent); avoid A8-style append-on arrays, prefer
  dicts and an off-chain indexer.
- No `ecrecover`/Keystone forwarder — oracle reports must be ed25519-verifiable in FunC/Tact.
- Timestamps come from the block header; keep the same "durations passed at creation,
  absolute deadlines computed on-chain" pattern (it ports cleanly).
- Factory "deployment" is a state-init message; the precompute-address-from-code+data
  property replaces CREATE2, useful for buyers to know the vault address before funding.

## 4. Suggested evaluation order for the developer

1. B1/B3/B4 (milestone machine + expiries) — self-contained, highest value.
2. B2 release racing — decide the TON oracle mechanism first; it gates this.
3. B6/B7 mutual paths — pure message-logic, cheap to add once (1) exists.
4. B8 bond lifecycle — small accounting change on top of (1).
5. A6/A7 arbiter policy — independent of milestones, quick win.
6. A4/A5/B9 compliance — only with a tier source; defer if not in scope.
