"use client";

import { useState } from "react";
import { useChainId } from "wagmi";
import { addresses, lendingMarkets } from "@/lib/addresses";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { GithubIcon } from "@/components/ui/icons";
import { toast } from "@/lib/toast";

const REPO_URL = "https://github.com/Benn-Labs/pledgon";

const EXPLORER_BY_CHAIN: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
};

const THEME_OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "dark", label: "Dark", hint: "The protocol-native near-black look" },
  { value: "light", label: "Light", hint: "High-contrast light surfaces" },
  { value: "system", label: "System", hint: "Follows this device's OS setting" },
];

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function AddressRow({ label, address, explorer }: { label: string; address: string; explorer?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-ink-300">{label}</span>
      <span className="flex items-center gap-2">
        <code className="font-mono text-xs text-ink-200">{short(address)}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(address).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              },
              () => toast("Couldn't copy address", "error"),
            );
          }}
          className="text-xs text-trust-400 hover:text-trust-300"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {explorer && (
          <a
            href={`${explorer}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-trust-400 hover:text-trust-300"
          >
            Explorer
          </a>
        )}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const { preference, resolved, setPreference, reduceMotion, setReduceMotion } = useTheme();
  const chainId = useChainId();
  const explorer = EXPLORER_BY_CHAIN[chainId];

  return (
    <div className="fade-in max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-display text-ink-50">Settings</h1>
        <p className="text-ink-400 mt-1">Appearance and the deployed factory configuration for this deployment.</p>
      </div>

      <section className="bg-ink-900 border border-ink-800 rounded-xl p-6">
        <h2 className="font-semibold text-ink-50 mb-1">Appearance</h2>
        <p className="text-xs text-ink-500 mb-4">
          Theme applies instantly and is remembered on this device. Currently rendering:{" "}
          <span className="text-ink-300">{resolved} mode</span>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPreference(option.value)}
              aria-pressed={preference === option.value}
              className={`btn-press text-left p-4 rounded-lg border transition-colors ${
                preference === option.value
                  ? "border-trust-500 bg-trust-500/10"
                  : "border-ink-700 bg-ink-800/40 hover:border-ink-600"
              }`}
            >
              <div className={`text-sm font-semibold ${preference === option.value ? "text-trust-400" : "text-ink-100"}`}>
                {option.label}
              </div>
              <div className="text-xs text-ink-500 mt-1">{option.hint}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div>
            <div className="text-sm text-ink-100">Reduce motion</div>
            <div className="text-xs text-ink-500">Calms animations and transitions regardless of the OS setting.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={reduceMotion}
            onClick={() => setReduceMotion(!reduceMotion)}
            className={`btn-press relative w-11 h-6 rounded-full transition-colors ${
              reduceMotion ? "bg-trust-600" : "bg-ink-700"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white border border-ink-400/40 transition-all ${
                reduceMotion ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      <section className="bg-ink-900 border border-ink-800 rounded-xl p-6">
        <h2 className="font-semibold text-ink-50 mb-1">Factory config</h2>
        <p className="text-xs text-ink-500 mb-4">
          The on-chain contracts this deployment talks to, from its environment configuration. Fees and moderation are
          governed by the factory owner.
        </p>
        <div className="divide-y divide-ink-800">
          {addresses.escrowFactory && (
            <AddressRow label="Escrow factory" address={addresses.escrowFactory} explorer={explorer} />
          )}
          {addresses.marketplace && <AddressRow label="Marketplace" address={addresses.marketplace} explorer={explorer} />}
          {addresses.complianceConsumer && (
            <AddressRow label="Compliance consumer" address={addresses.complianceConsumer} explorer={explorer} />
          )}
          {addresses.escrowConfirmationConsumer && (
            <AddressRow label="Escrow confirmation consumer" address={addresses.escrowConfirmationConsumer} explorer={explorer} />
          )}
          {lendingMarkets.map((market) => (
            <div key={market.id}>
              <AddressRow label={`${market.name} — pool`} address={market.lendingPool} explorer={explorer} />
              <AddressRow label={`${market.name} — oracle consumer`} address={market.lendingOracleConsumer} explorer={explorer} />
              <AddressRow label={`${market.name} — liquidation consumer`} address={market.liquidationConsumer} explorer={explorer} />
            </div>
          ))}
          {addresses.mockToken && <AddressRow label="Mock token (faucet)" address={addresses.mockToken} explorer={explorer} />}
        </div>
        {!addresses.escrowFactory && !addresses.marketplace && (
          <p className="text-xs text-warning-500 mt-3">
            No contract addresses are configured for this deployment — set the NEXT_PUBLIC_*_ADDRESS variables (see
            .env.example).
          </p>
        )}
      </section>

      <section className="bg-ink-900 border border-ink-800 rounded-xl p-6">
        <h2 className="font-semibold text-ink-50 mb-1">Source</h2>
        <p className="text-xs text-ink-500 mb-4">
          Contracts, workflows and this app ship from the pledgon repo — deployment records live under{" "}
          <code className="font-mono text-ink-300">contracts/evm/deployments/</code>.
        </p>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="btn-press inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 text-sm font-medium text-ink-100"
        >
          <GithubIcon className="h-4 w-4" />
          Benn-Labs / pledgon on GitHub
        </a>
      </section>
    </div>
  );
}
