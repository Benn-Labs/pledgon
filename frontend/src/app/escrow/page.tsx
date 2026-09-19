"use client";

import { useMemo } from "react";
import Link from "next/link";
import { erc20Abi, type Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { useMyVaults, type VaultCreatedEvent } from "@/hooks/useMyVaults";
import { formatToken } from "@/lib/format";
import { EscrowIcon } from "@/components/ui/icons";

function VaultCard({
  entry,
  role,
  funded,
  decimals,
  symbol,
}: {
  entry: VaultCreatedEvent;
  role: "buyer" | "seller" | "arbiter";
  funded: boolean | undefined;
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
      <div className="flex items-start justify-between mb-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${
            funded ? "bg-success-500/20 text-success-400 border-success-500/30" : "bg-ink-700 text-ink-300 border-ink-600"
          }`}
        >
          {funded === undefined ? "Loading…" : funded ? "Funded" : "Awaiting funding"}
        </span>
        <span className="text-xs text-ink-500 font-mono">
          {entry.vault.slice(0, 6)}…{entry.vault.slice(-4)}
        </span>
      </div>
      <div className="text-sm text-ink-400 mb-1">
        {role === "arbiter" ? "Buyer / Seller" : counterpart.label}
      </div>
      <div className="font-mono text-sm text-ink-200 mb-3">
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
      {decimals !== undefined && (
        <div className="flex justify-between text-sm pt-3 border-t border-ink-800">
          <span className="text-ink-400">Bond</span>
          <span className="font-mono text-warning-400">{formatToken(entry.bondAmount, decimals, symbol)}</span>
        </div>
      )}
    </Link>
  );
}

function VaultSection({
  title,
  role,
  entries,
  fundedByVault,
  tokenInfo,
}: {
  title: string;
  role: "buyer" | "seller" | "arbiter";
  entries: VaultCreatedEvent[];
  fundedByVault: Map<string, boolean>;
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
              funded={fundedByVault.get(entry.vault.toLowerCase())}
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

  const { data: fundedResults } = useReadContracts({
    contracts: allMine.map((v) => ({ address: v.vault, abi: escrowVaultAbi, functionName: "funded" as const })),
    query: { enabled: allMine.length > 0 },
  });

  const fundedByVault = useMemo(() => {
    const map = new Map<string, boolean>();
    allMine.forEach((v, i) => {
      const result = fundedResults?.[i]?.result;
      if (result !== undefined) map.set(v.vault.toLowerCase(), result);
    });
    return map;
  }, [allMine, fundedResults]);

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
          <VaultSection title="As Buyer" role="buyer" entries={data?.asBuyer ?? []} fundedByVault={fundedByVault} tokenInfo={tokenInfo} />
          <VaultSection title="As Seller" role="seller" entries={data?.asSeller ?? []} fundedByVault={fundedByVault} tokenInfo={tokenInfo} />
          <VaultSection title="As Arbiter" role="arbiter" entries={data?.asArbiter ?? []} fundedByVault={fundedByVault} tokenInfo={tokenInfo} />
        </>
      )}
    </div>
  );
}
