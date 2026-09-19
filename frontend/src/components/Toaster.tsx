"use client";

import { useEffect, useState } from "react";
import { subscribeToast, type ToastEvent } from "@/lib/toast";

const STYLES: Record<ToastEvent["type"], string> = {
  success: "bg-success-600 border-success-500",
  error: "bg-danger-600 border-danger-500",
  warning: "bg-warning-600 border-warning-500",
  info: "bg-trust-600 border-trust-500",
};

export function Toaster() {
  const [toasts, setToasts] = useState<ToastEvent[]>([]);

  useEffect(() => {
    return subscribeToast((event) => {
      setToasts((prev) => [...prev, event]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== event.id));
      }, 4000);
    });
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`fade-in px-4 py-3 rounded-lg border text-white text-sm font-medium shadow-lg max-w-sm ${STYLES[t.type]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
