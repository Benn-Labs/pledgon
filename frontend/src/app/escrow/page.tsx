"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { erc20Abi, isAddress, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { escrowFactoryAbi, escrowVaultAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useMyVaults, type VaultCreatedEvent } from "@/hooks/useMyVaults";
import { formatToken, formatVaultNumber } from "@/lib/format";
import {
  deriveTradeStatus,
  deriveTradeProgress,
  deriveCurrentDeadline,
  type TradeLifecycleStatus,
  type TradeProgress,
  type CurrentDeadline,
} from "@/lib/tradeStatus";
import { TradeStatusBadge } from "@/components/ui/badges";
import { TradeProgressBar } from "@/components/ui/TradeProgressBar";
import { CountdownBadge } from "@/components/ui/CountdownBadge";
import { EscrowIcon } from "@/components/ui/icons";
import { useEscrowMetadataMap } from "@/hooks/useEscrowMetadataMap";
import { useListingTitleByVault } from "@/hooks/useListingTitleByVault";

/**
 * The trade detail page (/escrow/[address]) already renders any vault
 * address read-only, regardless of whether the connected wallet is a party
 * to it — there was just no way to reach one you weren't already listed on
 * without someone sending you the exact link. This closes that gap: paste
 * an address, confirm EscrowFactory actually deployed it, then navigate.
 */
function VaultLookup() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [checkedAddress, setCheckedAddress] = useState<Address | undefined>();

  const { data: isVault, isFetching } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "isVault",
    args: checkedAddress ? [checkedAddress] : undefined,
    query: { enabled: Boolean(addresses.escrowFactory && checkedAddress) },
  });

  const notFound = checkedAddress !== undefined && isVault === false && !isFetching;

  function submit() {
    if (!isAddress(input)) return;
    setCheckedAddress(input as Address);
  }

  useEffect(() => {
    if (isVault === true && checkedAddress) router.push(`/escrow/${checkedAddress}`);
  }, [isVault, checkedAddress, router]);

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-xl p-5 mb-6">
      <label className="block text-sm font-medium mb-2">Look Up a Vault</label>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 font-mono text-sm focus:outline-none focus:border-trust-500"
          placeholder="0x… vault address"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setCheckedAddress(undefined);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button
          onClick={submit}
          disabled={!isAddress(input) || isFetching}
          className="btn-press px-4 py-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 disabled:opacity-40 text-white text-sm font-medium shrink-0"
        >
          {isFetching ? "Checking…" : "Open"}
        </button>
      </div>
      {notFound && (
        <p className="text-xs text-danger-400 mt-2">
          Not a vault this EscrowFactory deployed — double-check the address.
        </p>
      )}
      <p className="text-xs text-ink-500 mt-2">
        View any trade by its vault address, not just ones you&apos;re a party to — everything shown is on-chain and
        readable by anyone.
      </p>
    </div>
  );
}

