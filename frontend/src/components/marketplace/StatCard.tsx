import type { ReactNode } from "react";

export function StatCard({ label, value, hint, loading }: { label: string; value: ReactNode; hint?: ReactNode; loading?: boolean }) {
  return (
    <div className="deal-card rounded-xl border border-ink-800 bg-ink-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      {loading ? (
        <div className="mt-3 h-8 w-24 animate-pulse rounded bg-ink-800" />
      ) : (
        <p className="mt-2 font-mono text-2xl font-semibold text-white">{value}</p>
      )}
      {hint && !loading && <p className="mt-1 truncate text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
