// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPool} from "../../src/lending/LendingPool.sol";
import {LendingOracleConsumer} from "../../src/lending/LendingOracleConsumer.sol";
import {LiquidationConsumer} from "../../src/lending/LiquidationConsumer.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract LendingPoolTest is Test {
    uint256 constant LIQUIDATION_THRESHOLD_BPS = 8000; // 80% LTV
    uint256 constant PRICE = 100_000_000_000; // $1000.00000000 per whole collateral token
    uint8 constant PRICE_DECIMALS = 8;

    address forwarder = makeAddr("forwarder");
    address borrower = makeAddr("borrower");
    address liquidator = makeAddr("liquidator");

    MockERC20 collateralToken;
    MockERC20 debtToken;
    LendingOracleConsumer oracleConsumer;
    LiquidationConsumer liquidationConsumer;
    LendingPool pool;
    bytes32 feedId;

    function setUp() public {
        collateralToken = new MockERC20(18);
        debtToken = new MockERC20(18);
        oracleConsumer = new LendingOracleConsumer(forwarder);
        liquidationConsumer = new LiquidationConsumer(forwarder);
        feedId = oracleConsumer.feedIdFor("RWA/USD");

        pool = new LendingPool(
            IERC20(address(collateralToken)),
            IERC20(address(debtToken)),
            oracleConsumer,
            liquidationConsumer,
            feedId,
            LIQUIDATION_THRESHOLD_BPS
        );

        // Fund the pool with debt-token liquidity directly (no supply-side
        // mechanism in this minimal pool — see LendingPool's own doc comment).
        debtToken.mint(address(pool), 1_000_000e18);
    }

    function _setPrice(uint256 price, uint256 updatedAt) internal {
        vm.prank(forwarder);
        oracleConsumer.onReport("", abi.encode(feedId, price, PRICE_DECIMALS, updatedAt));
    }

    function _depositCollateral(address who, uint256 amount) internal {
        collateralToken.mint(who, amount);
        vm.startPrank(who);
        collateralToken.approve(address(pool), amount);
        pool.depositCollateral(amount);
        vm.stopPrank();
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroCollateralToken() public {
        vm.expectRevert(LendingPool.ZeroAddress.selector);
        new LendingPool(
            IERC20(address(0)), IERC20(address(debtToken)), oracleConsumer, liquidationConsumer, feedId, LIQUIDATION_THRESHOLD_BPS
        );
    }

    function test_Constructor_RevertsOnZeroOracleConsumer() public {
        vm.expectRevert(LendingPool.ZeroAddress.selector);
        new LendingPool(
            IERC20(address(collateralToken)),
            IERC20(address(debtToken)),
            LendingOracleConsumer(address(0)),
            liquidationConsumer,
            feedId,
            LIQUIDATION_THRESHOLD_BPS
        );
    }

    // ─── collateralValueInDebtUnits / isUndercollateralized ────

    function test_CollateralValueInDebtUnits_ComputesUsdValue() public {
        _setPrice(PRICE, block.timestamp);
        // 10 whole collateral tokens * $1000 = $10,000, in 18-decimal debtToken units.
        assertEq(pool.collateralValueInDebtUnits(10e18), 10_000e18);
    }

    function test_CollateralValueInDebtUnits_RevertsWithNoPriceEver() public {
        vm.expectRevert(abi.encodeWithSelector(LendingPool.StalePrice.selector, feedId));
        pool.collateralValueInDebtUnits(1e18);
    }

    function test_IsUndercollateralized_FalseWithNoDebt() public {
        _setPrice(PRICE, block.timestamp);
        assertFalse(pool.isUndercollateralized(borrower));
    }

    // ─── depositCollateral ────────────────────────────────────

    function test_DepositCollateral_TransfersAndUpdatesPosition() public {
        _depositCollateral(borrower, 5e18);
        (uint256 collateralAmount,) = pool.positions(borrower);
        assertEq(collateralAmount, 5e18);
        assertEq(collateralToken.balanceOf(address(pool)), 5e18);
    }

    function test_DepositCollateral_RevertsOnZeroAmount() public {
        vm.expectRevert(LendingPool.ZeroAmount.selector);
        pool.depositCollateral(0);
    }

    // ─── borrow ───────────────────────────────────────────────

    function test_Borrow_SucceedsWithinThreshold() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18); // $10,000 collateral, 80% LTV -> $8,000 max debt

        vm.prank(borrower);
        pool.borrow(7_000e18);

        (, uint256 debtAmount) = pool.positions(borrower);
        assertEq(debtAmount, 7_000e18);
        assertEq(debtToken.balanceOf(borrower), 7_000e18);
    }

    function test_Borrow_RevertsWhenExceedingThreshold() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18); // $10,000 collateral, 80% LTV -> $8,000 max debt

        vm.expectRevert(abi.encodeWithSelector(LendingPool.WouldBeUndercollateralized.selector, borrower));
        vm.prank(borrower);
        pool.borrow(8_001e18);
    }

    function test_Borrow_AtExactThresholdSucceeds() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);

        vm.prank(borrower);
        pool.borrow(8_000e18); // exactly 80% LTV

        (, uint256 debtAmount) = pool.positions(borrower);
        assertEq(debtAmount, 8_000e18);
    }

    function test_Borrow_RevertsOnZeroAmount() public {
        vm.expectRevert(LendingPool.ZeroAmount.selector);
        vm.prank(borrower);
        pool.borrow(0);
    }

    // ─── repay ────────────────────────────────────────────────

    function test_Repay_ReducesDebt() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);
        vm.prank(borrower);
        pool.borrow(5_000e18);

        debtToken.mint(borrower, 2_000e18);
        vm.startPrank(borrower);
        debtToken.approve(address(pool), 2_000e18);
        pool.repay(2_000e18);
        vm.stopPrank();

        (, uint256 debtAmount) = pool.positions(borrower);
        assertEq(debtAmount, 3_000e18);
    }

    function test_Repay_RevertsIfExceedsDebt() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);
        vm.prank(borrower);
        pool.borrow(1_000e18);

        vm.expectRevert(abi.encodeWithSelector(LendingPool.RepayExceedsDebt.selector, borrower, 2_000e18, 1_000e18));
        vm.prank(borrower);
        pool.repay(2_000e18);
    }

    // ─── withdrawCollateral ───────────────────────────────────

    function test_WithdrawCollateral_SucceedsWhenSafe() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);

        vm.prank(borrower);
        pool.withdrawCollateral(3e18);

        (uint256 collateralAmount,) = pool.positions(borrower);
        assertEq(collateralAmount, 7e18);
        assertEq(collateralToken.balanceOf(borrower), 3e18);
    }

    function test_WithdrawCollateral_RevertsIfWouldBecomeUndercollateralized() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);
        vm.prank(borrower);
        pool.borrow(7_000e18); // needs >= 8.75 collateral tokens at 80% LTV

        vm.expectRevert(abi.encodeWithSelector(LendingPool.WouldBeUndercollateralized.selector, borrower));
        vm.prank(borrower);
        pool.withdrawCollateral(2e18); // would leave 8e18, worth $8,000 == exactly the floor is fine, but this leaves under
    }

    function test_WithdrawCollateral_RevertsIfExceedsAvailable() public {
        _depositCollateral(borrower, 5e18);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.InsufficientCollateral.selector, borrower, 6e18, 5e18));
        vm.prank(borrower);
        pool.withdrawCollateral(6e18);
    }

    // ─── liquidate ────────────────────────────────────────────

    function test_Liquidate_RevertsIfNoDebt() public {
        vm.expectRevert(abi.encodeWithSelector(LendingPool.NoDebt.selector, borrower));
        pool.liquidate(borrower);
    }

    function test_Liquidate_RevertsIfNotAttestedEligible() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);
        vm.prank(borrower);
        pool.borrow(7_000e18);

        // Crash the on-chain price so the pool's own view thinks it's
        // undercollateralized — liquidate() must still refuse without the DON's
        // attestation. This is the property the whole design depends on.
        _setPrice(1, block.timestamp + 1);
        assertTrue(pool.isUndercollateralized(borrower));

        vm.expectRevert(abi.encodeWithSelector(LendingPool.PositionNotLiquidatable.selector, borrower));
        pool.liquidate(borrower);
    }

    function test_Liquidate_SucceedsWhenAttestedEligible_CallableByAnyone() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);
        vm.prank(borrower);
        pool.borrow(7_000e18);

        vm.prank(forwarder);
        liquidationConsumer.onReport("", abi.encode(borrower, true, block.timestamp));

        debtToken.mint(liquidator, 7_000e18);
        vm.startPrank(liquidator);
        debtToken.approve(address(pool), 7_000e18);
        pool.liquidate(borrower);
        vm.stopPrank();

        (uint256 collateralAmount, uint256 debtAmount) = pool.positions(borrower);
        assertEq(collateralAmount, 0);
        assertEq(debtAmount, 0);
        assertEq(collateralToken.balanceOf(liquidator), 10e18, "liquidator receives the full seized collateral");
        assertEq(debtToken.balanceOf(liquidator), 0, "liquidator's repayment was spent");
    }

    function test_Liquidate_EmitsLiquidated() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);
        vm.prank(borrower);
        pool.borrow(7_000e18);
        vm.prank(forwarder);
        liquidationConsumer.onReport("", abi.encode(borrower, true, block.timestamp));

        debtToken.mint(liquidator, 7_000e18);
        vm.startPrank(liquidator);
        debtToken.approve(address(pool), 7_000e18);

        vm.expectEmit(true, true, false, true, address(pool));
        emit LendingPool.Liquidated(borrower, liquidator, 10e18, 7_000e18);
        pool.liquidate(borrower);
        vm.stopPrank();
    }
}
