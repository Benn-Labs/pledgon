"use client";

import { useEffect, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { lendingPoolAbi } from "@/generated/contracts";
import { addresses, isLendingConfigured } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { formatToken } from "@/lib/format";
import { toast } from "@/lib/toast";
import { LendingIcon } from "@/components/ui/icons";

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

  const { data: position, refetch: refetchPosition } = useReadContract({
    address: addresses.lendingPool,
    abi: lendingPoolAbi,
    functionName: "positions",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.lendingPool && account) },
  });

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

  useEffect(() => {
    if (isSuccess) {
      toast("Transaction confirmed", "success");
      refetchPosition();
      refetchCollBalance();
      refetchDebtBalance();
      refetchCollAllowance();
      refetchDebtAllowance();
    }
  }, [isSuccess, refetchPosition, refetchCollBalance, refetchDebtBalance, refetchCollAllowance, refetchDebtAllowance]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  if (!isLendingConfigured) {
    return (
      <div className="fade-in max-w-lg mx-auto text-center py-16">
        <LendingIcon className="w-10 h-10 text-ink-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">Lending isn&apos;t deployed on this network</h1>
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
  const needsCollApproval =
    collDecimals !== undefined && depositAmount ? (collAllowance ?? 0n) < parseUnits(depositAmount, collDecimals) : false;
  const needsDebtApproval =
    debtDecimals !== undefined && repayAmount ? (debtAllowance ?? 0n) < parseUnits(repayAmount, debtDecimals) : false;

  return (
    <div className="fade-in max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Lending</h1>
        <p className="text-ink-400 mt-1">Deposit collateral, borrow against it, with DON-corroborated liquidation protection</p>
      </div>

      <div className="p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 mb-6">
        <p className="text-sm text-warning-400 font-medium mb-1">Borrow and Liquidate are inert in this environment</p>
        <p className="text-sm text-ink-300">
          Both require a price that only a live <code className="font-mono text-xs">liquidation-protection</code>{" "}
          DON workflow can report to <code className="font-mono text-xs">LendingOracleConsumer</code> — none is
          registered against a real DON here, so those two calls will always revert. Deposit, withdraw, and repay
          don&apos;t need a price and work normally.
        </p>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold text-white mb-4">Your Position</h2>
        <div className="grid grid-cols-2 gap-4">
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
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {needsCollApproval ? (
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-3">Deposit Collateral</h3>
            <p className="text-sm text-ink-400 mb-4">Approve {collSymbol} before depositing.</p>
            <button
              onClick={() =>
                addresses.lendingPool &&
                addresses.collateralToken &&
                collDecimals !== undefined &&
                writeContract({
                  address: addresses.collateralToken,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [addresses.lendingPool, parseUnits(depositAmount || "0", collDecimals)],
                })
              }
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
            onSubmit={() =>
              addresses.lendingPool &&
              collDecimals !== undefined &&
              writeContract({
                address: addresses.lendingPool,
                abi: lendingPoolAbi,
                functionName: "depositCollateral",
                args: [parseUnits(depositAmount || "0", collDecimals)],
              })
            }
          />
        )}

        <ActionPanel
          title="Withdraw Collateral"
          tokenSymbol={collSymbol}
          amount={withdrawAmount}
          setAmount={setWithdrawAmount}
          submitLabel="Withdraw"
          isPending={isPending || isConfirming}
          onSubmit={() =>
            addresses.lendingPool &&
            collDecimals !== undefined &&
            writeContract({
              address: addresses.lendingPool,
              abi: lendingPoolAbi,
              functionName: "withdrawCollateral",
              args: [parseUnits(withdrawAmount || "0", collDecimals)],
            })
          }
        />

        {needsDebtApproval ? (
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-3">Repay</h3>
            <p className="text-sm text-ink-400 mb-4">Approve {debtSymbol} before repaying.</p>
            <button
              onClick={() =>
                addresses.lendingPool &&
                addresses.debtToken &&
                debtDecimals !== undefined &&
                writeContract({
                  address: addresses.debtToken,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [addresses.lendingPool, parseUnits(repayAmount || "0", debtDecimals)],
                })
              }
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
            onSubmit={() =>
              addresses.lendingPool &&
              debtDecimals !== undefined &&
              writeContract({
                address: addresses.lendingPool,
                abi: lendingPoolAbi,
                functionName: "repay",
                args: [parseUnits(repayAmount || "0", debtDecimals)],
              })
            }
          />
        )}

        <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 opacity-50">
          <h3 className="font-semibold text-white mb-3">Borrow</h3>
          <input
            disabled
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono mb-4 cursor-not-allowed"
            placeholder="0.00"
            value={borrowAmount}
            onChange={(e) => setBorrowAmount(e.target.value)}
          />
          <button disabled className="w-full py-2.5 rounded-lg bg-ink-700 text-ink-500 font-semibold cursor-not-allowed">
            Requires a live price feed
          </button>
        </div>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 opacity-50">
        <h3 className="font-semibold text-white mb-3">Liquidate a Position</h3>
        <input
          disabled
          className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono mb-4 cursor-not-allowed"
          placeholder="Borrower address (0x…)"
          value={liquidateTarget}
          onChange={(e) => setLiquidateTarget(e.target.value)}
        />
        <button disabled className="w-full py-2.5 rounded-lg bg-ink-700 text-ink-500 font-semibold cursor-not-allowed">
          Requires a live DON eligibility verdict
        </button>
      </div>
    </div>
  );
}
