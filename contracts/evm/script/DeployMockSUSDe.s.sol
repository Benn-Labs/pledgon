// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20Named} from "../test/mocks/MockERC20Named.sol";

contract DeployMockSUSDe is Script {
    function run() external {
        vm.startBroadcast();
        MockERC20Named token = new MockERC20Named("Mock sUSDe", "msUSDe", 18);
        token.mint(msg.sender, 1_000_000 * 1e18);
        vm.stopBroadcast();
        console.log("Mock sUSDe:", address(token));
    }
}
