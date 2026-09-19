import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";
import { http } from "wagmi";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = getDefaultConfig({
  appName: "DEEDS",
  projectId: projectId || "MISSING_WALLETCONNECT_PROJECT_ID",
  chains: [sepolia],
  transports: {
    [sepolia.id]: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL
      ? http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL)
      : http(),
  },
  ssr: true,
});
