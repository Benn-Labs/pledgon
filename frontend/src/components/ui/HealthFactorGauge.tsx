function arcPoint(cx: number, cy: number, r: number, fraction: number) {
  const angleRad = ((180 + fraction * 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function describeArc(cx: number, cy: number, r: number, startFraction: number, endFraction: number) {
  const start = arcPoint(cx, cy, r, startFraction);
  const end = arcPoint(cx, cy, r, endFraction);
  // Fractions span a 180° semicircle (0 = left, 1 = right), so the arc from
  // startFraction to endFraction — swept in the increasing-angle direction
  // (sweep-flag 1) — is always <=180° for any 0<=start<=end<=1. The
  // large-arc-flag must therefore always be 0. SVG's large/small-arc choice
  // is relative to the *full* 360° circle, not this component's 180° range,
  // so a `> 0.5` check here sends anything over a 90° sweep (LTV over 50%)
  // the long way around the invisible bottom half of the circle — clipped
  // by the viewBox, rendering as two disconnected end caps instead of one
  // continuous arc.
  return `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`;
}

const CX = 100;
const CY = 100;
const R = 80;

/**
 * A semicircle "how close to liquidation" gauge: the filled arc is current
 * LTV against a 0–100% scale, with a tick marking the liquidation threshold
 * — the same shape as the plain LTV/threshold numbers shown alongside it,
 * just readable at a glance instead of two numbers to compare in your head.
 */
export function HealthFactorGauge({
  hasDebt,
  hasPrice,
  ltvBps,
  liquidationThresholdBps,
  healthFactor,
}: {
  hasDebt: boolean;
  hasPrice: boolean;
  ltvBps: bigint | undefined;
  liquidationThresholdBps: bigint | undefined;
  healthFactor: number | undefined;
}) {
  const thresholdFraction = liquidationThresholdBps !== undefined ? Math.min(Number(liquidationThresholdBps) / 10_000, 1) : undefined;
  const ltvFraction = hasDebt && hasPrice && ltvBps !== undefined ? Math.min(Number(ltvBps) / 10_000, 1) : 0;

  const colorClass = !hasDebt
    ? "text-success-400"
    : !hasPrice
      ? "text-ink-500"
      : healthFactor !== undefined && healthFactor < 1
        ? "text-danger-400"
        : thresholdFraction !== undefined && ltvFraction >= thresholdFraction * 0.9
          ? "text-warning-400"
          : "text-success-400";

  const trackPath = describeArc(CX, CY, R, 0, 1);
  const valuePath = ltvFraction > 0 ? describeArc(CX, CY, R, 0, ltvFraction) : undefined;
  const thresholdPoint = thresholdFraction !== undefined ? arcPoint(CX, CY, R, thresholdFraction) : undefined;

  const centerLabel = !hasDebt ? "No debt" : !hasPrice ? "—" : healthFactor !== undefined ? healthFactor.toFixed(2) : "—";

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-[140px]">
        <svg viewBox="0 0 200 150" className="w-full">
          <path d={trackPath} fill="none" stroke="currentColor" strokeWidth={14} strokeLinecap="round" className="text-ink-700" />
          {valuePath && (
            <path d={valuePath} fill="none" stroke="currentColor" strokeWidth={14} strokeLinecap="round" className={colorClass} />
          )}
          {thresholdPoint && (
            <circle cx={thresholdPoint.x} cy={thresholdPoint.y} r={5} className="fill-danger-500 stroke-ink-950" strokeWidth={1.5} />
          )}
        </svg>
        <div className="absolute inset-x-0 top-[78%] -translate-y-1/2 text-center">
          <div className={`font-bold text-lg ${colorClass}`}>{centerLabel}</div>
        </div>
      </div>
      {thresholdFraction !== undefined && (
        <p className="text-xs text-danger-400 font-medium mt-2 text-center leading-tight">
          Liquidation · {(thresholdFraction * 100).toFixed(0)}%
        </p>
      )}
    </div>
  );
}
