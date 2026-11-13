"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { erc20Abi, formatUnits, isAddress } from "viem";
import type { Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { lendingPoolAbi, liquidationConsumerAbi } from "@/generated/contracts";
import { lendingMarkets, isLendingConfigured, type LendingMarket } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { useLendingPosition } from "@/hooks/useLendingPosition";
import { useLenderRewards } from "@/hooks/useLenderRewards";
import { useLendingBorrowers, useRegisterBorrowerFromDeposit } from "@/hooks/useLendingBorrowers";
import { formatToken } from "@/lib/format";
import { tryParseUnits } from "@/lib/units";
import { toast, toastTxError } from "@/lib/toast";
import { LendingIcon } from "@/components/ui/icons";
import { HealthFactorGauge } from "@/components/ui/HealthFactorGauge";

function UtilizationBar({
  totalSupply,
  totalBorrows,
  capBps,
}: {
  totalSupply?: bigint;
  totalBorrows?: bigint;
  capBps?: bigint;
}) {
  if (totalSupply === undefined || totalBorrows === undefined || totalSupply === 0n) {
    return <div className="text-sm text-ink-400">—</div>;
  }
  const utilization = Number(totalBorrows) / Number(totalSupply);
  const cap = capBps !== undefined && capBps > 0n ? Number(capBps) / 10_000 : 1;
  const pctOfCap = capBps !== undefined && capBps > 0n ? utilization / cap : utilization;

  let barColor = "bg-trust-500";
  if (pctOfCap > 0.95) barColor = "bg-danger-500";
  else if (pctOfCap > 0.8) barColor = "bg-warning-500";

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-ink-400">{(utilization * 100).toFixed(2)}% utilized</span>
        {capBps !== undefined && capBps > 0n && (
          <span className="text-ink-500">Cap {Number(capBps) / 100}%</span>
        )}
      </div>
      <div className="h-2 w-full bg-ink-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${Math.min(utilization * 100, 100)}%` }}
        />
      </div>
      {pctOfCap > 0.95 && (
        <p className="text-xs text-danger-400 mt-1">Utilization is near the cap — new borrows may be limited.</p>
      )}
    </div>
  );
}

