// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @title DeployMockToken
/// @notice Testnet-only convenience: deploys a freely mintable ERC20 so
/// there's a payment token to use in Marketplace listings without hunting
/// for a real Sepolia stablecoin. Never deploy this to a real network —
/// MockERC20.mint() has no access control and is callable by anyone for any
/// address.
///
/// Usage:
///   forge script script/DeployMockToken.s.sol --rpc-url <url> --account deployer --password <pw> --broadcast
///
/// After deploying, mint yourself a balance directly (repeatable, and works
/// for any address — buyer, seller, or both if testing solo with one
/// account):
///   cast send <token address> "mint(address,uint256)" <your address> 1000000000000000000000 \
///     --rpc-url <url> --account deployer --password <pw>
contract DeployMockToken is Script {
    uint8 constant DECIMALS = 18;

    function run() external {
        vm.startBroadcast();
        MockERC20 token = new MockERC20(DECIMALS);
        vm.stopBroadcast();

        console.log("MockERC20:", address(token));
        console.log("Decimals:", DECIMALS);

        string memory json = "mockToken";
        vm.serializeAddress(json, "address", address(token));
        string memory finalJson = vm.serializeUint(json, "decimals", DECIMALS);
        string memory path = string.concat("deployments/mock-token-", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console.log("Wrote mock token record to", path);
    }
}
