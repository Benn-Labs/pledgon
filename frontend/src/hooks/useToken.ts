import { erc20Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";

/** Reads `decimals()` and `symbol()` for an ERC-20, batched in one multicall. */
export function useToken(token: Address | undefined) {
  const { data, isLoading } = useReadContracts({
    contracts: [
      { address: token, abi: erc20Abi, functionName: "decimals" },
      { address: token, abi: erc20Abi, functionName: "symbol" },
    ],
    query: { enabled: Boolean(token) },
  });

  const decimals = data?.[0]?.result;
  const symbol = data?.[1]?.result;

  return {
    decimals,
    symbol,
    isLoading,
    isReady: decimals !== undefined && symbol !== undefined,
  };
}
