# PLEDGON

A Garantor successor on Chainlink CRE: marketplace, milestone escrow, a
confidential compliance layer, and lending/borrowing.

See [docs/architecture.md](docs/architecture.md) for the feature-to-CRE mapping,
prior-art pointers, and open design questions.

## Deploying the contracts

```bash
cd contracts/evm
FORWARDER_ADDRESS=<KeystoneForwarder address for the target chain> \
  forge script script/Deploy.s.sol --rpc-url <url> --private-key $PRIVATE_KEY --broadcast
```

Escrow, compliance, and the marketplace always deploy. Lending deploys too if
`COLLATERAL_TOKEN_ADDRESS` and `DEBT_TOKEN_ADDRESS` are both set (see
`script/Deploy.s.sol`'s doc comment for the full env var list and defaults).
Omit `--private-key`/`--broadcast` for a dry run against a local simulated chain.

Every deployed address is written to `contracts/evm/deployments/<chainId>.json`.
Wire the relevant ones into each workflow's `config.<target>.json`
(`confirmationConsumerAddress`, `consumerAddress`, `lendingPoolAddress`) with:

```bash
go run ./cmd/wire-config --chain-id <chainId> --target staging   # or production
```

This only ever touches those specific address fields — `vaultAddresses`,
`borrowers`, secret IDs, URLs, and everything else in each config are left
exactly as they were, since a deployment record can't supply them. A field
whose deployment address is the zero address (lending, when it wasn't
deployed) is skipped rather than overwritten with a placeholder.

`liquidation-protection`'s `borrowers` list isn't a deployment address either
— it's discovered from on-chain deposit history, not wired from
`deployments/<chainId>.json`:

```bash
go run ./cmd/discover-borrowers --chain-id <chainId> --target staging \
  --rpc-url <url> --from-block <lendingPool's deployment block>
```

Scans `CollateralDeposited` logs on the deployed `LendingPool` for every
address that has ever deposited, classifies each by current LTV, and patches
the two tiers into **both** `config.<target>.json` (close-watch — within
`--ltv-margin-bps`, default 2000, of the liquidation threshold; checked every
5 minutes) and `config.<target>-safe.json` (everyone else; checked hourly —
see `workflow.yaml`'s `staging-safe-settings`/`production-safe-settings`
targets). Redeploy **both** targets after re-running this — a borrower can
move tiers as their LTV changes, not just join the list for the first time.
Re-run it (and redeploy) whenever a new borrower opens a position, or
periodically to keep both tiers current — same operational shape as updating
`vaultAddresses` by hand. Many free RPC tiers (Alchemy included) cap `eth_getLogs` at a small block range;
`--chunk-blocks` (default 10) works around that, but a wider-range-tolerant
public RPC (e.g. `ethereum-sepolia-rpc.publicnode.com`) with a larger
`--chunk-blocks` scans much faster.

## Frontend

Next.js + wagmi/viem + RainbowKit app under [`frontend/`](frontend), covering
the buyer journey against Sepolia: browse listings, purchase (opens an escrow
vault), the compliance gate on a purchase that exceeds the buyer's tier cap,
fund, and escrow status (bond, milestone docs, confirm, dispute). The
`/lending` page covers the borrower side (deposit/withdraw collateral, borrow,
repay, liquidate) and the lender side (supply/withdraw pool liquidity,
interest-bearing).

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in WalletConnect project id + deployed addresses
npm run dev
```

Contract bindings (`frontend/src/generated/contracts.ts`) are generated from
the Foundry build artifacts in `contracts/evm/out/`, not hand-copied — re-run
after any contract change (needs `forge` on `PATH`, plus a `forge build` if
the artifacts are stale):

```bash
npm run wagmi:generate
```

**KYC is a UI-only stub this session.** `ComplianceConsumer.onReport` only
accepts calls relayed by the real `KeystoneForwarder`, so only a live
`compliance-check` workflow running on an actual CRE DON can change a buyer's
on-chain tier — no such workflow is registered with a DON here, only the
contracts are deployed. The "Verify identity" step in the compliance gate
generates a fake caseId and a mock response to make that step's UX real to
build against, but it does not change on-chain state. To complete a purchase
end-to-end on real Sepolia today, keep it under the buyer's tier-0 cap (see
`EscrowFactory`'s `tier0CapUsd`, default $999).
