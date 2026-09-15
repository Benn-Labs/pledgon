// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {LendingOracleConsumer} from "./LendingOracleConsumer.sol";
import {LiquidationConsumer} from "./LiquidationConsumer.sol";

/// @title LendingPool
/// @notice Single-market collateral/debt pool (one collateralToken, one
/// debtToken, fixed at deploy time) — a minimal substrate for the
/// liquidation-protection workflow, not a production money market. No interest
/// accrual, no lender shares or utilization curve, no multi-asset markets; debt
/// liquidity is assumed pre-funded into the pool by whatever mechanism the real
/// lending product ends up using.
///
/// `collateralValueInDebtUnits` assumes `collateralToken` and `debtToken` share
/// the same `decimals()` — under that assumption a raw price-scaled
/// multiply/divide gives a correct debtToken-unit value with no further
/// token-decimal conversion. A market pairing tokens of different decimals needs
/// that conversion added before this pool is correct for it.
contract LendingPool {
    struct Position {
        uint256 collateralAmount;
        uint256 debtAmount;
    }

    uint256 public constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable collateralToken;
    IERC20 public immutable debtToken;
    LendingOracleConsumer public immutable oracleConsumer;
    LiquidationConsumer public immutable liquidationConsumer;
    bytes32 public immutable collateralFeedId;
    uint256 public immutable liquidationThresholdBps; // e.g. 8000 = 80% LTV

    mapping(address => Position) public positions;

    event CollateralDeposited(address indexed borrower, uint256 amount);
    event CollateralWithdrawn(address indexed borrower, uint256 amount);
    event Borrowed(address indexed borrower, uint256 amount);
    event Repaid(address indexed borrower, uint256 amount);
    event Liquidated(address indexed borrower, address indexed liquidator, uint256 collateralSeized, uint256 debtRepaid);

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientCollateral(address borrower, uint256 requested, uint256 available);
    error RepayExceedsDebt(address borrower, uint256 requested, uint256 owed);
    error PositionNotLiquidatable(address borrower);
    error WouldBeUndercollateralized(address borrower);
    error NoDebt(address borrower);
    error StalePrice(bytes32 feedId);
    error TransferFailed();

    constructor(
        IERC20 _collateralToken,
        IERC20 _debtToken,
        LendingOracleConsumer _oracleConsumer,
        LiquidationConsumer _liquidationConsumer,
        bytes32 _collateralFeedId,
        uint256 _liquidationThresholdBps
    ) {
        if (
            address(_collateralToken) == address(0) || address(_debtToken) == address(0)
                || address(_oracleConsumer) == address(0) || address(_liquidationConsumer) == address(0)
        ) revert ZeroAddress();

        collateralToken = _collateralToken;
        debtToken = _debtToken;
        oracleConsumer = _oracleConsumer;
        liquidationConsumer = _liquidationConsumer;
        collateralFeedId = _collateralFeedId;
        liquidationThresholdBps = _liquidationThresholdBps;
    }

    function depositCollateral(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        positions[msg.sender].collateralAmount += amount;
        _safeTransferFrom(collateralToken, msg.sender, address(this), amount);
        emit CollateralDeposited(msg.sender, amount);
    }

    function borrow(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Position storage position = positions[msg.sender];
        position.debtAmount += amount;
        if (_isUndercollateralized(position)) revert WouldBeUndercollateralized(msg.sender);
        _safeTransfer(debtToken, msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Position storage position = positions[msg.sender];
        if (amount > position.debtAmount) revert RepayExceedsDebt(msg.sender, amount, position.debtAmount);
        position.debtAmount -= amount;
        _safeTransferFrom(debtToken, msg.sender, address(this), amount);
        emit Repaid(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Position storage position = positions[msg.sender];
        if (amount > position.collateralAmount) {
            revert InsufficientCollateral(msg.sender, amount, position.collateralAmount);
        }
        position.collateralAmount -= amount;
        if (_isUndercollateralized(position)) revert WouldBeUndercollateralized(msg.sender);
        _safeTransfer(collateralToken, msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    /// @notice Permissionless: anyone may liquidate once the DON has attested
    /// eligibility. Safe because the real check is `liquidationConsumer
    /// .isEligible`, not the caller's identity — this pool's own
    /// `isUndercollateralized` view is deliberately not sufficient on its own to
    /// liquidate (see that function's notes).
    ///
    /// Full liquidation only: the liquidator repays the entire debt and receives
    /// the entire collateral — no partial liquidation, no separately-configured
    /// bonus percentage. The liquidator's profit is whatever gap exists between
    /// collateral value and debt value at the liquidation threshold.
    function liquidate(address borrower) external {
        Position storage position = positions[borrower];
        if (position.debtAmount == 0) revert NoDebt(borrower);
        if (!liquidationConsumer.isEligible(borrower)) revert PositionNotLiquidatable(borrower);

        uint256 debtAmount = position.debtAmount;
        uint256 collateralAmount = position.collateralAmount;
        position.debtAmount = 0;
        position.collateralAmount = 0;

        _safeTransferFrom(debtToken, msg.sender, address(this), debtAmount);
        _safeTransfer(collateralToken, msg.sender, collateralAmount);

        emit Liquidated(borrower, msg.sender, collateralAmount, debtAmount);
    }

    /// @notice On-chain view using this pool's own oracle reading only — the
    /// first line of defense for borrow/withdraw checks. `liquidate()`
    /// additionally requires the DON's independently-corroborated verdict from
    /// `liquidationConsumer`; a single on-chain feed reading alone is not enough
    /// to seize collateral.
    function isUndercollateralized(address borrower) external view returns (bool) {
        return _isUndercollateralized(positions[borrower]);
    }

    /// @notice Value of `collateralAmount` in debtToken units, using the last
    /// price LendingOracleConsumer received. Reverts if no price has ever been
    /// reported — deliberately fails closed rather than pricing collateral at
    /// zero. Does not itself check staleness beyond "has ever reported"; callers
    /// needing a max-age guarantee must check `oracleConsumer.latestRound`'s
    /// `updatedAt` themselves.
    function collateralValueInDebtUnits(uint256 collateralAmount) public view returns (uint256) {
        (uint256 price, uint8 priceDecimals, uint256 updatedAt) = oracleConsumer.latestRound(collateralFeedId);
        if (updatedAt == 0) revert StalePrice(collateralFeedId);
        return (collateralAmount * price) / (10 ** priceDecimals);
    }

    function _isUndercollateralized(Position memory position) private view returns (bool) {
        if (position.debtAmount == 0) return false;
        uint256 collateralValue = collateralValueInDebtUnits(position.collateralAmount);
        return collateralValue * liquidationThresholdBps < position.debtAmount * BPS_DENOMINATOR;
    }

    function _safeTransfer(IERC20 token, address to, uint256 amount) private {
        if (!token.transfer(to, amount)) revert TransferFailed();
    }

    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) private {
        if (!token.transferFrom(from, to, amount)) revert TransferFailed();
    }
}
