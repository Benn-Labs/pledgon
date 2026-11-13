import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

// Reads compiled ABIs straight from the Foundry build artifacts so the
// frontend never hand-copies or hand-maintains an ABI. Re-run `npm run
// wagmi:generate` after any contract change and `forge build`.
export default defineConfig({
  out: "src/generated/contracts.ts",
  plugins: [
    foundry({
      project: "../contracts/evm",
      include: [
        "Marketplace.sol/**",
        "EscrowFactory.sol/**",
        "EscrowVault.sol/**",
        "ArbitratorRegistry.sol/**",
        "ComplianceConsumer.sol/**",
        "LendingPool.sol/**",
        "LendingOracleConsumer.sol/**",
        "LiquidationConsumer.sol/**",
        "FlashArbV3.sol/**",
      ],
      // No `deployments` here — addresses differ per network and aren't known
      // at codegen time. Wired at runtime from NEXT_PUBLIC_* env vars instead
      // (see src/lib/addresses.ts).
      forge: {
        build: false,
      },
    }),
  ],
});
