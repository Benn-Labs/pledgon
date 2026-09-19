"use client";

import { useEffect } from "react";
import type { Address } from "viem";
import { erc20Abi } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { formatToken } from "@/lib/format";
import { toast } from "@/lib/toast";

export function BondPanel({
  vault,
  seller,
  token,
  bondAmount,
  bondDeposited,
  decimals,
  symbol,
  onSuccess,
}: {
  vault: Address;
  seller: Address;
  token: Address;
  bondAmount: bigint;
  bondDeposited: boolean;
  decimals: number;
  symbol: string;
  onSuccess: () => void;
}) {
  const { address: account } = useAccount();
  const isSeller = account?.toLowerCase() === seller.toLowerCase();

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: account ? [account, vault] : undefined,
    query: { enabled: Boolean(account) },
  });

  const { writeContract: approve, data: approveHash, isPending: approvePending } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
    query: { enabled: Boolean(approveHash) },
  });

  const { writeContract: deposit, data: depositHash, isPending: depositPending, error } = useWriteContract();
  const { isLoading: depositConfirming, isSuccess: depositSuccess } = useWaitForTransactionReceipt({
    hash: depositHash,
    query: { enabled: Boolean(depositHash) },
  });

  useEffect(() => {
    if (approveSuccess) {
      refetchAllowance();
      toast(`Approved ${symbol}`, "success");
    }
  }, [approveSuccess, refetchAllowance, symbol]);

  useEffect(() => {
    if (depositSuccess) {
      toast("Bond deposited", "success");
      onSuccess();
    }
  }, [depositSuccess, onSuccess]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  if (!isSeller) return null;

  if (bondDeposited) {
    return (
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold mb-2 text-white">Seller Bond</h2>
        <p className="text-sm text-success-400">Bond deposited ({formatToken(bondAmount, decimals, symbol)}).</p>
      </div>
    );
  }

  const needsApproval = bondAmount > 0n && (allowance ?? 0n) < bondAmount;

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
      <h2 className="font-semibold mb-4 text-white">Deposit Seller Bond</h2>
      <div className="p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-300">Bond amount</span>
          <span className="font-mono font-semibold text-warning-400">{formatToken(bondAmount, decimals, symbol)}</span>
        </div>
      </div>
      {needsApproval ? (
        <button
          onClick={() => approve({ address: token, abi: erc20Abi, functionName: "approve", args: [vault, bondAmount] })}
          disabled={approvePending || approveConfirming}
          className="btn-press w-full py-3 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
        >
          {approvePending || approveConfirming ? "Approving…" : `Approve ${symbol}`}
        </button>
      ) : (
        <button
          onClick={() => deposit({ address: vault, abi: escrowVaultAbi, functionName: "depositBond" })}
          disabled={depositPending || depositConfirming}
          className="btn-press w-full py-3 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
        >
          {depositPending || depositConfirming ? "Depositing…" : "Deposit Bond"}
        </button>
      )}
    </div>
  );
}
