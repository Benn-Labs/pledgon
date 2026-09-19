// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20Named} from "../test/mocks/MockERC20Named.sol";

/// @title DeployLendingTokens
/// @notice Testnet-only: deploys the two mock tokens LendingPool needs
/// (collateral + debt), both 18 decimals so LendingPool's
/// collateralValueInDebtUnits math (which assumes matching decimals) is
/// correct without extra conversion. Run this before DeployLending.s.sol
/// and feed its output addresses into that script's env vars.
///
/// Usage:
///   forge script script/DeployLendingTokens.s.sol --rpc-url <url> --account deployer --password <pw> --broadcast
contract DeployLendingTokens is Script {
    function run() external {
        vm.startBroadcast();
        MockERC20Named collateral = new MockERC20Named("Mock Collateral", "mCOL", 18);
        MockERC20Named debt = new MockERC20Named("Mock USD", "mUSD", 18);
        vm.stopBroadcast();

        console.log("Collateral token (mCOL):", address(collateral));
        console.log("Debt token (mUSD):      ", address(debt));

        string memory json = "lendingTokens";
        vm.serializeAddress(json, "collateralToken", address(collateral));
        string memory finalJson = vm.serializeAddress(json, "debtToken", address(debt));
        string memory path = string.concat("deployments/lending-tokens-", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console.log("Wrote lending token addresses to", path);
    }
}
