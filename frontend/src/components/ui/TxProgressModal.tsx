"use client";

import { useEffect, useMemo } from "react";
import type { TxPhase, TxStep } from "@/hooks/useTxSequence";
import { playApplause } from "@/lib/applause";

type StepStatus = "queued" | "wallet" | "mining" | "done" | "failed";

function stepStatus(phase: TxPhase, index: number, i: number): StepStatus {
  if (phase === "done" || i < index) return "done";
  if (phase === "idle" || i > index) return "queued";
  if (phase === "failed") return "failed";
  return phase === "signing" ? "wallet" : "mining";
}

const STATUS_LABEL: Record<StepStatus, string> = {
  queued: "Waiting",
  wallet: "Confirm in wallet…",
  mining: "Confirming on-chain…",
  done: "Confirmed",
  failed: "Failed",
};

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return (
        <span className="w-7 h-7 rounded-full bg-success-500/15 border border-success-500/50 flex items-center justify-center shrink-0 success-pop">
          <svg className="w-4 h-4 text-success-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </span>
      );
    case "failed":
      return (
        <span className="w-7 h-7 rounded-full bg-danger-500/15 border border-danger-500/50 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-danger-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
      );
    case "wallet":
      return (
        <span className="w-7 h-7 rounded-full border border-warning-500/50 flex items-center justify-center shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-warning-400 animate-pulse" />
        </span>
      );
    case "mining":
      return (
        <span className="w-7 h-7 rounded-full border border-trust-500/50 flex items-center justify-center shrink-0">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-trust-500/30 border-t-trust-400 animate-spin" />
        </span>
      );
    default:
      return <span className="w-7 h-7 rounded-full border border-ink-700 flex items-center justify-center shrink-0" />;
  }
}

const CONFETTI_COLORS = ["bg-trust-400", "bg-success-400", "bg-warning-400", "bg-danger-400", "bg-ink-100"];

/** Deterministic PRNG so confetti layout is stable across renders (pure render, no Math.random). */
function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Confetti() {
  const pieces = useMemo(() => {
    const rand = mulberry32(20261116);
    return Array.from({ length: 32 }, (_, i) => ({
      left: `${rand() * 100}%`,
      delay: `${rand() * 0.35}s`,
      duration: `${1.5 + rand() * 1.2}s`,
      size: 5 + rand() * 6,
      round: rand() > 0.6,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    }));
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`confetti-piece absolute top-0 ${p.color} ${p.round ? "rounded-full" : ""}`}
          style={{
            left: p.left,
            width: p.size,
            height: p.size * (p.round ? 1 : 0.5),
            animationDelay: p.delay,
            animationDuration: p.duration,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Progress modal for an operation running through useTxSequence: lists the
 * operation's steps in order, shows each one moving through wallet →
 * on-chain → confirmed, and finishes with a success state (check symbol,
 * confetti, and a short applause sound) once every step has executed.
 */
export function TxProgressModal({
  title,
  steps,
  index,
  phase,
  errorMessage,
  onClose,
}: {
  title: string;
  steps: TxStep[];
  index: number;
  phase: TxPhase;
  errorMessage?: string;
  onClose: () => void;
}) {
  const open = phase !== "idle";

  useEffect(() => {
    if (phase === "done") playApplause();
  }, [phase]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md bg-ink-900 border border-ink-800 rounded-xl p-6 shadow-2xl overflow-hidden">
        {phase === "done" && <Confetti />}

        <h3 className="font-semibold text-white text-lg mb-1">{title}</h3>
        <p className="text-xs text-ink-500 mb-5">
          Step {phase === "done" ? steps.length : Math.min(index + 1, steps.length)} of {steps.length}
        </p>

        <ol className="space-y-4 mb-6">
          {steps.map((step, i) => {
            const status = stepStatus(phase, index, i);
            return (
              <li key={`${step.title}-${i}`} className="flex gap-3">
                <StepIcon status={status} />
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={`text-sm font-semibold ${
                        status === "queued" ? "text-ink-500" : status === "failed" ? "text-danger-400" : "text-white"
                      }`}
                    >
                      {i + 1}. {step.title}
                    </span>
                    <span
                      className={`text-xs shrink-0 ${
                        status === "done"
                          ? "text-success-400"
                          : status === "failed"
                            ? "text-danger-400"
                            : status === "queued"
                              ? "text-ink-600"
                              : "text-warning-400 animate-pulse-subtle"
                      }`}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                  <p className={`text-xs mt-0.5 ${status === "queued" ? "text-ink-600" : "text-ink-400"}`}>{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>

        {phase === "done" ? (
          <div className="relative text-center pt-1">
            <div className="flex justify-center mb-3 success-pop" aria-hidden>
              <svg className="w-16 h-16" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="30" fill="#16a34a" />
                <path d="M20 33.5L28.5 42L45 23" stroke="#ffffff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-success-400 font-semibold mb-4">Operation completed successfully!</p>
            <button
              onClick={onClose}
              className="btn-press w-full py-2.5 rounded-lg bg-success-600 hover:bg-success-500 text-white font-semibold"
            >
              Done
            </button>
          </div>
        ) : phase === "failed" ? (
          <div>
            <p className="text-sm text-danger-400 mb-4">
              {errorMessage ?? "Transaction failed"}. Nothing further was sent — completed steps stay settled on-chain.
            </p>
            <button
              onClick={onClose}
              className="btn-press w-full py-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 text-white font-semibold"
            >
              Close
            </button>
          </div>
        ) : (
          <p className="text-xs text-ink-500">Follow the prompts in your wallet — each following step opens automatically.</p>
        )}
      </div>
    </div>
  );
}
