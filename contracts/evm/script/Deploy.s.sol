// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {EscrowConfirmationConsumer} from "../src/escrow/EscrowConfirmationConsumer.sol";
import {EscrowFactory} from "../src/escrow/EscrowFactory.sol";
import {ComplianceConsumer} from "../src/compliance/ComplianceConsumer.sol";
import {Marketplace} from "../src/marketplace/Marketplace.sol";
import {LendingOracleConsumer} from "../src/lending/LendingOracleConsumer.sol";
import {LiquidationConsumer} from "../src/lending/LiquidationConsumer.sol";
import {LendingPool} from "../src/lending/LendingPool.sol";

/// @title Deploy
/// @notice Deploys the DEEDS system contracts to whatever chain `forge script`
/// targets. Key material is supplied on the CLI (`--private-key` or
/// `--account`) — never read from an env var here.
///
/// Escrow and compliance always deploy. Lending deploys only if both token
/// addresses are set; a partial deployment (e.g. shipping escrow/marketplace
/// before lending's token pair is decided) is expected, not an error case.
///
/// Required env var:
///   FORWARDER_ADDRESS          KeystoneForwarder for the target chain — the
///                               production address from chain-selectors.md, or
///                               the MockKeystoneForwarder for a local/simulation
///                               run. One forwarder serves every consumer on a
///                               given chain; this deploy targets one chain.
///
/// Optional env vars (lending is skipped entirely unless both token addresses
/// are set):
///   COLLATERAL_TOKEN_ADDRESS
///   DEBT_TOKEN_ADDRESS          must share `decimals()` with the collateral
///                               token — see LendingPool's own doc comment
///   COLLATERAL_FEED_LABEL       default "RWA/USD"; hashed to the feedId
///                               LendingOracleConsumer keys its price by
///   LIQUIDATION_THRESHOLD_BPS   default 8000 (80% LTV)
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url <url> --private-key $PRIVATE_KEY --broadcast
///
/// Writes every deployed address to deployments/<chainId>.json — copy the
/// relevant ones into the matching workflow's config.*.json
/// (confirmationConsumerAddress, consumerAddress, lendingPoolAddress, etc.).
contract Deploy is Script {
    function run() external {
        address forwarder = vm.envAddress("FORWARDER_ADDRESS");

        vm.startBroadcast();

        EscrowConfirmationConsumer confirmationConsumer = new EscrowConfirmationConsumer(forwarder);
        ComplianceConsumer complianceConsumer = new ComplianceConsumer(forwarder);
        EscrowFactory factory = new EscrowFactory(confirmationConsumer, complianceConsumer);
        Marketplace marketplace = new Marketplace(factory);

        console.log("EscrowConfirmationConsumer:", address(confirmationConsumer));
        console.log("ComplianceConsumer:        ", address(complianceConsumer));
        console.log("EscrowFactory:             ", address(factory));
        console.log("Marketplace:               ", address(marketplace));

        (address lendingOracleConsumer, address liquidationConsumer, address lendingPool) = _maybeDeployLending(forwarder);

        vm.stopBroadcast();

        _writeDeploymentJson(
            address(confirmationConsumer),
            address(complianceConsumer),
            address(factory),
            address(marketplace),
            lendingOracleConsumer,
            liquidationConsumer,
            lendingPool
        );
    }

    function _maybeDeployLending(address forwarder)
        private
        returns (address lendingOracleConsumer, address liquidationConsumer, address lendingPool)
    {
        address collateralToken = vm.envOr("COLLATERAL_TOKEN_ADDRESS", address(0));
        address debtToken = vm.envOr("DEBT_TOKEN_ADDRESS", address(0));

        if (collateralToken == address(0) || debtToken == address(0)) {
            console.log("Skipping lending: COLLATERAL_TOKEN_ADDRESS / DEBT_TOKEN_ADDRESS not both set");
            return (address(0), address(0), address(0));
        }

        string memory feedLabel = vm.envOr("COLLATERAL_FEED_LABEL", string("RWA/USD"));
        uint256 thresholdBps = vm.envOr("LIQUIDATION_THRESHOLD_BPS", uint256(8000));

        LendingOracleConsumer oracleConsumer = new LendingOracleConsumer(forwarder);
        LiquidationConsumer liqConsumer = new LiquidationConsumer(forwarder);
        LendingPool pool = new LendingPool(
            IERC20(collateralToken),
            IERC20(debtToken),
            oracleConsumer,
            liqConsumer,
            oracleConsumer.feedIdFor(feedLabel),
            thresholdBps
        );

        console.log("LendingOracleConsumer:     ", address(oracleConsumer));
        console.log("LiquidationConsumer:       ", address(liqConsumer));
        console.log("LendingPool:               ", address(pool));

        return (address(oracleConsumer), address(liqConsumer), address(pool));
    }

    function _writeDeploymentJson(
        address confirmationConsumer,
        address complianceConsumer,
        address factory,
        address marketplace,
        address lendingOracleConsumer,
        address liquidationConsumer,
        address lendingPool
    ) private {
        string memory json = "deployment";
        vm.serializeAddress(json, "escrowConfirmationConsumer", confirmationConsumer);
        vm.serializeAddress(json, "complianceConsumer", complianceConsumer);
        vm.serializeAddress(json, "escrowFactory", factory);
        vm.serializeAddress(json, "marketplace", marketplace);
        vm.serializeAddress(json, "lendingOracleConsumer", lendingOracleConsumer);
        vm.serializeAddress(json, "liquidationConsumer", liquidationConsumer);
        string memory finalJson = vm.serializeAddress(json, "lendingPool", lendingPool);

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console.log("Wrote deployment addresses to", path);
    }
}
