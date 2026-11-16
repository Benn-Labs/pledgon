"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { erc20Abi, formatUnits, isAddress } from "viem";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { lendingPoolAbi, liquidationConsumerAbi } from "@/generated/contracts";
import { lendingMarkets, isLendingConfigured } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { useLendingPosition } from "@/hooks/useLendingPosition";
import { useLenderRewards } from "@/hooks/useLenderRewards";
import {
  useLendingBorrowers,
  useRegisterBorrowerFromDeposit,
} from "@/hooks/useLendingBorrowers";
import { formatToken, formatTokenDustAware } from "@/lib/format";
import { tryParseUnits } from "@/lib/units";
import { toast } from "@/lib/toast";
import { useTxSequence, type TxStep } from "@/hooks/useTxSequence";
import { TxProgressModal } from "@/components/ui/TxProgressModal";
import { LendingIcon } from "@/components/ui/icons";
import { HealthFactorGauge } from "@/components/ui/HealthFactorGauge";

function EnvDiagnostic() {
  const checks = [
    { name: "NEXT_PUBLIC_XSTOCKS_LENDING_POOL_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_XSTOCKS_LENDING_POOL_ADDRESS) },
    { name: "NEXT_PUBLIC_XSTOCKS_LENDING_ORACLE_CONSUMER_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_XSTOCKS_LENDING_ORACLE_CONSUMER_ADDRESS) },
    { name: "NEXT_PUBLIC_XSTOCKS_LIQUIDATION_CONSUMER_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_XSTOCKS_LIQUIDATION_CONSUMER_ADDRESS) },
    { name: "NEXT_PUBLIC_XSTOCKS_COLLATERAL_TOKEN_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_XSTOCKS_COLLATERAL_TOKEN_ADDRESS) },
    { name: "NEXT_PUBLIC_XSTOCKS_DEBT_TOKEN_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_XSTOCKS_DEBT_TOKEN_ADDRESS) },
    { name: "NEXT_PUBLIC_XSTOCKS_MARKET_NAME", present: Boolean(process.env.NEXT_PUBLIC_XSTOCKS_MARKET_NAME) },
    { name: "NEXT_PUBLIC_SUSDE_LENDING_POOL_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_SUSDE_LENDING_POOL_ADDRESS) },
    { name: "NEXT_PUBLIC_SUSDE_LENDING_ORACLE_CONSUMER_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_SUSDE_LENDING_ORACLE_CONSUMER_ADDRESS) },
    { name: "NEXT_PUBLIC_SUSDE_LIQUIDATION_CONSUMER_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_SUSDE_LIQUIDATION_CONSUMER_ADDRESS) },
    { name: "NEXT_PUBLIC_SUSDE_COLLATERAL_TOKEN_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_SUSDE_COLLATERAL_TOKEN_ADDRESS) },
    { name: "NEXT_PUBLIC_SUSDE_DEBT_TOKEN_ADDRESS", present: Boolean(process.env.NEXT_PUBLIC_SUSDE_DEBT_TOKEN_ADDRESS) },
    { name: "NEXT_PUBLIC_SUSDE_MARKET_NAME", present: Boolean(process.env.NEXT_PUBLIC_SUSDE_MARKET_NAME) },
  ];

  return (
    <div className="mt-6 text-left inline-block">
      <p className="text-xs text-ink-500 mb-2">
        Browser-bundle env check ({checks.filter((c) => c.present).length}/{checks.length} present):
      </p>
      <div className="bg-ink-900 border border-ink-800 rounded-lg p-3 space-y-1 max-w-md mx-auto">
        {checks.map((c) => (
          <div key={c.name} className="flex items-center justify-between gap-4 text-xs">
            <code className="font-mono text-ink-400 truncate">{c.name}</code>
            <span className={c.present ? "text-trust-400 font-medium" : "text-danger-400 font-medium"}>
              {c.present ? "OK" : "missing"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotConfiguredFallback() {
  return (
    <div className="fade-in max-w-lg mx-auto text-center py-16">
      <LendingIcon className="w-10 h-10 text-ink-600 mx-auto mb-4" />
      <h1 className="text-xl font-display text-white mb-2">Lending isn&apos;t deployed on this network</h1>
      <p className="text-sm text-ink-400">
        Set the <code className="font-mono text-xs">NEXT_PUBLIC_XSTOCKS_*</code> and{" "}
        <code className="font-mono text-xs">NEXT_PUBLIC_SUSDE_*</code> env vars, then restart the dev server.
      </p>
      <EnvDiagnostic />
    </div>
  );
}

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

/** Mirrors LendingPool.collateralValueInDebtUnits(): collateral base units priced by the DON report, converted into debt-token base units. */
function collateralValueInDebtUnits(
  amount: bigint,
  price: bigint,
  priceDecimals: number,
  collDecimals: number,
  debtDecimals: number,
): bigint {
  let value = (amount * price) / 10n ** BigInt(priceDecimals);
  if (collDecimals > debtDecimals) {
    value = value / 10n ** BigInt(collDecimals - debtDecimals);
  } else if (collDecimals < debtDecimals) {
    value = value * 10n ** BigInt(debtDecimals - collDecimals);
  }
  return value;
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
  blockedReason,
  footer,
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
  isPending: boolean;
  activeHere?: boolean;
  limit?: bigint;
  limitMessage?: string;
  onMax?: () => void;
  /** When set, the entered amount would revert on-chain — show why and block submit. */
  blockedReason?: string;
  /** Extra content under the submit button (e.g. an escape hatch for a blocked state). */
  footer?: ReactNode;
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
            <button
              type="button"
              onClick={onMax}
              className="rounded px-1.5 py-0.5 text-xs font-semibold text-trust-400 hover:bg-ink-700"
            >
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
      {blockedReason && !overLimit && <p className="text-xs text-danger-400 mb-2">{blockedReason}</p>}
      <button
        onClick={onSubmit}
        disabled={!amount || isPending || overLimit || Boolean(blockedReason)}
        className="btn-press mt-2 w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
      >
        {activeHere ? "Submitting…" : submitLabel}
      </button>
      {footer}
    </div>
  );
}

function LendingPageContent() {
  const { address: account } = useAccount();
  const [selectedMarketId, setSelectedMarketId] = useState<string>(() => lendingMarkets[0].id);
  const selectedMarket = useMemo(
    () => lendingMarkets.find((m) => m.id === selectedMarketId) ?? lendingMarkets[0],
    [selectedMarketId]
  );

  const { decimals: collDecimals, symbol: collSymbol } = useToken(selectedMarket.collateralToken);
  const { decimals: debtDecimals, symbol: debtSymbol } = useToken(selectedMarket.debtToken);
  const {
    hasPrice,
    healthFactor,
    ltvBps,
    liquidationThresholdBps,
    price,
    priceDecimals,
    maxUtilizationBps,
  } = useLendingPosition(selectedMarket);
  const {
    rewards: feeRewards,
    windowSeconds: rewardSeconds,
    windowLabel: rewardWindow,
    isError: rewardsError,
  } = useLenderRewards(selectedMarket);
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

  // The raw `totalBorrows` getter is storage-only: it only picks up accrued
  // interest when a pool tx runs _accrue(), so it reads low between
  // operations while totalSupply() (used for "Total Supplied") is always
  // live. Derive borrows the same way LendingPool.totalSupply() does —
  // balance + currentTotalBorrows — so the two stat cards and the
  // utilization bar stay consistent (e.g. 2000.10 next to 6000.10, not a
  // stale 2000.03).
  const { data: poolTokenBalance, refetch: refetchPoolTokenBalance } = useReadContract({
    address: selectedMarket.debtToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [selectedMarket.lendingPool],
    query: { enabled: Boolean(selectedMarket.debtToken && selectedMarket.lendingPool) },
  });

  const poolTotalBorrows =
    poolTotalSupply !== undefined && poolTokenBalance !== undefined ? poolTotalSupply - poolTokenBalance : undefined;

  const { data: borrowRateBps } = useReadContract({
    address: selectedMarket.lendingPool,
    abi: lendingPoolAbi,
    functionName: "borrowRateBps",
    query: { enabled: Boolean(selectedMarket.lendingPool) },
  });

  // Clears the input of the operation whose sequence just completed, so a
  // leftover amount doesn't sit there exceeding the freshly recomputed limit
  // (e.g. after a borrow, the old amount reads as "over credit limit" even
  // though it executed fine). Set when an op starts, fired in onDone.
  const clearAfterRunRef = useRef<(() => void) | null>(null);

  const sequence = useTxSequence({
    onStepConfirmed: (confirmedHash) => {
      // Best-effort, silent — write-lending-borrower verifies on-chain
      // whether this transaction actually emitted CollateralDeposited, so
      // passing every confirmed step's hash (not just known deposits) is
      // safe: anything else just fails harmlessly server-side, and there's
      // no wallet prompt either way to make that failure user-visible.
      registerBorrowerFromDeposit(confirmedHash);
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
      refetchPoolTokenBalance();
    },
    onDone: () => {
      clearAfterRunRef.current?.();
      clearAfterRunRef.current = null;
    },
  });
  const busy = sequence.busy;

  function run(opTitle: string, opSteps: TxStep[], clear?: () => void) {
    clearAfterRunRef.current = clear ?? null;
    sequence.start(opTitle, opSteps);
  }

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

  const [collateralAmount, debtAmount] = position ?? [0n, 0n];
  const [, targetDebtAmount] = targetPosition ?? [0n, 0n];

  const depositParsed = collDecimals !== undefined ? tryParseUnits(depositAmount, collDecimals) : undefined;
  const repayParsed = debtDecimals !== undefined ? tryParseUnits(repayAmount, debtDecimals) : undefined;
  const supplyParsed = debtDecimals !== undefined ? tryParseUnits(supplyAmount, debtDecimals) : undefined;
  const withdrawParsed = collDecimals !== undefined ? tryParseUnits(withdrawAmount, collDecimals) : undefined;

  const repayLimit = debtBalance !== undefined && debtAmount > debtBalance ? debtBalance : undefined;

  // Mirrors the pool's withdrawCollateral revert: after removing the entered
  // amount, remaining collateral must still cover existing debt at the
  // liquidation threshold (debt of 0 means any withdraw up to the deposit is
  // fine). Catches the "withdraw everything while dust debt remains" case
  // client-side instead of a WouldBeUndercollateralized revert.
  const withdrawBreaksPosition =
    withdrawParsed !== undefined &&
    withdrawParsed <= collateralAmount &&
    debtAmount > 0n &&
    hasPrice &&
    liquidationThresholdBps !== undefined &&
    collDecimals !== undefined &&
    debtDecimals !== undefined &&
    (() => {
      const value = collateralValueInDebtUnits(collateralAmount - withdrawParsed, price, priceDecimals, collDecimals, debtDecimals);
      return value * liquidationThresholdBps < debtAmount * 10_000n;
    })();

  // The dust debt, buffered for interest that accrues before the repay lands
  // (repay() clamps overpayment to the real debt, so the wallet and approval
  // only ever fund what's actually owed). The combined repay-and-escape is
  // offered only when the wallet can actually cover this figure.
  const dustBuffered = debtAmount > 0n ? debtAmount + debtAmount / 1000n + 1n : undefined;
  const dustClearable = dustBuffered !== undefined && debtBalance !== undefined && debtBalance >= dustBuffered;

  const borrowInputLimit =
    poolTotalSupply !== undefined && poolTotalBorrows !== undefined
      ? (() => {
          const idle = poolTotalSupply - poolTotalBorrows;
          let poolCap: bigint;
          if (maxUtilizationBps === undefined || maxUtilizationBps === 0n) {
            poolCap = idle;
          } else {
            const capBorrows = (poolTotalSupply * maxUtilizationBps) / 10_000n;
            poolCap = capBorrows > poolTotalBorrows ? capBorrows - poolTotalBorrows : 0n;
            if (idle < poolCap) poolCap = idle;
          }
          // Collateral credit limit — mirrors LendingPool._isUndercollateralizedAmounts:
          // collateral value in debt units (price scale + decimal conversion, same as
          // the contract and useLendingPosition), times the liquidation threshold.
          // Without a live price collateral can't be priced here; fall back to the
          // pool cap and let the contract fail closed with StalePrice.
          if (!hasPrice || liquidationThresholdBps === undefined || collDecimals === undefined || debtDecimals === undefined) {
            return poolCap;
          }
          const collateralValue = collateralValueInDebtUnits(collateralAmount, price, priceDecimals, collDecimals, debtDecimals);
          const maxDebt = (collateralValue * liquidationThresholdBps) / 10_000n;
          const creditLimit = maxDebt > debtAmount ? maxDebt - debtAmount : 0n;
          return creditLimit < poolCap ? creditLimit : poolCap;
        })()
      : undefined;

  function repayMax() {
    if (debtDecimals === undefined || debtAmount === 0n) return;
    // Fill the full (interest-buffered) debt even when the wallet can't
    // cover it — the panel's limit then shows "Exceeds wallet balance"
    // instead of silently collapsing to 0, which hid the dust debt behind
    // an empty-looking input. repay() clamps overpayment to the real debt.
    setRepayAmount(formatUnits(debtAmount + debtAmount / 1000n + 1n, debtDecimals));
  }

  function withdrawMax() {
    if (collDecimals === undefined) return;
    setWithdrawAmount(formatUnits(collateralAmount, collDecimals));
  }

  // Every operation runs as a sequence through useTxSequence. When the token
  // allowance doesn't cover the amount, an approve step is prepended and the
  // main action fires automatically once the approve confirms on-chain — the
  // two wallet prompts follow each other with no manual re-click. The step
  // list (with per-step descriptions) drives the TxProgressModal.
  function depositCollateral() {
    const pool = selectedMarket.lendingPool;
    const collToken = selectedMarket.collateralToken;
    if (collDecimals === undefined) return;
    if (depositParsed === undefined) {
      toast("Enter a valid amount to deposit", "warning");
      return;
    }
    const amount = depositParsed;
    const label = formatToken(amount, collDecimals, collSymbol);
    const steps: TxStep[] = [];
    if ((collAllowance ?? 0n) < amount) {
      steps.push({
        title: `Approve ${collSymbol}`,
        description: `Allow the ${selectedMarket.name} pool to pull ${label} from your wallet. A one-time approval for this amount.`,
        tx: { address: collToken, abi: erc20Abi, functionName: "approve", args: [pool, amount] },
      });
    }
    steps.push({
      title: "Deposit Collateral",
      description: `Move ${label} into the pool as collateral for your position.`,
      tx: { address: pool, abi: lendingPoolAbi, functionName: "depositCollateral", args: [amount] },
    });
    run("Deposit Collateral", steps, () => setDepositAmount(""));
  }

  function withdrawCollateral() {
    const pool = selectedMarket.lendingPool;
    if (collDecimals === undefined) return;
    if (withdrawParsed === undefined) {
      toast("Enter a valid amount to withdraw", "warning");
      return;
    }
    const amount = withdrawParsed;
    run("Withdraw Collateral", [
      {
        title: "Withdraw Collateral",
        description:
          `Send ${formatToken(amount, collDecimals, collSymbol)} of collateral back to your wallet` +
          (debtAmount > 0n ? ". Your position must stay overcollateralized — the pool reverts otherwise." : "."),
        tx: { address: pool, abi: lendingPoolAbi, functionName: "withdrawCollateral", args: [amount] },
      },
    ], () => setWithdrawAmount(""));
  }

  // One-click escape for the blocked-full-withdrawal state: clear the dust
  // debt and pull out the entire collateral as a single sequence. The repay
  // amount is buffered for interest accrued since the read and clamped by
  // the pool to the real debt, so the wallet only funds what's owed; once
  // the debt hits zero the withdraw of everything is unconditional.
  function repayDustAndWithdrawAll() {
    const pool = selectedMarket.lendingPool;
    const debtToken = selectedMarket.debtToken;
    if (collDecimals === undefined || debtDecimals === undefined || dustBuffered === undefined) return;
    if (debtBalance === undefined || debtBalance < dustBuffered) {
      toast("Your wallet needs USDC to cover the dust debt first", "warning");
      return;
    }
    const dustLabel = formatTokenDustAware(debtAmount, debtDecimals, debtSymbol, 4);
    const steps: TxStep[] = [];
    if ((debtAllowance ?? 0n) < dustBuffered) {
      steps.push({
        title: `Approve ${debtSymbol}`,
        description: `Allow the pool to pull up to ${formatToken(dustBuffered, debtDecimals, debtSymbol)} to cover the ${dustLabel} debt — the pool only takes what's actually owed.`,
        tx: { address: debtToken, abi: erc20Abi, functionName: "approve", args: [pool, dustBuffered] },
      });
    }
    steps.push({
      title: "Repay Dust Debt",
      description: `Pay off the ${dustLabel} debt so the collateral can be released. Anything above the real debt is clamped and stays in your wallet.`,
      tx: { address: pool, abi: lendingPoolAbi, functionName: "repay", args: [dustBuffered] },
    });
    steps.push({
      title: "Withdraw Collateral",
      description: `Send all ${formatToken(collateralAmount, collDecimals, collSymbol)} of your collateral back to your wallet.`,
      tx: { address: pool, abi: lendingPoolAbi, functionName: "withdrawCollateral", args: [collateralAmount] },
    });
    run("Repay Dust & Withdraw All", steps, () => setWithdrawAmount(""));
  }

  function repay() {
    const pool = selectedMarket.lendingPool;
    const debtToken = selectedMarket.debtToken;
    if (debtDecimals === undefined) return;
    if (repayParsed === undefined) {
      toast("Enter a valid amount to repay", "warning");
      return;
    }
    const amount = repayParsed;
    const label = formatToken(amount, debtDecimals, debtSymbol);
    const steps: TxStep[] = [];
    if ((debtAllowance ?? 0n) < amount) {
      steps.push({
        title: `Approve ${debtSymbol}`,
        description: `Allow the ${selectedMarket.name} pool to pull ${label} from your wallet to repay your debt.`,
        tx: { address: debtToken, abi: erc20Abi, functionName: "approve", args: [pool, amount] },
      });
    }
    steps.push({
      title: "Repay Debt",
      description: `Pay back ${label}. Interest stops accruing on the repaid amount.`,
      tx: { address: pool, abi: lendingPoolAbi, functionName: "repay", args: [amount] },
    });
    run("Repay Debt", steps, () => setRepayAmount(""));
  }

  function borrow() {
    const pool = selectedMarket.lendingPool;
    if (debtDecimals === undefined) return;
    const amount = tryParseUnits(borrowAmount, debtDecimals);
    if (amount === undefined) {
      toast("Enter a valid amount to borrow", "warning");
      return;
    }
    run("Borrow", [
      {
        title: "Borrow",
        description: `Borrow ${formatToken(amount, debtDecimals, debtSymbol)} against your deposited collateral. Interest accrues at the fixed rate shown above — watch your health factor.`,
        tx: { address: pool, abi: lendingPoolAbi, functionName: "borrow", args: [amount] },
      },
    ], () => setBorrowAmount(""));
  }

  function liquidate() {
    const pool = selectedMarket.lendingPool;
    const debtToken = selectedMarket.debtToken;
    if (!liquidateTargetAddress || debtDecimals === undefined) return;
    const buffered = targetDebtAmount + targetDebtAmount / 100n + 1n;
    const steps: TxStep[] = [];
    if ((debtAllowance ?? 0n) < targetDebtAmount) {
      steps.push({
        title: `Approve ${debtSymbol}`,
        description: `Allow the pool to pull up to ${formatToken(buffered, debtDecimals, debtSymbol)} — the borrower's debt plus a small buffer for accrued interest.`,
        tx: { address: debtToken, abi: erc20Abi, functionName: "approve", args: [pool, buffered] },
      });
    }
    steps.push({
      title: "Liquidate Position",
      description: `Repay the borrower's debt and seize their collateral. Only succeeds once the DON has attested this borrower eligible.`,
      tx: { address: pool, abi: lendingPoolAbi, functionName: "liquidate", args: [liquidateTargetAddress] },
    });
    run("Liquidate Position", steps, () => setLiquidateTarget(""));
  }

  function supplyLiquidity() {
    const pool = selectedMarket.lendingPool;
    const debtToken = selectedMarket.debtToken;
    if (debtDecimals === undefined) return;
    if (supplyParsed === undefined) {
      toast("Enter a valid amount to supply", "warning");
      return;
    }
    const amount = supplyParsed;
    const label = formatToken(amount, debtDecimals, debtSymbol);
    const steps: TxStep[] = [];
    if ((debtAllowance ?? 0n) < amount) {
      steps.push({
        title: `Approve ${debtSymbol}`,
        description: `Allow the ${selectedMarket.name} pool to pull ${label} from your wallet for supplying.`,
        tx: { address: debtToken, abi: erc20Abi, functionName: "approve", args: [pool, amount] },
      });
    }
    steps.push({
      title: "Supply Liquidity",
      description: `Lend ${label} to the pool. Your share of the pool — and the interest borrowers pay — accrues in place.`,
      tx: { address: pool, abi: lendingPoolAbi, functionName: "depositLiquidity", args: [amount] },
    });
    run("Supply Liquidity", steps, () => setSupplyAmount(""));
  }

  function withdrawSupply() {
    const pool = selectedMarket.lendingPool;
    if (debtDecimals === undefined) return;
    const requested = tryParseUnits(withdrawSupplyAmount, debtDecimals);
    if (requested === undefined) {
      toast("Enter a valid amount to withdraw", "warning");
      return;
    }
    const userShares = lenderShares ?? 0n;
    const userBalance = lenderBalance ?? 0n;
    const shares =
      userBalance > 0n && requested >= userBalance
        ? userShares
        : (requested * userShares) / (userBalance || 1n);
    run("Withdraw Liquidity", [
      {
        title: "Withdraw Liquidity",
        description: `Withdraw ${formatToken(requested, debtDecimals, debtSymbol)} of supplied liquidity, with its share of accrued interest, back to your wallet.`,
        tx: { address: pool, abi: lendingPoolAbi, functionName: "withdrawLiquidity", args: [shares] },
      },
    ], () => setWithdrawSupplyAmount(""));
  }

  return (
    <div className="fade-in max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display text-white">Lending</h1>
          <p className="text-ink-400 mt-1">
            Deposit collateral, borrow against it, with DON-corroborated liquidation protection
          </p>
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
          onChange={(e) => setSelectedMarketId(e.target.value)}
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
                {formatToken(feeRewards, debtDecimals, debtSymbol, 2)} shared with lenders from platform fees in the
                last {rewardWindow}
                {poolTotalSupply !== undefined && poolTotalSupply > 0n && (
                  <>
                    {" "}
                    — about{" "}
                    {((Number((feeRewards * 1_000_000n) / poolTotalSupply) / 10_000) * ((365 * 86_400) / rewardSeconds)).toFixed(2)}
                    % a year on top of borrower interest, if repeated
                  </>
                )}
                .
              </>
            ) : (
              <>none in the last {rewardWindow}. A share of platform fees is paid into the pool for lenders from time to time.</>
            )}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ActionPanel
            title="Supply Liquidity"
            tokenSymbol={debtSymbol}
            balance={debtBalance}
            decimals={debtDecimals}
            amount={supplyAmount}
            setAmount={setSupplyAmount}
            submitLabel="Supply"
            isPending={busy}
            activeHere={busy}
            limit={debtBalance}
            onSubmit={supplyLiquidity}
          />

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
            activeHere={busy}
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
              {debtDecimals !== undefined ? formatTokenDustAware(debtAmount, debtDecimals, debtSymbol) : "…"}
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
        <ActionPanel
          title="Deposit Collateral"
          tokenSymbol={collSymbol}
          balance={collBalance}
          decimals={collDecimals}
          amount={depositAmount}
          setAmount={setDepositAmount}
          submitLabel="Deposit"
          isPending={busy}
          activeHere={busy}
          limit={collBalance}
          onSubmit={depositCollateral}
        />

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
          activeHere={busy}
          limit={collateralAmount}
          limitMessage="Exceeds your deposited collateral"
          onMax={debtAmount === 0n && collateralAmount > 0n ? withdrawMax : undefined}
          blockedReason={
            withdrawBreaksPosition && debtDecimals !== undefined
              ? `This withdrawal would leave your position undercollateralized — repay the ${formatTokenDustAware(
                  debtAmount,
                  debtDecimals,
                  debtSymbol,
                  4,
                )} debt first, then withdraw.`
              : undefined
          }
          footer={
            withdrawBreaksPosition && debtDecimals !== undefined ? (
              dustClearable ? (
                <button
                  onClick={repayDustAndWithdrawAll}
                  disabled={busy}
                  className="btn-press w-full py-2 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white text-sm font-semibold"
                >
                  {busy
                    ? "Submitting…"
                    : `Repay ${formatTokenDustAware(debtAmount, debtDecimals, debtSymbol, 4)} & Withdraw All ${collSymbol ?? "Collateral"}`}
                </button>
              ) : (
                <p className="text-xs text-warning-400">
                  Clearing the {formatTokenDustAware(debtAmount, debtDecimals, debtSymbol, 4)} dust debt needs USDC in
                  your wallet (balance:{" "}
                  {debtBalance !== undefined ? formatTokenDustAware(debtBalance, debtDecimals, debtSymbol, 4) : "…"}).
                  Grab testnet USDC from a faucet (e.g. faucet.circle.com), then use the button above.
                </p>
              )
            ) : undefined
          }
          onSubmit={withdrawCollateral}
        />

        <ActionPanel
          title="Repay"
          tokenSymbol={debtSymbol}
          balance={debtBalance}
          decimals={debtDecimals}
          amount={repayAmount}
          setAmount={setRepayAmount}
          submitLabel="Repay"
          isPending={busy}
          activeHere={busy}
          limit={repayLimit}
          onMax={repayMax}
          onSubmit={repay}
        />

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
          activeHere={busy}
          limit={borrowInputLimit}
          limitMessage="Exceeds your collateral credit limit or available liquidity"
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
                const collateralValue = hasPrice
                  ? (b.collateralAmount * price) / 10n ** BigInt(priceDecimals)
                  : undefined;
                const rowLtvBps =
                  collateralValue && collateralValue > 0n ? (b.debtAmount * 10_000n) / collateralValue : undefined;
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
                    <span className="font-mono text-ink-300">
                      {b.rowLtvBps !== undefined ? `${Number(b.rowLtvBps) / 100}% LTV` : "—"}
                    </span>
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
        <button
          onClick={liquidate}
          disabled={!liquidateTargetAddress || !targetEligible || busy}
          className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
        >
          {busy ? "Submitting…" : "Liquidate"}
        </button>
      </div>

      <TxProgressModal
        title={sequence.title}
        steps={sequence.steps}
        index={sequence.index}
        phase={sequence.phase}
        errorMessage={sequence.errorMessage}
        onClose={sequence.close}
      />
    </div>
  );
}

export default function LendingPageClient() {
  if (!isLendingConfigured) {
    return <NotConfiguredFallback />;
  }
  return <LendingPageContent />;
}
