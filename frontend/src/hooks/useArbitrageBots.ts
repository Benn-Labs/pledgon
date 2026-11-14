"use client";

import { useCallback } from "react";
import type { Address } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured, url as supabaseUrl, anonKey } from "@/lib/supabaseClient";
import { buildArbitrageSignatureMessage } from "@/lib/arbitrage";

export interface ArbitrageBot {
  bot_address: string;
  owner_address: string;
  deployed_at: string;
  updated_at: string;
}

async function fetchBots(owner: string, chainId: number): Promise<ArbitrageBot[]> {
  const listUrl = new URL(`${supabaseUrl}/functions/v1/arbitrage-bots`);
  listUrl.searchParams.set("owner", owner.toLowerCase());
  listUrl.searchParams.set("chainId", String(chainId));
  const key = anonKey!;
  const res = await fetch(listUrl.toString(), {
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to load bots");
  return (data?.bots as ArbitrageBot[]) ?? [];
}

export function useArbitrageBots(chainId?: number) {
  const { address: owner } = useAccount();

  const query = useQuery({
    queryKey: ["arbitrage-bots", owner, chainId],
    queryFn: () => {
      if (!owner || !chainId) return [];
      return fetchBots(owner, chainId);
    },
    enabled: Boolean(owner && chainId && isSupabaseConfigured),
  });

  return { bots: query.data ?? null, isLoading: query.isLoading, error: query.error?.message ?? null, refetch: query.refetch };
}

export function useRegisterArbitrageBot() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const register = useCallback(
    async (chainId: number, botAddress: Address): Promise<{ ok: boolean; error?: string }> => {
      if (!address) return { ok: false, error: "Connect a wallet first" };
      if (!isSupabaseConfigured || !supabase) return { ok: false, error: "Supabase isn't configured" };

      try {
        const resource = `arbitrage:${chainId}:${botAddress.toLowerCase()}`;
        const message = buildArbitrageSignatureMessage("register this arbitrage bot", resource);
        const signature = await signMessageAsync({ message });
        const { data, error: fnError } = await supabase.functions.invoke("arbitrage-bots", {
          body: { address, signature, message, chainId, botAddress },
        });
        if (fnError) {
          let messageOut = fnError.message;
          const context = (fnError as { context?: Response }).context;
          if (context) {
            try {
              const body = await context.clone().json();
              if (body?.error) messageOut = body.error as string;
            } catch {}
          }
          return { ok: false, error: messageOut };
        }
        if (data?.error) {
          return { ok: false, error: data.error as string };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Failed to register" };
      }
    },
    [address, signMessageAsync],
  );

  return { register };
}
