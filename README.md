# DEEDS

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

Every deployed address is written to `contracts/evm/deployments/<chainId>.json`
— copy the relevant ones into the matching workflow's `config.*.json`
(`confirmationConsumerAddress`, `consumerAddress`, `lendingPoolAddress`, etc.).
