"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isAddress, zeroAddress, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { escrowFactoryAbi, escrowVaultAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { formatToken } from "@/lib/format";
import { BondPanel } from "@/components/trade/BondPanel";
import { FundPanel } from "@/components/trade/FundPanel";
import { FundingDeadlinePanel } from "@/components/trade/FundingDeadlinePanel";
import { MilestoneRow } from "@/components/trade/MilestoneRow";
import { ArbiterPanel } from "@/components/trade/ArbiterPanel";
import { ExitTradePanel } from "@/components/trade/ExitTradePanel";
import { RoleBadge, TradeStatusBadge } from "@/components/ui/badges";
import { CountdownBadge } from "@/components/ui/CountdownBadge";
import { deriveTradeStatus, deriveCurrentDeadline } from "@/lib/tradeStatus";
import { useEscrowMetadata } from "@/hooks/useEscrowMetadata";
import { EditTradeDescription } from "@/components/trade/EditTradeDescription";

function TradeNotFound({ address }: { address?: string }) {
  return (
    <div className="fade-in max-w-5xl mx-auto">
      <Link href="/escrow" className="flex items-center gap-2 text-ink-400 hover:text-white mb-6 w-fit">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Escrow
      </Link>
      <div className="p-8 rounded-xl bg-ink-900 border border-ink-800 text-center">
        <h1 className="text-xl font-display text-white mb-2">Trade not found</h1>
        <p className="text-sm text-ink-400">
          {address ? (
            <>
              No escrow vault at <span className="addr text-trust-400 font-mono">{address}</span> — double-check the address.
            </>
          ) : (
            "That doesn't look like a vault address."
          )}
        </p>
      </div>
    </div>
  );
}

