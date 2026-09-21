"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { marketplaceAbi, complianceConsumerAbi } from "@/generated/contracts";
import { addresses, isLendingConfigured } from "@/lib/addresses";
import { useEscrowAttention } from "@/hooks/useEscrowAttention";
import { useTotalValueLocked } from "@/hooks/useTotalValueLocked";
import { useRecentTrades } from "@/hooks/useRecentTrades";
import { useLendingPosition } from "@/hooks/useLendingPosition";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { formatToken, formatVaultNumber } from "@/lib/format";
import { useNow, formatRelativeTime } from "@/lib/countdown";
import { TradeStatusBadge, VerificationBadge } from "@/components/ui/badges";
import { TradeProgressBar } from "@/components/ui/TradeProgressBar";
import { CountdownBadge } from "@/components/ui/CountdownBadge";
import { HealthFactorGauge } from "@/components/ui/HealthFactorGauge";
import { MarketplaceIcon, EscrowIcon, LendingIcon, ShieldAlertIcon, SwapIcon, FaucetIcon } from "@/components/ui/icons";
import type { ActivityTone } from "@/lib/activityFeed";

const CLOSED_STATUSES = new Set(["Completed", "Cancelled"]);

const ACTIVITY_DOT: Record<ActivityTone, string> = {
  info: "bg-trust-400",
  success: "bg-success-400",
  warning: "bg-warning-400",
  danger: "bg-danger-400",
};

