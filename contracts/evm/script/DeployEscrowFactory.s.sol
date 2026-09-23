// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {EscrowConfirmationConsumer} from "../src/escrow/EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../src/compliance/ComplianceConsumer.sol";
import {ArbitratorRegistry} from "../src/escrow/ArbitratorRegistry.sol";
import {EscrowFactory} from "../src/escrow/EscrowFactory.sol";
import {Marketplace} from "../src/marketplace/Marketplace.sol";

/// @title DeployEscrowFactory
/// @notice Deploys a new EscrowFactory + Marketplace pair on their own,
/// reusing the already-deployed EscrowConfirmationConsumer/ComplianceConsumer
/// /ArbitratorRegistry — same pattern as DeployLending.s.sol relative to
/// Deploy.s.sol: those three are shared, independent infrastructure that
/// doesn't need to move just because EscrowFactory picked up a new feature
/// (the vault-creation fee). A new EscrowFactory means a fresh `allVaults` —
/// nothing carries over from the old factory's listings/trades, and
/// TradeExpiryKeeper's workflow config (`escrowFactoryAddress`) needs
/// re-wiring afterwards via cmd/wire-config, same as any other redeploy.
///
/// Required env vars:
///   CONFIRMATION_CONSUMER_ADDRESS   from deployments/<chainId>.json's
///                                    escrowConfirmationConsumer
///   COMPLIANCE_CONSUMER_ADDRESS     from deployments/<chainId>.json's
///                                    complianceConsumer
///   ARBITRATOR_REGISTRY_ADDRESS     from deployments/<chainId>.json's
///                                    arbitratorRegistry
///   DEFAULT_ARBITER_ADDRESS         same address the original Deploy.s.sol
///                                    run used — read it back from the old
///                                    factory's defaultArbiter() if unsure
///   OWNER_ADDRESS                   the account that will control
///                                    setVaultCreationFee/setFeeRecipient/
///                                    withdrawFees/transferOwnership —
///                                    deliberately NOT defaulted to
///                                    `msg.sender`: inside a forge script,
///                                    `msg.sender` is forge-std's fixed
///                                    DEFAULT_SENDER (0x1804c8AB...), not
///                                    whoever `--account`/`--private-key`
///                                    actually broadcasts as — nobody holds
///                                    that address's key, so anything owned
///                                    by it is permanently locked out of
///                                    every onlyOwner function. Pass the
///                                    real address explicitly (e.g. from
///                                    `cast wallet address --account deployer`).
///
/// Optional:
///   TIER0_CAP_USD              default 999 — read back from the old
///                               factory's tier0CapUsd() to keep it identical
///   TIER1_CAP_USD              default 10000 — same, via tier1CapUsd()
///   FEE_RECIPIENT_ADDRESS      default: OWNER_ADDRESS
///   VAULT_CREATION_FEE_WEI     default 0 (fees off)
///
/// Usage:
///   forge script script/DeployEscrowFactory.s.sol --rpc-url <url> --account deployer --broadcast
contract DeployEscrowFactory is Script {
    function run() external {
        EscrowConfirmationConsumer confirmationConsumer =
            EscrowConfirmationConsumer(vm.envAddress("CONFIRMATION_CONSUMER_ADDRESS"));
        ComplianceConsumer complianceConsumer = ComplianceConsumer(vm.envAddress("COMPLIANCE_CONSUMER_ADDRESS"));
        ArbitratorRegistry arbitratorRegistry = ArbitratorRegistry(vm.envAddress("ARBITRATOR_REGISTRY_ADDRESS"));
        address defaultArbiter = vm.envAddress("DEFAULT_ARBITER_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        uint256 tier0CapUsd = vm.envOr("TIER0_CAP_USD", uint256(999));
        uint256 tier1CapUsd = vm.envOr("TIER1_CAP_USD", uint256(10_000));
        address feeRecipient = vm.envOr("FEE_RECIPIENT_ADDRESS", owner);
        uint256 vaultCreationFee = vm.envOr("VAULT_CREATION_FEE_WEI", uint256(0));

        vm.startBroadcast();
        EscrowFactory factory = new EscrowFactory(
            confirmationConsumer,
            complianceConsumer,
            tier0CapUsd,
            tier1CapUsd,
            arbitratorRegistry,
            defaultArbiter,
            owner,
            feeRecipient,
            vaultCreationFee
        );
        Marketplace marketplace = new Marketplace(factory);
        vm.stopBroadcast();

        console.log("EscrowFactory:", address(factory));
        console.log("Marketplace:  ", address(marketplace));
        console.log("Owner:        ", owner);
        console.log("Fee recipient:", feeRecipient);
        console.log("Vault fee wei:", vaultCreationFee);

        string memory json = "escrow-factory";
        vm.serializeAddress(json, "confirmationConsumer", address(confirmationConsumer));
        vm.serializeAddress(json, "complianceConsumer", address(complianceConsumer));
        vm.serializeAddress(json, "arbitratorRegistry", address(arbitratorRegistry));
        vm.serializeAddress(json, "escrowFactory", address(factory));
        string memory finalJson = vm.serializeAddress(json, "marketplace", address(marketplace));
        string memory path = string.concat("deployments/escrow-factory-", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console.log("Wrote escrow-factory deployment record to", path);
    }
}
