// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPool} from "../../src/lending/LendingPool.sol";
import {LendingOracleConsumer} from "../../src/lending/LendingOracleConsumer.sol";
import {LiquidationConsumer} from "../../src/lending/LiquidationConsumer.sol";
import {WorkflowBoundReceiver} from "../../src/keystone/WorkflowBoundReceiver.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract LendingPoolTest is Test {
    uint256 constant LIQUIDATION_THRESHOLD_BPS = 8000; // 80% LTV
    uint256 constant PRICE = 100_000_000_000; // $1000.00000000 per whole collateral token
    uint8 constant PRICE_DECIMALS = 8;

    address forwarder = makeAddr("forwarder");
    address borrower = makeAddr("borrower");
    address liquidator = makeAddr("liquidator");
    address lender = makeAddr("lender");

    MockERC20 collateralToken;
    MockERC20 debtToken;
    LendingOracleConsumer oracleConsumer;
    LiquidationConsumer liquidationConsumer;
    LendingPool pool;
    bytes32 feedId;

    function setUp() public {
        collateralToken = new MockERC20(18);
        debtToken = new MockERC20(18);
        // Deviation cap / verdict age disabled (0) on the shared consumers so
        // pre-existing tests exercise the uncapped behavior; the caps get
        // their own dedicated tests with freshly constructed consumers below.
        oracleConsumer = new LendingOracleConsumer(forwarder, 0, 0, bytes32(0));
        liquidationConsumer = new LiquidationConsumer(forwarder, 0, bytes32(0), new bytes32[](0));
        feedId = oracleConsumer.feedIdFor("RWA/USD");

        // 0% borrow rate here so every pre-existing test's exact-equality
        // assertions stay correct with no interest math involved — interest
        // accrual gets its own dedicated pool/tests below.
        pool = _newPool(0);

        // Funded via the real depositLiquidity() flow, not a raw mint — this
        // is itself the first real exercise of that path.
        _depositLiquidity(lender, 1_000_000e18);
    }

    function _newPool(uint256 borrowRateBps) internal returns (LendingPool) {
        return _newPoolWithAge(borrowRateBps, 0);
    }

    function _newPoolWithAge(uint256 borrowRateBps, uint256 maxPriceAge) internal returns (LendingPool) {
        return new LendingPool(
            IERC20(address(collateralToken)),
            IERC20(address(debtToken)),
            oracleConsumer,
            liquidationConsumer,
            feedId,
            LIQUIDATION_THRESHOLD_BPS,
            borrowRateBps,
            maxPriceAge
        );
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

    function _depositLiquidity(address who, uint256 amount) internal {
        debtToken.mint(who, amount);
        vm.startPrank(who);
        debtToken.approve(address(pool), amount);
        pool.depositLiquidity(amount);
        vm.stopPrank();
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroCollateralToken() public {
        vm.expectRevert(LendingPool.ZeroAddress.selector);
        new LendingPool(
            IERC20(address(0)),
            IERC20(address(debtToken)),
            oracleConsumer,
            liquidationConsumer,
            feedId,
            LIQUIDATION_THRESHOLD_BPS,
            0,
            0
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
            LIQUIDATION_THRESHOLD_BPS,
            0,
            0
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

    function test_Borrow_RevertsWhenPoolLacksLiquidity() public {
        LendingPool thinPool = _newPool(0);
        _depositLiquidityTo(thinPool, lender, 100e18); // far less than the borrower will need

        _setPrice(PRICE, block.timestamp);
        _depositCollateralTo(thinPool, borrower, 10e18);

        vm.expectRevert(abi.encodeWithSelector(LendingPool.InsufficientLiquidity.selector, 500e18, 100e18));
        vm.prank(borrower);
        thinPool.borrow(500e18);
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

    function test_Repay_ClampsToCurrentDebtAndPullsOnlyThat() public {
        LendingPool ratedPool = _newPool(500); // 5% APR
        _depositLiquidityTo(ratedPool, lender, 1_000_000e18);
        _setPrice(PRICE, block.timestamp);
        _depositCollateralTo(ratedPool, borrower, 10e18);

        vm.prank(borrower);
        ratedPool.borrow(1_000e18);
        skip(30 days);
        _setPrice(PRICE, block.timestamp); // keep the feed fresh so collateral can be withdrawn below

        (, uint256 debtBefore) = ratedPool.positions(borrower);
        assertGt(debtBefore, 1_000e18, "interest accrued");

        debtToken.mint(borrower, 100e18); // cover the interest owed on top of the borrowed 1,000
        uint256 walletBefore = debtToken.balanceOf(borrower);

        vm.startPrank(borrower);
        debtToken.approve(address(ratedPool), type(uint256).max);
        ratedPool.repay(type(uint256).max); // "repay everything"
        vm.stopPrank();

        (, uint256 debtAfter) = ratedPool.positions(borrower);
        assertEq(debtAfter, 0, "fully repaid, no dust");
        // Each tx block advances the clock by nothing here, so the pull equals the debt read just before.
        assertEq(walletBefore - debtToken.balanceOf(borrower), debtBefore, "pulled exactly the debt");
        // totalBorrows compounds on its own rounding, so a few wei of dust can
        // remain versus the position's index-derived debt; it must stay negligible.
        assertLt(ratedPool.totalBorrows(), 1e6, "totalBorrows dust");

        // With no debt left the whole collateral can leave.
        vm.prank(borrower);
        ratedPool.withdrawCollateral(10e18);
        (uint256 collateralAfter,) = ratedPool.positions(borrower);
        assertEq(collateralAfter, 0);
    }

    function test_Repay_RevertsWhenNoDebt() public {
        _depositCollateral(borrower, 10e18);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.NoDebt.selector, borrower));
        vm.prank(borrower);
        pool.repay(1e18);
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
        skip(1); // monotonic updatedAt must increase; reports can't be future-dated
        _setPrice(1, block.timestamp);
        assertTrue(pool.isUndercollateralized(borrower));

        vm.expectRevert(abi.encodeWithSelector(LendingPool.PositionNotLiquidatable.selector, borrower));
        pool.liquidate(borrower);
    }

    function test_Liquidate_SucceedsWhenAttestedEligible_CallableByAnyone() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);
        vm.prank(borrower);
        pool.borrow(7_000e18);

        // Crash the price so the position is undercollateralized in the
        // pool's own view too: liquidate() requires BOTH the fresh DON
        // verdict and an on-chain re-check at execution time.
        skip(1);
        _setPrice(700_000_000_00, block.timestamp); // $700: $7,000e18 value vs 7,000e18 debt

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

        skip(1);
        _setPrice(700_000_000_00, block.timestamp); // undercollateralized in the pool's own view

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

    // ─── depositLiquidity / withdrawLiquidity ──────────────────

    function test_DepositLiquidity_FirstDepositorMintsSharesOneToOne() public {
        LendingPool freshPool = _newPool(0);
        debtToken.mint(lender, 1_000e18);
        vm.startPrank(lender);
        debtToken.approve(address(freshPool), 1_000e18);
        freshPool.depositLiquidity(1_000e18);
        vm.stopPrank();

        assertEq(freshPool.lenderShares(lender), 1_000e18);
        assertEq(freshPool.totalShares(), 1_000e18);
        assertEq(freshPool.totalSupply(), 1_000e18);
    }

    function test_DepositLiquidity_RevertsOnZeroAmount() public {
        vm.expectRevert(LendingPool.ZeroAmount.selector);
        pool.depositLiquidity(0);
    }

    function test_WithdrawLiquidity_ReturnsPrincipalWhenNoInterestAccrued() public {
        uint256 balanceBefore = debtToken.balanceOf(lender);
        uint256 held = pool.lenderShares(lender);
        vm.prank(lender);
        pool.withdrawLiquidity(held);

        assertEq(pool.lenderShares(lender), 0);
        assertEq(pool.totalShares(), 0);
        assertEq(debtToken.balanceOf(lender), balanceBefore + 1_000_000e18);
    }

    function test_WithdrawLiquidity_RevertsIfExceedsHeldShares() public {
        uint256 held = pool.lenderShares(lender);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.InsufficientShares.selector, lender, held + 1, held));
        vm.prank(lender);
        pool.withdrawLiquidity(held + 1);
    }

    function test_WithdrawLiquidity_RevertsIfExceedsIdleLiquidity() public {
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 1300e18); // $1,300,000 worth, comfortably supports the borrow below at 80% LTV
        vm.prank(borrower);
        pool.borrow(999_500e18); // leaves only 500e18 idle out of the 1,000,000e18 supplied

        uint256 held = pool.lenderShares(lender);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.InsufficientLiquidity.selector, 1_000_000e18, 500e18));
        vm.prank(lender);
        pool.withdrawLiquidity(held);
    }

    // ─── interest accrual ──────────────────────────────────────

    function test_Accrual_BorrowerDebtGrowsOverTime() public {
        LendingPool ratedPool = _newPool(500); // 5% APR
        _depositLiquidityTo(ratedPool, lender, 1_000_000e18);
        _setPrice(PRICE, block.timestamp);
        _depositCollateralTo(ratedPool, borrower, 10e18);

        vm.prank(borrower);
        ratedPool.borrow(1_000e18);

        skip(365 days);

        (, uint256 debtAmount) = ratedPool.positions(borrower);
        // 5% of 1,000e18 over exactly one year = 50e18 of accrued interest.
        assertEq(debtAmount, 1_050e18);
    }

    function test_Accrual_LenderBalanceGrowsByTheSameInterest() public {
        LendingPool ratedPool = _newPool(500); // 5% APR
        _depositLiquidityTo(ratedPool, lender, 1_000_000e18);
        _setPrice(PRICE, block.timestamp);
        _depositCollateralTo(ratedPool, borrower, 100e18); // $100,000 worth, 80% LTV -> $80,000 max debt

        vm.prank(borrower);
        ratedPool.borrow(50_000e18);

        skip(365 days);

        // 5% of 50,000e18 over one year = 2,500e18 of interest, all of which
        // (no protocol fee) belongs to the pool's one and only lender.
        assertEq(ratedPool.lenderBalance(lender), 1_002_500e18);
    }

    function test_Accrual_NoInterestWithNothingBorrowed() public {
        LendingPool ratedPool = _newPool(500);
        _depositLiquidityTo(ratedPool, lender, 1_000e18);

        skip(365 days);

        assertEq(ratedPool.lenderBalance(lender), 1_000e18);
    }

    function test_Accrual_RepayingRealizedInterestThenFullyClosesDebt() public {
        LendingPool ratedPool = _newPool(500); // 5% APR
        _depositLiquidityTo(ratedPool, lender, 1_000_000e18);
        _setPrice(PRICE, block.timestamp);
        _depositCollateralTo(ratedPool, borrower, 10e18);

        vm.prank(borrower);
        ratedPool.borrow(1_000e18);
        skip(365 days); // debt is now 1,050e18

        debtToken.mint(borrower, 50e18); // borrower only ever received 1,000e18 — top up for the interest owed
        vm.startPrank(borrower);
        debtToken.approve(address(ratedPool), 1_050e18);
        ratedPool.repay(1_050e18);
        vm.stopPrank();

        (, uint256 debtAmount) = ratedPool.positions(borrower);
        assertEq(debtAmount, 0);
        assertEq(ratedPool.totalBorrows(), 0);
    }

    function test_Accrual_LiquidationRepaysInterestInclusiveDebt() public {
        LendingPool ratedPool = _newPool(500); // 5% APR
        _depositLiquidityTo(ratedPool, lender, 1_000_000e18);
        _setPrice(PRICE, block.timestamp);
        _depositCollateralTo(ratedPool, borrower, 10e18);

        vm.prank(borrower);
        ratedPool.borrow(7_000e18);
        skip(365 days); // debt is now 7_350e18

        // Crash the price so the pool's own view shows the position
        // undercollateralized (7_350e18 debt needs > $9,187.5e18 collateral
        // value at 80% LTV; $900/token gives $9,000e18). The 365-day skip
        // already makes block.timestamp a fresh, monotonic updatedAt.
        _setPrice(900_000_000_00, block.timestamp); // $900

        vm.prank(forwarder);
        liquidationConsumer.onReport("", abi.encode(borrower, true, block.timestamp));

        debtToken.mint(liquidator, 7_350e18);
        vm.startPrank(liquidator);
        debtToken.approve(address(ratedPool), 7_350e18);

        vm.expectEmit(true, true, false, true, address(ratedPool));
        emit LendingPool.Liquidated(borrower, liquidator, 10e18, 7_350e18);
        ratedPool.liquidate(borrower);
        vm.stopPrank();
    }

    // ─── freshness / recency guards (audit HIGH-1, HIGH-2) ─────

    function test_Liquidate_RevertsWhenHealthyDespiteFreshVerdict() public {
        // HIGH-1 regression: a fresh eligible=true verdict must NOT liquidate a
        // position that is healthy in the pool's own on-chain view — the
        // borrower may have topped up after the verdict was written.
        _setPrice(PRICE, block.timestamp);
        _depositCollateral(borrower, 10e18);
        vm.prank(borrower);
        pool.borrow(7_000e18); // 70% LTV — healthy

        vm.prank(forwarder);
        liquidationConsumer.onReport("", abi.encode(borrower, true, block.timestamp));

        vm.expectRevert(abi.encodeWithSelector(LendingPool.PositionNotLiquidatable.selector, borrower));
        pool.liquidate(borrower);
    }

    function test_Liquidate_RevertsWhenVerdictExpired() public {
        LiquidationConsumer agedConsumer = new LiquidationConsumer(forwarder, 1 hours, bytes32(0), new bytes32[](0));
        LendingPool agedPool = _newPoolAgainst(agedConsumer);
        _depositLiquidityTo(agedPool, lender, 1_000_000e18);

        _setPrice(PRICE, block.timestamp);
        _depositCollateralTo(agedPool, borrower, 10e18);
        vm.prank(borrower);
        agedPool.borrow(7_000e18);

        skip(1);
        _setPrice(700_000_000_00, block.timestamp); // undercollateralized on-chain

        vm.prank(forwarder);
        agedConsumer.onReport("", abi.encode(borrower, true, block.timestamp));

        skip(1 hours + 1); // verdict now older than maxVerdictAge

        vm.expectRevert(abi.encodeWithSelector(LendingPool.PositionNotLiquidatable.selector, borrower));
        agedPool.liquidate(borrower);
    }

    function test_Liquidate_SucceedsWithVerdictInsideMaxAge() public {
        LiquidationConsumer agedConsumer = new LiquidationConsumer(forwarder, 1 hours, bytes32(0), new bytes32[](0));
        LendingPool agedPool = _newPoolAgainst(agedConsumer);
        _depositLiquidityTo(agedPool, lender, 1_000_000e18);

        _setPrice(PRICE, block.timestamp);
        _depositCollateralTo(agedPool, borrower, 10e18);
        vm.prank(borrower);
        agedPool.borrow(7_000e18);

        skip(1);
        _setPrice(700_000_000_00, block.timestamp); // undercollateralized on-chain

        vm.prank(forwarder);
        agedConsumer.onReport("", abi.encode(borrower, true, block.timestamp));

        skip(30 minutes); // within maxVerdictAge

        debtToken.mint(liquidator, 7_000e18);
        vm.startPrank(liquidator);
        debtToken.approve(address(agedPool), 7_000e18);
        agedPool.liquidate(borrower);
        vm.stopPrank();

        (uint256 collateralAmount, uint256 debtAmount) = agedPool.positions(borrower);
        assertEq(collateralAmount, 0);
        assertEq(debtAmount, 0);
    }

    function test_OracleConsumer_RevertsOnFutureUpdatedAt() public {
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(
                LendingOracleConsumer.FutureUpdatedAt.selector, feedId, block.timestamp + 1, block.timestamp
            )
        );
        oracleConsumer.onReport("", abi.encode(feedId, PRICE, PRICE_DECIMALS, block.timestamp + 1));
    }

    function test_LiquidationConsumer_RevertsOnFutureCheckedAt() public {
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidationConsumer.FutureCheckedAt.selector, borrower, block.timestamp + 1, block.timestamp
            )
        );
        liquidationConsumer.onReport("", abi.encode(borrower, true, block.timestamp + 1));
    }

    function test_OracleConsumer_RejectsMoveExceedingDeviationCap() public {
        LendingOracleConsumer capped = new LendingOracleConsumer(forwarder, 1000, 15 minutes, bytes32(0)); // 10%

        vm.startPrank(forwarder);
        capped.onReport("", abi.encode(feedId, 1000e8, PRICE_DECIMALS, block.timestamp));

        // +20% in one tick — over the 10% cap, stored value kept.
        skip(1); // monotonic updatedAt must advance; reports can't be future-dated
        vm.expectRevert(
            abi.encodeWithSelector(LendingOracleConsumer.DeviationExceeded.selector, feedId, 1200e8, 1000e8, 1000)
        );
        capped.onReport("", abi.encode(feedId, 1200e8, PRICE_DECIMALS, block.timestamp));

        // Downward moves are bounded too: -20% also rejected.
        skip(1);
        vm.expectRevert(
            abi.encodeWithSelector(LendingOracleConsumer.DeviationExceeded.selector, feedId, 800e8, 1000e8, 1000)
        );
        capped.onReport("", abi.encode(feedId, 800e8, PRICE_DECIMALS, block.timestamp));

        // Exactly -10% (delta * 10_000 == stored * cap) is accepted: the check
        // is strict-greater, so the boundary itself is not a violation.
        skip(1);
        capped.onReport("", abi.encode(feedId, 900e8, PRICE_DECIMALS, block.timestamp));
        (uint256 value,, uint256 updatedAt) = capped.latestRound(feedId);
        assertEq(value, 900e8);
        assertEq(updatedAt, block.timestamp);

        // And a later over-cap move is measured against the NEW stored value.
        skip(1);
        vm.expectRevert(
            abi.encodeWithSelector(LendingOracleConsumer.DeviationExceeded.selector, feedId, 1000e8, 900e8, 1000)
        );
        capped.onReport("", abi.encode(feedId, 1000e8, PRICE_DECIMALS, block.timestamp));
        vm.stopPrank();
    }

    function test_OracleConsumer_DeviationCapSkippedOnceBaselineStale() public {
        LendingOracleConsumer capped = new LendingOracleConsumer(forwarder, 1000, 15 minutes, bytes32(0)); // 10%

        vm.startPrank(forwarder);
        capped.onReport("", abi.encode(feedId, 1000e8, PRICE_DECIMALS, block.timestamp));

        // Baseline still fresh: a -60% move is rejected.
        skip(15 minutes); // exactly at the window — not yet stale
        vm.expectRevert(
            abi.encodeWithSelector(LendingOracleConsumer.DeviationExceeded.selector, feedId, 400e8, 1000e8, 1000)
        );
        capped.onReport("", abi.encode(feedId, 400e8, PRICE_DECIMALS, block.timestamp));

        // Baseline now older than deviationResetAge: the same move re-seeds
        // the feed instead of leaving it frozen forever.
        skip(1);
        capped.onReport("", abi.encode(feedId, 400e8, PRICE_DECIMALS, block.timestamp));
        (uint256 value,, uint256 updatedAt) = capped.latestRound(feedId);
        assertEq(value, 400e8);
        assertEq(updatedAt, block.timestamp);

        // The cap is live again relative to the new baseline.
        skip(1);
        vm.expectRevert(
            abi.encodeWithSelector(LendingOracleConsumer.DeviationExceeded.selector, feedId, 1000e8, 400e8, 1000)
        );
        capped.onReport("", abi.encode(feedId, 1000e8, PRICE_DECIMALS, block.timestamp));
        vm.stopPrank();
    }

    function test_LiquidationConsumer_AcceptsAnyBoundWorkflowButNoOther() public {
        bytes32 closeWatch = keccak256("close-watch");
        bytes32 safeTier = keccak256("safe-tier");
        bytes32[] memory extra = new bytes32[](1);
        extra[0] = safeTier;
        LiquidationConsumer bound = new LiquidationConsumer(forwarder, 0, closeWatch, extra);

        vm.startPrank(forwarder);
        // Metadata layout: workflowId (32) + workflowName (10) + workflowOwner (20).
        bytes memory report = abi.encode(borrower, true, block.timestamp);
        bound.onReport(abi.encodePacked(closeWatch, bytes10(0), address(0)), report);
        assertTrue(bound.isEligible(borrower));

        skip(1);
        bound.onReport(abi.encodePacked(safeTier, bytes10(0), address(0)), abi.encode(borrower, false, block.timestamp));
        assertFalse(bound.isEligible(borrower));

        skip(1);
        bytes32 stranger = keccak256("someone-else");
        vm.expectRevert(abi.encodeWithSelector(WorkflowBoundReceiver.UnexpectedWorkflowId.selector, stranger, closeWatch));
        bound.onReport(abi.encodePacked(stranger, bytes10(0), address(0)), abi.encode(borrower, true, block.timestamp));
        vm.stopPrank();
    }

    function test_LiquidationConsumer_RejectsAdditionalIdsWhenUnbound() public {
        bytes32[] memory extra = new bytes32[](1);
        extra[0] = keccak256("safe-tier");
        vm.expectRevert(WorkflowBoundReceiver.AdditionalWorkflowWhileUnbound.selector);
        new LiquidationConsumer(forwarder, 0, bytes32(0), extra);

        bytes32[] memory zero = new bytes32[](1);
        vm.expectRevert(WorkflowBoundReceiver.ZeroWorkflowId.selector);
        new LiquidationConsumer(forwarder, 0, keccak256("close-watch"), zero);
    }

    function test_Pool_RevertsOnStalePrice() public {
        LendingPool agedPool = _newPoolWithAge(0, 15 minutes);

        _setPrice(PRICE, block.timestamp);
        assertEq(agedPool.collateralValueInDebtUnits(10e18), 10_000e18);

        skip(16 minutes); // last report now older than maxPriceAge

        vm.expectRevert(abi.encodeWithSelector(LendingPool.StalePrice.selector, feedId));
        agedPool.collateralValueInDebtUnits(10e18);
    }

    function _newPoolAgainst(LiquidationConsumer consumer) internal returns (LendingPool) {
        return new LendingPool(
            IERC20(address(collateralToken)),
            IERC20(address(debtToken)),
            oracleConsumer,
            consumer,
            feedId,
            LIQUIDATION_THRESHOLD_BPS,
            0,
            0
        );
    }

    // ─── helpers for tests against a pool other than the default `pool` ──

    function _depositLiquidityTo(LendingPool target, address who, uint256 amount) internal {
        debtToken.mint(who, amount);
        vm.startPrank(who);
        debtToken.approve(address(target), amount);
        target.depositLiquidity(amount);
        vm.stopPrank();
    }

    function _depositCollateralTo(LendingPool target, address who, uint256 amount) internal {
        collateralToken.mint(who, amount);
        vm.startPrank(who);
        collateralToken.approve(address(target), amount);
        target.depositCollateral(amount);
        vm.stopPrank();
    }
}
