const PENDING = 0;
const DOCS_SUBMITTED = 1;
const RELEASED = 2;
const DISPUTED = 3;
const REFUNDED = 4;
const SPLIT = 5;
const SETTLED_STATUSES = [RELEASED, REFUNDED, SPLIT];

export type TradeLifecycleStatus = "Cancelled" | "Awaiting Bond" | "Awaiting Funding" | "Active" | "Disputed" | "Completed";

/**
 * A single "where is this trade at" label, derived from the vault's actual
 * on-chain state — not stored anywhere itself. Priority: cancellation is
 * terminal and wins over everything (a cancelled vault's milestones may
 * still show Pending/Refunded from before the cancel/exit); then an active
 * dispute or full settlement, since those are the states that actually
 * matter regardless of how funding progressed to get there.
 */
export function deriveTradeStatus({
  bondAmount,
  bondDeposited,
  funded,
  cancelled,
  milestoneStatuses,
}: {
  bondAmount: bigint;
  bondDeposited: boolean;
  funded: boolean;
  cancelled?: boolean;
  milestoneStatuses: number[];
}): TradeLifecycleStatus {
  if (cancelled) return "Cancelled";
  if (milestoneStatuses.some((s) => s === DISPUTED)) return "Disputed";
  if (milestoneStatuses.length > 0 && milestoneStatuses.every((s) => SETTLED_STATUSES.includes(s))) {
    return "Completed";
  }
  if (bondAmount > 0n && !bondDeposited) return "Awaiting Bond";
  if (!funded) return "Awaiting Funding";
  return "Active";
}

export interface TradeProgress {
  steps: string[];
  /** Index of the current/frontier step; equals steps.length once every step is done. */
  currentIndex: number;
  flag: "none" | "disputed" | "cancelled";
}

/**
 * The stage-by-stage breakdown behind deriveTradeStatus's single label, for
 * rendering a "creation → completed" progress line. A step is "done" once
 * its underlying on-chain flag flips permanently true — "Active" itself only
 * counts as done once every milestone has actually settled, since it's a
 * phase, not a one-time event. Disputed/cancelled don't add their own step;
 * they flag whichever step is currently the frontier.
 */
export function deriveTradeProgress({
  bondAmount,
  bondDeposited,
  funded,
  cancelled,
  milestoneStatuses,
}: {
  bondAmount: bigint;
  bondDeposited: boolean;
  funded: boolean;
  cancelled?: boolean;
  milestoneStatuses: number[];
}): TradeProgress {
  const bondRequired = bondAmount > 0n;
  const isDisputed = milestoneStatuses.some((s) => s === DISPUTED);
  const isCompleted = milestoneStatuses.length > 0 && milestoneStatuses.every((s) => SETTLED_STATUSES.includes(s));

  const steps = bondRequired ? ["Created", "Bonded", "Funded", "Active", "Completed"] : ["Created", "Funded", "Active", "Completed"];
  const reached = bondRequired
    ? [true, bondDeposited, funded, isCompleted, isCompleted]
    : [true, funded, isCompleted, isCompleted];

  let currentIndex = reached.findIndex((r) => !r);
  if (currentIndex === -1) currentIndex = steps.length;

  const flag: TradeProgress["flag"] = cancelled ? "cancelled" : isDisputed && !isCompleted ? "disputed" : "none";

  return { steps, currentIndex, flag };
}

export interface CurrentDeadline {
  /** Unix seconds, straight off `fundingDeadline`/`milestoneDeadline`. */
  deadline: bigint;
  label: string;
}

/**
 * The one deadline currently worth showing on a trade card: `fundingDeadline`
 * while unfunded, or — once funded — the soonest active deadline across every
 * milestone: a DocsSubmitted one's confirmation deadline, or a Pending one's
 * delivery deadline (a trade can have several milestones in flight at once;
 * only the nearest deadline is the actual time pressure). Undefined means
 * nothing is currently time-bound — no deadline was configured, or none
 * applies at this stage.
 */
export function deriveCurrentDeadline({
  funded,
  cancelled,
  fundingDeadline,
  milestoneStatuses,
  milestoneDeadlines,
  deliveryDeadlines = [],
}: {
  funded: boolean;
  cancelled?: boolean;
  fundingDeadline: bigint | undefined;
  milestoneStatuses: number[];
  milestoneDeadlines: (bigint | undefined)[];
  deliveryDeadlines?: (bigint | undefined)[];
}): CurrentDeadline | undefined {
  if (cancelled) return undefined;

  if (!funded) {
    return fundingDeadline && fundingDeadline > 0n ? { deadline: fundingDeadline, label: "Funding" } : undefined;
  }

  let soonest: (CurrentDeadline & { deadline: bigint }) | undefined;
  const consider = (deadline: bigint | undefined, label: string) => {
    if (deadline && deadline > 0n && (soonest === undefined || deadline < soonest.deadline)) soonest = { deadline, label };
  };
  milestoneStatuses.forEach((status, i) => {
    if (status === DOCS_SUBMITTED) consider(milestoneDeadlines[i], "Confirm by");
    else if (status === PENDING) consider(deliveryDeadlines[i], "Deliver by");
  });
  return soonest;
}
