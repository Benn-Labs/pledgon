// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlashArbV3} from "../src/arbitrage/FlashArbV3.sol";

/// @title DeployArbitrageBot
/// @notice Deploys a user-owned FlashArbV3 arbitrage bot contract.
///         The deploying address becomes the contract owner.
///
/// No constructor arguments or env vars are required. The bot is deployed
/// with its mainnet Aave/Uniswap/SushiSwap constants; only use it on Ethereum
/// mainnet (or a fork where those addresses are meaningful).
///
/// Usage:
///   forge script script/DeployArbitrageBot.s.sol --rpc-url <url> --account deployer --broadcast
///
/// Writes the deployed address to deployments/arbitrage-<chainId>.json.
contract DeployArbitrageBot is Script {
    function run() external {
        vm.startBroadcast();
        FlashArbV3 bot = new FlashArbV3();
        vm.stopBroadcast();

        console.log("FlashArbV3:", address(bot));

        string memory json = "arbitrage";
        string memory finalJson = vm.serializeAddress(json, "flashArbV3", address(bot));
        string memory path = string.concat("deployments/arbitrage-", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console.log("Wrote arbitrage deployment record to", path);
    }
}
