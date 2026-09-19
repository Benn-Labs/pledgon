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
