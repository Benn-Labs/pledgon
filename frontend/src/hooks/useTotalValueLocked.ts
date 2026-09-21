import { useMemo } from "react";
import { erc20Abi, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { escrowFactoryAbi, escrowVaultAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";

export type TokenLockedAmount = { token: Address; symbol: string; decimals: number; amount: bigint };

/**
 * Protocol-wide value currently held by PLEDGON contracts, split by what kind
 * of value it actually is rather than merged into one undifferentiated list —
 * escrow vault balances, LendingPool's collateral, and LendingPool's
 * borrowable liquidity are three different things that happen to all be "an
 * ERC20 balance held by a PLEDGON contract," and showing them side by side
 * with no distinction reads as one pile of TVL when it isn't:
 *   - `escrow`: every EscrowVault's actual token balance (not totalAmount(),
 *     since that wouldn't reflect bonds/milestones already paid out) —
 *     payment currently in flight across trades.
 *   - `lendingCollateral`: LendingPool's collateralToken balance — deposited
 *     by borrowers, backing their debt. This is genuinely "locked": it isn't
 *     available to anyone until its owner withdraws or gets liquidated.
 *   - `lendingLiquidity`: LendingPool's debtToken balance — funds sitting in
 *     the pool available *to be borrowed*, not owned or locked by any single
 *     depositor. On this deployment it's testnet mUSD minted directly into
 *     the pool (LendingPool has no lender-deposit mechanism of its own yet),
 *     so this number says nothing about protocol activity — it's supply, not
 *     demand.
 *
 * Not collapsed into one combined figure within or across these groups
 * either — there's no price oracle here to convert different payment tokens
 * into a common unit, so summing them would just be wrong.
 */
export function useTotalValueLocked() {
  const { data: vaultCount } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "vaultCount",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const vaultIndices = useMemo(
    () => (vaultCount === undefined ? [] : Array.from({ length: Number(vaultCount) }, (_, i) => i)),
    [vaultCount],
  );

  const { data: vaultAddressResults } = useReadContracts({
    contracts: vaultIndices.map((i) => ({
      address: addresses.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: "allVaults" as const,
      args: [BigInt(i)],
    })),
    query: { enabled: vaultIndices.length > 0 },
  });

  const vaultAddresses = useMemo(
    () => (vaultAddressResults?.map((r) => r.result as Address | undefined).filter((v): v is Address => Boolean(v)) ?? []),
    [vaultAddressResults],
  );

  const { data: vaultTokenResults } = useReadContracts({
    contracts: vaultAddresses.map((v) => ({ address: v, abi: escrowVaultAbi, functionName: "token" as const })),
    query: { enabled: vaultAddresses.length > 0 },
  });

  const vaultTokens = useMemo(
    () => vaultAddresses.map((vault, i) => ({ vault, token: vaultTokenResults?.[i]?.result as Address | undefined })),
    [vaultAddresses, vaultTokenResults],
  );

  const vaultBalanceQueries = vaultTokens
    .filter((vt): vt is { vault: Address; token: Address } => Boolean(vt.token))
    .map(({ vault, token }) => ({ address: token, abi: erc20Abi, functionName: "balanceOf" as const, args: [vault] }));

  const { data: vaultBalanceResults, isLoading: vaultBalancesLoading } = useReadContracts({
    contracts: vaultBalanceQueries,
    query: { enabled: vaultBalanceQueries.length > 0 },
  });

  const uniqueVaultTokens = useMemo(() => {
    const tokens = new Set<string>();
    vaultTokens.forEach((vt) => vt.token && tokens.add(vt.token));
    return [...tokens] as Address[];
  }, [vaultTokens]);

  const { data: vaultTokenMetaResults } = useReadContracts({
    contracts: uniqueVaultTokens.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: "decimals" as const },
      { address: token, abi: erc20Abi, functionName: "symbol" as const },
    ]),
    query: { enabled: uniqueVaultTokens.length > 0 },
  });

  const escrow = useMemo(() => {
    const byToken = new Map<string, bigint>();
    vaultTokens.forEach((vt, i) => {
      if (!vt.token) return;
      const balance = (vaultBalanceResults?.[i]?.result as bigint | undefined) ?? 0n;
      byToken.set(vt.token, (byToken.get(vt.token) ?? 0n) + balance);
    });

    const result: TokenLockedAmount[] = [];
    uniqueVaultTokens.forEach((token, i) => {
      const decimals = vaultTokenMetaResults?.[i * 2]?.result as number | undefined;
      const symbol = vaultTokenMetaResults?.[i * 2 + 1]?.result as string | undefined;
      const amount = byToken.get(token) ?? 0n;
      if (decimals !== undefined && symbol !== undefined && amount > 0n) {
        result.push({ token, symbol, decimals, amount });
      }
    });
    return result;
  }, [vaultTokens, vaultBalanceResults, uniqueVaultTokens, vaultTokenMetaResults]);

  const lendingConfigured = Boolean(addresses.lendingPool && addresses.collateralToken && addresses.debtToken);

  const { data: lendingResults, isLoading: lendingLoading } = useReadContracts({
    contracts: lendingConfigured
      ? [
          { address: addresses.collateralToken, abi: erc20Abi, functionName: "balanceOf" as const, args: [addresses.lendingPool as Address] },
          { address: addresses.collateralToken, abi: erc20Abi, functionName: "decimals" as const },
          { address: addresses.collateralToken, abi: erc20Abi, functionName: "symbol" as const },
          { address: addresses.debtToken, abi: erc20Abi, functionName: "balanceOf" as const, args: [addresses.lendingPool as Address] },
          { address: addresses.debtToken, abi: erc20Abi, functionName: "decimals" as const },
          { address: addresses.debtToken, abi: erc20Abi, functionName: "symbol" as const },
        ]
      : [],
    query: { enabled: lendingConfigured },
  });

  const lendingCollateral = useMemo((): TokenLockedAmount | undefined => {
    if (!lendingConfigured || !addresses.collateralToken) return undefined;
    const amount = lendingResults?.[0]?.result as bigint | undefined;
    const decimals = lendingResults?.[1]?.result as number | undefined;
    const symbol = lendingResults?.[2]?.result as string | undefined;
    if (amount === undefined || decimals === undefined || symbol === undefined) return undefined;
    return { token: addresses.collateralToken, symbol, decimals, amount };
  }, [lendingConfigured, lendingResults]);

  const lendingLiquidity = useMemo((): TokenLockedAmount | undefined => {
    if (!lendingConfigured || !addresses.debtToken) return undefined;
    const amount = lendingResults?.[3]?.result as bigint | undefined;
    const decimals = lendingResults?.[4]?.result as number | undefined;
    const symbol = lendingResults?.[5]?.result as string | undefined;
    if (amount === undefined || decimals === undefined || symbol === undefined) return undefined;
    return { token: addresses.debtToken, symbol, decimals, amount };
  }, [lendingConfigured, lendingResults]);

  return {
    escrow,
    lendingCollateral,
    lendingLiquidity,
    isLoading: vaultBalancesLoading || (lendingConfigured && lendingLoading),
  };
}
