// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {LendingOracleConsumer} from "../src/lending/LendingOracleConsumer.sol";
import {LiquidationConsumer} from "../src/lending/LiquidationConsumer.sol";
import {LendingPool} from "../src/lending/LendingPool.sol";

/// @title DeployLending
/// @notice Deploys the lending substrate on its own, independent of
/// Deploy.s.sol — escrow/compliance/marketplace are already live and in
/// active use; redeploying the whole system again just to add lending
/// would reset all of that state for no reason. Run DeployLendingTokens.s.sol
/// first and feed its output addresses in here.
///
/// Known limitation carried over from LendingOracleConsumer/LiquidationConsumer:
/// borrow() and liquidate() require a price/verdict that only a live
/// compliance-check-style DON workflow can report via onReport() (forwarder-
/// gated, same trust model as ComplianceConsumer). No such workflow is
/// registered against a real DON in this environment, so those two calls
/// will always revert (StalePrice / PositionNotLiquidatable) until one is.
/// depositCollateral/withdrawCollateral/repay don't need a price and work now.
///
/// Required env vars:
///   FORWARDER_ADDRESS
///   COLLATERAL_TOKEN_ADDRESS  from deployments/lending-tokens-<chainId>.json
///   DEBT_TOKEN_ADDRESS        must share decimals() with the collateral token
///
/// Optional:
///   COLLATERAL_FEED_LABEL      default "RWA/USD"
///   LIQUIDATION_THRESHOLD_BPS  default 8000 (80% LTV)
///   BORROW_RATE_BPS            default 500 (5%/year, fixed simple interest)
///   MAX_PRICE_AGE              default 900 (15 min; 0 disables staleness reverts)
///   MAX_VERDICT_AGE            default 900 (15 min; 0 disables verdict expiry)
///   MAX_PRICE_DEVIATION_BPS    default 5000 (50% single-tick sanity bound; 0 disables;
///                              skipped once the stored price is older than MAX_PRICE_AGE)
///
/// Usage:
///   forge script script/DeployLending.s.sol --rpc-url <url> --account deployer --password <pw> --broadcast
contract DeployLending is Script {
    function run() external {
        address forwarder = vm.envAddress("FORWARDER_ADDRESS");
        address collateralToken = vm.envAddress("COLLATERAL_TOKEN_ADDRESS");
        address debtToken = vm.envAddress("DEBT_TOKEN_ADDRESS");
        string memory feedLabel = vm.envOr("COLLATERAL_FEED_LABEL", string("RWA/USD"));
        uint256 thresholdBps = vm.envOr("LIQUIDATION_THRESHOLD_BPS", uint256(8000));
        uint256 borrowRateBps = vm.envOr("BORROW_RATE_BPS", uint256(500));
        uint256 maxPriceAge = vm.envOr("MAX_PRICE_AGE", uint256(15 minutes));
        uint256 maxVerdictAge = vm.envOr("MAX_VERDICT_AGE", uint256(15 minutes));
        uint256 maxDeviationBps = vm.envOr("MAX_PRICE_DEVIATION_BPS", uint256(5000));
        // Workflow bindings (WorkflowBoundReceiver) — bytes32 0 = unbound
        // (simulation only; see Deploy.s.sol's comment). Set once the
        // workflows are deployed and their IDs known.
        bytes32 lendingOracleWorkflowId = vm.envOr("LENDING_ORACLE_WORKFLOW_ID", bytes32(0));
        bytes32 liquidationWorkflowId = vm.envOr("LIQUIDATION_WORKFLOW_ID", bytes32(0));
        // The liquidation workflow runs at two cadences (close-watch + safe),
        // each its own workflowId; the second is optional.
        bytes32 liquidationWorkflowId2 = vm.envOr("LIQUIDATION_WORKFLOW_ID_2", bytes32(0));
        bytes32[] memory liquidationExtra = new bytes32[](liquidationWorkflowId2 == bytes32(0) ? 0 : 1);
        if (liquidationExtra.length == 1) liquidationExtra[0] = liquidationWorkflowId2;

        vm.startBroadcast();
        LendingOracleConsumer oracleConsumer =
            new LendingOracleConsumer(forwarder, maxDeviationBps, maxPriceAge, lendingOracleWorkflowId);
        LiquidationConsumer liqConsumer = new LiquidationConsumer(forwarder, maxVerdictAge, liquidationWorkflowId, liquidationExtra);

        if (lendingOracleWorkflowId == bytes32(0) || liquidationWorkflowId == bytes32(0)) {
            console.log("WARNING: one or more lending consumers deployed UNBOUND (workflow id 0)");
            console.log("         onReport accepts any DON-signed workflow - bind before production");
        }
        LendingPool pool = new LendingPool(
            IERC20(collateralToken),
            IERC20(debtToken),
            oracleConsumer,
            liqConsumer,
            oracleConsumer.feedIdFor(feedLabel),
            thresholdBps,
            borrowRateBps,
            maxPriceAge
        );
        vm.stopBroadcast();

        // Optional guard: workflow configs (and so workflow IDs) embed these
        // addresses, so bound deployments precompute them from the deployer
        // nonce. Abort (nothing is broadcast) if reality drifted from that.
        _expect("EXPECTED_ORACLE_CONSUMER", address(oracleConsumer));
        _expect("EXPECTED_LIQUIDATION_CONSUMER", address(liqConsumer));
        _expect("EXPECTED_LENDING_POOL", address(pool));

        console.log("LendingOracleConsumer:", address(oracleConsumer));
        console.log("LiquidationConsumer:  ", address(liqConsumer));
        console.log("LendingPool:          ", address(pool));

        string memory json = "lending";
        vm.serializeAddress(json, "lendingOracleConsumer", address(oracleConsumer));
        vm.serializeAddress(json, "liquidationConsumer", address(liqConsumer));
        vm.serializeAddress(json, "collateralToken", collateralToken);
        vm.serializeAddress(json, "debtToken", debtToken);
        string memory finalJson = vm.serializeAddress(json, "lendingPool", address(pool));
        string memory path = string.concat("deployments/lending-", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console.log("Wrote lending deployment record to", path);
    }

    function _expect(string memory envName, address actual) private view {
        address expected = vm.envOr(envName, address(0));
        if (expected != address(0)) {
            require(expected == actual, string.concat(envName, " mismatch: deployer nonce drifted from the precomputed address"));
        }
    }
}
