// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {LendingOracleConsumer} from "./LendingOracleConsumer.sol";
import {LiquidationConsumer} from "./LiquidationConsumer.sol";

/// @title LendingPool
/// @notice Single-market collateral/debt pool (one collateralToken, one
/// debtToken, fixed at deploy time) — a minimal substrate for the
/// liquidation-protection workflow, not a production money market. No
/// multi-asset markets, no utilization curve — a single fixed interest rate
/// (`borrowRateBps`) accrues on all outstanding debt and is passed through
/// 100% to lenders, proportional to their share of the pool. No protocol fee,
/// no owner/admin concept, matching this codebase's existing pattern
/// (ComplianceConsumer/EscrowFactory don't have one either — see
/// docs/architecture.md's compliance-hardening section for why that was a
/// deliberate choice, not an oversight).
///
/// Interest accounting follows the same shape Compound V2's cTokens use
/// (a single growing index, not a loop over positions): `borrowIndex` grows
/// every time any state-changing function runs, and each position stores its
/// own debt as of the last time *it* was touched plus the index value at that
/// moment — so a position's current debt (principal + accrued interest) is
/// always `principalDebt * borrowIndex / borrowIndexSnapshot`, computed
/// lazily, never by iterating every position. `positions(address)` — the
/// external view every existing consumer (the liquidation-protection
/// workflow's raw calldata reads, cmd/discover-borrowers, the frontend)
/// already calls — keeps the exact same `(collateralAmount, debtAmount)`
/// shape it always has; `debtAmount` now simply comes back correctly
/// interest-inclusive, with no changes needed anywhere else.
///
/// Lender accounting needs no separate `totalSupply` variable: since
/// `debtToken` sitting idle in the pool plus everything currently lent out
/// (`totalBorrows`) is by definition everything lenders are collectively
/// owed, `totalSupply()` is just `debtToken.balanceOf(this) + totalBorrows`,
/// always consistent with the pool's real balance without separate
/// bookkeeping to keep in sync.
///
/// A known, accepted quirk carried over from this codebase's own earlier
/// testnet funding approach (raw `mint()` directly to the pool address,
/// bypassing `depositLiquidity`): any debtToken balance that lands in this
/// contract without going through `depositLiquidity` inflates `totalSupply()`
/// — and therefore the exchange rate every existing lender's shares are worth
/// — without minting shares for whoever sent it. Harmless (it can only ever
/// add value, never let anyone claim more than they're owed), not defended
/// against, consistent with this pool's "minimal substrate" scope.
///
/// `collateralValueInDebtUnits` assumes `collateralToken` and `debtToken` share
/// the same `decimals()` — under that assumption a raw price-scaled
/// multiply/divide gives a correct debtToken-unit value with no further
/// token-decimal conversion. A market pairing tokens of different decimals needs
/// that conversion added before this pool is correct for it.
contract LendingPool {
    struct Position {
        uint256 collateralAmount;
        uint256 principalDebt; // this position's debt as of borrowIndexSnapshot, not necessarily current
        uint256 borrowIndexSnapshot; // borrowIndex at the last time this position was touched
    }

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant INDEX_SCALE = 1e18;

    IERC20 public immutable collateralToken;
    IERC20 public immutable debtToken;
    LendingOracleConsumer public immutable oracleConsumer;
    LiquidationConsumer public immutable liquidationConsumer;
    bytes32 public immutable collateralFeedId;
    uint256 public immutable liquidationThresholdBps; // e.g. 8000 = 80% LTV
    uint256 public immutable borrowRateBps; // fixed simple APR charged on all debt, e.g. 500 = 5%/year
    /// @notice Maximum age of the on-chain oracle price before reads fail
    /// closed: borrow(), withdrawCollateral() and liquidate() revert
    /// StalePrice rather than act on a frozen feed (e.g. the oracle workflow
    /// halted). Should be comfortably larger than the producing workflow's
    /// cron interval. 0 disables the freshness check (relies on
    /// `updatedAt != 0` only), matching this contract's other 0-means-off
    /// parameters.
    uint256 public immutable maxPriceAge;

    mapping(address => Position) private _positions;
    mapping(address => uint256) public lenderShares;
    uint256 public totalShares;
    uint256 public totalBorrows;
    uint256 public borrowIndex = INDEX_SCALE; // starts at 1.0, grows monotonically
    uint256 public lastAccrualTimestamp;

    event CollateralDeposited(address indexed borrower, uint256 amount);
    event CollateralWithdrawn(address indexed borrower, uint256 amount);
    event Borrowed(address indexed borrower, uint256 amount);
    event Repaid(address indexed borrower, uint256 amount);
    event Liquidated(address indexed borrower, address indexed liquidator, uint256 collateralSeized, uint256 debtRepaid);
    event LiquidityDeposited(address indexed lender, uint256 amount, uint256 shares);
    event LiquidityWithdrawn(address indexed lender, uint256 shares, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientCollateral(address borrower, uint256 requested, uint256 available);
    error RepayExceedsDebt(address borrower, uint256 requested, uint256 owed);
    error PositionNotLiquidatable(address borrower);
    error WouldBeUndercollateralized(address borrower);
    error NoDebt(address borrower);
    error StalePrice(bytes32 feedId);
    error TransferFailed();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error InsufficientShares(address lender, uint256 requested, uint256 available);
    error ZeroShares();

    constructor(
        IERC20 _collateralToken,
        IERC20 _debtToken,
        LendingOracleConsumer _oracleConsumer,
        LiquidationConsumer _liquidationConsumer,
        bytes32 _collateralFeedId,
        uint256 _liquidationThresholdBps,
        uint256 _borrowRateBps,
        uint256 _maxPriceAge
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
        borrowRateBps = _borrowRateBps;
        maxPriceAge = _maxPriceAge;
        lastAccrualTimestamp = block.timestamp;
    }

    // ─── Borrower actions ──────────────────────────────────

    function depositCollateral(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        _positions[msg.sender].collateralAmount += amount;
        _safeTransferFrom(collateralToken, msg.sender, address(this), amount);
        emit CollateralDeposited(msg.sender, amount);
    }

    function borrow(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        Position storage position = _positions[msg.sender];
        uint256 newDebt = _realizeDebt(position) + amount;
        position.principalDebt = newDebt;
        totalBorrows += amount;
        if (_isUndercollateralizedAmounts(position.collateralAmount, newDebt)) revert WouldBeUndercollateralized(msg.sender);
        uint256 available = debtToken.balanceOf(address(this));
        if (amount > available) revert InsufficientLiquidity(amount, available);
        _safeTransfer(debtToken, msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        Position storage position = _positions[msg.sender];
        uint256 currentDebt = _realizeDebt(position);
        if (amount > currentDebt) revert RepayExceedsDebt(msg.sender, amount, currentDebt);
        position.principalDebt = currentDebt - amount;
        totalBorrows -= amount;
        _safeTransferFrom(debtToken, msg.sender, address(this), amount);
        emit Repaid(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        Position storage position = _positions[msg.sender];
        uint256 currentDebt = _realizeDebt(position);
        if (amount > position.collateralAmount) {
            revert InsufficientCollateral(msg.sender, amount, position.collateralAmount);
        }
        position.collateralAmount -= amount;
        if (_isUndercollateralizedAmounts(position.collateralAmount, currentDebt)) revert WouldBeUndercollateralized(msg.sender);
        _safeTransfer(collateralToken, msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    /// @notice Permissionless: anyone may liquidate once the DON has attested
    /// eligibility. Safe because the real checks are `liquidationConsumer
    /// .isEligible` (a fresh, independently-corroborated verdict — see that
    /// contract's maxVerdictAge) plus an on-chain re-check that the position
    /// is still undercollateralized at execution time, not the caller's
    /// identity. Either check alone is deliberately not sufficient
    /// (see isUndercollateralized's notes).
    ///
    /// Full liquidation only: the liquidator repays the entire current debt
    /// (principal plus whatever interest has accrued) and receives the entire
    /// collateral — no partial liquidation, no separately-configured bonus
    /// percentage. The liquidator's profit is whatever gap exists between
    /// collateral value and debt value at the liquidation threshold.
    function liquidate(address borrower) external {
        _accrue();
        Position storage position = _positions[borrower];
        uint256 currentDebt = _realizeDebt(position);
        if (currentDebt == 0) revert NoDebt(borrower);
        if (!liquidationConsumer.isEligible(borrower)) revert PositionNotLiquidatable(borrower);
        // Belt-and-suspenders alongside the DON verdict: the verdict is only
        // actionable within LiquidationConsumer.maxVerdictAge of checkedAt,
        // but prices can move inside even that window. Re-verify the position
        // is actually undercollateralized at execution time — collateral that
        // was topped up after the verdict was written must not be seizable.
        if (!_isUndercollateralizedAmounts(position.collateralAmount, currentDebt)) {
            revert PositionNotLiquidatable(borrower);
        }

        uint256 collateralAmount = position.collateralAmount;
        position.principalDebt = 0;
        position.collateralAmount = 0;
        totalBorrows -= currentDebt;

        _safeTransferFrom(debtToken, msg.sender, address(this), currentDebt);
        _safeTransfer(collateralToken, msg.sender, collateralAmount);

        emit Liquidated(borrower, msg.sender, collateralAmount, currentDebt);
    }

    // ─── Lender actions ────────────────────────────────────

    /// @notice Supplies debtToken liquidity for borrowers to draw on, earning
    /// a pro-rata share of the interest borrowers pay. Shares are minted
    /// 1:1 with `amount` for the very first depositor (when the pool is
    /// otherwise empty); every deposit after that mints proportional to the
    /// current exchange rate, so existing lenders' share of a (possibly
    /// interest-grown) pool is never diluted unfairly.
    function depositLiquidity(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        uint256 supply = totalSupply();
        uint256 shares = totalShares == 0 ? amount : (amount * totalShares) / supply;
        if (shares == 0) revert ZeroShares();
        lenderShares[msg.sender] += shares;
        totalShares += shares;
        _safeTransferFrom(debtToken, msg.sender, address(this), amount);
        emit LiquidityDeposited(msg.sender, amount, shares);
    }

    /// @notice Redeems shares for their current underlying value (principal
    /// plus accrued interest). Limited by idle liquidity actually sitting in
    /// the pool — shares backed by debt currently lent out to borrowers can't
    /// be withdrawn until enough of that debt is repaid.
    function withdrawLiquidity(uint256 shares) external {
        if (shares == 0) revert ZeroAmount();
        _accrue();
        uint256 held = lenderShares[msg.sender];
        if (shares > held) revert InsufficientShares(msg.sender, shares, held);
        uint256 amount = (shares * totalSupply()) / totalShares;
        uint256 available = debtToken.balanceOf(address(this));
        if (amount > available) revert InsufficientLiquidity(amount, available);
        lenderShares[msg.sender] = held - shares;
        totalShares -= shares;
        _safeTransfer(debtToken, msg.sender, amount);
        emit LiquidityWithdrawn(msg.sender, shares, amount);
    }

    /// @notice Total value owed to lenders collectively: idle debtToken sitting
    /// in the pool plus everything currently lent out. Always consistent with
    /// the pool's real balance — see the contract-level doc comment.
    function totalSupply() public view returns (uint256) {
        return debtToken.balanceOf(address(this)) + _currentTotalBorrows();
    }

    /// @notice A lender's current claim (principal plus accrued interest),
    /// in debtToken units — not necessarily withdrawable in full right now if
    /// idle liquidity is short.
    function lenderBalance(address lender) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (lenderShares[lender] * totalSupply()) / totalShares;
    }

    // ─── Views ─────────────────────────────────────────────

    /// @notice A borrower's collateral and current debt (principal plus
    /// accrued interest as of right now). Same external shape this function
    /// has always had — every existing caller keeps working unchanged.
    function positions(address borrower) external view returns (uint256 collateralAmount, uint256 debtAmount) {
        Position memory position = _positions[borrower];
        collateralAmount = position.collateralAmount;
        debtAmount = _currentDebtView(position);
    }

    /// @notice On-chain view using this pool's own oracle reading only — the
    /// first line of defense for borrow/withdraw checks. `liquidate()`
    /// additionally requires the DON's independently-corroborated verdict from
    /// `liquidationConsumer`; a single on-chain feed reading alone is not enough
    /// to seize collateral.
    function isUndercollateralized(address borrower) external view returns (bool) {
        Position memory position = _positions[borrower];
        return _isUndercollateralizedAmounts(position.collateralAmount, _currentDebtView(position));
    }

    /// @notice Value of `collateralAmount` in debtToken units, using the last
    /// price LendingOracleConsumer received. Fails closed rather than pricing
    /// collateral on nothing: reverts StalePrice if no price has ever been
    /// reported, and again once the last report is older than `maxPriceAge`
    /// (0 disables the age check — "has ever reported" only).
    function collateralValueInDebtUnits(uint256 collateralAmount) public view returns (uint256) {
        (uint256 price, uint8 priceDecimals, uint256 updatedAt) = oracleConsumer.latestRound(collateralFeedId);
        if (updatedAt == 0) revert StalePrice(collateralFeedId);
        if (maxPriceAge != 0 && block.timestamp - updatedAt > maxPriceAge) revert StalePrice(collateralFeedId);
        return (collateralAmount * price) / (10 ** priceDecimals);
    }

    // ─── Interest accrual ──────────────────────────────────

    /// @notice Advances `borrowIndex`/`totalBorrows` to the current block,
    /// applying `borrowRateBps` (simple interest) to whatever was outstanding
    /// since the last call. Called at the top of every state-changing
    /// function so nothing ever reads or writes a stale index. A no-op when
    /// nothing is currently borrowed, or when called again within the same
    /// block.
    function _accrue() private {
        if (block.timestamp == lastAccrualTimestamp) return;
        if (totalBorrows > 0) {
            uint256 interest = _interestSince(lastAccrualTimestamp);
            if (interest > 0) {
                uint256 newTotalBorrows = totalBorrows + interest;
                borrowIndex = (borrowIndex * newTotalBorrows) / totalBorrows;
                totalBorrows = newTotalBorrows;
            }
        }
        lastAccrualTimestamp = block.timestamp;
    }

    function _interestSince(uint256 fromTimestamp) private view returns (uint256) {
        uint256 dt = block.timestamp - fromTimestamp;
        return (totalBorrows * borrowRateBps * dt) / (SECONDS_PER_YEAR * BPS_DENOMINATOR);
    }

    /// @notice `borrowIndex` as of right now, without mutating state — for
    /// view functions (`positions`, `isUndercollateralized`) called between
    /// accruals, so a read between two transactions still reflects interest
    /// that's accrued but not yet realized into storage.
    function _currentBorrowIndex() private view returns (uint256) {
        if (totalBorrows == 0 || block.timestamp == lastAccrualTimestamp) return borrowIndex;
        uint256 interest = _interestSince(lastAccrualTimestamp);
        if (interest == 0) return borrowIndex;
        uint256 newTotalBorrows = totalBorrows + interest;
        return (borrowIndex * newTotalBorrows) / totalBorrows;
    }

    function _currentTotalBorrows() private view returns (uint256) {
        if (totalBorrows == 0) return 0;
        return totalBorrows + _interestSince(lastAccrualTimestamp);
    }

    function _currentDebtView(Position memory position) private view returns (uint256) {
        if (position.principalDebt == 0) return 0;
        return (position.principalDebt * _currentBorrowIndex()) / position.borrowIndexSnapshot;
    }

    /// @notice Realizes a position's current debt into storage (principal
    /// plus interest accrued since it was last touched) and refreshes its
    /// index snapshot to the current (already-accrued, via `_accrue`)
    /// `borrowIndex` — call after `_accrue()`, before applying any borrow/
    /// repay/liquidate delta. Always leaves `borrowIndexSnapshot` fresh, even
    /// for a position with zero debt, so a later borrow starts from a valid
    /// snapshot rather than a stale or uninitialized one.
    function _realizeDebt(Position storage position) private returns (uint256 currentDebt) {
        if (position.principalDebt == 0) {
            position.borrowIndexSnapshot = borrowIndex;
            return 0;
        }
        currentDebt = (position.principalDebt * borrowIndex) / position.borrowIndexSnapshot;
        position.principalDebt = currentDebt;
        position.borrowIndexSnapshot = borrowIndex;
    }

    function _isUndercollateralizedAmounts(uint256 collateralAmount, uint256 debtAmount) private view returns (bool) {
        if (debtAmount == 0) return false;
        uint256 collateralValue = collateralValueInDebtUnits(collateralAmount);
        return collateralValue * liquidationThresholdBps < debtAmount * BPS_DENOMINATOR;
    }

    function _safeTransfer(IERC20 token, address to, uint256 amount) private {
        if (!token.transfer(to, amount)) revert TransferFailed();
    }

    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) private {
        if (!token.transferFrom(from, to, amount)) revert TransferFailed();
    }
}
