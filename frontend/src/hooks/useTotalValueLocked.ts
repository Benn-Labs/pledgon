import { useMemo } from "react";
import { erc20Abi, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { escrowFactoryAbi, escrowVaultAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";

export type TokenLockedAmount = { token: Address; symbol: string; decimals: number; amount: bigint };

/**
 * Protocol-wide value currently held by DEEDS contracts: every EscrowVault's
 * token balance, plus LendingPool's collateral/debt balances. Deliberately
 * not collapsed into one number — there's no price oracle to convert, say,
 * MOCK and mCOL into a common unit, so summing them would just be wrong.
 * Reads each vault's *actual* token balance (not totalAmount()), since that
 * correctly reflects bonds/milestones already paid out.
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

  const lendingHoldings = [
    addresses.lendingPool && addresses.collateralToken ? { holder: addresses.lendingPool, token: addresses.collateralToken } : null,
    addresses.lendingPool && addresses.debtToken ? { holder: addresses.lendingPool, token: addresses.debtToken } : null,
  ].filter((h): h is { holder: Address; token: Address } => Boolean(h));

  const balanceQueries = [
    ...vaultTokens
      .filter((vt): vt is { vault: Address; token: Address } => Boolean(vt.token))
      .map(({ vault, token }) => ({ address: token, abi: erc20Abi, functionName: "balanceOf" as const, args: [vault] })),
    ...lendingHoldings.map(({ holder, token }) => ({ address: token, abi: erc20Abi, functionName: "balanceOf" as const, args: [holder] })),
  ];

  const { data: balanceResults, isLoading: balancesLoading } = useReadContracts({
    contracts: balanceQueries,
    query: { enabled: balanceQueries.length > 0 },
  });

  const uniqueTokens = useMemo(() => {
    const tokens = new Set<string>();
    vaultTokens.forEach((vt) => vt.token && tokens.add(vt.token));
    lendingHoldings.forEach((h) => tokens.add(h.token));
    return [...tokens] as Address[];
  }, [vaultTokens, lendingHoldings]);

  const { data: tokenMetaResults } = useReadContracts({
    contracts: uniqueTokens.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: "decimals" as const },
      { address: token, abi: erc20Abi, functionName: "symbol" as const },
    ]),
    query: { enabled: uniqueTokens.length > 0 },
  });

  const totals = useMemo(() => {
    const byToken = new Map<string, bigint>();
    let cursor = 0;
    for (const vt of vaultTokens) {
      if (!vt.token) continue;
      const balance = (balanceResults?.[cursor]?.result as bigint | undefined) ?? 0n;
      byToken.set(vt.token, (byToken.get(vt.token) ?? 0n) + balance);
      cursor++;
    }
    for (const h of lendingHoldings) {
      const balance = (balanceResults?.[cursor]?.result as bigint | undefined) ?? 0n;
      byToken.set(h.token, (byToken.get(h.token) ?? 0n) + balance);
      cursor++;
    }

    const result: TokenLockedAmount[] = [];
    uniqueTokens.forEach((token, i) => {
      const decimals = tokenMetaResults?.[i * 2]?.result as number | undefined;
      const symbol = tokenMetaResults?.[i * 2 + 1]?.result as string | undefined;
      const amount = byToken.get(token) ?? 0n;
      if (decimals !== undefined && symbol !== undefined && amount > 0n) {
        result.push({ token, symbol, decimals, amount });
      }
    });
    return result;
  }, [vaultTokens, lendingHoldings, balanceResults, uniqueTokens, tokenMetaResults]);

  return { totals, isLoading: balancesLoading };
}
