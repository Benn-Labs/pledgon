"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useChainId, useDeployContract, useWaitForTransactionReceipt } from "wagmi";
import { isAddress, type Address } from "viem";
import { flashArbV3Abi } from "@/generated/contracts";
import { flashArbV3Bytecode } from "@/generated/flashArbV3Bytecode";
import { useArbitrageBots, useRegisterArbitrageBot } from "@/hooks/useArbitrageBots";
import { toast, toastTxError } from "@/lib/toast";

function formatAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function ArbitragePage() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { bots, isLoading, error, refetch } = useArbitrageBots(chainId);
  const { register } = useRegisterArbitrageBot();

  const [registerAddress, setRegisterAddress] = useState("");
  const [activeTab, setActiveTab] = useState<"bots" | "deploy" | "register">("bots");

  const {
    deployContract,
    data: deployHash,
    isPending: isDeploying,
    error: deployError,
  } = useDeployContract();
  const { isLoading: isConfirmingDeploy, isSuccess: deploySuccess, data: deployReceipt } = useWaitForTransactionReceipt({
    hash: deployHash,
    query: { enabled: Boolean(deployHash) },
  });

  useEffect(() => {
    if (deployError) toastTxError(deployError);
    if (deploySuccess && deployReceipt?.contractAddress) {
      toast(`Bot deployed at ${formatAddress(deployReceipt.contractAddress)}`, "success");
    }
  }, [deployError, deploySuccess, deployReceipt]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(registerAddress)) {
      toast("Enter a valid bot address", "warning");
      return;
    }
    const result = await register(chainId, registerAddress as Address);
    if (result.ok) {
      toast("Bot registered with PLEDGON", "success");
      setRegisterAddress("");
      setActiveTab("bots");
      refetch();
    } else if (result.error) {
      toast(result.error, "error");
    }
  }

  function handleDeploy() {
    deployContract({ abi: flashArbV3Abi, bytecode: flashArbV3Bytecode });
  }

  const deployedAddress = deploySuccess && deployReceipt?.contractAddress ? deployReceipt.contractAddress : undefined;

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-display text-ink-50">Arbitrage Bots</h1>
        <p className="text-ink-400 mt-1">
          Deploy and run user-owned FlashArbV3 bots. PLEDGON never holds your funds or keys.
        </p>
      </div>

      <div className="flex gap-2 mb-6 border-b border-ink-800">
        {(["bots", "deploy", "register"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? "text-ink-50 border-trust-500"
                : "text-ink-400 border-transparent hover:text-ink-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "bots" && (
        <div className="space-y-4">
          {!isConnected ? (
            <p className="text-ink-400">Connect your wallet to see your bots.</p>
          ) : isLoading ? (
            <p className="text-ink-400">Loading…</p>
          ) : error ? (
            <p className="text-danger-400">{error}</p>
          ) : bots && bots.length > 0 ? (
            <div className="grid gap-3">
              {bots.map((bot) => (
                <Link
                  key={bot.bot_address}
                  href={`/arbitrage/${bot.bot_address}`}
                  className="group flex items-center justify-between p-4 rounded-xl bg-ink-900 border border-ink-800 hover:border-trust-500/50 transition-colors"
                >
                  <div>
                    <p className="font-mono text-sm text-ink-50">{formatAddress(bot.bot_address)}</p>
                    <p className="text-xs text-ink-500 mt-1">
                      Deployed {new Date(bot.deployed_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-trust-400 group-hover:translate-x-0.5 transition-transform">
                    Execute →
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-6 rounded-xl bg-ink-900 border border-ink-800 text-center">
              <p className="text-ink-400 mb-4">No bots registered yet.</p>
              <button
                onClick={() => setActiveTab("deploy")}
                className="btn-press px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold"
              >
                Deploy your first bot
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "deploy" && (
        <div className="p-6 rounded-xl bg-ink-900 border border-ink-800">
          <h2 className="font-semibold text-ink-50 mb-2">Deploy a new FlashArbV3 bot</h2>
          <p className="text-sm text-ink-400 mb-6">
            This deploys a fresh bot contract owned by your connected wallet. The bot is ready for mainnet
            Aave/Uniswap/SushiSwap constants; on Sepolia it will deploy but cannot execute real arbitrage.
          </p>
          {!isConnected ? (
            <p className="text-ink-400">Connect your wallet to deploy.</p>
          ) : (
            <button
              onClick={handleDeploy}
              disabled={isDeploying || isConfirmingDeploy}
              className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
            >
              {isDeploying || isConfirmingDeploy ? "Deploying…" : "Deploy FlashArbV3"}
            </button>
          )}
          {deployHash && (
            <p className="mt-4 text-xs text-ink-500 font-mono break-all">Transaction: {deployHash}</p>
          )}
          {deployedAddress && (
            <div className="mt-4 p-4 rounded-lg bg-trust-500/10 border border-trust-500/30">
              <p className="text-sm text-trust-400 font-medium mb-1">Bot deployed</p>
              <p className="font-mono text-xs text-ink-200 break-all">{deployedAddress}</p>
              <button
                onClick={() => {
                  setRegisterAddress(deployedAddress);
                  setActiveTab("register");
                }}
                className="mt-3 text-sm font-semibold text-trust-400 hover:text-trust-300"
              >
                Register this bot →
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "register" && (
        <form onSubmit={handleRegister} className="p-6 rounded-xl bg-ink-900 border border-ink-800">
          <h2 className="font-semibold text-ink-50 mb-2">Register an existing bot</h2>
          <p className="text-sm text-ink-400 mb-6">
            If you deployed a bot elsewhere (e.g. via Foundry), paste its address here and sign a message proving
            ownership. PLEDGON will record it in the discovery index.
          </p>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500 mb-4"
            placeholder="0x…"
            value={registerAddress}
            onChange={(e) => setRegisterAddress(e.target.value)}
          />
          {!isConnected ? (
            <p className="text-ink-400">Connect your wallet to register.</p>
          ) : (
            <button
              type="submit"
              disabled={!isAddress(registerAddress)}
              className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
            >
              Register Bot
            </button>
          )}
        </form>
      )}
    </div>
  );
}
