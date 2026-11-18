// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {EscrowFactory} from "../src/escrow/EscrowFactory.sol";
import {Marketplace} from "../src/marketplace/Marketplace.sol";

/// @title DeployMarketplace
/// @notice Deploys a fresh Marketplace against the already-live EscrowFactory,
/// without touching the factory, consumers or any existing vault. Used when
/// only the Marketplace contract itself changed (e.g. adding admin
/// moderation). The previous Marketplace's listings stay readable at its old
/// address but are no longer shown once the frontend points at the new one.
///
/// Required env vars:
///   ESCROW_FACTORY_ADDRESS   the live EscrowFactory (its owner() becomes the
///                            new Marketplace's moderation admin and its
///                            feeRecipient() receives withdrawn listing fees)
///
/// Optional env vars:
///   LISTING_FEE_WEI          default 0 — flat ETH fee on createListing and
///                            renewListing (listings are valid monthly)
///
/// Usage:
///   forge script script/DeployMarketplace.s.sol --rpc-url <url> --account deployer --broadcast --verify --slow
contract DeployMarketplace is Script {
    function run() external {
        EscrowFactory factory = EscrowFactory(vm.envAddress("ESCROW_FACTORY_ADDRESS"));
        uint256 listingFee = vm.envOr("LISTING_FEE_WEI", uint256(0));

        vm.startBroadcast();
        Marketplace marketplace = new Marketplace(factory, listingFee);
        vm.stopBroadcast();

        console.log("Marketplace:", address(marketplace));
        console.log("Listing fee (wei):", listingFee);
        console.log("Moderation admin (factory.owner()):", factory.owner());

        string memory json = "marketplace";
        vm.serializeAddress(json, "escrowFactory", address(factory));
        string memory finalJson = vm.serializeAddress(json, "marketplace", address(marketplace));
        string memory path = string.concat("deployments/marketplace-", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console.log("Wrote marketplace deployment record to", path);
    }
}
