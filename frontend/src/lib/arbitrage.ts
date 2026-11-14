import { encodeAbiParameters, parseAbiParameters, type Address } from "viem";

export const ARBITRAGE_TOKENS: { address: Address; symbol: string; decimals: number }[] = [
  { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
  { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", decimals: 18 },
  { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
  { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6 },
];

export const ARBITRAGE_ROUTERS: { address: Address; name: string }[] = [
  { address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", name: "Uniswap V2" },
  { address: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F", name: "SushiSwap" },
];

export const AAVE_V3_FLASH_LOAN_FEE_BPS = 5; // 0.05%

export interface ArbitrageRoute {
  router: Address;
  path: Address[];
  amountOutMin: bigint;
}

export interface FlashLoanParams {
  asset: Address;
  amount: bigint;
  router1: Address;
  router2: Address;
  path1: Address[];
  path2: Address[];
  amountOutMin1: bigint;
  amountOutMin2: bigint;
  minProfit: bigint;
  unwrapToEth: boolean;
}

export function encodeFlashLoanParams(params: FlashLoanParams): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters("address, address, address[], address[], uint256, uint256, uint256, bool"),
    [
      params.router1,
      params.router2,
      params.path1,
      params.path2,
      params.amountOutMin1,
      params.amountOutMin2,
      params.minProfit,
      params.unwrapToEth,
    ],
  );
}

export function buildArbitrageSignatureMessage(action: string, resource: string): string {
  return `PLEDGON wants you to ${action}.\n\nResource: ${resource}\nIssued At: ${new Date().toISOString()}`;
}
