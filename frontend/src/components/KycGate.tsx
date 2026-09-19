"use client";

import { useState } from "react";

type VerifyState = "idle" | "pending" | "done";

/**
 * KYC step for this session is a UI-only stub: no real KYC provider is wired
 * up yet, and ComplianceConsumer.onReport only accepts calls relayed by the
 * real KeystoneForwarder — only a live compliance-check workflow running on
 * an actual DON can change a buyer's on-chain tier (see
 * docs/architecture.md's "Known limitation: HTTP trigger delivery is not
 * confidential"). So this button simulates what a real provider's widget
 * would do (issue an opaque caseId once the subject verifies out of band)
 * without touching chain state — it's here to make the gate's UX real to
 * build against, not to actually unblock funding today.
 */
export function KycGate({ subject }: { subject: string }) {
  const [state, setState] = useState<VerifyState>("idle");
  const [caseId, setCaseId] = useState<string | null>(null);

  function startVerification() {
    setState("pending");
    const id = crypto.randomUUID();
    setTimeout(() => {
      setCaseId(id);
      setState("done");
    }, 900);
  }

  return (
    <div className="p-4 rounded-lg bg-danger-500/10 border border-danger-500/30 mb-4">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 text-danger-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div className="flex-1 space-y-3">
          <div>
            <h4 className="font-semibold text-danger-400">Compliance Limit Exceeded</h4>
            <p className="text-sm text-ink-300 mt-1">
              This purchase would push {subject.slice(0, 6)}…{subject.slice(-4)}&apos;s rolling 30-day volume past
              their current tier&apos;s cap.
            </p>
          </div>

          {state === "idle" && (
            <button
              onClick={startVerification}
              className="px-4 py-2 rounded-lg bg-warning-600 hover:bg-warning-500 text-white text-sm font-semibold"
            >
              Verify to Increase Limit
            </button>
          )}

          {state === "pending" && <p className="text-sm text-ink-400">Contacting mock provider…</p>}

          {state === "done" && caseId && (
            <div className="text-sm space-y-2">
              <div className="p-3 rounded-lg bg-ink-800 border border-ink-700">
                <div className="text-xs text-ink-500 mb-1">Payload shape a real integration would send:</div>
                <pre className="text-xs font-mono text-trust-400 whitespace-pre-wrap break-all">
                  {`{\n  "subject": "${subject.slice(0, 10)}…",\n  "caseId": "${caseId}"\n}`}
                </pre>
              </div>
              <p className="text-ink-400">
                No real KYC provider is integrated this session, and nothing was sent to the compliance-check
                workflow — this demonstrates the step&apos;s UX only. Even a real submission wouldn&apos;t change the
                on-chain tier here: only a live compliance-check workflow running on an actual DON can call{" "}
                <code className="font-mono text-xs">ComplianceConsumer.onReport</code>. To complete this purchase on
                real Sepolia today, keep it under the buyer&apos;s current tier cap.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
