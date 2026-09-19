import type { Address } from "viem";

export const addresses = {
  marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS as Address | undefined,
  escrowFactory: process.env.NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS as Address | undefined,
  complianceConsumer: process.env.NEXT_PUBLIC_COMPLIANCE_CONSUMER_ADDRESS as Address | undefined,
  escrowConfirmationConsumer: process.env.NEXT_PUBLIC_ESCROW_CONFIRMATION_CONSUMER_ADDRESS as Address | undefined,
  // Lending is optional — not every deployment configures it (Deploy.s.sol
  // itself skips it unless both token addresses are set). Undefined here
  // means "not deployed on this network," not "misconfigured."
  lendingPool: process.env.NEXT_PUBLIC_LENDING_POOL_ADDRESS as Address | undefined,
  lendingOracleConsumer: process.env.NEXT_PUBLIC_LENDING_ORACLE_CONSUMER_ADDRESS as Address | undefined,
  liquidationConsumer: process.env.NEXT_PUBLIC_LIQUIDATION_CONSUMER_ADDRESS as Address | undefined,
  collateralToken: process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_ADDRESS as Address | undefined,
  debtToken: process.env.NEXT_PUBLIC_DEBT_TOKEN_ADDRESS as Address | undefined,
};

export const isLendingConfigured = Boolean(
  addresses.lendingPool && addresses.lendingOracleConsumer && addresses.liquidationConsumer,
);

export const missingAddressVars = Object.entries({
  NEXT_PUBLIC_MARKETPLACE_ADDRESS: addresses.marketplace,
  NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS: addresses.escrowFactory,
  NEXT_PUBLIC_COMPLIANCE_CONSUMER_ADDRESS: addresses.complianceConsumer,
  NEXT_PUBLIC_ESCROW_CONFIRMATION_CONSUMER_ADDRESS: addresses.escrowConfirmationConsumer,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);
