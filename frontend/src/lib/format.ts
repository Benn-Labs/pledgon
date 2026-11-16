import { formatUnits } from "viem";

/**
 * Rounds `amount` (base units, `decimals` precision) to `maxDecimals` decimal
 * places, entirely in bigint arithmetic — avoids both float-precision loss on
 * large values and the wall of noise digits interest accrual produces (e.g.
 * 20000.0003805175038) when the raw base-unit value just isn't ever round.
 */
function roundToDecimals(amount: bigint, decimals: number, maxDecimals: number): string {
  if (maxDecimals >= decimals) return formatUnits(amount, decimals);
  const divisor = 10n ** BigInt(decimals - maxDecimals);
  const rounded = (amount + divisor / 2n) / divisor;
  if (maxDecimals === 0) return rounded.toString();
  const scale = 10n ** BigInt(maxDecimals);
  const whole = rounded / scale;
  const frac = rounded % scale;
  return `${whole}.${frac.toString().padStart(maxDecimals, "0")}`;
}

export function formatToken(amount: bigint, decimals: number, symbol?: string, maxDecimals?: number): string {
  const formatted = maxDecimals === undefined ? formatUnits(amount, decimals) : roundToDecimals(amount, decimals, maxDecimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * Like formatToken, but a nonzero amount that would round to 0.00 at
 * maxDecimals is shown at higher precision instead. Dust balances (e.g.
 * 0.001502 USDC of debt) must not read as "0.00" — the contract still counts
 * them even when the display rounds them away.
 */
export function formatTokenDustAware(amount: bigint, decimals: number, symbol?: string, maxDecimals = 2): string {
  const atMax = formatToken(amount, decimals, undefined, maxDecimals);
  if (amount === 0n || parseFloat(atMax) !== 0) return formatToken(amount, decimals, symbol, maxDecimals);
  for (const dp of [maxDecimals + 2, maxDecimals + 4]) {
    if (dp >= decimals) break;
    const candidate = formatToken(amount, decimals, undefined, dp);
    if (parseFloat(candidate) > 0) return formatToken(amount, decimals, symbol, dp);
  }
  return formatToken(amount, decimals, symbol);
}

export function sumBigints(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/** A vault's position in EscrowFactory.allVaults(), shown 1-indexed and zero-padded (e.g. index 0 -> "#0000001"). */
export function formatVaultNumber(index: number): string {
  return `#${String(index + 1).padStart(7, "0")}`;
}
