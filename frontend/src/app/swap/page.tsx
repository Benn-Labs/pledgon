"use client";

import { useState } from "react";
import Script from "next/script";

// Rango's own test-only credentials, from their public quick-start docs —
// swap these for real ones before shipping this anywhere real users touch
// it. A real API key needs a support ticket in Rango's Discord; the
// affiliate ref needs connecting a wallet at https://app.rango.exchange/affiliate.
const RANGO_API_KEY = process.env.NEXT_PUBLIC_RANGO_API_KEY || "c6381a79-2817-4602-83bf-6a641a409e32";
const AFFILIATE_REF = process.env.NEXT_PUBLIC_RANGO_AFFILIATE_REF;
const AFFILIATE_PERCENT = process.env.NEXT_PUBLIC_RANGO_AFFILIATE_PERCENT;
const AFFILIATE_WALLET = process.env.NEXT_PUBLIC_RANGO_AFFILIATE_WALLET;

declare global {
  interface Window {
    rangoWidget?: { init: (config: Record<string, unknown>) => void };
  }
}

/**
 * Rango's hosted iframe embed rather than the @rango-dev/widget-embedded npm
 * package: that package pulls in ~1,200 transitive dependencies (wallet
 * providers for Solana, Cosmos, Tron, and 30+ individual wallets we don't
 * use, since we're EVM-only via RainbowKit/wagmi already), for no benefit
 * here. The iframe gives the same swap + referral-fee functionality with
 * zero new npm dependencies — see docs.rango.exchange/widget-integration.
 *
 * This is unrelated to /faucet: Rango can only route swaps through tokens
 * that already have real liquidity somewhere. Our MOCK/collateral/debt
 * tokens don't (see /faucet's own doc comment) — this page is for swapping
 * real, liquid assets (ETH, stablecoins, etc.), not for acquiring PLEDGON's
 * test tokens.
 */
export default function SwapPage() {
  const [loaded, setLoaded] = useState(false);

  function initWidget() {
    if (!window.rangoWidget) return;
    const config: Record<string, unknown> = {
      apiKey: RANGO_API_KEY,
      walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    };
    if (AFFILIATE_REF) {
      config.affiliate = {
        ref: AFFILIATE_REF,
        percent: AFFILIATE_PERCENT ? Number(AFFILIATE_PERCENT) : 0.3,
        ...(AFFILIATE_WALLET ? { wallets: { ETH: AFFILIATE_WALLET } } : {}),
      };
    }
    window.rangoWidget.init(config);
    setLoaded(true);
  }

  return (
    <div className="fade-in max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Swap</h1>
        <p className="text-ink-400 mt-1">
          Cross-chain swaps and bridging via Rango, aggregating real liquidity across DEXs and bridges.
        </p>
      </div>

      {!AFFILIATE_REF && (
        <div className="mb-4 p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 text-sm text-warning-400">
          Running with Rango&apos;s public test API key and no affiliate ref configured — no referral fee is being
          earned yet. Generate a real API key (Rango Discord) and an affiliate ref (
          <a href="https://app.rango.exchange/affiliate" target="_blank" rel="noreferrer" className="underline">
            app.rango.exchange/affiliate
          </a>
          ), then set NEXT_PUBLIC_RANGO_API_KEY / NEXT_PUBLIC_RANGO_AFFILIATE_REF / NEXT_PUBLIC_RANGO_AFFILIATE_WALLET.
        </div>
      )}

      <div id="rango-widget-container" className="rounded-xl overflow-hidden" style={{ minHeight: 600 }}>
        {!loaded && <p className="text-sm text-ink-400 text-center py-16">Loading swap widget…</p>}
      </div>

      <Script src="https://api.rango.exchange/widget/iframe.bundle.min.js" strategy="afterInteractive" onLoad={initWidget} />
    </div>
  );
}