function VaultCard({
  entry,
  role,
  status,
  progress,
  deadline,
  description,
  decimals,
  symbol,
}: {
  entry: VaultCreatedEvent;
  role: "buyer" | "seller" | "arbiter";
  status: TradeLifecycleStatus | undefined;
  progress: TradeProgress | undefined;
  deadline: CurrentDeadline | undefined;
  description: string | undefined;
  decimals: number | undefined;
  symbol: string | undefined;
}) {
  const counterpart =
    role === "buyer" ? { label: "Seller", address: entry.seller } : { label: "Buyer", address: entry.buyer };

  return (
    <Link
      href={`/escrow/${entry.vault}`}
      className="deal-card block bg-ink-900 border border-ink-800 rounded-xl p-5"
    >
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {status ? <TradeStatusBadge status={status} size="sm" /> : <span className="text-xs text-ink-500">Loading…</span>}
          {deadline && <CountdownBadge deadline={deadline.deadline} label={deadline.label} />}
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-ink-300 font-mono">{formatVaultNumber(entry.index)}</div>
          <div className="text-[10px] text-ink-600 font-mono">
            {entry.vault.slice(0, 6)}…{entry.vault.slice(-4)}
          </div>
        </div>
      </div>
      <div className="text-sm text-ink-400 mb-1">
        {role === "arbiter" ? "Buyer / Seller" : counterpart.label}
      </div>
      <div className="font-mono text-sm text-ink-200 mb-4">
        {role === "arbiter" ? (
          <>
            {entry.buyer.slice(0, 6)}…{entry.buyer.slice(-4)} / {entry.seller.slice(0, 6)}…{entry.seller.slice(-4)}
          </>
        ) : (
          <>
            {counterpart.address.slice(0, 6)}…{counterpart.address.slice(-4)}
          </>
        )}
      </div>
      {description && <p className="text-xs text-ink-500 -mt-2 mb-4 line-clamp-2">{description}</p>}
      {progress && <TradeProgressBar progress={progress} />}
      {decimals !== undefined && (
        <div className="pt-3 mt-4 border-t border-ink-800 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-ink-400">Trade Value</span>
            <span className="font-mono text-ink-100">{formatToken(entry.totalAmount, decimals, symbol)}</span>
          </div>
          {entry.bondAmount > 0n && (
            <div className="flex justify-between text-sm">
              <span className="text-ink-400">Bond</span>
              <span className="font-mono text-warning-400">{formatToken(entry.bondAmount, decimals, symbol)}</span>
            </div>
          )}
        </div>
      )}
    </Link>
  );
}

