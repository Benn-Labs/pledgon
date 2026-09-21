"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { erc20Abi, isAddress, parseUnits, type Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { addresses, isLendingConfigured } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { formatToken } from "@/lib/format";
import { toast } from "@/lib/toast";

const MINT_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

/**
 * Every token in this deployment (MOCK, the lending collateral token, the
 * lending debt token) is a MockERC20 with a deliberately open mint() — no
 * access control at all. That's a real testnet feature, not a bug: it's the
 * actual solution to "how do I get a test token into my wallet," which a
 * swap widget can never provide anyway (no DEX has a pool for a token
 * anyone can mint for free, so no aggregator can ever find a route into
 * one — see /swap for the real, liquidity-backed alternative).
 */
export default function FaucetPage() {
  const { address: account, isConnected } = useAccount();
  const [tokenInput, setTokenInput] = useState<string>(addresses.collateralToken ?? "");
  const [amountInput, setAmountInput] = useState("100");

  const token = isAddress(tokenInput) ? (tokenInput as Address) : undefined;
  const { decimals, symbol, isReady: tokenReady } = useToken(token);

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(token && account) },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  useEffect(() => {
    if (isSuccess) {
      toast(`Minted ${amountInput} ${symbol ?? "tokens"}`, "success");
      refetchBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- amountInput/symbol are read at the moment of success, not meant to re-fire this on every keystroke
  }, [isSuccess, refetchBalance]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  function mint() {
    if (!token || !account || decimals === undefined) return;
    writeContract({
      address: token,
      abi: MINT_ABI,
      functionName: "mint",
      args: [account, parseUnits(amountInput || "0", decimals)],
    });
  }

  const quickTokens: { label: string; address: Address | undefined }[] = [];
  if (addresses.mockToken) quickTokens.push({ label: "MOCK (Escrow test token)", address: addresses.mockToken });
  if (isLendingConfigured && addresses.collateralToken) quickTokens.push({ label: "Collateral", address: addresses.collateralToken });
  if (isLendingConfigured && addresses.debtToken) quickTokens.push({ label: "Debt", address: addresses.debtToken });

  const isLendingToken =
    Boolean(token) &&
    ((addresses.collateralToken && token?.toLowerCase() === addresses.collateralToken.toLowerCase()) ||
      (addresses.debtToken && token?.toLowerCase() === addresses.debtToken.toLowerCase()));

  const canMint = isConnected && Boolean(token) && tokenReady && parseFloat(amountInput || "0") > 0 && !isPending && !isConfirming;

  return (
    <div className="fade-in max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Faucet</h1>
        <p className="text-ink-400 mt-1">
          Mint any of this deployment&apos;s test tokens directly to your wallet — no swap needed, since they&apos;re
          all freely mintable by design.
        </p>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-3">Quick Select</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {quickTokens.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => t.address && setTokenInput(t.address)}
                disabled={!t.address}
                className={`px-3 py-2.5 rounded-lg text-sm font-medium border text-left ${
                  t.address && tokenInput.toLowerCase() === t.address.toLowerCase()
                    ? "bg-trust-600 border-trust-500 text-white"
                    : "bg-ink-800 border-ink-700 text-ink-300 hover:text-white hover:border-ink-600 disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Token Address</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            placeholder="0x…"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">
            {token && tokenReady
              ? `${symbol}, ${decimals} decimals`
              : token
                ? "Reading token…"
                : "Any MockERC20 from this project — must have an open mint(address,uint256)."}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Amount</label>
          <div className="relative">
            <input
              type="number"
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-16 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              placeholder="100"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm">{symbol ?? "token"}</span>
          </div>
          {balance !== undefined && decimals !== undefined && (
            <p className="text-xs text-ink-500 mt-1">Current balance: {formatToken(balance, decimals, symbol)}</p>
          )}
        </div>

        <button
          onClick={mint}
          disabled={!canMint}
          className="btn-press w-full py-4 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold text-lg glow-trust disabled:shadow-none"
        >
          {isPending || isConfirming ? "Minting…" : "Mint to My Wallet"}
        </button>

        {isLendingToken && (
          <div className="p-4 rounded-lg bg-trust-500/10 border border-trust-500/30 flex items-center justify-between gap-3">
            <p className="text-sm text-ink-300">
              Lending&apos;s Deposit, Withdraw, and Repay all work with these test tokens today — only Borrow and
              Liquidate need a live price feed.
            </p>
            <Link
              href="/lending"
              className="btn-press px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold shrink-0"
            >
              Go to Lending →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
