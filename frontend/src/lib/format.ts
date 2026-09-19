import { formatUnits } from "viem";

export function formatToken(amount: bigint, decimals: number, symbol?: string): string {
  const formatted = formatUnits(amount, decimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

export function sumBigints(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}
