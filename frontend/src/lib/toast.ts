export type ToastType = "success" | "error" | "warning" | "info";

export type ToastEvent = { id: number; message: string; type: ToastType };

type Listener = (event: ToastEvent) => void;

let listeners: Listener[] = [];
let idCounter = 0;

export function toast(message: string, type: ToastType = "info") {
  const event: ToastEvent = { id: ++idCounter, message, type };
  listeners.forEach((listener) => listener(event));
}

export function subscribeToast(listener: Listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

const MAX_TX_ERROR_LENGTH = 120;

function errorFields(error: unknown): { code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown } {
  if (error !== null && typeof error === "object") return error as { code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown };
  return {};
}

function isUserRejection(error: unknown): boolean {
  if (typeof error === "string") return /user (rejected|denied)/i.test(error);
  const { code, name, message } = errorFields(error);
  if (code === 4001 || code === "ACTION_REJECTED") return true;
  if (typeof name === "string" && /user rejected|user denied|userrejected/i.test(name)) return true;
  return typeof message === "string" && /user (rejected|denied)/i.test(message);
}

function extractRevertReason(message: string): string {
  let text = message.trim();

  // Some providers surface the whole JSON-RPC error object serialized into the
  // message — drill down to the innermost nested "message" instead.
  for (let depth = 0; depth < 3 && text.startsWith("{"); depth++) {
    try {
      const parsed = JSON.parse(text) as { message?: unknown; data?: unknown };
      const data = parsed.data;
      const nested =
        data !== null && typeof data === "object"
          ? ((data as { message?: unknown }).message ??
            (data as { originalError?: { message?: unknown } }).originalError?.message)
          : typeof data === "string"
            ? data
            : undefined;
      const next = typeof nested === "string" ? nested : parsed.message;
      if (typeof next !== "string") break;
      text = next.trim();
    } catch {
      break;
    }
  }

  // "execution reverted: Insufficient balance" / "reverted with the following
  // reason:\nInsufficient balance" / "reverted with reason string 'X'" — keep
  // just the reason itself.
  const revert = text.match(/reverted[^:\n]{0,80}:\s*['"`]?([^"'`\n]+?)['"`]?\s*$/i);
  if (revert?.[1]) text = revert[1].trim();

  text = text.replace(/\s+/g, " ").trim();
  if (text.length > MAX_TX_ERROR_LENGTH) text = `${text.slice(0, MAX_TX_ERROR_LENGTH - 1)}…`;
  return text;
}

function rawErrorMessage(error: unknown): string {
  const { shortMessage, message } = errorFields(error);
  if (typeof shortMessage === "string" && shortMessage) return shortMessage;
  if (typeof message === "string" && message) return message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

/**
 * Human-readable message for a transaction error without dumping raw revert
 * JSON. A declined wallet signature is treated as a neutral "Cancelled", not
 * a scary error; real reverts are shortened to their reason (capped at ~120
 * chars).
 */
export function txErrorMessage(error: unknown, fallback = "Transaction failed"): string {
  if (isUserRejection(error)) return "Cancelled";
  if (error === null || error === undefined) return fallback;
  const reason = extractRevertReason(rawErrorMessage(error));
  return reason.length > 0 ? reason : fallback;
}

/**
 * Toast a transaction error without dumping raw revert JSON. A declined wallet
 * signature is treated as a neutral "Cancelled", not a scary error; real
 * reverts are shortened to their reason (capped at ~120 chars).
 */
export function toastTxError(error: unknown, fallback = "Transaction failed") {
  const message = txErrorMessage(error, fallback);
  toast(message, message === "Cancelled" ? "info" : "error");
}
