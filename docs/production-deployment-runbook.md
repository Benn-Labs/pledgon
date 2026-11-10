# PLEDGON Production Deployment Runbook (Ethereum Mainnet)

Step-by-step checklist for taking PLEDGON from Sepolia staging to Ethereum mainnet
production. Complements `docs/audit-remediation-summary.md` (what was fixed and why)
— this doc is the *how* for the production cutover.

**Current state:** all contracts, workflows and the frontend target Sepolia
(chain 11155111). Nothing PLEDGON is deployed on mainnet. The only mainnet
transactions so far are the CRE account-registry writes (link-key/allowlist).

**Principle (same as TON practice):** testnet and mainnet deployments are separate
instances with separate state. Nothing is "promoted" — production is a fresh
deployment, fresh addresses, fresh wiring.

---

## Phase 0 — Go/No-Go gates (blockers)

- [ ] **KYC provider integration built.** The compliance webhook flow requires the
      provider's `caseId`, obtained by the frontend integrating with the provider
      directly (out of band). Not yet built — until it exists, `compliance-check`
      has no way to receive verdict requests in production.
- [ ] **Compliance webhook signer decided.** `config.production.json` ships
      `authorizedKeys: ["REPLACE_WITH_PRODUCTION_SIGNER_PUBLIC_KEY"]` which **fails
      closed** (accepts no caller). Generate a dedicated signer keypair for the
      service that POSTs to the webhook; put its **public key** in `authorizedKeys`;
      store the private key with the calling service. Confirm the exact encoding
      CRE expects (raw ECDSA public key, not address) against `cre workflow
      simulate --http-payload` output.
- [ ] **Owner/arbiter key policy decided.** `OWNER_ADDRESS` (owns `EscrowFactory`
      fees + `ArbitratorRegistry`) and `DEFAULT_ARBITER_ADDRESS` should be
      multisigs (e.g. Safe) or at least hardware-held keys — not the testnet deployer.
- [ ] **Collateral/debt token pair decided.** Real stablecoin + real RWA/liquid
      collateral, **same decimals** (`collateralValueInDebtUnits` assumes it).
      Lending deploys only if both are configured.
- [ ] **Real data sources contracted.** `verificationUrl` (escrow confirmation),
      `verificationUrlTemplate` (KYC verdicts), `priceUrl` (oracle) and the
      independent liquidation price source should be paid/authenticated tier for
      production SLAs. Update `config.production.json` files (they currently hold
      `example.com` placeholders).
- [ ] **CRE quota confirmed** for the production target (`cre workflow deploy
      --target production-settings`) — org limit was 3 active on don_family zone-a.
- [ ] **Deployer key prepared** (see Phase 1).
- [ ] **Mainnet ETH budget** approved (est. 0.05–0.15 ETH for contract deploys at
      typical gas, plus CRE registry txs).

---

## Phase 1 — Keys & accounts

- [ ] **Create a fresh deployer key** (the Sepolia deployer was used for tests; use
      a new one for mainnet): `cast wallet new` → import via
      `cast wallet import pledgon-prod --interactive`.
      - Verify it is **not EIP-7702 delegated**: `cast code <addr> --rpc-url <mainnet>`
        must return `0x` (delegated accounts cannot do raw CREATEs — burned a day on
        this on Sepolia).
      - Verify it has no prior history (nonce 0).
- [ ] **Fund it with mainnet ETH** (from your exchange/custody; keep the amount
      minimal — just the deploy budget).
- [ ] **Confirm CRE account state**: `cre whoami` (deploy access enabled),
      `cre account link-key --target production-settings` if a different owner is
      used (requires a mainnet tx), Vault secrets allowlist done.
- [ ] **Record addresses** in the worksheet below as each phase completes.

---

## Phase 2 — Contract deployment (mainnet)

