// Seconds, as strings so they drop straight into a <select> value. "0" means
// no deadline — EscrowVault treats a zero window as "disabled" throughout.
export const DEADLINE_WINDOW_OPTIONS = [
  { label: "No deadline", seconds: "0" },
  { label: "1 day", seconds: String(1 * 24 * 60 * 60) },
  { label: "3 days", seconds: String(3 * 24 * 60 * 60) },
  { label: "7 days", seconds: String(7 * 24 * 60 * 60) },
  { label: "14 days", seconds: String(14 * 24 * 60 * 60) },
  { label: "30 days", seconds: String(30 * 24 * 60 * 60) },
] as const;
