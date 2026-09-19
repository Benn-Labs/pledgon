"use client";

import { missingAddressVars } from "@/lib/addresses";

export function ConfigWarning() {
  const missingWalletConnect = !process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (missingAddressVars.length === 0 && !missingWalletConnect) return null;

  return (
    <div className="bg-warning-500/10 text-warning-400 text-sm px-4 py-2 border-b border-warning-500/30">
      <strong>Not configured:</strong>{" "}
      {missingWalletConnect && "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"}
      {missingWalletConnect && missingAddressVars.length > 0 && ", "}
      {missingAddressVars.join(", ")} — copy{" "}
      <code className="font-mono">.env.example</code> to{" "}
      <code className="font-mono">.env.local</code> and fill these in.
    </div>
  );
}
