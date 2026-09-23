import { formatToken } from "@/lib/format";

/**
 * A token amount with its symbol styled as a distinct, smaller/muted unit
 * label rather than plain-concatenated into one string (see lib/format.ts's
 * formatToken) — for the stat cells where the number is the point and the
 * unit is secondary, same convention as frontend/ui/Design.html.
 */
export function TokenAmount({
  amount,
  decimals,
  symbol,
  maxDecimals,
  className = "text-lg font-bold text-white",
  unitClassName = "text-xs font-normal text-ink-400 ml-1",
}: {
  amount: bigint;
  decimals: number;
  symbol?: string;
  maxDecimals?: number;
  className?: string;
  unitClassName?: string;
}) {
  return (
    <span className={className}>
      {formatToken(amount, decimals, undefined, maxDecimals)}
      {symbol && <span className={unitClassName}>{symbol}</span>}
    </span>
  );
}