function VaultSection({
  title,
  role,
  entries,
  statusByVault,
  progressByVault,
  deadlineByVault,
  descriptionByVault,
  tokenInfo,
}: {
  title: string;
  role: "buyer" | "seller" | "arbiter";
  entries: VaultCreatedEvent[];
  statusByVault: Map<string, TradeLifecycleStatus>;
  progressByVault: Map<string, TradeProgress>;
  deadlineByVault: Map<string, CurrentDeadline>;
  descriptionByVault: Map<string, string>;
  tokenInfo: Map<string, { decimals: number; symbol: string }>;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="mb-8">
      <h2 className="font-semibold text-white mb-4">
        {title} <span className="text-ink-500 font-normal">({entries.length})</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {entries.map((entry) => {
          const info = tokenInfo.get(entry.token.toLowerCase());
          return (
            <VaultCard
              key={entry.vault}
              entry={entry}
              role={role}
              status={statusByVault.get(entry.vault.toLowerCase())}
              progress={progressByVault.get(entry.vault.toLowerCase())}
              deadline={deadlineByVault.get(entry.vault.toLowerCase())}
              description={descriptionByVault.get(entry.vault.toLowerCase())}
              decimals={info?.decimals}
              symbol={info?.symbol}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function EscrowListPage() {
  const { isConnected } = useAccount();
  const { data, isLoading } = useMyVaults();

  const allMine = useMemo(() => {
    const map = new Map<string, VaultCreatedEvent>();
    for (const v of [...(data?.asBuyer ?? []), ...(data?.asSeller ?? []), ...(data?.asArbiter ?? [])]) {
      map.set(v.vault.toLowerCase(), v);
    }
    return [...map.values()];
  }, [data]);

  const { data: scalarResults } = useReadContracts({
    contracts: allMine.flatMap((v) => [
      { address: v.vault, abi: escrowVaultAbi, functionName: "funded" as const },
      { address: v.vault, abi: escrowVaultAbi, functionName: "bondDeposited" as const },
      { address: v.vault, abi: escrowVaultAbi, functionName: "milestoneCount" as const },
      { address: v.vault, abi: escrowVaultAbi, functionName: "cancelled" as const },
      { address: v.vault, abi: escrowVaultAbi, functionName: "fundingDeadline" as const },
    ]),
    query: { enabled: allMine.length > 0 },
  });

  const perVaultScalars = useMemo(
    () =>
      allMine.map((v, i) => ({
        vault: v,
        funded: scalarResults?.[i * 5]?.result as boolean | undefined,
        bondDeposited: scalarResults?.[i * 5 + 1]?.result as boolean | undefined,
        milestoneCount: scalarResults?.[i * 5 + 2]?.result as bigint | undefined,
        cancelled: scalarResults?.[i * 5 + 3]?.result as boolean | undefined,
        fundingDeadline: scalarResults?.[i * 5 + 4]?.result as bigint | undefined,
      })),
    [allMine, scalarResults],
  );

  const milestoneQueries = useMemo(
    () =>
      perVaultScalars.flatMap(({ vault, milestoneCount }) =>
        milestoneCount === undefined
          ? []
          : Array.from({ length: Number(milestoneCount) }, (_, i) => ({
              address: vault.vault,
              abi: escrowVaultAbi,
              functionName: "milestones" as const,
              args: [BigInt(i)] as const,
            })),
      ),
    [perVaultScalars],
  );

  const { data: milestoneResults } = useReadContracts({
    contracts: milestoneQueries,
    query: { enabled: milestoneQueries.length > 0 },
  });

  // Parallel to milestoneQueries (same shape, same order) — kept as its own
  // call rather than interleaved into milestoneQueries so both stay a simple
  // one-function-per-entry batch instead of needing per-entry disambiguation.
  const milestoneDeadlineQueries = useMemo(
    () =>
      perVaultScalars.flatMap(({ vault, milestoneCount }) =>
        milestoneCount === undefined
          ? []
          : Array.from({ length: Number(milestoneCount) }, (_, i) => ({
              address: vault.vault,
              abi: escrowVaultAbi,
              functionName: "milestoneDeadline" as const,
              args: [BigInt(i)] as const,
            })),
      ),
    [perVaultScalars],
  );

  const { data: milestoneDeadlineResults } = useReadContracts({
    contracts: milestoneDeadlineQueries,
    query: { enabled: milestoneDeadlineQueries.length > 0 },
  });

  // Parallel to milestoneQueries too — the Pending-side mirror of
  // milestoneDeadlineQueries above.
  const deliveryDeadlineQueries = useMemo(
    () =>
      perVaultScalars.flatMap(({ vault, milestoneCount }) =>
        milestoneCount === undefined
          ? []
          : Array.from({ length: Number(milestoneCount) }, (_, i) => ({
              address: vault.vault,
              abi: escrowVaultAbi,
              functionName: "deliveryDeadline" as const,
              args: [BigInt(i)] as const,
            })),
      ),
    [perVaultScalars],
  );

  const { data: deliveryDeadlineResults } = useReadContracts({
    contracts: deliveryDeadlineQueries,
    query: { enabled: deliveryDeadlineQueries.length > 0 },
  });

  const { statusByVault, progressByVault, deadlineByVault } = useMemo(() => {
    const statusMap = new Map<string, TradeLifecycleStatus>();
    const progressMap = new Map<string, TradeProgress>();
    const deadlineMap = new Map<string, CurrentDeadline>();
    let flatIndex = 0;
    for (const { vault, funded, bondDeposited, milestoneCount, cancelled, fundingDeadline } of perVaultScalars) {
      const statuses: number[] = [];
      const milestoneDeadlines: (bigint | undefined)[] = [];
      const deliveryDeadlines: (bigint | undefined)[] = [];
      for (let i = 0; i < Number(milestoneCount ?? 0n); i++) {
        const result = milestoneResults?.[flatIndex]?.result as readonly [bigint, number, `0x${string}`, bigint] | undefined;
        if (result) statuses.push(result[1]);
        milestoneDeadlines.push(milestoneDeadlineResults?.[flatIndex]?.result as bigint | undefined);
        deliveryDeadlines.push(deliveryDeadlineResults?.[flatIndex]?.result as bigint | undefined);
        flatIndex++;
      }
      if (funded === undefined || bondDeposited === undefined) continue;
      const key = vault.vault.toLowerCase();
      statusMap.set(
        key,
        deriveTradeStatus({ bondAmount: vault.bondAmount, bondDeposited, funded, cancelled, milestoneStatuses: statuses }),
      );
      progressMap.set(
        key,
        deriveTradeProgress({ bondAmount: vault.bondAmount, bondDeposited, funded, cancelled, milestoneStatuses: statuses }),
      );
      const deadline = deriveCurrentDeadline({
        funded,
        cancelled,
        fundingDeadline,
        milestoneStatuses: statuses,
        milestoneDeadlines,
        deliveryDeadlines,
      });
      if (deadline) deadlineMap.set(key, deadline);
    }
    return { statusByVault: statusMap, progressByVault: progressMap, deadlineByVault: deadlineMap };
  }, [perVaultScalars, milestoneResults, milestoneDeadlineResults, deliveryDeadlineResults]);

  const escrowDescriptionByVault = useEscrowMetadataMap(useMemo(() => allMine.map((v) => v.vault), [allMine]));
  const listingTitleByVault = useListingTitleByVault();
  // A trade opened via Marketplace.purchase() has no escrow-level
  // description of its own — its identifying text is the listing's Title
  // instead, so prefer that when both exist.
  const descriptionByVault = useMemo(() => {
    const map = new Map<string, string>();
    for (const [vault, description] of escrowDescriptionByVault) map.set(vault, description);
    for (const [vault, title] of listingTitleByVault) map.set(vault, title);
    return map;
  }, [escrowDescriptionByVault, listingTitleByVault]);

  const uniqueTokens = useMemo(() => [...new Set(allMine.map((v) => v.token.toLowerCase()))] as Address[], [allMine]);

  const { data: tokenResults } = useReadContracts({
    contracts: uniqueTokens.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: "decimals" as const },
      { address: token, abi: erc20Abi, functionName: "symbol" as const },
    ]),
    query: { enabled: uniqueTokens.length > 0 },
  });

  const tokenInfo = useMemo(() => {
    const map = new Map<string, { decimals: number; symbol: string }>();
    uniqueTokens.forEach((token, i) => {
      const decimals = tokenResults?.[i * 2]?.result as number | undefined;
      const symbol = tokenResults?.[i * 2 + 1]?.result as string | undefined;
      if (decimals !== undefined && symbol !== undefined) map.set(token, { decimals, symbol });
    });
    return map;
  }, [uniqueTokens, tokenResults]);

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Escrow</h1>
          <p className="text-ink-400 mt-1">Every trade you&apos;re a party to — as buyer, seller, or arbiter</p>
        </div>
        <Link
          href="/escrow/create"
          className="btn-press px-4 py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold glow-trust flex items-center gap-2 w-fit"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Escrow
        </Link>
      </div>

      <VaultLookup />

      {!isConnected ? (
        <p className="text-sm text-ink-400">Connect a wallet to see your trades.</p>
      ) : isLoading ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : allMine.length === 0 ? (
        <div className="p-8 rounded-xl bg-ink-900 border border-ink-800 text-center">
          <EscrowIcon className="w-8 h-8 text-ink-600 mx-auto mb-3" />
          <p className="text-sm text-ink-400">No trades yet. Purchase a listing from the Marketplace to open one.</p>
        </div>
      ) : (
        <>
          <VaultSection title="As Buyer" role="buyer" entries={data?.asBuyer ?? []} statusByVault={statusByVault} progressByVault={progressByVault} deadlineByVault={deadlineByVault} descriptionByVault={descriptionByVault} tokenInfo={tokenInfo} />
          <VaultSection title="As Seller" role="seller" entries={data?.asSeller ?? []} statusByVault={statusByVault} progressByVault={progressByVault} deadlineByVault={deadlineByVault} descriptionByVault={descriptionByVault} tokenInfo={tokenInfo} />
          <VaultSection title="As Arbiter" role="arbiter" entries={data?.asArbiter ?? []} statusByVault={statusByVault} progressByVault={progressByVault} deadlineByVault={deadlineByVault} descriptionByVault={descriptionByVault} tokenInfo={tokenInfo} />
        </>
      )}
    </div>
  );
}