export default function DashboardPage() {
  const { address: account, isConnected } = useAccount();
  const { activeCount, attentionCount } = useEscrowAttention();
  const { escrow: escrowTvl, lendingCollateral, lendingLiquidity, isLoading: tvlLoading } = useTotalValueLocked();
  const { trades: recentTrades, isLoading: recentLoading } = useRecentTrades(10);
  const lending = useLendingPosition();
  const activity = useActivityFeed(recentTrades, recentLoading);
  const now = useNow(60_000);
  const [tradeTab, setTradeTab] = useState<"active" | "closed">("active");

  const { data: listingCount } = useReadContract({
    address: addresses.marketplace,
    abi: marketplaceAbi,
    functionName: "listingCount",
    query: { enabled: Boolean(addresses.marketplace) },
  });

  const { data: tier } = useReadContract({
    address: addresses.complianceConsumer,
    abi: complianceConsumerAbi,
    functionName: "tierOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.complianceConsumer && account) },
  });

  const activeTrades = useMemo(() => recentTrades.filter((t) => !CLOSED_STATUSES.has(t.status)), [recentTrades]);
  const closedTrades = useMemo(() => recentTrades.filter((t) => CLOSED_STATUSES.has(t.status)), [recentTrades]);
  const visibleTrades = tradeTab === "active" ? activeTrades : closedTrades;

  if (!isConnected) {
    return (
      <div className="fade-in max-w-2xl mx-auto text-center py-16">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-trust-500 to-trust-700 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Welcome to PLEDGON</h1>
        <p className="text-ink-400">
          Milestone escrow, independently verified — connect a wallet to browse the marketplace, view your active
          trades, and see your compliance standing.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1">Overview</p>
          <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="text-ink-400 mt-1">
            {account?.slice(0, 6)}…{account?.slice(-4)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/escrow/create"
            className="btn-press px-4 py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold glow-trust flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Escrow
          </Link>
          <Link
            href="/marketplace/create"
            className="btn-press px-4 py-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 text-white text-sm font-semibold flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Listing
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Link href="/escrow" className="deal-card block bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="text-3xl font-bold font-mono text-white">{activeCount}</div>
          <div className="text-sm text-ink-400 mt-1">Active Trades</div>
          {activeCount === 0 && <div className="text-xs text-ink-500 mt-1">No trades in progress</div>}
        </Link>
        <Link
          href="/escrow"
          className={`deal-card block rounded-xl p-5 border ${
            attentionCount > 0 ? "bg-warning-500/10 border-warning-500/30" : "bg-ink-900 border-ink-800"
          }`}
        >
          <div className={`text-3xl font-bold font-mono ${attentionCount > 0 ? "text-warning-400" : "text-white"}`}>
            {attentionCount}
          </div>
          <div className={`text-sm mt-1 ${attentionCount > 0 ? "text-warning-400" : "text-ink-400"}`}>
            Needs Your Attention
          </div>
          {attentionCount === 0 && <div className="text-xs text-ink-500 mt-1">You&apos;re all caught up</div>}
        </Link>
        <Link href="/marketplace" className="deal-card block bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="text-3xl font-bold font-mono text-white">{listingCount?.toString() ?? "…"}</div>
          <div className="text-sm text-ink-400 mt-1">Marketplace Listings</div>
          {listingCount === 0n && <div className="text-xs text-ink-500 mt-1">Nothing listed yet</div>}
        </Link>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold text-white mb-1">Recent Activity</h2>
        <p className="text-xs text-ink-500 mb-4">What changed since you were last here, in this browser — not a full on-chain history.</p>
        {activity.length === 0 ? (
          <p className="text-sm text-ink-400">Nothing new since your last visit.</p>
        ) : (
          <div className="space-y-3">
            {activity.map((entry) => (
              <Link key={entry.id} href={`/escrow/${entry.vault}`} className="flex items-start gap-3 group">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${ACTIVITY_DOT[entry.tone]}`} />
                <p className="text-sm text-ink-300 group-hover:text-white flex-1 min-w-0">{entry.message}</p>
                <span className="text-xs text-ink-500 shrink-0">{formatRelativeTime(entry.at, now)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-success-500/20 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-success-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8c-1.657 0-3 .672-3 1.5S10.343 11 12 11s3 .672 3 1.5-1.343 1.5-3 1.5m0-6c1.11 0 2.08.402 2.599 1M12 8V6.5m0 1.5v6m0 0V17m0-1.5c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Total Value Locked</h2>
            <p className="text-sm text-ink-400">Real on-chain balances — grouped by what the value actually is, not one pile of numbers</p>
          </div>
        </div>

        {tvlLoading ? (
          <p className="text-sm text-ink-400">Loading…</p>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">Escrow Vaults</div>
              {escrowTvl.length === 0 ? (
                <p className="text-sm text-ink-500">Nothing in escrow yet.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {escrowTvl.map((t) => (
                    <div key={t.token} className="px-4 py-3 rounded-lg bg-ink-800/50 border border-ink-700">
                      <div className="text-lg font-bold font-mono text-white">{formatToken(t.amount, t.decimals, t.symbol)}</div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-ink-500 mt-2">
                Payment currently in flight across trades — held by each trade&apos;s vault until milestones release it.
              </p>
            </div>

            {(lendingCollateral || lendingLiquidity) && (
              <div>
                <div className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">Lending Pool</div>
                <div className="flex flex-wrap gap-3">
                  {lendingCollateral && (
                    <div className="px-4 py-3 rounded-lg bg-ink-800/50 border border-ink-700">
                      <div className="text-lg font-bold font-mono text-white">
                        {formatToken(lendingCollateral.amount, lendingCollateral.decimals, lendingCollateral.symbol)}
                      </div>
                      <div className="text-xs text-ink-500 mt-0.5">Collateral deposited</div>
                    </div>
                  )}
                  {lendingLiquidity && (
                    <div className="px-4 py-3 rounded-lg bg-ink-800/50 border border-ink-700">
                      <div className="text-lg font-bold font-mono text-white">
                        {formatToken(lendingLiquidity.amount, lendingLiquidity.decimals, lendingLiquidity.symbol)}
                      </div>
                      <div className="text-xs text-ink-500 mt-0.5">Available to borrow</div>
                    </div>
                  )}
                </div>
                <p className="text-xs text-ink-500 mt-2">
                  These aren&apos;t the same kind of value: <span className="text-ink-400">Collateral deposited</span> is{" "}
                  {lendingCollateral?.symbol ?? "the collateral token"} locked by borrowers, securing what they owe — it
                  isn&apos;t available to anyone until withdrawn or liquidated.{" "}
                  <span className="text-ink-400">Available to borrow</span> is{" "}
                  {lendingLiquidity?.symbol ?? "the debt token"} sitting in the pool waiting to be lent out — supply, not
                  demand. It isn&apos;t owned or locked by any one depositor, and on this deployment it&apos;s testnet
                  liquidity minted directly into the pool, not something users supplied.
                </p>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-ink-500 mt-4 pt-3 border-t border-ink-800">
          Never combined into one figure, within or across these groups — there&apos;s no price oracle here to convert
          different payment tokens into a common unit.
        </p>
      </div>

      {isLendingConfigured && (
        <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-warning-500/20 flex items-center justify-center shrink-0">
              <LendingIcon className="w-5 h-5 text-warning-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white">Lending Position</h2>
              <p className="text-sm text-ink-400">Your collateral, debt, and liquidation-protection standing</p>
            </div>
          </div>

          {!lending.hasPosition ? (
            <p className="text-sm text-ink-400">No open position yet — deposit collateral on the Lending page to get started.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-ink-800/50 border border-ink-700">
                  <div className="text-xs text-ink-400 mb-1">Collateral</div>
                  <div className="font-mono text-sm text-ink-100">
                    {lending.collDecimals !== undefined
                      ? formatToken(lending.collateralAmount, lending.collDecimals, lending.collSymbol)
                      : "…"}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-ink-800/50 border border-ink-700">
                  <div className="text-xs text-ink-400 mb-1">Debt</div>
                  <div className="font-mono text-sm text-ink-100">
                    {lending.debtDecimals !== undefined ? formatToken(lending.debtAmount, lending.debtDecimals, lending.debtSymbol) : "…"}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-ink-800/50 border border-ink-700">
                  <div className="text-xs text-ink-400 mb-1">Liquidation Threshold</div>
                  <div className="font-mono text-sm text-ink-100">
                    {lending.liquidationThresholdBps !== undefined ? `${Number(lending.liquidationThresholdBps) / 100}%` : "…"}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-ink-800/50 border border-ink-700 flex flex-col items-center justify-center">
                  <div className="text-xs text-ink-400 mb-1 self-start">Health Factor</div>
                  <HealthFactorGauge
                    hasDebt={lending.debtAmount > 0n}
                    hasPrice={lending.hasPrice}
                    ltvBps={lending.ltvBps}
                    liquidationThresholdBps={lending.liquidationThresholdBps}
                    healthFactor={lending.healthFactor}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="p-3 rounded-lg bg-ink-800/50 border border-ink-700">
                  <div className="text-xs text-ink-400 mb-1">Current LTV</div>
                  <div className="font-mono text-sm text-ink-100">
                    {lending.debtAmount === 0n ? "0%" : lending.ltvBps !== undefined ? `${Number(lending.ltvBps) / 100}%` : "—"}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-ink-800/50 border border-ink-700">
                  <div className="text-xs text-ink-400 mb-1">Est. Liquidation Price</div>
                  <div className="font-mono text-sm text-ink-100">
                    {lending.debtAmount === 0n
                      ? "N/A — no debt"
                      : lending.liquidationPrice !== undefined
                        ? `${(Number(lending.liquidationPrice) / 10 ** lending.priceDecimals).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${lending.debtSymbol ?? ""}`
                        : "—"}
                  </div>
                </div>
              </div>

              {!lending.hasPrice && lending.debtAmount > 0n && (
                <p className="text-xs text-warning-400 mt-3">
                  Health Factor, LTV, and Liquidation Price need a live price feed from the liquidation-protection DON
                  workflow — none has ever reported here, so these show as "—" rather than a fabricated number. They'll
                  start showing real figures automatically the moment one does, no app update needed.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-ink-800/60">
            <button
              onClick={() => setTradeTab("active")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                tradeTab === "active" ? "bg-ink-700 text-white" : "text-ink-400 hover:text-white"
              }`}
            >
              Active ({activeTrades.length})
            </button>
            <button
              onClick={() => setTradeTab("closed")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                tradeTab === "closed" ? "bg-ink-700 text-white" : "text-ink-400 hover:text-white"
              }`}
            >
              Closed ({closedTrades.length})
            </button>
          </div>
          <Link href="/escrow" className="text-sm text-trust-400 hover:text-trust-300 font-medium">
            View all
          </Link>
        </div>
        {recentLoading ? (
          <p className="text-sm text-ink-400">Loading…</p>
        ) : visibleTrades.length === 0 ? (
          <p className="text-sm text-ink-400">
            {tradeTab === "active"
              ? "No active trades — create an escrow or purchase a listing to get started."
              : "No closed trades yet."}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleTrades.map((t) => (
              <Link
                key={t.vault}
                href={`/escrow/${t.vault}`}
                className="deal-card block p-3 rounded-lg bg-ink-800/40 border border-ink-700"
              >
                <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-500 font-mono">{formatVaultNumber(t.index)}</span>
                    <span className="text-xs text-ink-400 capitalize">{t.role}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.currentDeadline && <CountdownBadge deadline={t.currentDeadline.deadline} label={t.currentDeadline.label} />}
                    <TradeStatusBadge status={t.status} size="sm" />
                  </div>
                </div>
                {(t.listingTitle || t.description) && (
                  <p className="text-xs text-ink-500 mb-2 line-clamp-1">{t.listingTitle || t.description}</p>
                )}
                <TradeProgressBar progress={t.progress} />
                {t.decimals !== undefined && (
                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-ink-800/60">
                    <span className="text-ink-500">Trade Value</span>
                    <span className="font-mono text-ink-300">{formatToken(t.totalAmount, t.decimals, t.symbol)}</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href="/marketplace" className="deal-card flex items-center gap-3 bg-ink-900 border border-ink-800 rounded-xl p-5">
          <MarketplaceIcon className="w-6 h-6 text-trust-400 shrink-0" />
          <div>
            <div className="font-semibold text-white">Marketplace</div>
            <div className="text-xs text-ink-400">
              {listingCount !== undefined ? `${listingCount.toString()} listing${listingCount === 1n ? "" : "s"}` : "Browse & create listings"}
            </div>
          </div>
        </Link>
        <Link href="/escrow" className="deal-card flex items-center gap-3 bg-ink-900 border border-ink-800 rounded-xl p-5">
          <EscrowIcon className="w-6 h-6 text-success-400 shrink-0" />
          <div>
            <div className="font-semibold text-white">Escrow</div>
            <div className="text-xs text-ink-400">
              {activeCount} active trade{activeCount === 1 ? "" : "s"}
              {attentionCount > 0 && <span className="text-warning-400"> · {attentionCount} need attention</span>}
            </div>
          </div>
        </Link>
        <Link
          href="/lending"
          className={`deal-card flex flex-col gap-2 bg-ink-900 border border-ink-800 rounded-xl p-5 ${!isLendingConfigured ? "opacity-50" : ""}`}
        >
          <div className="flex items-center gap-3">
            <LendingIcon className="w-6 h-6 text-warning-400 shrink-0" />
            <div className="font-semibold text-white">Lending</div>
          </div>
          {!isLendingConfigured ? (
            <div className="text-xs text-ink-400">Not deployed yet</div>
          ) : !lending.hasPosition ? (
            <div className="text-xs text-ink-400">No open position — deposit to get started</div>
          ) : (
            <div className="text-xs text-ink-400 space-y-0.5">
              <div>
                Collateral:{" "}
                <span className="font-mono text-ink-200">
                  {lending.collDecimals !== undefined ? formatToken(lending.collateralAmount, lending.collDecimals, lending.collSymbol) : "…"}
                </span>
              </div>
              <div>
                Debt:{" "}
                <span className="font-mono text-ink-200">
                  {lending.debtDecimals !== undefined ? formatToken(lending.debtAmount, lending.debtDecimals, lending.debtSymbol) : "…"}
                </span>
              </div>
              {lending.debtAmount > 0n && <div className="text-warning-400 pt-0.5">Liquidation protection needs a live price feed</div>}
            </div>
          )}
        </Link>
        <Link href="/compliance" className="deal-card flex items-center justify-between gap-3 bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="flex items-center gap-3">
            <ShieldAlertIcon className="w-6 h-6 text-trust-400 shrink-0" />
            <div>
              <div className="font-semibold text-white">Compliance</div>
              <div className="text-xs text-ink-400">Your KYC tier & caps</div>
            </div>
          </div>
          {tier !== undefined && <VerificationBadge tier={tier} />}
        </Link>
        <Link href="/swap" className="deal-card flex items-center gap-3 bg-ink-900 border border-ink-800 rounded-xl p-5">
          <SwapIcon className="w-6 h-6 text-trust-400 shrink-0" />
          <div>
            <div className="font-semibold text-white">Swap</div>
            <div className="text-xs text-ink-400">Trade real, liquid assets</div>
          </div>
        </Link>
        <Link href="/faucet" className="deal-card flex items-center gap-3 bg-ink-900 border border-ink-800 rounded-xl p-5">
          <FaucetIcon className="w-6 h-6 text-success-400 shrink-0" />
          <div>
            <div className="font-semibold text-white">Faucet</div>
            <div className="text-xs text-ink-400">Mint testnet tokens</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
