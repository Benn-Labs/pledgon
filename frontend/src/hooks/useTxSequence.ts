"use client";

import { useCallback, useRef, useState } from "react";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { toastTxError, txErrorMessage } from "@/lib/toast";

type WriteContractAsyncFn = ReturnType<typeof useWriteContract>["writeContractAsync"];

/**
 * One step of an on-chain operation. `title` is the short label shown in the
 * progress list; `description` explains in plain terms what this transaction
 * does and why it's needed (shown under the title, so make it specific to the
 * amounts involved); `tx` is the wagmi write request for this step.
 */
export type TxStep = {
  title: string;
  description: string;
  tx: Parameters<WriteContractAsyncFn>[0];
};

export type TxPhase = "idle" | "signing" | "mining" | "done" | "failed";

type Handlers = {
  /** Fired once, after the last step's transaction has confirmed on-chain. */
  onDone?: () => void;
  /** Fired for every confirmed step, with that step's transaction hash. */
  onStepConfirmed?: (hash: `0x${string}`) => void;
};

/**
 * Runs a sequence of wallet transactions one after another: each step's
 * transaction is sent and awaited on-chain before the next step fires its
 * wallet prompt automatically. Drives the TxProgressModal. A declined
 * signature or a revert stops the sequence at the failed step (earlier steps
 * stay settled on-chain) and reports the reason.
 */
export function useTxSequence(handlers: Handlers = {}) {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  // Invalidates an in-flight run when a new one starts or the modal closes, so
  // a slow receipt from an old sequence can never advance a new one. Only
  // touched from event handlers / async continuations, never during render.
  const activeRunRef = useRef(0);

  const start = useCallback(
    (opTitle: string, opSteps: TxStep[]) => {
      if (opSteps.length === 0) return;
      // Handlers are captured here, at the moment the sequence starts.
      const { onDone, onStepConfirmed } = handlers;
      const runId = ++activeRunRef.current;
      setTitle(opTitle);
      setSteps(opSteps);
      setIndex(0);
      setErrorMessage(undefined);
      void (async () => {
        try {
          for (let i = 0; i < opSteps.length; i++) {
            if (activeRunRef.current !== runId) return;
            setIndex(i);
            setPhase("signing");
            const hash = await writeContractAsync(opSteps[i].tx);
            if (activeRunRef.current !== runId) return;
            setPhase("mining");
            await waitForTransactionReceipt(config, { hash });
            if (activeRunRef.current !== runId) return;
            onStepConfirmed?.(hash);
          }
          setPhase("done");
          onDone?.();
        } catch (err) {
          if (activeRunRef.current !== runId) return;
          setPhase("failed");
          setErrorMessage(txErrorMessage(err));
          toastTxError(err);
        }
      })();
    },
    [config, handlers, writeContractAsync],
  );

  const close = useCallback(() => {
    activeRunRef.current += 1;
    setPhase("idle");
    setErrorMessage(undefined);
  }, []);

  const busy = phase === "signing" || phase === "mining";

  return { title, steps, index, phase, errorMessage, busy, start, close };
}

export type TxSequence = ReturnType<typeof useTxSequence>;
