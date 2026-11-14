import type { Address } from "viem";

export type LendingMarket = {
  id: string;
  name: string;
  lendingPool: Address;
  lendingOracleConsumer: Address;
  liquidationConsumer: Address;
  collateralToken: Address;
  debtToken: Address;
};

function optionalAddress(env: string | undefined): Address | undefined {
  return env && env.startsWith("0x") ? (env as Address) : undefined;
}

function marketFromEnv(prefix: string): LendingMarket | undefined {
  const lendingPool = optionalAddress(process.env[`NEXT_PUBLIC_${prefix}_LENDING_POOL_ADDRESS`]);
  const lendingOracleConsumer = optionalAddress(process.env[`NEXT_PUBLIC_${prefix}_LENDING_ORACLE_CONSUMER_ADDRESS`]);
  const liquidationConsumer = optionalAddress(process.env[`NEXT_PUBLIC_${prefix}_LIQUIDATION_CONSUMER_ADDRESS`]);
  const collateralToken = optionalAddress(process.env[`NEXT_PUBLIC_${prefix}_COLLATERAL_TOKEN_ADDRESS`]);
  const debtToken = optionalAddress(process.env[`NEXT_PUBLIC_${prefix}_DEBT_TOKEN_ADDRESS`]);

  if (!lendingPool || !lendingOracleConsumer || !liquidationConsumer || !collateralToken || !debtToken) {
    return undefined;
  }

  return {
    id: prefix.toLowerCase(),
    name: process.env[`NEXT_PUBLIC_${prefix}_MARKET_NAME`] || `${prefix} Market`,
    lendingPool,
    lendingOracleConsumer,
    liquidationConsumer,
    collateralToken,
    debtToken,
  };
}

function primaryMarketFromLegacyEnv(): LendingMarket | undefined {
  const lendingPool = optionalAddress(process.env.NEXT_PUBLIC_LENDING_POOL_ADDRESS);
  const lendingOracleConsumer = optionalAddress(process.env.NEXT_PUBLIC_LENDING_ORACLE_CONSUMER_ADDRESS);
  const liquidationConsumer = optionalAddress(process.env.NEXT_PUBLIC_LIQUIDATION_CONSUMER_ADDRESS);
  const collateralToken = optionalAddress(process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_ADDRESS);
  const debtToken = optionalAddress(process.env.NEXT_PUBLIC_DEBT_TOKEN_ADDRESS);

  if (!lendingPool || !lendingOracleConsumer || !liquidationConsumer || !collateralToken || !debtToken) {
    return undefined;
  }

  return {
    id: "rwa",
    name: process.env.NEXT_PUBLIC_RWA_MARKET_NAME || "RWA / mUSD",
    lendingPool,
    lendingOracleConsumer,
    liquidationConsumer,
    collateralToken,
    debtToken,
  };
}

/**
 * Lending markets configured for this deployment.
 *
 * The legacy single-market env vars (without a prefix) define the primary
 * "RWA" market for backward compatibility. Additional markets can be added
 * with prefixed env vars, e.g.:
 *
 *   NEXT_PUBLIC_XSTOCKS_LENDING_POOL_ADDRESS=...
 *   NEXT_PUBLIC_XSTOCKS_COLLATERAL_TOKEN_ADDRESS=...
 *   NEXT_PUBLIC_XSTOCKS_DEBT_TOKEN_ADDRESS=...
 *   NEXT_PUBLIC_XSTOCKS_MARKET_NAME="XStocks / USDC"
 *
 * Each market is an isolated LendingPool contract; the UI lets the user pick
 * which one to interact with.
 */
export const lendingMarkets: LendingMarket[] = [
  primaryMarketFromLegacyEnv(),
  marketFromEnv("XSTOCKS"),
  marketFromEnv("SUSDE"),
].filter((m): m is LendingMarket => m !== undefined);

// Temporary debug: server terminal + browser console should both show these.
function debugEnv(prefix: string) {
  return {
    pool: process.env[`NEXT_PUBLIC_${prefix}_LENDING_POOL_ADDRESS`],
    oracle: process.env[`NEXT_PUBLIC_${prefix}_LENDING_ORACLE_CONSUMER_ADDRESS`],
    liquidation: process.env[`NEXT_PUBLIC_${prefix}_LIQUIDATION_CONSUMER_ADDRESS`],
    collateral: process.env[`NEXT_PUBLIC_${prefix}_COLLATERAL_TOKEN_ADDRESS`],
    debt: process.env[`NEXT_PUBLIC_${prefix}_DEBT_TOKEN_ADDRESS`],
    market: marketFromEnv(prefix),
  };
}
// eslint-disable-next-line no-console
console.log("[lending markets debug]", {
  xstocks: debugEnv("XSTOCKS"),
  susde: debugEnv("SUSDE"),
  marketCount: lendingMarkets.length,
});

/**
 * Backward-compatible single-market addresses object. Reflects the first
 * configured lending market (or undefined if none are configured).
 * Prefer passing a specific LendingMarket to hooks; this is kept for any
 * code that has not yet been migrated.
 */
export const addresses = {
  marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS as Address | undefined,
  escrowFactory: process.env.NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS as Address | undefined,
  complianceConsumer: process.env.NEXT_PUBLIC_COMPLIANCE_CONSUMER_ADDRESS as Address | undefined,
  escrowConfirmationConsumer: process.env.NEXT_PUBLIC_ESCROW_CONFIRMATION_CONSUMER_ADDRESS as Address | undefined,
  lendingPool: lendingMarkets[0]?.lendingPool,
  lendingOracleConsumer: lendingMarkets[0]?.lendingOracleConsumer,
  liquidationConsumer: lendingMarkets[0]?.liquidationConsumer,
  collateralToken: lendingMarkets[0]?.collateralToken,
  debtToken: lendingMarkets[0]?.debtToken,
  mockToken: process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS as Address | undefined,
};

export const isLendingConfigured = lendingMarkets.length > 0;

export const missingAddressVars = Object.entries({
  NEXT_PUBLIC_MARKETPLACE_ADDRESS: addresses.marketplace,
  NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS: addresses.escrowFactory,
  NEXT_PUBLIC_COMPLIANCE_CONSUMER_ADDRESS: addresses.complianceConsumer,
  NEXT_PUBLIC_ESCROW_CONFIRMATION_CONSUMER_ADDRESS: addresses.escrowConfirmationConsumer,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);
