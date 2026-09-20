import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { lendingPoolAbi, lendingOracleConsumerAbi } from "@/generated/contracts";
import { addresses, isLendingConfigured } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";

const BPS_DENOMINATOR = 10_000n;

/**
 * The connected wallet's real LendingPool position, plus health-factor-style
 * analytics computed client-side from LendingOracleConsumer.latestRound() —
 * which, unlike LendingPool.collateralValueInDebtUnits()/
 * isUndercollateralized(), returns (0, 0, 0) rather than reverting when no
 * DON has ever reported a price. That lets this hook show real numbers the
 * instant a price ever lands, with no further code change, while showing an
 * honest "needs a live price feed" state until then instead of either
 * crashing or faking a number.
 */
export function useLendingPosition() {
  const { address: account } = useAccount();
  const { decimals: collDecimals, symbol: collSymbol } = useToken(addresses.collateralToken);
  const { decimals: debtDecimals, symbol: debtSymbol } = useToken(addresses.debtToken);

  const { data: position, isLoading: positionLoading } = useReadContract({
    address: addresses.lendingPool,
    abi: lendingPoolAbi,
    functionName: "positions",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(isLendingConfigured && addresses.lendingPool && account) },
  });

  const { data: staticData, isLoading: staticLoading } = useReadContracts({
    contracts: [
      { address: addresses.lendingPool, abi: lendingPoolAbi, functionName: "liquidationThresholdBps" },
      { address: addresses.lendingPool, abi: lendingPoolAbi, functionName: "collateralFeedId" },
    ],
    query: { enabled: Boolean(isLendingConfigured && addresses.lendingPool) },
  });

  const liquidationThresholdBps = staticData?.[0]?.result as bigint | undefined;
  const collateralFeedId = staticData?.[1]?.result as `0x${string}` | undefined;

  const { data: round, isLoading: priceLoading } = useReadContract({
    address: addresses.lendingOracleConsumer,
    abi: lendingOracleConsumerAbi,
    functionName: "latestRound",
    args: collateralFeedId ? [collateralFeedId] : undefined,
    query: { enabled: Boolean(isLendingConfigured && addresses.lendingOracleConsumer && collateralFeedId) },
  });

  const [collateralAmount, debtAmount] = position ?? [0n, 0n];
  const [price, priceDecimals, updatedAt] = round ?? [0n, 0, 0n];
  const hasPrice = updatedAt > 0n;

  let healthFactor: number | undefined;
  let ltvBps: bigint | undefined;
  let liquidationPrice: bigint | undefined;

  if (hasPrice && liquidationThresholdBps !== undefined) {
    // collateralValue is in debt-token units — same computation as
    // LendingPool.collateralValueInDebtUnits(), which assumes collateral and
    // debt tokens share decimals (see that function's own doc comment).
    const collateralValue = (collateralAmount * price) / 10n ** BigInt(priceDecimals);

    if (debtAmount > 0n) {
      // Scaled by 10_000 before the division so the truncating BigInt
      // division still keeps 2 decimal places of precision for display.
      const scaled = (collateralValue * liquidationThresholdBps * 10_000n) / (debtAmount * BPS_DENOMINATOR);
      healthFactor = Number(scaled) / 10_000;
      ltvBps = collateralValue > 0n ? (debtAmount * BPS_DENOMINATOR) / collateralValue : undefined;
      liquidationPrice =
        collateralAmount > 0n
          ? (debtAmount * BPS_DENOMINATOR * 10n ** BigInt(priceDecimals)) / (collateralAmount * liquidationThresholdBps)
          : undefined;
    }
  }

  return {
    collateralAmount,
    debtAmount,
    collDecimals,
    collSymbol,
    debtDecimals,
    debtSymbol,
    hasPosition: collateralAmount > 0n || debtAmount > 0n,
    liquidationThresholdBps,
    hasPrice,
    price,
    priceDecimals,
    healthFactor,
    ltvBps,
    liquidationPrice,
    isLoading: positionLoading || staticLoading || priceLoading,
  };
}
