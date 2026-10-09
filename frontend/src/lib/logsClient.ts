import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

/**
 * A read-only client used for `eth_getLogs` queries only. The app's main RPC
 * (NEXT_PUBLIC_SEPOLIA_RPC_URL) is often a free tier that caps log queries to a
 * handful of blocks — useless for "what happened recently" — while public
 * nodes allow ranges of thousands of blocks. Point NEXT_PUBLIC_LOGS_RPC_URL at
 * any node with deeper log history; everything else (balances, transactions,
 * multicalls) keeps using the main RPC.
 */
const url = process.env.NEXT_PUBLIC_LOGS_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

export const logsClient = createPublicClient({ chain: sepolia, transport: http(url) });

export const SECONDS_PER_BLOCK = 12;

/**
 * Lookback windows to try, widest first (~7 days, ~3 days, ~33 hours, ~17 hours).
 * Public nodes cap a log query at 50,000 blocks and many prune history well
 * before that (publicnode serves about 10,000), so callers fall back down this list.
 */
export const LOG_WINDOWS_BLOCKS = [49_000n, 20_000n, 10_000n, 5_000n];
