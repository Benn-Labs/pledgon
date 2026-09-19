import type { Address } from "viem";

export const addresses = {
  marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS as Address | undefined,
  escrowFactory: process.env.NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS as Address | undefined,
  complianceConsumer: process.env.NEXT_PUBLIC_COMPLIANCE_CONSUMER_ADDRESS as Address | undefined,
  escrowConfirmationConsumer: process.env.NEXT_PUBLIC_ESCROW_CONFIRMATION_CONSUMER_ADDRESS as Address | undefined,
};

export const missingAddressVars = Object.entries({
  NEXT_PUBLIC_MARKETPLACE_ADDRESS: addresses.marketplace,
  NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS: addresses.escrowFactory,
  NEXT_PUBLIC_COMPLIANCE_CONSUMER_ADDRESS: addresses.complianceConsumer,
  NEXT_PUBLIC_ESCROW_CONFIRMATION_CONSUMER_ADDRESS: addresses.escrowConfirmationConsumer,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);
