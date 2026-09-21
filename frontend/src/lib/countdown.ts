import { useEffect, useState } from "react";

/**
 * Ticks a re-render every `intervalMs`, so a component showing a countdown
 * (built from `formatTimeLeft` below) stays live without its own timer.
 * Returns the current time in milliseconds, same unit `Date.now()` uses.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export type TimeLeft = { label: string; expired: boolean };

/**
 * `deadlineSeconds` is a Unix timestamp in seconds, as EscrowVault's
 * `fundingDeadline`/`milestoneDeadline` return it — 0 means "no deadline" and
 * has nothing to render. `nowMs` defaults to `Date.now()` but takes a value so
 * callers driven by `useNow` re-render on the same tick they format with.
 */
export function formatTimeLeft(deadlineSeconds: bigint | number, nowMs: number = Date.now()): TimeLeft | undefined {
  const deadline = typeof deadlineSeconds === "bigint" ? deadlineSeconds : BigInt(Math.trunc(deadlineSeconds));
  if (deadline === 0n) return undefined;

  const remainingMs = Number(deadline) * 1000 - nowMs;
  if (remainingMs <= 0) return { label: "Expired", expired: true };

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let label: string;
  if (days > 0) label = `${days}d ${hours}h left`;
  else if (hours > 0) label = `${hours}h ${minutes}m left`;
  else if (minutes > 0) label = `${minutes}m ${seconds}s left`;
  else label = `${seconds}s left`;

  return { label, expired: false };
}

/** `atMs` is a Unix timestamp in milliseconds, as `Date.now()` returns it. */
export function formatRelativeTime(atMs: number, nowMs: number = Date.now()): string {
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  if (elapsedSeconds < 60) return "just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
