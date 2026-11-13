import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";
import { http } from "wagmi";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = getDefaultConfig({
  appName: "PLEDGON",
  projectId: projectId || "MISSING_WALLETCONNECT_PROJECT_ID",
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: process.env.NEXT_PUBLIC_MAINNET_RPC_URL
      ? http(process.env.NEXT_PUBLIC_MAINNET_RPC_URL)
      : http(),
    [sepolia.id]: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL
      ? http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL)
      : http(),
  },
  ssr: true,
});
