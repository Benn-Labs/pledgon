"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { isAddress, parseUnits, type Address } from "viem";
import { flashArbV3Abi } from "@/generated/contracts";
import { ARBITRAGE_TOKENS, ARBITRAGE_ROUTERS, encodeFlashLoanParams } from "@/lib/arbitrage";
import { toast, toastTxError } from "@/lib/toast";

function formatAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function ArbitrageBotPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: rawAddress } = use(params);
  const botAddress = isAddress(rawAddress) ? (rawAddress as Address) : undefined;
  const { address: account } = useAccount();

  const { data: owner } = useReadContract({
    address: botAddress,
    abi: flashArbV3Abi,
    functionName: "owner",
    query: { enabled: Boolean(botAddress) },
  });

  const { data: paused } = useReadContract({
    address: botAddress,
    abi: flashArbV3Abi,
    functionName: "paused",
    query: { enabled: Boolean(botAddress) },
  });

  const isOwner = Boolean(account && owner && account.toLowerCase() === owner.toLowerCase());

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  // Execute form state
  const [asset, setAsset] = useState<string>(ARBITRAGE_TOKENS[0].address);
  const [amount, setAmount] = useState("");
  const [router1, setRouter1] = useState<string>(ARBITRAGE_ROUTERS[0].address);
  const [router2, setRouter2] = useState<string>(ARBITRAGE_ROUTERS[1].address);
  const [path1, setPath1] = useState("");
  const [path2, setPath2] = useState("");
  const [amountOutMin1, setAmountOutMin1] = useState("0");
  const [amountOutMin2, setAmountOutMin2] = useState("0");
  const [minProfit, setMinProfit] = useState("0");
  const [unwrapToEth, setUnwrapToEth] = useState(false);

  useEffect(() => {
    if (isSuccess) toast("Flash loan executed", "success");
  }, [isSuccess]);

  useEffect(() => {
    if (error) toastTxError(error);
  }, [error]);

  if (!botAddress) {
    return (
      <div className="fade-in max-w-3xl mx-auto">
        <p className="text-danger-400">Invalid bot address.</p>
      </div>
    );
  }

  const token = ARBITRAGE_TOKENS.find((t) => t.address.toLowerCase() === asset.toLowerCase());

  function execute() {
    if (!botAddress || !token || !account) return;
    const parsedAmount = parseUnits(amount, token.decimals);
    const path1Addresses = path1
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Address => isAddress(s));
    const path2Addresses = path2
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Address => isAddress(s));
    if (path1Addresses.length < 2 || path2Addresses.length < 2) {
      toast("Each path must contain at least two comma-separated addresses", "warning");
      return;
    }
    const params = encodeFlashLoanParams({
      asset: asset as Address,
      amount: parsedAmount,
      router1: router1 as Address,
      router2: router2 as Address,
      path1: path1Addresses,
      path2: path2Addresses,
      amountOutMin1: parseUnits(amountOutMin1, token.decimals),
      amountOutMin2: parseUnits(amountOutMin2, token.decimals),
      minProfit: parseUnits(minProfit, token.decimals),
      unwrapToEth,
    });
    writeContract({
      address: botAddress,
      abi: flashArbV3Abi,
      functionName: "startFlashLoan",
      args: [asset as Address, parsedAmount, params],
    });
  }

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <Link href="/arbitrage" className="text-sm text-ink-400 hover:text-white mb-4 inline-block">
        ← Back to bots
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display text-white">{formatAddress(botAddress)}</h1>
          <p className="text-ink-400 mt-1">FlashArbV3 arbitrage bot</p>
        </div>
        {isOwner && (
          <span className="px-3 py-1 rounded-full bg-trust-500/10 border border-trust-500/30 text-trust-400 text-xs font-semibold">
            Owner
          </span>
        )}
      </div>

      <div className="p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 mb-6">
        <p className="text-sm text-warning-400 font-medium mb-1">Mainnet-only execution</p>
        <p className="text-sm text-ink-300">
          This bot hard-codes Ethereum mainnet Aave V3, Uniswap V2, and SushiSwap addresses. On Sepolia it will
          deploy, but <code className="font-mono text-xs">startFlashLoan</code> will revert because those contracts
          don&apos;t exist here. Only execute on mainnet (or a mainnet fork).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-xl bg-ink-900 border border-ink-800">
          <div className="text-xs text-ink-400 mb-1">Owner</div>
          <div className="font-mono text-sm text-ink-100">{owner ? formatAddress(owner) : "…"}</div>
        </div>
        <div className="p-4 rounded-xl bg-ink-900 border border-ink-800">
          <div className="text-xs text-ink-400 mb-1">Status</div>
          <div className="text-sm text-ink-100">{paused === undefined ? "…" : paused ? "Paused" : "Active"}</div>
        </div>
      </div>

      <div className="p-6 rounded-xl bg-ink-900 border border-ink-800 mb-6">
        <h2 className="font-semibold text-white mb-4">Execute Flash Loan</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-ink-400 mb-1">Borrow asset</label>
            <select
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 focus:outline-none focus:border-trust-500"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
            >
              {ARBITRAGE_TOKENS.map((t) => (
                <option key={t.address} value={t.address}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-400 mb-1">Amount</label>
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-ink-400 mb-1">Router 1</label>
            <select
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 focus:outline-none focus:border-trust-500"
              value={router1}
              onChange={(e) => setRouter1(e.target.value)}
            >
              {ARBITRAGE_ROUTERS.map((r) => (
                <option key={r.address} value={r.address}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-400 mb-1">Router 2</label>
            <select
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 focus:outline-none focus:border-trust-500"
              value={router2}
              onChange={(e) => setRouter2(e.target.value)}
            >
              {ARBITRAGE_ROUTERS.map((r) => (
                <option key={r.address} value={r.address}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-ink-400 mb-1">Path 1 (comma-separated addresses)</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            placeholder={`${asset},0x…,${asset}`}
            value={path1}
            onChange={(e) => setPath1(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">Must start with the borrowed asset.</p>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-ink-400 mb-1">Path 2 (comma-separated addresses)</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            placeholder={`0x…,${asset}`}
            value={path2}
            onChange={(e) => setPath2(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">Must end with the borrowed asset.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-ink-400 mb-1">amountOutMin 1</label>
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              value={amountOutMin1}
              onChange={(e) => setAmountOutMin1(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-400 mb-1">amountOutMin 2</label>
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              value={amountOutMin2}
              onChange={(e) => setAmountOutMin2(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-400 mb-1">Min profit</label>
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2.5 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              value={minProfit}
              onChange={(e) => setMinProfit(e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 mb-6 text-sm text-ink-300">
          <input
            type="checkbox"
            checked={unwrapToEth}
            onChange={(e) => setUnwrapToEth(e.target.checked)}
            className="rounded border-ink-700 bg-ink-800 text-trust-500 focus:ring-trust-500"
          />
          Unwrap WETH profit to ETH
        </label>

        <button
          onClick={execute}
          disabled={!isOwner || !amount || isPending || isConfirming}
          className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
        >
          {isPending || isConfirming ? "Submitting…" : "Execute Flash Loan"}
        </button>
        {!isOwner && <p className="text-xs text-danger-400 mt-2">Only the bot owner can execute.</p>}
      </div>

      <div className="p-6 rounded-xl bg-ink-900 border border-ink-800">
        <h2 className="font-semibold text-white mb-2">Withdraw profits</h2>
        <p className="text-sm text-ink-400 mb-4">
          Profits accumulate in the bot contract. Use the contract&apos;s owner functions directly (e.g. via Etherscan
          or cast) until a withdrawal UI is added here.
        </p>
      </div>
    </div>
  );
}
