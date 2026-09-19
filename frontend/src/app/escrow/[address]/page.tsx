"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import type { Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { useToken } from "@/hooks/useToken";
import { formatToken } from "@/lib/format";
import { BondPanel } from "@/components/trade/BondPanel";
import { FundPanel } from "@/components/trade/FundPanel";
import { MilestoneRow } from "@/components/trade/MilestoneRow";
import { ArbiterPanel } from "@/components/trade/ArbiterPanel";
import { RoleBadge } from "@/components/ui/badges";

export default function TradePage() {
  const { address } = useParams<{ address: string }>();
  const vault = address as Address;
  const { address: account } = useAccount();

  const vaultContract = { address: vault, abi: escrowVaultAbi } as const;

  const { data, refetch } = useReadContracts({
    contracts: [
      { ...vaultContract, functionName: "buyer" },
      { ...vaultContract, functionName: "seller" },
      { ...vaultContract, functionName: "arbiter" },
      { ...vaultContract, functionName: "token" },
      { ...vaultContract, functionName: "bondAmount" },
      { ...vaultContract, functionName: "tier0Cap" },
      { ...vaultContract, functionName: "tier1Cap" },
      { ...vaultContract, functionName: "bondDeposited" },
      { ...vaultContract, functionName: "funded" },
      { ...vaultContract, functionName: "milestoneCount" },
      { ...vaultContract, functionName: "totalAmount" },
      { ...vaultContract, functionName: "bondBalance" },
    ],
  });

  const [
    buyer,
    seller,
    arbiter,
    token,
    bondAmount,
    tier0Cap,
    tier1Cap,
    bondDeposited,
    funded,
    milestoneCount,
    totalAmount,
    bondBalance,
  ] = (data?.map((d) => d.result) ?? []) as [
    Address | undefined,
    Address | undefined,
    Address | undefined,
    Address | undefined,
    bigint | undefined,
    bigint | undefined,
    bigint | undefined,
    boolean | undefined,
    boolean | undefined,
    bigint | undefined,
    bigint | undefined,
    bigint | undefined,
  ];

  const { decimals, symbol, isReady: tokenReady } = useToken(token);

  const milestoneIndices = useMemo(
    () => (milestoneCount === undefined ? [] : Array.from({ length: Number(milestoneCount) }, (_, i) => i)),
    [milestoneCount],
  );

  const { data: milestoneData, refetch: refetchMilestones } = useReadContracts({
    contracts: milestoneIndices.map((i) => ({ ...vaultContract, functionName: "milestones" as const, args: [BigInt(i)] })),
    query: { enabled: milestoneIndices.length > 0 },
  });

  function refetchAll() {
    refetch();
    refetchMilestones();
  }

  if (!buyer || !seller || !arbiter || !token) {
    return <p className="text-sm text-ink-400">Loading trade…</p>;
  }

  const isBuyer = account?.toLowerCase() === buyer.toLowerCase();
  const isSeller = account?.toLowerCase() === seller.toLowerCase();
  const isArbiter = account?.toLowerCase() === arbiter.toLowerCase();
  const role = isBuyer ? "buyer" : isSeller ? "seller" : isArbiter ? "arbiter" : undefined;

  const milestones = milestoneIndices.map((i) => {
    const result = milestoneData?.[i]?.result as readonly [bigint, number, `0x${string}`] | undefined;
    return { index: i, amount: result?.[0] ?? 0n, status: result?.[1] ?? 0, docHash: result?.[2] ?? ("0x" as const) };
  });

  return (
    <div className="fade-in max-w-5xl mx-auto">
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-2xl font-bold text-white">Trade</h1>
              {role && <RoleBadge role={role} />}
            </div>
            <p className="text-ink-400 text-sm">
              Escrow Vault: <span className="addr text-trust-400 font-mono">{vault}</span>
            </p>
          </div>
          {tokenReady && decimals !== undefined && (
            <div className="text-right">
              <div className="text-2xl font-bold font-mono text-white">{formatToken(totalAmount ?? 0n, decimals, symbol)}</div>
              <div className="text-sm text-ink-400">Total Value</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-ink-800/50 border border-ink-700 text-center">
            <div className="text-xs text-ink-400 mb-1">Buyer</div>
            <div className="addr text-ink-200 font-mono text-xs">
              {buyer.slice(0, 6)}…{buyer.slice(-4)}
            </div>
            {isBuyer && <div className="text-xs text-trust-400 mt-1">You</div>}
          </div>
          <div className="p-4 rounded-lg bg-ink-800/50 border border-ink-700 text-center">
            <div className="text-xs text-ink-400 mb-1">Seller</div>
            <div className="addr text-ink-200 font-mono text-xs">
              {seller.slice(0, 6)}…{seller.slice(-4)}
            </div>
            {isSeller && <div className="text-xs text-success-400 mt-1">You</div>}
          </div>
          <div className="p-4 rounded-lg bg-ink-800/50 border border-ink-700 text-center">
            <div className="text-xs text-ink-400 mb-1">Arbiter</div>
            <div className="addr text-ink-200 font-mono text-xs">
              {arbiter.slice(0, 6)}…{arbiter.slice(-4)}
            </div>
            {isArbiter && <div className="text-xs text-warning-400 mt-1">You</div>}
          </div>
        </div>
      </div>

      {tokenReady && decimals !== undefined && symbol && (
        <>
          <BondPanel
            vault={vault}
            seller={seller}
            token={token}
            bondAmount={bondAmount ?? 0n}
            bondDeposited={bondDeposited ?? false}
            decimals={decimals}
            symbol={symbol}
            onSuccess={refetchAll}
          />

          <FundPanel
            vault={vault}
            buyer={buyer}
            token={token}
            totalAmount={totalAmount ?? 0n}
            bondAmount={bondAmount ?? 0n}
            bondDeposited={bondDeposited ?? false}
            funded={funded ?? false}
            tier0Cap={tier0Cap ?? 0n}
            tier1Cap={tier1Cap ?? 0n}
            decimals={decimals}
            symbol={symbol}
            onSuccess={refetchAll}
          />

          <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
            <h2 className="font-semibold mb-6 text-white">Milestones</h2>
            <div className="space-y-4">
              {milestones.map((m) => (
                <MilestoneRow
                  key={m.index}
                  vault={vault}
                  index={m.index}
                  amount={m.amount}
                  status={m.status}
                  docHash={m.docHash}
                  buyer={buyer}
                  seller={seller}
                  funded={funded ?? false}
                  decimals={decimals}
                  symbol={symbol}
                  onSuccess={refetchAll}
                />
              ))}
            </div>
          </div>

          {isArbiter && (
            <ArbiterPanel
              vault={vault}
              buyer={buyer}
              milestones={milestones}
              bondAmount={bondAmount ?? 0n}
              bondBalance={bondBalance ?? 0n}
              decimals={decimals}
              symbol={symbol}
              onSuccess={refetchAll}
            />
          )}
        </>
      )}
    </div>
  );
}
