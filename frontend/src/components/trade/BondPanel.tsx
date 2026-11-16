"use client";

import type { Address } from "viem";
import { erc20Abi } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { formatToken } from "@/lib/format";
import { useTxSequence, type TxStep } from "@/hooks/useTxSequence";
import { TxProgressModal } from "@/components/ui/TxProgressModal";

export function BondPanel({
  vault,
  seller,
  token,
  bondAmount,
  bondDeposited,
  decimals,
  symbol,
  onSuccess,
}: {
  vault: Address;
  seller: Address;
  token: Address;
  bondAmount: bigint;
  bondDeposited: boolean;
  decimals: number;
  symbol: string;
  onSuccess: () => void;
}) {
  const { address: account } = useAccount();
  const isSeller = account?.toLowerCase() === seller.toLowerCase();

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: account ? [account, vault] : undefined,
    query: { enabled: Boolean(account) },
  });

  const sequence = useTxSequence({
    onStepConfirmed: () => refetchAllowance(),
    onDone: () => onSuccess(),
  });

  if (!isSeller) return null;

  if (bondDeposited) {
    return (
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold mb-2 text-white">Seller Bond</h2>
        <p className="text-sm text-success-400">Bond deposited ({formatToken(bondAmount, decimals, symbol)}).</p>
      </div>
    );
  }

  const label = formatToken(bondAmount, decimals, symbol);
  const needsApproval = bondAmount > 0n && (allowance ?? 0n) < bondAmount;

  // Approve (only when the current allowance doesn't cover the bond) then
  // depositBond run as one sequence: the wallet prompts follow each other
  // automatically, and each step is explained in the progress modal.
  function depositBond() {
    const bondStep: TxStep = {
      title: "Deposit Bond",
      description: `Lock ${label} into the vault as your performance bond. It refunds when the trade completes — the arbiter can slash it if you fail to deliver.`,
      tx: { address: vault, abi: escrowVaultAbi, functionName: "depositBond" },
    };
    const steps: TxStep[] = needsApproval
      ? [
          {
            title: `Approve ${symbol}`,
            description: `Allow the escrow vault to pull ${label} from your wallet as your performance bond.`,
            tx: { address: token, abi: erc20Abi, functionName: "approve", args: [vault, bondAmount] },
          },
          bondStep,
        ]
      : [bondStep];
    sequence.start("Deposit Seller Bond", steps);
  }

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
      <h2 className="font-semibold mb-4 text-white">Deposit Seller Bond</h2>
      <div className="p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-300">Bond amount</span>
          <span className="font-mono font-semibold text-warning-400">{label}</span>
        </div>
      </div>
      <button
        onClick={depositBond}
        disabled={sequence.busy}
        className="btn-press w-full py-3 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
      >
        {sequence.busy ? "Submitting…" : needsApproval ? `Approve & Deposit Bond` : "Deposit Bond"}
      </button>
      <TxProgressModal
        title={sequence.title}
        steps={sequence.steps}
        index={sequence.index}
        phase={sequence.phase}
        errorMessage={sequence.errorMessage}
        onClose={sequence.close}
      />
    </div>
  );
}
