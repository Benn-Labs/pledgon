"use client";

import { useEffect, useState } from "react";
import { erc20Abi, formatEther, formatUnits } from "viem";
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { lendingPoolAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { formatToken } from "@/lib/format";
import { tryParseUnits } from "@/lib/units";
import { toast, toastTxError } from "@/lib/toast";

/**
 * Owner-only: pay part of the platform fees to lenders. Rewards are a plain
 * transfer of the pool's debt token into the lending pool — its share model
 * makes every current lender's balance grow pro rata, with no pool function
 * involved. Fees are collected in ETH, so converting the chosen portion into
 * the debt token is a manual step for now (swap it, or on testnet use the
 * faucet), done before sending here.
 */
export function LenderRewardsPanel() {
  const { address: account } = useAccount();
  const { decimals, symbol } = useToken(addresses.debtToken);
  const [pct, setPct] = useState("25");
  const [amount, setAmount] = useState("");

  const { data: feeBalance } = useBalance({
    address: addresses.escrowFactory,
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { data: ownerBalance, refetch: refetchOwnerBalance } = useReadContract({
    address: addresses.debtToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.debtToken && account) },
  });

  const { data: totalShares } = useReadContract({
    address: addresses.lendingPool,
    abi: lendingPoolAbi,
    functionName: "totalShares",
    query: { enabled: Boolean(addresses.lendingPool) },
  });
  const { data: totalSupply, refetch: refetchSupply } = useReadContract({
    address: addresses.lendingPool,
    abi: lendingPoolAbi,
    functionName: "totalSupply",
    query: { enabled: Boolean(addresses.lendingPool) },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });
  const busy = isPending || isConfirming;

  useEffect(() => {
    if (!isSuccess) return;
    toast("Rewards sent to lenders", "success");
    refetchOwnerBalance();
    refetchSupply();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch fns are stable; fire once per confirmed tx
  }, [isSuccess]);

  useEffect(() => {
    if (error) toastTxError(error);
  }, [error]);

  if (!addresses.lendingPool || !addresses.debtToken) return null;

  const pctNum = Number(pct);
  const pctValid = Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100;
  const suggestedWei = feeBalance && pctValid ? (feeBalance.value * BigInt(Math.round(pctNum * 100))) / 10_000n : undefined;

  const parsed = decimals !== undefined ? tryParseUnits(amount, decimals) : undefined;
  const noLenders = totalShares !== undefined && totalShares === 0n;
  const overBalance = parsed !== undefined && ownerBalance !== undefined && parsed > ownerBalance;
  const canSend = parsed !== undefined && parsed > 0n && !overBalance && !noLenders && !busy;

  function send() {
    if (!addresses.debtToken || !addresses.lendingPool || parsed === undefined) return;
    writeContract({ address: addresses.debtToken, abi: erc20Abi, functionName: "transfer", args: [addresses.lendingPool, parsed] });
  }

  const rewardPct =
    parsed !== undefined && parsed > 0n && totalSupply !== undefined && totalSupply > 0n
      ? Number((parsed * 1_000_000n) / totalSupply) / 10_000
      : undefined;

  return (
    <div className="bg-ink-900 border border-trust-500/30 rounded-xl p-6 mb-6">
      <h3 className="font-semibold text-ink-50 mb-1">Lender Rewards</h3>
      <p className="text-xs text-ink-500 mb-4">
        Share part of the platform fees with the people who supply liquidity. Rewards go into the pool as {symbol ?? "the debt token"}
        and are split pro rata among <strong>current</strong> lenders — anyone who supplies afterwards doesn&apos;t get them.
        Send smaller amounts regularly rather than one large lump sum, so a deposit made just before a reward can&apos;t capture
        a big share of it.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded-lg bg-ink-800/50 border border-ink-700">
          <div className="text-xs text-ink-400 mb-1">Accumulated fees</div>
          <div className="font-mono text-sm text-ink-100">{feeBalance ? `${formatEther(feeBalance.value)} ETH` : "…"}</div>
        </div>
        <div className="p-3 rounded-lg bg-ink-800/50 border border-ink-700">
          <label className="block text-xs text-ink-400 mb-1" htmlFor="reward-pct">
            Lender share (policy, % of fees)
          </label>
          <input
            id="reward-pct"
            className="w-full bg-ink-900 border border-ink-700 rounded px-2 py-1 font-mono text-sm text-ink-100 focus:outline-none focus:border-trust-500"
            value={pct}
            onChange={(e) => setPct(e.target.value.trim())}
          />
        </div>
        <div className="p-3 rounded-lg bg-ink-800/50 border border-ink-700">
          <div className="text-xs text-ink-400 mb-1">To convert and send</div>
          <div className="font-mono text-sm text-ink-100">
            {suggestedWei !== undefined && pctValid ? `≈ ${formatEther(suggestedWei)} ETH` : "—"}
          </div>
        </div>
      </div>
      <p className="text-xs text-ink-500 mb-4">
        The percentage here is a working figure — it isn&apos;t enforced on-chain. Withdraw the fees above, convert the lender
        share to {symbol ?? "the debt token"}, then send it below.
      </p>

      <div className="relative mb-2">
        <input
          className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-24 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-ink-400 text-sm">
          {ownerBalance !== undefined && decimals !== undefined && ownerBalance > 0n && (
            <button
              type="button"
              onClick={() => setAmount(formatUnits(ownerBalance, decimals))}
              className="rounded px-1.5 py-0.5 text-xs font-semibold text-trust-400 hover:bg-ink-700"
            >
              Max
            </button>
          )}
          {symbol ?? ""}
        </span>
      </div>
      <p className="text-xs text-ink-500 mb-2">
        Your balance: {ownerBalance !== undefined && decimals !== undefined ? formatToken(ownerBalance, decimals, symbol) : "…"}
        {rewardPct !== undefined && (
          <span className="text-trust-400"> · adds about {rewardPct.toFixed(2)}% to lenders&apos; balances</span>
        )}
      </p>
      {noLenders && (
        <p className="text-xs text-warning-400 mb-2">
          No one has supplied liquidity yet, so there are no lenders to reward — a transfer now would just go to the first
          person who supplies. Send rewards once the pool has lenders.
        </p>
      )}
      {overBalance && <p className="text-xs text-danger-400 mb-2">More than your {symbol} balance.</p>}
      <button
        onClick={send}
        disabled={!canSend}
        className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
      >
        {busy ? "Submitting…" : "Send rewards to lenders"}
      </button>
    </div>
  );
}
