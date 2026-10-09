import { useQuery } from "@tanstack/react-query";
import { parseAbiItem } from "viem";
import { addresses } from "@/lib/addresses";
import { logsClient, LOG_WINDOWS_BLOCKS, SECONDS_PER_BLOCK } from "@/lib/logsClient";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const LIQUIDITY_DEPOSITED = parseAbiItem("event LiquidityDeposited(address indexed lender, uint256 amount, uint256 shares)");
const REPAID = parseAbiItem("event Repaid(address indexed borrower, uint256 amount)");
const LIQUIDATED = parseAbiItem(
  "event Liquidated(address indexed borrower, address indexed liquidator, uint256 collateralSeized, uint256 debtRepaid)",
);

/** "~3 days" / "~33 hours" for a block span. */
function describeWindow(blocks: bigint): { seconds: number; label: string } {
  const seconds = Number(blocks) * SECONDS_PER_BLOCK;
  const hours = Math.round(seconds / 3600);
  return { seconds, label: hours >= 48 ? `~${Math.round(hours / 24)} days` : `~${hours} hours` };
}

/**
 * Fee rewards the owner has sent to lenders recently.
 *
 * A reward is just a plain debt-token transfer into the pool (it raises every
 * lender's share value; no pool function is involved). The pool also receives
 * debt tokens from ordinary activity — supplying liquidity, repaying, being
 * liquidated — so a transfer counts as a reward only when its transaction
 * emitted none of those pool events. Anything else arriving in the pool is, by
 * construction, a donation to lenders.
 *
 * How far back this can look is whatever the log RPC allows: it tries the
 * widest window first and falls back to narrower ones, and reports the window
 * it actually used. A free public node serves about a day and a half; point
 * NEXT_PUBLIC_LOGS_RPC_URL at a node with deeper log history for a full week.
 */
export function useLenderRewards() {
  const pool = addresses.lendingPool;
  const token = addresses.debtToken;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["lenderRewards", pool, token],
    enabled: Boolean(pool && token),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 0,
    queryFn: async () => {
      const head = await logsClient.getBlockNumber();
      let lastError: unknown;
      for (const span of LOG_WINDOWS_BLOCKS) {
        const fromBlock = head > span ? head - span : 0n;
        try {
          const [transfers, deposits, repays, liquidations] = await Promise.all([
            logsClient.getLogs({ address: token, event: TRANSFER, args: { to: pool }, fromBlock, toBlock: head }),
            logsClient.getLogs({ address: pool, event: LIQUIDITY_DEPOSITED, fromBlock, toBlock: head }),
            logsClient.getLogs({ address: pool, event: REPAID, fromBlock, toBlock: head }),
            logsClient.getLogs({ address: pool, event: LIQUIDATED, fromBlock, toBlock: head }),
          ]);
          const ordinary = new Set([...deposits, ...repays, ...liquidations].map((l) => l.transactionHash));
          let total = 0n;
          for (const t of transfers) {
            if (!ordinary.has(t.transactionHash)) total += t.args.value ?? 0n;
          }
          return { total, ...describeWindow(span) };
        } catch (e) {
          lastError = e; // range too wide / history pruned for this node: try a narrower window
        }
      }
      throw lastError;
    },
  });

  return {
    rewards: data?.total,
    /** Length of the window actually queried, in seconds, and a human label for it. */
    windowSeconds: data?.seconds,
    windowLabel: data?.label,
    isLoading,
    isError,
  };
}