export default function TradePage() {
  const { address } = useParams<{ address: string }>();
  const vault = isAddress(address) ? (address as Address) : undefined;
  const { address: account } = useAccount();

  // Same validity check as the VaultLookup on the escrow list page: only
  // addresses EscrowFactory actually deployed render as trades, anything
  // else gets an explicit not-found state instead of an eternal spinner.
  const { data: isVault } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "isVault",
    args: vault ? [vault] : undefined,
    query: { enabled: Boolean(addresses.escrowFactory && vault) },
  });

  const vaultContract = { address: vault ?? zeroAddress, abi: escrowVaultAbi } as const;
  const { description: tradeDescription, milestoneLabels, isLoading: metadataLoading } = useEscrowMetadata(vault ?? zeroAddress);

  const { data, refetch, isLoading: isReadingTrade } = useReadContracts({
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
      { ...vaultContract, functionName: "cancelled" },
      { ...vaultContract, functionName: "tradeExitProposal" },
      { ...vaultContract, functionName: "fundingDeadline" },
    ],
    query: {
      enabled: Boolean(vault) && (addresses.escrowFactory === undefined || isVault === true),
    },
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
    cancelled,
    tradeExitProposalResult,
    fundingDeadline,
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
    boolean | undefined,
    readonly [Address, boolean] | undefined,
    bigint | undefined,
  ];

  const tradeExitProposal = tradeExitProposalResult
    ? { proposedBy: tradeExitProposalResult[0], active: tradeExitProposalResult[1] }
    : undefined;

  const { decimals, symbol, isReady: tokenReady } = useToken(token);

  const milestoneIndices = useMemo(
    () => (milestoneCount === undefined ? [] : Array.from({ length: Number(milestoneCount) }, (_, i) => i)),
    [milestoneCount],
  );

  const { data: milestoneData, refetch: refetchMilestones } = useReadContracts({
    contracts: milestoneIndices.map((i) => ({ ...vaultContract, functionName: "milestones" as const, args: [BigInt(i)] })),
    query: { enabled: milestoneIndices.length > 0 },
  });

  const { data: settlementData, refetch: refetchSettlements } = useReadContracts({
    contracts: milestoneIndices.map((i) => ({
      ...vaultContract,
      functionName: "settlementProposals" as const,
      args: [BigInt(i)],
    })),
    query: { enabled: milestoneIndices.length > 0 },
  });

  const { data: milestoneDeadlineData, refetch: refetchMilestoneDeadlines } = useReadContracts({
    contracts: milestoneIndices.map((i) => ({
      ...vaultContract,
      functionName: "milestoneDeadline" as const,
      args: [BigInt(i)],
    })),
    query: { enabled: milestoneIndices.length > 0 },
  });

  const { data: deliveryDeadlineData, refetch: refetchDeliveryDeadlines } = useReadContracts({
    contracts: milestoneIndices.map((i) => ({
      ...vaultContract,
      functionName: "deliveryDeadline" as const,
      args: [BigInt(i)],
    })),
    query: { enabled: milestoneIndices.length > 0 },
  });

  function refetchAll() {
    refetch();
    refetchMilestones();
    refetchSettlements();
    refetchMilestoneDeadlines();
    refetchDeliveryDeadlines();
  }

  if (vault === undefined || isVault === false) {
    return <TradeNotFound address={address} />;
  }
  if (addresses.escrowFactory && isVault !== true) {
    return <p className="text-sm text-ink-400">Loading trade…</p>;
  }
  if (!buyer || !seller || !arbiter || !token) {
    // The reads are enabled by now, so a settled multicall that returned no
    // parties means the address is a valid contract that isn't an escrow
    // vault (or the RPC dropped the batch) — same not-found state instead
    // of hanging on "Loading trade…" forever.
    if (!isReadingTrade) return <TradeNotFound address={address} />;
    return <p className="text-sm text-ink-400">Loading trade…</p>;
  }

  const isBuyer = account?.toLowerCase() === buyer.toLowerCase();
  const isSeller = account?.toLowerCase() === seller.toLowerCase();
  const hasArbiter = arbiter.toLowerCase() !== zeroAddress;
  const isArbiter = hasArbiter && account?.toLowerCase() === arbiter.toLowerCase();
  const role = isBuyer ? "buyer" : isSeller ? "seller" : isArbiter ? "arbiter" : undefined;

  const milestones = milestoneIndices.map((i) => {
    const result = milestoneData?.[i]?.result as readonly [bigint, number, `0x${string}`, bigint] | undefined;
    const proposalResult = settlementData?.[i]?.result as readonly [number, Address, boolean] | undefined;
    const settlementProposal = proposalResult
      ? { sellerBps: proposalResult[0], proposedBy: proposalResult[1], active: proposalResult[2] }
      : undefined;
    return {
      index: i,
      amount: result?.[0] ?? 0n,
      status: result?.[1] ?? 0,
      docHash: result?.[2] ?? ("0x" as const),
      settlementProposal,
      deadline: milestoneDeadlineData?.[i]?.result as bigint | undefined,
      deliveryDeadline: deliveryDeadlineData?.[i]?.result as bigint | undefined,
    };
  });

  const lifecycleStatus =
    bondDeposited !== undefined && funded !== undefined
      ? deriveTradeStatus({
          bondAmount: bondAmount ?? 0n,
          bondDeposited,
          funded,
          cancelled,
          milestoneStatuses: milestones.map((m) => m.status),
        })
      : undefined;

  const currentDeadline =
    funded !== undefined
      ? deriveCurrentDeadline({
          funded,
          cancelled,
          fundingDeadline,
          milestoneStatuses: milestones.map((m) => m.status),
          milestoneDeadlines: milestones.map((m) => m.deadline),
          deliveryDeadlines: milestones.map((m) => m.deliveryDeadline),
        })
      : undefined;

  return (
    <div className="fade-in max-w-5xl mx-auto">
      <Link href="/escrow" className="flex items-center gap-2 text-ink-400 hover:text-white mb-6 w-fit">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Escrow
      </Link>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-3xl font-display text-white">Trade</h1>
              {lifecycleStatus && <TradeStatusBadge status={lifecycleStatus} />}
              {role && <RoleBadge role={role} />}
              {currentDeadline && <CountdownBadge deadline={currentDeadline.deadline} label={currentDeadline.label} />}
            </div>
            <p className="text-ink-400 text-sm">
              Escrow Vault: <span className="addr text-trust-400 font-mono">{vault}</span>
            </p>
            {(isBuyer || isSeller) && !metadataLoading ? (
              <EditTradeDescription vault={vault} description={tradeDescription} />
            ) : (
              tradeDescription && <p className="text-sm text-ink-300 mt-2 max-w-lg">{tradeDescription}</p>
            )}
          </div>
          {tokenReady && decimals !== undefined && (
            <div className="text-right">
              <div className="text-2xl font-bold font-mono text-white">{formatToken(totalAmount ?? 0n, decimals, symbol)}</div>
              <div className="text-sm text-ink-400">Total Value</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] text-center">
            <div className="text-xs text-ink-400 mb-1">Buyer</div>
            <div className="addr text-ink-200 font-mono text-xs">
              {buyer.slice(0, 6)}…{buyer.slice(-4)}
            </div>
            {isBuyer && <div className="text-xs text-trust-400 mt-1">You</div>}
          </div>
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] text-center">
            <div className="text-xs text-ink-400 mb-1">Seller</div>
            <div className="addr text-ink-200 font-mono text-xs">
              {seller.slice(0, 6)}…{seller.slice(-4)}
            </div>
            {isSeller && <div className="text-xs text-success-400 mt-1">You</div>}
          </div>
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] text-center">
            <div className="text-xs text-ink-400 mb-1">Arbiter</div>
            {hasArbiter ? (
              <>
                <div className="addr text-ink-200 font-mono text-xs">
                  {arbiter.slice(0, 6)}…{arbiter.slice(-4)}
                </div>
                {isArbiter && <div className="text-xs text-warning-400 mt-1">You</div>}
              </>
            ) : (
              <div className="text-xs text-ink-500 italic">None — mutual settlement only</div>
            )}
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

          <FundingDeadlinePanel
            vault={vault}
            fundingDeadline={fundingDeadline ?? 0n}
            funded={funded ?? false}
            cancelled={cancelled ?? false}
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
                  hasArbiter={hasArbiter}
                  decimals={decimals}
                  symbol={symbol}
                  settlementProposal={m.settlementProposal}
                  label={milestoneLabels[m.index]}
                  milestoneDeadline={m.deadline}
                  deliveryDeadline={m.deliveryDeadline}
                  onSuccess={refetchAll}
                />
              ))}
            </div>
          </div>

          {(isBuyer || isSeller) && lifecycleStatus !== "Completed" && (
            <ExitTradePanel
              vault={vault}
              buyer={buyer}
              seller={seller}
              funded={funded ?? false}
              cancelled={cancelled ?? false}
              exitProposal={tradeExitProposal}
              onSuccess={refetchAll}
            />
          )}

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
