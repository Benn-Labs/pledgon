# DEEDS Architecture

DEEDS is a Garantor successor built on Chainlink CRE: marketplace, milestone
escrow, a confidential compliance layer, and lending/borrowing.

Garantor (predecessor, `../garantor-project`) proved the domain model on TON/Tact:
listings, a performance bond, seller-submits-docs → buyer-confirms → release,
with dispute as an escape hatch (see `../garantor-project/MILESTONE_ACTIONS_FLOW.md`).
DEEDS keeps that domain model but rebuilds it on EVM + CRE, replacing TON-specific
transaction plumbing with Solidity contracts and DON-verified confidential workflows.

## Feature → CRE mapping

| DEEDS feature | Maps to | Status |
|---|---|---|
| Marketplace (listings, transfers) | Plain Solidity — CRE doesn't do much here | Not started |
| Escrow + DON confirmation | Confidential workflow verifies an off-chain condition (title recorded, payment cleared) → signed report → escrow contract checks it before releasing funds | **Built**: `EscrowVault`/`EscrowFactory`/`EscrowConfirmationConsumer` (Solidity, 50 tests) + `escrow-confirmation` workflow (Go, 18 tests) |
| Milestone escrows | Same pattern, repeated per milestone. Triggered by an EVM log trigger (fires when a milestone is claimed via `submitMilestoneDocs`) rather than cron polling | Built as part of the row above — `DocsSubmitted` is the claim event |
| Compliance layer (confidentiality) | KYC/AML/sanctions API called inside the enclave — PII and the provider's credentials never leave it, only `compliant: true/false` crosses out | Textbook Confidential Workflows use case |
| Lending/borrowing | Its own large protocol: collateral valuation (the RWA oracle feeds this directly), liquidation logic | `automated-liquidation-protection` template is a real starting point, not from scratch |

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
    marketplace/      listings, transfers (plain Solidity)
    escrow/            milestone escrow, DON-verified release
    compliance/        receives compliant:true/false reports
    lending/           collateral, borrowing, liquidation
  workflows/
    escrow-confirmation/     confidential workflow: verify milestone condition off-chain
    compliance-check/         confidential workflow: KYC/AML/sanctions in-enclave
    liquidation-protection/   adapted from the CRE template of the same name
```

## Decisions

- **Escrow shape: `EscrowFactory` + per-trade vault.** Matches Garantor
  (`escrow_factory.tact` + `escrow_vault.tact`) and keeps each trade's state and
  balance isolated — lower complexity than a single contract with a milestone array
  across all trades.
- **Compliance gates by transaction value.** Any transaction ≤ $999 (equivalent)
  proceeds without a compliance check. Above $999, escrow funding requires a
  `compliant: true` verdict from the compliance-check confidential workflow
  (KYC/KYB) before funds move. Threshold is enforced in the escrow vault at fund-in,
  not at marketplace listing time.
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