- [ ] **Fetch the mainnet forwarder** (do not reuse Sepolia's):
      `cre workflow supported-chains` → `ethereum-mainnet` row →
      `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` (verify live; tenants can change).
- [ ] **Dry-run first** (no broadcast) to validate env + estimate gas:
      ```bash
      FORWARDER_ADDRESS=0x0b93... \
      DEFAULT_ARBITER_ADDRESS=<multisig or arbiter key> \
      OWNER_ADDRESS=<multisig> \
      FEE_RECIPIENT_ADDRESS=<fee recipient> \
      VAULT_CREATION_FEE_WEI=<e.g. 1000000000000000> \
      TIER0_CAP_USD=999 TIER1_CAP_USD=10000 \
      COMPLIANCE_MAX_VALIDITY_DAYS=180 \
      COLLATERAL_TOKEN_ADDRESS=<token> DEBT_TOKEN_ADDRESS=<token> \
      COLLATERAL_FEED_LABEL="<feed label>" \
      LIQUIDATION_THRESHOLD_BPS=8000 BORROW_RATE_BPS=500 \
      MAX_PRICE_AGE=900 MAX_VERDICT_AGE=900 MAX_PRICE_DEVIATION_BPS=5000 \
      forge script script/Deploy.s.sol --rpc-url <mainnet-rpc>
      ```
      Same for `DeployLending.s.sol`. **Gas-schedule check:** Sepolia repriced code
      deposit (~1630 gas/byte) making forge's estimates ~6.8× low. Before
      broadcasting on mainnet, compare the dry-run estimate against
      `cast estimate` for one CREATE on mainnet; if the divergence exists there
      too, add `--gas-estimate-multiplier 900` (and keep `--slow`). Do not
      blindly reuse the Sepolia multiplier — measure.
- [ ] **Broadcast** both scripts with `--broadcast --account pledgon-prod` and the
      chosen multiplier. Verify three+ green ✅ per script; if a tx drops from the
      mempool, re-run with `--resume` (check `cast nonce` first — "dropped" txs
      sometimes mine late and change the nonce).
- [ ] **Record addresses** from `deployments/1.json` + `deployments/lending-1.json`
      in the worksheet.
- [ ] **Verify on-chain** (getters): consumers `expectedWorkflowId()==0` (unbound
      until Phase 5/6), `maxDeviationBps`, `maxVerdictAge`, `maxValidity`; pool
      `maxPriceAge`, `liquidationThresholdBps`, `oracleConsumer`,
      `liquidationConsumer`, token addresses; factory `defaultArbiter`,
      `vaultCreationFee`, `tier0CapUsd/tier1CapUsd`.
- [ ] **Merge** the lending record into `deployments/1.json` (same 3-key merge as
      staging) so `wire-config --chain-id 1` reads one record.

---

## Phase 3 — Config wiring

- [ ] `go run ./cmd/wire-config --chain-id 1 --target production`
      (fills `confirmationConsumerAddress`, `consumerAddress`×2, `lendingPoolAddress`,
      `escrowFactoryAddress`, `keeperAddress` in the production configs; leaves
      `vaultAddresses`/`borrowers` untouched).
- [ ] Hand-fill per-environment values in `config.production.json` files:
      - `escrow-confirmation`: real `vaultAddresses` (start empty list + add vaults
        as trades are created — remember the per-vault log-trigger operational cost)
      - `compliance-check`: real `verificationUrlTemplate`, real `authorizedKeys`
      - `lending-oracle`/`liquidation-protection`: real `priceUrl` /
        `verificationUrl`, **and `gasLimitWei` ≥ 3× the measured mainnet `onReport`
        cost** (Sepolia measured 354k for the oracle consumer at the repriced
        schedule; measure on mainnet with `cast estimate` and set accordingly —
        3,000,000 was Sepolia's value)
- [ ] `cre workflow hash <dir> --target production-settings` for each workflow —
      these are the *intended* production workflow IDs (record them; binding
      consumes them in Phase 6).

---

## Phase 4 — Vault secrets (production)

- [ ] Set the production secret env values (provider credentials) in the env file
      used with `-e`, names matching `secrets.yaml`:
      `SECRET_VERIFICATION_API_TOKEN`, `SECRET_COMPLIANCE_API_TOKEN`,
      `SECRET_LENDING_PRICE_API_TOKEN`, `SECRET_LENDING_ORACLE_API_TOKEN`.
- [ ] `cre secrets create secrets.yaml --target production-settings --yes`
      (mainnet digest tx + gateway POST, ~$0.01).
- [ ] `cre secrets list --target production-settings --yes` → all four present.

---

## Phase 5 — Workflow deployment (production)

- [ ] Simulate each workflow first: `cre workflow simulate <dir> --target
      production-settings --non-interactive --trigger-index 0`.
- [ ] Deploy: `cre workflow deploy <dir> --target production-settings --yes` for
      `lending-oracle`, `liquidation-protection` (+`-safe` if used), `trade-expiry`,
      then `escrow-confirmation`/`compliance-check` once Phase 0 items land.
- [ ] Confirm IDs from deploy output match the Phase-3 hashes; record actuals.
- [ ] Activation: deployments start paused on a fresh name; `cre workflow activate
      <dir> --target production-settings --yes` (mainnet registry tx) — or verify
      they report `Active` via `cre workflow list --target production-settings`.

---

## Phase 6 — Binding (after the setter lands)

The constructor-level `expectedWorkflowId` binding is circular on CRE (the workflow
ID hashes the config bytes, which contain the consumer address). Until the
`setExpectedWorkflowId` owner-setter is implemented (Chainlink `ReceiverTemplate`
pattern), production consumers run **unbound** — acceptable, but schedule the
follow-up before real volume:
- [ ] Implement owner + `setExpectedWorkflowId` in `WorkflowBoundReceiver`
      (+ tests, redeploy consumers, re-wire, re-deploy workflows — one more full
      cycle; budget it).
- [ ] Bind each consumer to its deployed workflow ID; spot-check that a wrong-ID
      report reverts `UnexpectedWorkflowId`.

---

## Phase 7 — Frontend (Vercel)

- [ ] **Code change — mainnet chain support:** `src/lib/wagmi.ts` currently defines
      Sepolia only. Add Ethereum mainnet (chain id 1) + public RPC, and decide the
      UX for chain gating (switch network prompt vs. read-only).
- [ ] Set production env vars in Vercel (Project → Settings → Environment
      Variables → Production), mirroring `.env.example`:
      - contract addresses from the worksheet (10× `NEXT_PUBLIC_*`)
      - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_SUPABASE_URL`,
        `NEXT_PUBLIC_SUPABASE_ANON_KEY` (production Supabase project)
      - mainnet RPC URLs
- [ ] Redeploy (`vercel --prod`); smoke-test `https://pledgon.com` on mainnet:
      connect wallet, read marketplace/escrow/lending, one small test trade.
- [ ] If Git-connected (recommended), confirm the production branch setting.

---

## Phase 8 — Post-deploy verification (all must pass)

- [ ] Oracle consumer `latestRound` updates at the cron cadence with a sane price.
- [ ] Liquidation consumer `checkedAt` advances; `isEligible` matches the pool's
      `isUndercollateralized` view.
- [ ] Pool end-to-end: `collateralValueInDebtUnits(1e18)` returns a sane value
      through the new oracle consumer.
- [ ] `cre execution list <workflow> --target production-settings` — recent runs
      SUCCESS; inspect one run's events (WriteReport success).
- [ ] A real escrow trade: create → fund → submit docs → DON confirms (or buyer
      confirms) → release; volume recording + tier caps behave.
- [ ] Compliance: a test caseId through the real provider writes a tier to
      `ComplianceConsumer` and `tierOf` reflects it.
- [ ] Watch the staging→prod parity: same code, different addresses — verify no
      staging address leaked into production configs (`grep -ri 0x8fa4\|0xd389\|
      0xa269\|0xfe02\|0x62dc\|0xA16A\|0xb77c workflows/*/config.production.json`).

---

## Liquidation borrower refresh (recurring ops)

The liquidation workflows only monitor borrowers baked into their config at
deploy time; a new `depositCollateral` is invisible to them until the config is
refreshed and both instances redeployed. After any new borrower, or on a
schedule once churn justifies it:

- [ ] `scripts/refresh-liquidation-borrowers.sh --rpc-url <sepolia-rpc>
      [--target staging]` — rescans `CollateralDeposited`, repatches both tier
      configs, then prompts before redeploying + activating the two workflow
      instances.
- [ ] Update `WorkflowID.txt` from `cre workflow list` — a redeploy changes the
      workflow IDs (config bytes hash into the ID).

Fully automated refresh was deliberately not built: a config change only takes
effect via a credentialled `cre workflow deploy` + `activate` (org-quota
limited), and the workflow can't self-discover borrowers across ticks (see
docs/architecture.md, "Multi-borrower monitoring"). The script keeps the manual
path to one command; promote it to CI only together with a secrets story for
the CRE deploy credentials.

---

## Rollback / incident plan

Contracts are immutable (no upgrade path) — incident response is:
- [ ] **Pause the affected workflow**: `cre workflow pause <dir> --target
      production-settings --yes` (stops triggers immediately; missed triggers are
      not queued).
- [ ] If a consumer is compromised/misbehaving: deploy a replacement, `wire-config`,
      `cre workflow update`, reactivate (the full cycle is ~1 hour by this runbook).
- [ ] `EscrowFactory` owner actions (fee/feeRecipient) are the only live admin
      levers; multisig owners make them slow but safe.

---

## Address worksheet

| Component | Sepolia (reference) | Mainnet |
|---|---|---|
| KeystoneForwarder | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` |
| EscrowFactory | `0x98062049A1c96b223d4F441524572a5B6E0408fc` | |
| Marketplace | `0x2091F788c40A62A70BdCE605821b8e429184B724` | |
| EscrowConfirmationConsumer | `0x075846414E0D911B3A1aF83AC85CF04bd09A953a` | |
| ComplianceConsumer | `0xB53debF35709B1C040bAbf0B41b3f5A92B908E0c` | |
| ArbitratorRegistry | `0xA2c80F3d116608f510Effa03AFc10C85d88731E1` | |
| TradeExpiryKeeper | `0xdBAF591d3360D23eeec5cF4aF47197042C400C91` | |
| LendingPool | `0xD389c90a61F4de210D2632Df1545082D53d41ed9` | |
| LendingOracleConsumer | `0xe94F2C9654c84091bbbF82c8Cac07e606215A84D` | |
| LiquidationConsumer | `0xa2695De5596537D12e256C033a94f0fE35196e24` | |
| Owner (factory/registry) | — | |
| Default arbiter | `0xD212a8bb21112c9941D58E232d01b542C3577F37` (testnet) | |
| Fee recipient | — | |

## Workflow-ID worksheet (production)

| Workflow | Intended ID (`cre workflow hash`) | Deployed ID |
|---|---|---|
| lending-oracle-production | | |
| liquidation-protection-production | | |
| liquidation-protection-production-safe | | |
| trade-expiry-production | | |
| escrow-confirmation-production | | |
| compliance-check-production | | |

Note: `liquidation-protection-production` / `-safe` (and every other production
row above) have **never been deployed** — the empty Deployed-ID cells are
original, not deletions. The production configs mirror the current Sepolia
lending stack as a ready second slot; deploying them today would duplicate
monitoring of the same pool and exceed the org's 3-active-workflow quota
(`docs/audit-remediation-summary.md`). Deploy only alongside a separate
production lending stack.
