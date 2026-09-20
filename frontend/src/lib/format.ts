import { formatUnits } from "viem";

export function formatToken(amount: bigint, decimals: number, symbol?: string): string {
  const formatted = formatUnits(amount, decimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

export function sumBigints(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/** A vault's position in EscrowFactory.allVaults(), shown 1-indexed and zero-padded (e.g. index 0 -> "#0000001"). */
export function formatVaultNumber(index: number): string {
  return `#${String(index + 1).padStart(7, "0")}`;
}