function ActionPanel({
  title,
  tokenSymbol,
  balance,
  balanceLabel = "Wallet balance",
  decimals,
  amount,
  setAmount,
  onSubmit,
  submitLabel,
  isPending,
  activeHere,
  limit,
  limitMessage = "Exceeds wallet balance",
  onMax,
}: {
  title: string;
  tokenSymbol?: string;
  balance?: bigint;
  balanceLabel?: string;
  decimals?: number;
  amount: string;
  setAmount: (v: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  /** Any transaction in flight: disables every action (one wallet prompt at a time). */
  isPending: boolean;
  /** This panel's own transaction is the one in flight: only then show "Submitting…". */
  activeHere?: boolean;
  /** Largest amount that can go through; typing more disables submit and shows `limitMessage`. */
  limit?: bigint;
  limitMessage?: string;
  onMax?: () => void;
}) {
  const parsed = decimals !== undefined ? tryParseUnits(amount, decimals) : undefined;
  const overLimit = limit !== undefined && parsed !== undefined && parsed > limit;
  return (
    <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
      <h3 className="font-semibold text-white mb-3">{title}</h3>
      <div className="relative mb-2">
        <input
          className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-20 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-ink-400 text-sm">
          {onMax && (
            <button type="button" onClick={onMax} className="rounded px-1.5 py-0.5 text-xs font-semibold text-trust-400 hover:bg-ink-700">
              Max
            </button>
          )}
          {tokenSymbol ?? ""}
        </span>
      </div>
      {balance !== undefined && decimals !== undefined && (
        <p className="text-xs text-ink-500 mb-2">
          {balanceLabel}: {formatToken(balance, decimals, tokenSymbol)}
        </p>
      )}
      {overLimit && <p className="text-xs text-danger-400 mb-2">{limitMessage}</p>}
      <button
        onClick={onSubmit}
        disabled={!amount || isPending || overLimit}
        className="btn-press mt-2 w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
      >
        {activeHere ? "Submitting…" : submitLabel}
      </button>
    </div>
  );
}

export default function LendingPage() {
  const { address: account } = useAccount();
  const [selectedMarket, setSelectedMarket] = useState<LendingMarket>(lendingMarkets[0]);

  const { decimals: collDecimals, symbol: collSymbol } = useToken(selectedMarket.collateralToken);
  const { decimals: debtDecimals, symbol: debtSymbol } = useToken(selectedMarket.debtToken);
  const { hasPrice, healthFactor, ltvBps, liquidationThresholdBps, price, priceDecimals, maxUtilizationBps } =
    useLendingPosition(selectedMarket);
  const { rewards: feeRewards, windowSeconds: rewardSeconds, windowLabel: rewardWindow, isError: rewardsError } =
    useLenderRewards(selectedMarket);
  const { borrowers: atRiskBorrowers, isLoading: borrowersLoading } = useLendingBorrowers(selectedMarket);
  const registerBorrowerFromDeposit = useRegisterBorrowerFromDeposit(selectedMarket);

  const { data: position, refetch: refetchPosition } = useReadContract({
    address: selectedMarket.lendingPool,
    abi: lendingPoolAbi,
    functionName: "positions",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(selectedMarket.lendingPool && account) },
  });

  const { data: collBalance, refetch: refetchCollBalance } = useReadContract({
    address: selectedMarket.collateralToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(selectedMarket.collateralToken && account) },
  });

  const { data: debtBalance, refetch: refetchDebtBalance } = useReadContract({
    address: selectedMarket.debtToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(selectedMarket.debtToken && account) },
  });

  const { data: collAllowance, refetch: refetchCollAllowance } = useReadContract({
    address: selectedMarket.collateralToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: account && selectedMarket.lendingPool ? [account, selectedMarket.lendingPool] : undefined,
    query: { enabled: Boolean(selectedMarket.collateralToken && selectedMarket.lendingPool && account) },
  });

  const { data: debtAllowance, refetch: refetchDebtAllowance } = useReadContract({
    address: selectedMarket.debtToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: account && selectedMarket.lendingPool ? [account, selectedMarket.lendingPool] : undefined,
    query: { enabled: Boolean(selectedMarket.debtToken && selectedMarket.lendingPool && account) },
  });

  const { data: lenderShares, refetch: refetchLenderShares } = useReadContract({
    address: selectedMarket.lendingPool,
    abi: lendingPoolAbi,
    functionName: "lenderShares",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(selectedMarket.lendingPool && account) },
  });

  const { data: lenderBalance, refetch: refetchLenderBalance } = useReadContract({
    address: selectedMarket.lendingPool,
    abi: lendingPoolAbi,
    functionName: "lenderBalance",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(selectedMarket.lendingPool && account) },
  });

  const { data: poolTotalSupply, refetch: refetchPoolTotalSupply } = useReadContract({
    address: selectedMarket.lendingPool,
    abi: lendingPoolAbi,
    functionName: "totalSupply",
    query: { enabled: Boolean(selectedMarket.lendingPool) },
  });

  const { data: poolTotalBorrows, refetch: refetchPoolTotalBorrows } = useReadContract({
    address: selectedMarket.lendingPool,
    abi: lendingPoolAbi,
    functionName: "totalBorrows",
    query: { enabled: Boolean(selectedMarket.lendingPool) },
  });

  const { data: borrowRateBps } = useReadContract({
    address: selectedMarket.lendingPool,
    abi: lendingPoolAbi,
    functionName: "borrowRateBps",
    query: { enabled: Boolean(selectedMarket.lendingPool) },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });
  const busy = isPending || isConfirming;
  // Which action owns the in-flight transaction, so only its button reads
  // "Submitting…"; the rest are just disabled, not mislabelled.
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const activeHere = (action: string) => busy && activeAction === action;
  const send = (action: string, params: Parameters<typeof writeContract>[0]) => {
    setActiveAction(action);
    writeContract(params);
  };

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [liquidateTarget, setLiquidateTarget] = useState("");
  const [supplyAmount, setSupplyAmount] = useState("");
  const [withdrawSupplyAmount, setWithdrawSupplyAmount] = useState("");

  const liquidateTargetAddress = isAddress(liquidateTarget) ? (liquidateTarget as Address) : undefined;

  const { data: targetPosition, refetch: refetchTargetPosition } = useReadContract({
    address: selectedMarket.lendingPool,
    abi: lendingPoolAbi,
    functionName: "positions",
    args: liquidateTargetAddress ? [liquidateTargetAddress] : undefined,
    query: { enabled: Boolean(selectedMarket.lendingPool && liquidateTargetAddress) },
  });

  const { data: targetEligible, refetch: refetchTargetEligible } = useReadContract({
    address: selectedMarket.liquidationConsumer,
    abi: liquidationConsumerAbi,
    functionName: "isEligible",
    args: liquidateTargetAddress ? [liquidateTargetAddress] : undefined,
    query: { enabled: Boolean(selectedMarket.liquidationConsumer && liquidateTargetAddress) },
  });

  useEffect(() => {
    if (isSuccess) {
      toast("Transaction confirmed", "success");
      refetchPosition();
      refetchCollBalance();
      refetchDebtBalance();
      refetchCollAllowance();
      refetchDebtAllowance();
      refetchTargetPosition();
      refetchTargetEligible();
      refetchLenderShares();
      refetchLenderBalance();
      refetchPoolTotalSupply();
      refetchPoolTotalBorrows();
      // Best-effort, silent — write-lending-borrower verifies on-chain
      // whether this transaction actually emitted CollateralDeposited, so
      // passing every successful tx's hash (not just known deposits) is
      // safe: anything else just fails harmlessly server-side, and there's
      // no wallet prompt either way to make that failure user-visible.
      if (hash) registerBorrowerFromDeposit(hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hash/registerBorrowerFromDeposit read at the moment of success, not meant to re-fire this on every render
  }, [
    isSuccess,
    refetchPosition,
    refetchCollBalance,
    refetchDebtBalance,
    refetchCollAllowance,
    refetchDebtAllowance,
    refetchTargetPosition,
    refetchTargetEligible,
    refetchLenderShares,
    refetchLenderBalance,
    refetchPoolTotalSupply,
    refetchPoolTotalBorrows,
  ]);

  useEffect(() => {
    if (error) toastTxError(error);
  }, [error]);

  if (!isLendingConfigured) {
    return (
      <div className="fade-in max-w-lg mx-auto text-center py-16">
        <LendingIcon className="w-10 h-10 text-ink-600 mx-auto mb-4" />
        <h1 className="text-xl font-display text-white mb-2">Lending isn&apos;t deployed on this network</h1>
        <p className="text-sm text-ink-400">
          The contracts exist (<code className="font-mono text-xs">LendingPool</code>,{" "}
          <code className="font-mono text-xs">LendingOracleConsumer</code>,{" "}
          <code className="font-mono text-xs">LiquidationConsumer</code>) but haven&apos;t been deployed to Sepolia
          yet. Run <code className="font-mono text-xs">DeployLendingTokens.s.sol</code> then{" "}
          <code className="font-mono text-xs">DeployLending.s.sol</code>, then set the{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_LENDING_*</code> env vars.
        </p>
      </div>
    );
  }

  const [collateralAmount, debtAmount] = position ?? [0n, 0n];
  const [, targetDebtAmount] = targetPosition ?? [0n, 0n];
  // Inputs are free text, so these parses must stay render-safe: tryParseUnits
  // returns undefined for garbage like "abc"/"1e3" instead of throwing mid-render.
  const depositParsed = collDecimals !== undefined ? tryParseUnits(depositAmount, collDecimals) : undefined;
  const repayParsed = debtDecimals !== undefined ? tryParseUnits(repayAmount, debtDecimals) : undefined;
  const supplyParsed = debtDecimals !== undefined ? tryParseUnits(supplyAmount, debtDecimals) : undefined;
  const needsCollApproval = depositParsed !== undefined && (collAllowance ?? 0n) < depositParsed;
  const needsDebtApproval = repayParsed !== undefined && (debtAllowance ?? 0n) < repayParsed;
  const needsLiquidateApproval = liquidateTargetAddress ? (debtAllowance ?? 0n) < targetDebtAmount : false;
  const needsSupplyApproval = supplyParsed !== undefined && (debtAllowance ?? 0n) < supplyParsed;

  // Amounts above what the wallet holds revert on-chain (transferFrom), so block
  // them up front instead of letting the wallet warn "likely to fail".
  const overBalance = (value: string, decimals: number | undefined, balance: bigint | undefined) => {
    const parsed = decimals !== undefined ? tryParseUnits(value, decimals) : undefined;
    return parsed !== undefined && balance !== undefined && parsed > balance;
  };
  // Repay pulls min(amount, currentDebt), so the wallet only has to cover the
  // debt. The cap therefore only applies when the wallet holds less than that.
  const repayLimit = debtBalance !== undefined && debtAmount > debtBalance ? debtBalance : undefined;
  // Borrow is limited by whichever is smaller: idle liquidity in the pool or
  // the utilization cap. Show that as the input limit so users get feedback
  // before the wallet reverts UtilizationExceeded / InsufficientLiquidity.
  const borrowInputLimit =
    poolTotalSupply !== undefined && poolTotalBorrows !== undefined
      ? (() => {
          const idle = poolTotalSupply - poolTotalBorrows;
          if (maxUtilizationBps === undefined || maxUtilizationBps === 0n) return idle;
          const capBorrows = (poolTotalSupply * maxUtilizationBps) / 10_000n;
          const underCap = capBorrows > poolTotalBorrows ? capBorrows - poolTotalBorrows : 0n;
          return underCap < idle ? underCap : idle;
        })()
      : undefined;
  // Debt grows every second, so "Max" asks for slightly more than the displayed
  // debt (0.1% buffer); the pool clamps the pull to the exact debt at execution.
  function repayMax() {
    if (debtDecimals === undefined || debtAmount === 0n) return;
    const buffered = debtAmount + debtAmount / 1000n + 1n;
    const capped = debtBalance !== undefined && buffered > debtBalance ? debtBalance : buffered;
    setRepayAmount(formatUnits(capped, debtDecimals));
  }

  // With no debt the whole deposit can leave; with debt, how much is safe depends
  // on the price and threshold, so there is no one-click "Max" in that case.
  function withdrawMax() {
    if (collDecimals === undefined) return;
    setWithdrawAmount(formatUnits(collateralAmount, collDecimals));
  }

  function approveCollateral() {
    if (!selectedMarket.lendingPool || !selectedMarket.collateralToken || collDecimals === undefined) return;
    if (depositParsed === undefined) {
      toast("Enter a valid amount to approve", "warning");
      return;
    }
    send("approveColl", {
      address: selectedMarket.collateralToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [selectedMarket.lendingPool, depositParsed],
    });
  }

  function depositCollateral() {
    if (!selectedMarket.lendingPool || collDecimals === undefined) return;
    if (depositParsed === undefined) {
      toast("Enter a valid amount to deposit", "warning");
      return;
    }
    send("deposit", {
      address: selectedMarket.lendingPool,
      abi: lendingPoolAbi,
      functionName: "depositCollateral",
      args: [depositParsed],
    });
  }

  function withdrawCollateral() {
    if (!selectedMarket.lendingPool || collDecimals === undefined) return;
    const amount = tryParseUnits(withdrawAmount, collDecimals);
    if (amount === undefined) {
      toast("Enter a valid amount to withdraw", "warning");
      return;
    }
    send("withdraw", {
      address: selectedMarket.lendingPool,
      abi: lendingPoolAbi,
      functionName: "withdrawCollateral",
      args: [amount],
    });
  }

  function approveDebtForRepay() {
    if (!selectedMarket.lendingPool || !selectedMarket.debtToken || debtDecimals === undefined) return;
    if (repayParsed === undefined) {
      toast("Enter a valid amount to approve", "warning");
      return;
    }
    send("approveRepay", {
      address: selectedMarket.debtToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [selectedMarket.lendingPool, repayParsed],
    });
  }

  function repay() {
    if (!selectedMarket.lendingPool || debtDecimals === undefined) return;
    if (repayParsed === undefined) {
      toast("Enter a valid amount to repay", "warning");
      return;
    }
    send("repay", {
      address: selectedMarket.lendingPool,
      abi: lendingPoolAbi,
      functionName: "repay",
      args: [repayParsed],
    });
  }

  function borrow() {
    if (!selectedMarket.lendingPool || debtDecimals === undefined) return;
    const amount = tryParseUnits(borrowAmount, debtDecimals);
    if (amount === undefined) {
      toast("Enter a valid amount to borrow", "warning");
      return;
    }
    send("borrow", {
      address: selectedMarket.lendingPool,
      abi: lendingPoolAbi,
      functionName: "borrow",
      args: [amount],
    });
  }

  function approveDebtForLiquidate() {
    if (!selectedMarket.lendingPool || !selectedMarket.debtToken || targetDebtAmount === 0n) return;
    // The liquidation pulls the *current* debt at execution time, which is always
    // >= the amount we read from positions() because interest accrues every second.
    // Approve a small buffer so the allowance isn't immediately stale by the time
    // the user clicks Liquidate — otherwise the UI asks for approval again.
    const buffered = targetDebtAmount + targetDebtAmount / 100n + 1n;
    send("approveLiq", {
      address: selectedMarket.debtToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [selectedMarket.lendingPool, buffered],
    });
  }

  function liquidate() {
    if (!selectedMarket.lendingPool || !liquidateTargetAddress) return;
    send("liquidate", {
      address: selectedMarket.lendingPool,
      abi: lendingPoolAbi,
      functionName: "liquidate",
      args: [liquidateTargetAddress],
    });
  }

  function approveDebtForSupply() {
    if (!selectedMarket.lendingPool || !selectedMarket.debtToken || debtDecimals === undefined) return;
    if (supplyParsed === undefined) {
      toast("Enter a valid amount to approve", "warning");
      return;
    }
    send("approveSupply", {
      address: selectedMarket.debtToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [selectedMarket.lendingPool, supplyParsed],
    });
  }

  function supplyLiquidity() {
    if (!selectedMarket.lendingPool || debtDecimals === undefined) return;
    if (supplyParsed === undefined) {
      toast("Enter a valid amount to supply", "warning");
      return;
    }
    send("supply", {
      address: selectedMarket.lendingPool,
      abi: lendingPoolAbi,
      functionName: "depositLiquidity",
      args: [supplyParsed],
    });
  }

  function withdrawSupply() {
    if (!selectedMarket.lendingPool || debtDecimals === undefined) return;
    const requested = tryParseUnits(withdrawSupplyAmount, debtDecimals);
    if (requested === undefined) {
      toast("Enter a valid amount to withdraw", "warning");
      return;
    }
    const userShares = lenderShares ?? 0n;
    const userBalance = lenderBalance ?? 0n;
    // Redeeming the full displayed balance uses the exact held shares, so no
    // dust share is left behind from rounding the proportional formula below.
    const shares = userBalance > 0n && requested >= userBalance ? userShares : (requested * userShares) / (userBalance || 1n);
    send("withdrawSupply", {
      address: selectedMarket.lendingPool,
      abi: lendingPoolAbi,
      functionName: "withdrawLiquidity",
      args: [shares],
    });
  }

  return (
    <div className="fade-in max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display text-white">Lending</h1>
          <p className="text-ink-400 mt-1">Deposit collateral, borrow against it, with DON-corroborated liquidation protection</p>
        </div>
        <Link
          href="/faucet"
          className="btn-press px-4 py-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 text-white text-sm font-semibold shrink-0"
        >
          Need test tokens?
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <label htmlFor="market-select" className="text-sm text-ink-400">
          Market
        </label>
        <select
          id="market-select"
          className="bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-ink-200 focus:outline-none focus:border-trust-500"
          value={selectedMarket.id}
          onChange={(e) => {
            const market = lendingMarkets.find((m) => m.id === e.target.value);
            if (market) setSelectedMarket(market);
          }}
        >
          {lendingMarkets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {hasPrice ? (
        <div className="p-4 rounded-lg bg-trust-500/10 border border-trust-500/30 mb-6">
          <p className="text-sm text-trust-400 font-medium mb-1">Live price feed active</p>
          <p className="text-sm text-ink-300">
            The <code className="font-mono text-xs">lending-oracle</code> DON workflow is reporting to{" "}
            <code className="font-mono text-xs">LendingOracleConsumer</code>, so Borrow now works. Liquidate only
            succeeds once <code className="font-mono text-xs">LiquidationConsumer</code> has attested that specific
            borrower eligible — most positions won&apos;t be.
          </p>
        </div>
      ) : (
        <div className="p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 mb-6">
          <p className="text-sm text-warning-400 font-medium mb-1">No live price feed yet</p>
          <p className="text-sm text-ink-300">
            The <code className="font-mono text-xs">lending-oracle</code> DON workflow hasn&apos;t reported a price to{" "}
            <code className="font-mono text-xs">LendingOracleConsumer</code> yet, so Borrow and the Health Factor below
            aren&apos;t live — the gauge shows a dash rather than a fabricated number until the first report lands.
            Deposits, withdrawals, and supplying liquidity are unaffected.
          </p>
        </div>
      )}

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold text-white mb-1">Lend &amp; Earn Interest</h2>
        <p className="text-xs text-ink-500 mb-4">
          Supplied {debtSymbol} earns a fixed rate, paid by borrowers as their debt accrues — your share of the pool
          grows in place, nothing to claim separately.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
            <div className="text-xs text-ink-400 mb-1">Total Supplied</div>
            <div className="font-mono text-lg text-ink-100">
              {debtDecimals !== undefined && poolTotalSupply !== undefined
                ? formatToken(poolTotalSupply, debtDecimals, debtSymbol, 2)
                : "…"}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
            <div className="text-xs text-ink-400 mb-1">Total Borrowed</div>
            <div className="font-mono text-lg text-ink-100">
              {debtDecimals !== undefined && poolTotalBorrows !== undefined
                ? formatToken(poolTotalBorrows, debtDecimals, debtSymbol, 2)
                : "…"}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
            <div className="text-xs text-ink-400 mb-1">Fixed Rate (APR)</div>
            <div className="font-mono text-lg text-ink-100">
              {borrowRateBps !== undefined ? `${Number(borrowRateBps) / 100}%` : "…"}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
            <div className="text-xs text-ink-400 mb-1">Your Supplied Balance</div>
            <div className="font-mono text-lg text-ink-100">
              {debtDecimals !== undefined && lenderBalance !== undefined
                ? formatToken(lenderBalance, debtDecimals, debtSymbol, 2)
                : "…"}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
            <div className="text-xs text-ink-400 mb-2">Pool Utilization</div>
            <UtilizationBar totalSupply={poolTotalSupply} totalBorrows={poolTotalBorrows} capBps={maxUtilizationBps} />
          </div>
        </div>
        {!rewardsError && feeRewards !== undefined && rewardSeconds !== undefined && debtDecimals !== undefined && (
          <p className="text-xs text-ink-400 mb-6">
            <span className="font-semibold text-trust-400">Fee rewards:</span>{" "}
            {feeRewards > 0n ? (
              <>
                {formatToken(feeRewards, debtDecimals, debtSymbol, 2)} shared with lenders from platform fees in the last{" "}
                {rewardWindow}
                {poolTotalSupply !== undefined && poolTotalSupply > 0n && (
                  <> — about {((Number((feeRewards * 1_000_000n) / poolTotalSupply) / 10_000) * ((365 * 86_400) / rewardSeconds)).toFixed(2)}% a year
                  on top of borrower interest, if repeated</>
                )}
                .
              </>
            ) : (
              <>none in the last {rewardWindow}. A share of platform fees is paid into the pool for lenders from time to time.</>
            )}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {needsSupplyApproval ? (
            <div className="bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] rounded-xl p-6">
              <h3 className="font-semibold text-white mb-3">Supply Liquidity</h3>
              <p className="text-sm text-ink-400 mb-4">Approve {debtSymbol} before supplying.</p>
              <button
                onClick={approveDebtForSupply}
                disabled={!supplyAmount || busy || overBalance(supplyAmount, debtDecimals, debtBalance)}
                className="btn-press w-full py-2.5 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
              >
                {activeHere("approveSupply") ? "Submitting…" : `Approve ${debtSymbol}`}
              </button>
              <input
                className="w-full mt-3 bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
                placeholder="Amount to approve/supply"
                value={supplyAmount}
                onChange={(e) => setSupplyAmount(e.target.value)}
              />
            </div>
          ) : (
            <ActionPanel
              title="Supply Liquidity"
              tokenSymbol={debtSymbol}
              balance={debtBalance}
              decimals={debtDecimals}
              amount={supplyAmount}
              setAmount={setSupplyAmount}
              submitLabel="Supply"
              isPending={busy}
              activeHere={activeHere("supply")}
              limit={debtBalance}
              onSubmit={supplyLiquidity}
            />
          )}

          <ActionPanel
            title="Withdraw Liquidity"
            tokenSymbol={debtSymbol}
            balance={lenderBalance}
            balanceLabel="Supplied balance"
            decimals={debtDecimals}
            amount={withdrawSupplyAmount}
            setAmount={setWithdrawSupplyAmount}
            submitLabel="Withdraw"
            isPending={busy}
            activeHere={activeHere("withdrawSupply")}
            limit={lenderBalance}
            limitMessage="Exceeds your supplied balance"
            onSubmit={withdrawSupply}
          />
        </div>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold text-white mb-4">Your Position</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
            <div className="text-xs text-ink-400 mb-1">Collateral Deposited</div>
            <div className="font-mono text-lg text-ink-100">
              {collDecimals !== undefined ? formatToken(collateralAmount, collDecimals, collSymbol) : "…"}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
            <div className="text-xs text-ink-400 mb-1">Debt Owed</div>
            <div className="font-mono text-lg text-ink-100">
              {debtDecimals !== undefined ? formatToken(debtAmount, debtDecimals, debtSymbol, 2) : "…"}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] flex flex-col items-center justify-center">
            <div className="text-xs text-ink-400 mb-1 self-start">Health Factor</div>
            <HealthFactorGauge
              hasDebt={debtAmount > 0n}
              hasPrice={hasPrice}
              ltvBps={ltvBps}
              liquidationThresholdBps={liquidationThresholdBps}
              healthFactor={healthFactor}
            />
          </div>
        </div>
        {debtAmount > 0n && !hasPrice && (
          <p className="text-xs text-warning-400 mt-4">
            Health Factor needs a live price feed from the lending-oracle DON workflow — none has ever reported here,
            so it shows as a dash rather than a fabricated number.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {needsCollApproval ? (
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-3">Deposit Collateral</h3>
            <p className="text-sm text-ink-400 mb-4">Approve {collSymbol} before depositing.</p>
            <button
              onClick={approveCollateral}
              disabled={!depositAmount || busy || overBalance(depositAmount, collDecimals, collBalance)}
              className="btn-press w-full py-2.5 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
            >
              {activeHere("approveColl") ? "Submitting…" : `Approve ${collSymbol}`}
            </button>
            <input
              className="w-full mt-3 bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              placeholder="Amount to approve/deposit"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
            />
          </div>
        ) : (
          <ActionPanel
            title="Deposit Collateral"
            tokenSymbol={collSymbol}
            balance={collBalance}
            decimals={collDecimals}
            amount={depositAmount}
            setAmount={setDepositAmount}
            submitLabel="Deposit"
            isPending={busy}
            activeHere={activeHere("deposit")}
            limit={collBalance}
            onSubmit={depositCollateral}
          />
        )}

        <ActionPanel
          title="Withdraw Collateral"
          tokenSymbol={collSymbol}
          balance={collateralAmount}
          balanceLabel="Deposited collateral"
          decimals={collDecimals}
          amount={withdrawAmount}
          setAmount={setWithdrawAmount}
          submitLabel="Withdraw"
          isPending={busy}
          activeHere={activeHere("withdraw")}
          limit={collateralAmount}
          limitMessage="Exceeds your deposited collateral"
          onMax={debtAmount === 0n && collateralAmount > 0n ? withdrawMax : undefined}
          onSubmit={withdrawCollateral}
        />

        {needsDebtApproval ? (
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-3">Repay</h3>
            <p className="text-sm text-ink-400 mb-4">Approve {debtSymbol} before repaying.</p>
            <button
              onClick={approveDebtForRepay}
              disabled={!repayAmount || busy || overBalance(repayAmount, debtDecimals, repayLimit)}
              className="btn-press w-full py-2.5 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
            >
              {activeHere("approveRepay") ? "Submitting…" : `Approve ${debtSymbol}`}
            </button>
            <input
              className="w-full mt-3 bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              placeholder="Amount to approve/repay"
              value={repayAmount}
              onChange={(e) => setRepayAmount(e.target.value)}
            />
          </div>
        ) : (
          <ActionPanel
            title="Repay"
            tokenSymbol={debtSymbol}
            balance={debtBalance}
            decimals={debtDecimals}
            amount={repayAmount}
            setAmount={setRepayAmount}
            submitLabel="Repay"
            isPending={busy}
            activeHere={activeHere("repay")}
            limit={repayLimit}
            onMax={repayMax}
            onSubmit={repay}
          />
        )}

        <ActionPanel
          title="Borrow"
          tokenSymbol={debtSymbol}
          balance={borrowInputLimit}
          balanceLabel="Available to borrow"
          decimals={debtDecimals}
          amount={borrowAmount}
          setAmount={setBorrowAmount}
          submitLabel="Borrow"
          isPending={busy}
          activeHere={activeHere("borrow")}
          limit={borrowInputLimit}
          limitMessage="Exceeds available liquidity / utilization cap"
          onSubmit={borrow}
        />
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-white mb-1">Positions at Risk</h3>
        <p className="text-xs text-ink-500 mb-4">
          Every wallet that has ever deposited collateral, ranked by current LTV — pure discovery, always re-checked
          live on-chain before anything acts on it. Click a row to load it below.
        </p>
        {borrowersLoading ? (
          <p className="text-sm text-ink-400">Loading…</p>
        ) : atRiskBorrowers.length === 0 ? (
          <p className="text-sm text-ink-400">No open positions with debt discovered yet.</p>
        ) : (
          <div className="space-y-2">
            {atRiskBorrowers
              .map((b) => {
                const collateralValue = hasPrice ? (b.collateralAmount * price) / 10n ** BigInt(priceDecimals) : undefined;
                const rowLtvBps = collateralValue && collateralValue > 0n ? (b.debtAmount * 10_000n) / collateralValue : undefined;
                return { ...b, rowLtvBps };
              })
              .sort((a, b) => {
                if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
                return Number((b.rowLtvBps ?? 0n) - (a.rowLtvBps ?? 0n));
              })
              .map((b) => (
                <button
                  key={b.address}
                  onClick={() => setLiquidateTarget(b.address)}
                  className={`btn-press w-full flex items-center justify-between gap-3 p-3 rounded-lg border text-left ${
                    b.eligible ? "bg-danger-500/10 border-danger-500/30" : "bg-ink-800/40 border-ink-700"
                  }`}
                >
                  <span className="font-mono text-xs text-ink-300">
                    {b.address.slice(0, 6)}…{b.address.slice(-4)}
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    {debtDecimals !== undefined && (
                      <span className="text-ink-400">{formatToken(b.debtAmount, debtDecimals, debtSymbol, 2)} owed</span>
                    )}
                    <span className="font-mono text-ink-300">{b.rowLtvBps !== undefined ? `${Number(b.rowLtvBps) / 100}% LTV` : "—"}</span>
                    {b.eligible ? (
                      <span className="text-danger-400 font-semibold">Eligible</span>
                    ) : (
                      <span className="text-ink-500">Not eligible</span>
                    )}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
        <h3 className="font-semibold text-white mb-3">Liquidate a Position</h3>
        <input
          className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono mb-3 focus:outline-none focus:border-trust-500"
          placeholder="Borrower address (0x…)"
          value={liquidateTarget}
          onChange={(e) => setLiquidateTarget(e.target.value)}
        />
        {liquidateTargetAddress && debtDecimals !== undefined && (
          <p className="text-xs text-ink-500 mb-4">
            Debt owed: {formatToken(targetDebtAmount, debtDecimals, debtSymbol, 2)} ·{" "}
            {targetEligible ? "Eligible for liquidation" : "Not eligible"}
          </p>
        )}
        {needsLiquidateApproval ? (
          <button
            onClick={approveDebtForLiquidate}
            disabled={!liquidateTargetAddress || busy}
            className="btn-press w-full py-2.5 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
          >
            {activeHere("approveLiq") ? "Submitting…" : `Approve ${debtSymbol}`}
          </button>
        ) : (
          <button
            onClick={liquidate}
            disabled={!liquidateTargetAddress || !targetEligible || busy}
            className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
          >
            {activeHere("liquidate") ? "Submitting…" : "Liquidate"}
          </button>
        )}
      </div>
    </div>
  );
}
