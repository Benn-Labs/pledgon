import type { TradeProgress } from "@/lib/tradeStatus";

/**
 * A slim creation-to-completed stepper for a trade card. Filled segments are
 * stages already reached; the frontier dot pulses trust-blue while normal,
 * or flips to danger/muted for a disputed or cancelled trade — everything
 * past the frontier stays gray since it hasn't happened (and, if cancelled,
 * never will).
 */
export function TradeProgressBar({ progress }: { progress: TradeProgress }) {
  const { steps, currentIndex, flag } = progress;

  return (
    <div className="w-full">
      <div className="flex items-center">
        {steps.map((label, i) => {
          const isDone = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isLast = i === steps.length - 1;

          let dotClasses = "bg-ink-700";
          if (isDone) dotClasses = "bg-success-500";
          if (isCurrent) {
            dotClasses =
              flag === "cancelled" ? "bg-ink-500" : flag === "disputed" ? "bg-danger-500" : "bg-trust-500 animate-pulse-subtle";
          }

          return (
            <div key={label} className={`flex items-center ${isLast ? "" : "flex-1"}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotClasses}`} title={label} />
              {!isLast && <span className={`flex-1 h-px mx-1 ${isDone ? "bg-success-500/50" : "bg-ink-700"}`} />}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5">
        {steps.map((label, i) => (
          <span
            key={label}
            className={`text-[9px] uppercase tracking-wide ${
              i === currentIndex
                ? flag === "cancelled"
                  ? "text-ink-500"
                  : flag === "disputed"
                    ? "text-danger-400"
                    : "text-trust-400"
                : i < currentIndex
                  ? "text-success-400/70"
                  : "text-ink-600"
            }`}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
