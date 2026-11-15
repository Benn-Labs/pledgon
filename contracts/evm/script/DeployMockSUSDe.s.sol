// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20Named} from "../test/mocks/MockERC20Named.sol";

/// @title DeployMockSUSDe
/// @notice Testnet-only: deploys the mock sUSDe collateral token for the
/// Sepolia sUSDe/USDC lending market (real sUSDe is mainnet-only). Mints
/// 1M msUSDe to the deployer; mint() is unguarded, so anyone can mint more
/// for testing. Run before DeployLending.s.sol and feed the recorded address
/// in as COLLATERAL_TOKEN_ADDRESS.
///
/// Usage:
///   forge script script/DeployMockSUSDe.s.sol --rpc-url <url> --account deployer --password <pw> --broadcast
contract DeployMockSUSDe is Script {
    function run() external {
        vm.startBroadcast();
        MockERC20Named token = new MockERC20Named("Mock sUSDe", "msUSDe", 18);
        token.mint(msg.sender, 1_000_000 * 1e18);
        vm.stopBroadcast();
        console.log("Mock sUSDe:", address(token));

        string memory json = "mockSUSDe";
        vm.serializeAddress(json, "address", address(token));
        string memory finalJson = vm.serializeUint(json, "decimals", 18);
        string memory path = string.concat("deployments/mock-susde-", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console.log("Wrote mock sUSDe record to", path);
    }
}
