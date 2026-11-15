

import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { lendingPoolAbi, lendingOracleConsumerAbi } from "@/generated/contracts";
import { isLendingConfigured, lendingMarkets, type LendingMarket } from "@/lib/addresses";
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
 *
 * @param market The lending market to read. Defaults to the first configured
 * market for backward compatibility.
 */
export function useLendingPosition(market?: LendingMarket) {
  const selectedMarket = market ?? lendingMarkets[0];

  const { address: account } = useAccount();
  const { decimals: collDecimals, symbol: collSymbol } = useToken(selectedMarket?.collateralToken);
  const { decimals: debtDecimals, symbol: debtSymbol } = useToken(selectedMarket?.debtToken);

  const { data: position, isLoading: positionLoading } = useReadContract({
    address: selectedMarket?.lendingPool,
    abi: lendingPoolAbi,
    functionName: "positions",
    args: account && selectedMarket ? [account] : undefined,
    query: {
      enabled: Boolean(isLendingConfigured && selectedMarket?.lendingPool && account),
      refetchInterval: 15_000,
      staleTime: 5_000,
    },
  });

  const { data: staticData, isLoading: staticLoading } = useReadContracts({
    contracts: [
      { address: selectedMarket?.lendingPool, abi: lendingPoolAbi, functionName: "liquidationThresholdBps" },
      { address: selectedMarket?.lendingPool, abi: lendingPoolAbi, functionName: "collateralFeedId" },
      { address: selectedMarket?.lendingPool, abi: lendingPoolAbi, functionName: "maxUtilizationBps" },
    ],
    query: {
      enabled: Boolean(isLendingConfigured && selectedMarket?.lendingPool),
      refetchInterval: 15_000,
      staleTime: 5_000,
    },
  });

  const liquidationThresholdBps = staticData?.[0]?.result as bigint | undefined;
  const collateralFeedId = staticData?.[1]?.result as `0x${string}` | undefined;
  const maxUtilizationBps = staticData?.[2]?.result as bigint | undefined;

  const { data: round, isLoading: priceLoading } = useReadContract({
    address: selectedMarket?.lendingOracleConsumer,
    abi: lendingOracleConsumerAbi,
    functionName: "latestRound",
    args: collateralFeedId && selectedMarket ? [collateralFeedId] : undefined,
    query: {
      enabled: Boolean(isLendingConfigured && selectedMarket?.lendingOracleConsumer && collateralFeedId),
      refetchInterval: 15_000,
      staleTime: 5_000,
    },
  });

  if (!selectedMarket) {
    return {
      collateralAmount: 0n,
      debtAmount: 0n,
      collDecimals: undefined,
      collSymbol: undefined,
      debtDecimals: undefined,
      debtSymbol: undefined,
      hasPosition: false,
      liquidationThresholdBps: undefined,
      maxUtilizationBps: undefined,
      hasPrice: false,
      price: 0n,
      priceDecimals: 0,
      priceUpdatedAt: 0n,
      healthFactor: undefined,
      ltvBps: undefined,
      liquidationPrice: undefined,
      isLoading: false,
    };
  }

  const [collateralAmount, debtAmount] = position ?? [0n, 0n];
  const [price, priceDecimals, updatedAt] = round ?? [0n, 0, 0n];
  const hasPrice = updatedAt > 0n;

  let healthFactor: number | undefined;
  let ltvBps: bigint | undefined;
  let liquidationPrice: bigint | undefined;

  if (hasPrice && liquidationThresholdBps !== undefined) {
    // collateralValue is in debt-token units — same computation as
    // LendingPool.collateralValueInDebtUnits(), which now handles differing
    // collateral and debt token decimals.
    let collateralValue = (collateralAmount * price) / 10n ** BigInt(priceDecimals);
    if (collDecimals !== undefined && debtDecimals !== undefined) {
      if (collDecimals > debtDecimals) {
        collateralValue = collateralValue / 10n ** BigInt(collDecimals - debtDecimals);
      } else if (collDecimals < debtDecimals) {
        collateralValue = collateralValue * 10n ** BigInt(debtDecimals - collDecimals);
      }
    }

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
    maxUtilizationBps,
    hasPrice,
    price,
    priceDecimals,
    /** Unix seconds the oracle last reported a price — 0n until the first report lands. */
    priceUpdatedAt: updatedAt,
    healthFactor,
    ltvBps,
    liquidationPrice,
    isLoading: positionLoading || staticLoading || priceLoading,
  };
}
