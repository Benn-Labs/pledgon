"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { erc20Abi, isAddress, parseUnits } from "viem";
import type { Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { lendingPoolAbi, liquidationConsumerAbi } from "@/generated/contracts";
import { addresses, isLendingConfigured } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { useLendingPosition } from "@/hooks/useLendingPosition";
import { useLendingBorrowers, useEnsureLendingBorrowerRegistered } from "@/hooks/useLendingBorrowers";
import { formatToken } from "@/lib/format";
import { toast } from "@/lib/toast";
import { LendingIcon } from "@/components/ui/icons";
import { HealthFactorGauge } from "@/components/ui/HealthFactorGauge";

function ActionPanel({
  title,
  tokenSymbol,
  balance,
  decimals,
  amount,
  setAmount,
  onSubmit,
  submitLabel,
  isPending,
}: {
  title: string;
  tokenSymbol?: string;
  balance?: bigint;
  decimals?: number;
  amount: string;
  setAmount: (v: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  isPending: boolean;
}) {
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
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm">{tokenSymbol ?? ""}</span>
      </div>
      {balance !== undefined && decimals !== undefined && (
        <p className="text-xs text-ink-500 mb-4">Wallet balance: {formatToken(balance, decimals, tokenSymbol)}</p>
      )}
      <button
        onClick={onSubmit}
        disabled={!amount || isPending}
        className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
      >
        {isPending ? "Submitting…" : submitLabel}
      </button>
    </div>
  );
}

export default function LendingPage() {
  const { address: account } = useAccount();

  const { decimals: collDecimals, symbol: collSymbol } = useToken(addresses.collateralToken);
  const { decimals: debtDecimals, symbol: debtSymbol } = useToken(addresses.debtToken);
  const { hasPrice, healthFactor, ltvBps, liquidationThresholdBps, price, priceDecimals } = useLendingPosition();
  const { borrowers: atRiskBorrowers, isLoading: borrowersLoading } = useLendingBorrowers();
  const ensureBorrowerRegistered = useEnsureLendingBorrowerRegistered();

  const { data: position, refetch: refetchPosition } = useReadContract({
    address: addresses.lendingPool,
    abi: lendingPoolAbi,
    functionName: "positions",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.lendingPool && account) },
  });

  // Backfills the discovery table for positions that predate this feature —
  // registration used to only fire right after a fresh depositCollateral()
  // success, which left every already-open position invisible forever
  // unless its owner happened to deposit again. Firing this whenever a
  // connected wallet's existing position is read closes that gap: visiting
  // this page with an open position is enough, no new deposit required.
  // ensureBorrowerRegistered itself checks Supabase before ever prompting a
  // signature, so this can safely re-run on every position refetch without
  // re-asking an already-registered wallet to sign again.
  useEffect(() => {
    if (!account || !position) return;
    const [collateralAmount] = position;
    if (collateralAmount === 0n) return;
    ensureBorrowerRegistered();
  }, [account, position, ensureBorrowerRegistered]);

  const { data: collBalance, refetch: refetchCollBalance } = useReadContract({
    address: addresses.collateralToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.collateralToken && account) },
  });

  const { data: debtBalance, refetch: refetchDebtBalance } = useReadContract({
    address: addresses.debtToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.debtToken && account) },
  });

  const { data: collAllowance, refetch: refetchCollAllowance } = useReadContract({
    address: addresses.collateralToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: account && addresses.lendingPool ? [account, addresses.lendingPool] : undefined,
    query: { enabled: Boolean(addresses.collateralToken && addresses.lendingPool && account) },
  });

  const { data: debtAllowance, refetch: refetchDebtAllowance } = useReadContract({
    address: addresses.debtToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: account && addresses.lendingPool ? [account, addresses.lendingPool] : undefined,
    query: { enabled: Boolean(addresses.debtToken && addresses.lendingPool && account) },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [liquidateTarget, setLiquidateTarget] = useState("");

  const liquidateTargetAddress = isAddress(liquidateTarget) ? (liquidateTarget as Address) : undefined;

  const { data: targetPosition, refetch: refetchTargetPosition } = useReadContract({
    address: addresses.lendingPool,
    abi: lendingPoolAbi,
    functionName: "positions",
    args: liquidateTargetAddress ? [liquidateTargetAddress] : undefined,
    query: { enabled: Boolean(addresses.lendingPool && liquidateTargetAddress) },
  });

  const { data: targetEligible, refetch: refetchTargetEligible } = useReadContract({
    address: addresses.liquidationConsumer,
    abi: liquidationConsumerAbi,
    functionName: "isEligible",
    args: liquidateTargetAddress ? [liquidateTargetAddress] : undefined,
    query: { enabled: Boolean(addresses.liquidationConsumer && liquidateTargetAddress) },
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
      // Borrower registration isn't handled here — refetchPosition() above
      // updates `position`, which the backfill effect above already reacts
      // to (and it's the one that actually checks Supabase before ever
      // prompting a signature, deposit or not).
    }
  }, [
    isSuccess,
    refetchPosition,
    refetchCollBalance,
    refetchDebtBalance,
    refetchCollAllowance,
    refetchDebtAllowance,
    refetchTargetPosition,
    refetchTargetEligible,
  ]);

  useEffect(() => {
    if (error) toast(error.message, "error");
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
  const needsCollApproval =
    collDecimals !== undefined && depositAmount ? (collAllowance ?? 0n) < parseUnits(depositAmount, collDecimals) : false;
  const needsDebtApproval =
    debtDecimals !== undefined && repayAmount ? (debtAllowance ?? 0n) < parseUnits(repayAmount, debtDecimals) : false;
  const needsLiquidateApproval = liquidateTargetAddress ? (debtAllowance ?? 0n) < targetDebtAmount : false;

  function approveCollateral() {
    if (!addresses.lendingPool || !addresses.collateralToken || collDecimals === undefined) return;
    writeContract({
      address: addresses.collateralToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [addresses.lendingPool, parseUnits(depositAmount || "0", collDecimals)],
    });
  }

  function depositCollateral() {
    if (!addresses.lendingPool || collDecimals === undefined) return;
    writeContract({
      address: addresses.lendingPool,
      abi: lendingPoolAbi,
      functionName: "depositCollateral",
      args: [parseUnits(depositAmount || "0", collDecimals)],
    });
  }

  function withdrawCollateral() {
    if (!addresses.lendingPool || collDecimals === undefined) return;
    writeContract({
      address: addresses.lendingPool,
      abi: lendingPoolAbi,
      functionName: "withdrawCollateral",
      args: [parseUnits(withdrawAmount || "0", collDecimals)],
    });
  }

  function approveDebtForRepay() {
    if (!addresses.lendingPool || !addresses.debtToken || debtDecimals === undefined) return;
    writeContract({
      address: addresses.debtToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [addresses.lendingPool, parseUnits(repayAmount || "0", debtDecimals)],
    });
  }

  function repay() {
    if (!addresses.lendingPool || debtDecimals === undefined) return;
    writeContract({
      address: addresses.lendingPool,
      abi: lendingPoolAbi,
      functionName: "repay",
      args: [parseUnits(repayAmount || "0", debtDecimals)],
    });
  }

  function borrow() {
    if (!addresses.lendingPool || debtDecimals === undefined) return;
    writeContract({
      address: addresses.lendingPool,
      abi: lendingPoolAbi,
      functionName: "borrow",
      args: [parseUnits(borrowAmount || "0", debtDecimals)],
    });
  }

  function approveDebtForLiquidate() {
    if (!addresses.lendingPool || !addresses.debtToken) return;
    writeContract({
      address: addresses.debtToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [addresses.lendingPool, targetDebtAmount],
    });
  }

  function liquidate() {
    if (!addresses.lendingPool || !liquidateTargetAddress) return;
    writeContract({
      address: addresses.lendingPool,
      abi: lendingPoolAbi,
      functionName: "liquidate",
      args: [liquidateTargetAddress],
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

      <div className="p-4 rounded-lg bg-trust-500/10 border border-trust-500/30 mb-6">
        <p className="text-sm text-trust-400 font-medium mb-1">Live price feed active</p>
        <p className="text-sm text-ink-300">
          The <code className="font-mono text-xs">liquidation-protection</code> DON workflow is registered and
          reporting to <code className="font-mono text-xs">LendingOracleConsumer</code> every 5 minutes, so Borrow
          now works. Liquidate only succeeds once{" "}
          <code className="font-mono text-xs">LiquidationConsumer</code> has attested that specific borrower
          eligible — most positions won&apos;t be.
        </p>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold text-white mb-4">Your Position</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-ink-800/50 border border-ink-700">
            <div className="text-xs text-ink-400 mb-1">Collateral Deposited</div>
            <div className="font-mono text-lg text-ink-100">
              {collDecimals !== undefined ? formatToken(collateralAmount, collDecimals, collSymbol) : "…"}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-ink-800/50 border border-ink-700">
            <div className="text-xs text-ink-400 mb-1">Debt Owed</div>
            <div className="font-mono text-lg text-ink-100">
              {debtDecimals !== undefined ? formatToken(debtAmount, debtDecimals, debtSymbol) : "…"}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-ink-800/50 border border-ink-700 flex flex-col items-center justify-center">
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
            Health Factor needs a live price feed from the liquidation-protection DON workflow — none has ever
            reported here, so it shows as a dash rather than a fabricated number.
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
              disabled={!depositAmount || isPending || isConfirming}
              className="btn-press w-full py-2.5 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
            >
              Approve {collSymbol}
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
            isPending={isPending || isConfirming}
            onSubmit={depositCollateral}
          />
        )}

        <ActionPanel
          title="Withdraw Collateral"
          tokenSymbol={collSymbol}
          amount={withdrawAmount}
          setAmount={setWithdrawAmount}
          submitLabel="Withdraw"
          isPending={isPending || isConfirming}
          onSubmit={withdrawCollateral}
        />

        {needsDebtApproval ? (
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-3">Repay</h3>
            <p className="text-sm text-ink-400 mb-4">Approve {debtSymbol} before repaying.</p>
            <button
              onClick={approveDebtForRepay}
              disabled={!repayAmount || isPending || isConfirming}
              className="btn-press w-full py-2.5 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
            >
              Approve {debtSymbol}
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
            isPending={isPending || isConfirming}
            onSubmit={repay}
          />
        )}

        <ActionPanel
          title="Borrow"
          tokenSymbol={debtSymbol}
          balance={debtBalance}
          decimals={debtDecimals}
          amount={borrowAmount}
          setAmount={setBorrowAmount}
          submitLabel="Borrow"
          isPending={isPending || isConfirming}
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
                      <span className="text-ink-400">{formatToken(b.debtAmount, debtDecimals, debtSymbol)} owed</span>
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
            Debt owed: {formatToken(targetDebtAmount, debtDecimals, debtSymbol)} ·{" "}
            {targetEligible ? "Eligible for liquidation" : "Not eligible"}
          </p>
        )}
        {needsLiquidateApproval ? (
          <button
            onClick={approveDebtForLiquidate}
            disabled={!liquidateTargetAddress || isPending || isConfirming}
            className="btn-press w-full py-2.5 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
          >
            Approve {debtSymbol}
          </button>
        ) : (
          <button
            onClick={liquidate}
            disabled={!liquidateTargetAddress || !targetEligible || isPending || isConfirming}
            className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
          >
            {isPending || isConfirming ? "Submitting…" : "Liquidate"}
          </button>
        )}
      </div>
    </div>
  );
}
