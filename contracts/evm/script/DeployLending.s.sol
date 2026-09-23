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

        vm.startBroadcast();
        LendingOracleConsumer oracleConsumer = new LendingOracleConsumer(forwarder);
        LiquidationConsumer liqConsumer = new LiquidationConsumer(forwarder);
        LendingPool pool = new LendingPool(
            IERC20(collateralToken),
            IERC20(debtToken),
            oracleConsumer,
            liqConsumer,
            oracleConsumer.feedIdFor(feedLabel),
            thresholdBps,
            borrowRateBps
        );
        vm.stopBroadcast();

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
}
