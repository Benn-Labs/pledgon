# Mainnet promotion readiness

Audit of what stands between the current Sepolia-only deployment and a mainnet
cutover (2026-11-18). Verdict: **contracts are deployable to mainnet today,
but the workflow/ops layer is Sepolia-shaped and the org CRE quota is the
hard blocker.** Nothing found is a contract-code change.

## Blockers (must resolve before mainnet)

1. **CRE org quota.** The private registry caps BENN LABS at 3 active
   workflows. A mainnet lending market wants lending-oracle +
   liquidation-protection (×2 tiers) + portfolio-rebalancing = 4, before
   escrow-confirmation/compliance-check. The increase request
   (`docs/cre-quota-increase-request.md`, 3 → 10) must be approved first —
   deploying today would exceed the quota the moment a second market exists.

2. **Production workflow configs target Sepolia.** Every
   `config.production.json` except arbitrage/portfolio-rebalancing says
   `ethereum-testnet-sepolia` and carries Sepolia consumer addresses. The
   runbook's worksheet note already says these rows were never deployed —
   they are ready-slots mirroring Sepolia. For mainnet: set
   `chainSelectorName: ethereum-mainnet`, redeploy the contracts on mainnet,
   then re-run `cmd/wire-config --chain-id 1 --target production` to patch
   pool/consumer addresses. `project.yaml` already has an
   `ethereum-mainnet` RPC for gateway validation.

3. **Mainnet deployment env vars.** `Deploy.s.sol` requires, at minimum:
   `FORWARDER_ADDRESS` (the *mainnet* KeystoneForwarder from
   `cre workflow supported-chains` — NOT Sepolia's), `OWNER_ADDRESS`
   (multisig, not an EOA), `DEFAULT_ARBITER_ADDRESS` (a real arbitration
   operation), `FEE_RECIPIENT_ADDRESS`. Decide non-zero
   `VAULT_CREATION_FEE_WEI` / `LISTING_FEE_WEI` — they default to 0 (fees
   off). Lending: real `COLLATERAL_TOKEN_ADDRESS`/`DEBT_TOKEN_ADDRESS` — the
   mock `msUSDe` from the Sepolia package is mainnet-useless (unguarded
   `mint()`). The locked sUSDe mainnet design (69% threshold, 90% max
   utilization, 15-min freshness/verdict ages) is in
   `docs/sepolia-susde-deployment.md`.

4. **Consumer ↔ workflow binding.** Every consumer deploys with
   `expectedWorkflowId = 0` (unbound) because binding is circular on CRE.
   Accepted for staging; for mainnet the runbook's Phase 6
   (`setExpectedWorkflowId` owner-setter) should land first or be scheduled
   with a hard date before real volume.

## Not blockers, but decide/verify

- **Secrets.** `REBALANCING_PRICE_API_TOKEN` (new) must be added to
  `secrets.yaml` + `.env.example`, along with a real third price provider —
  portfolio-rebalancing's production `verificationUrl` is still an
  example.com placeholder. Same placeholder status for the arbitrage config
  (pre-existing; that workflow is config-stub-only, no Go code).
- **Frontend envs.** `NEXT_PUBLIC_*` addresses are single-chain — a mainnet
  frontend deployment needs its own env set (wagmi already supports mainnet;
  the footer network label is now chain-aware).
- **Workflow simulation before deploy** per runbook Phase 5
  (`cre workflow simulate ... --target production-settings`).
- **Un-audited contracts.** The remediation summary
  (`docs/audit-remediation-summary.md`) covers the internal review; there is
  no third-party audit. For mainnet TVL, commission one.

## What is already mainnet-shaped

- `project.yaml` production RPCs include `ethereum-mainnet`.
- `workflows/arbitrage/config.production.json` and
  `workflows/portfolio-rebalancing/config.production.json` already say
  `ethereum-mainnet` (addresses get wired by wire-config after deploy).
- The production runbook's Phase 3–6 checklist covers forwarder, binding and
  deployment order; the Workflow-ID worksheet has the new
  portfolio-rebalancing row.
- LendingPool's locked mainnet parameters are decided and documented.
