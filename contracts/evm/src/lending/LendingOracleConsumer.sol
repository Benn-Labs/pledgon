// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {WorkflowBoundReceiver} from "../keystone/WorkflowBoundReceiver.sol";

/// @title LendingOracleConsumer
/// @notice Receives collateral price reports from lending's own CRE oracle
/// workflow — a separate deployment from escrow's RwaOracleConsumer (see
/// docs/architecture.md: reusing escrow's oracle was considered and rejected).
/// Same feedId-keyed round-store shape, so the producing workflow can be tuned
/// independently for collateral volatility: its own cadence, its own staleness
/// and deviation checks.
///
/// Report layout: abi.encode(bytes32 feedId, uint256 value, uint8 decimals, uint256 updatedAt)
/// `value` is USD price per one whole collateral token, scaled by `decimals`.
contract LendingOracleConsumer is WorkflowBoundReceiver {
    struct Round {
        uint256 value;
        uint8 decimals;
        uint256 updatedAt;
    }

    /// @notice Sanity bound on a single-tick price move, in basis points
    /// relative to the currently stored value. A report whose value deviates
    /// further is rejected and the stored round is kept. 0 disables the cap.
    /// This is garbage-input protection (a buggy workflow or a glitching API
    /// returning 0 or 10x the real price), NOT a crash circuit-breaker: during
    /// a sustained real-world crash a hard cap would keep rejecting updates
    /// and freeze the feed at the pre-crash price — exactly when it matters
    /// most — so keep this loose and let `LendingPool.maxPriceAge` handle
    /// freshness (fail closed) instead.
    uint256 public immutable maxDeviationBps;

    /// @notice Once the stored round is older than this many seconds, the
    /// deviation cap is skipped and the next (future-guarded, monotonic)
    /// report is accepted as a fresh baseline. Without this, a real move
    /// beyond the cap would be rejected forever — every later report is
    /// measured against the same frozen value — leaving the feed stuck until
    /// the pool's maxPriceAge fails borrow/withdraw/liquidate closed with no
    /// way to recover. Set equal to (or just below) LendingPool.maxPriceAge so
    /// the feed can re-seed exactly when the pool has stopped trusting it.
    /// 0 = never skip (cap always applies).
    uint256 public immutable deviationResetAge;

    mapping(bytes32 => Round) private _rounds;

    event PriceUpdated(bytes32 indexed feedId, uint256 value, uint8 decimals, uint256 updatedAt);

    error StaleReport(bytes32 feedId, uint256 incomingUpdatedAt, uint256 storedUpdatedAt);
    error FutureUpdatedAt(bytes32 feedId, uint256 updatedAt, uint256 blockTimestamp);
    error DeviationExceeded(bytes32 feedId, uint256 value, uint256 storedValue, uint256 maxDeviationBps);

    constructor(address _forwarder, uint256 _maxDeviationBps, uint256 _deviationResetAge, bytes32 _expectedWorkflowId)
        WorkflowBoundReceiver(_forwarder, _expectedWorkflowId)
    {
        maxDeviationBps = _maxDeviationBps;
        deviationResetAge = _deviationResetAge;
    }

    function onReport(bytes calldata metadata, bytes calldata report) external onlyForwarder {
        _checkWorkflow(metadata);
        (bytes32 feedId, uint256 value, uint8 decimals, uint256 updatedAt) =
            abi.decode(report, (bytes32, uint256, uint8, uint256));

        // Mirror ComplianceConsumer's FutureVerifiedAt guard: a future
        // timestamp would make every subsequent genuine report revert
        // StaleReport until real time catches up — a single buggy report
        // bricks the feed channel.
        if (updatedAt > block.timestamp) {
            revert FutureUpdatedAt(feedId, updatedAt, block.timestamp);
        }

        Round storage current = _rounds[feedId];
        if (updatedAt <= current.updatedAt) {
            revert StaleReport(feedId, updatedAt, current.updatedAt);
        }

        bool baselineStale = deviationResetAge != 0 && block.timestamp - current.updatedAt > deviationResetAge;
        if (maxDeviationBps > 0 && current.updatedAt != 0 && !baselineStale) {
            // Bound applies in both directions: |value - stored| * BPS_DENOMINATOR
            // > stored * maxDeviationBps. Over/underflow-safe: value >= stored
            // handled by subtraction order; stored * maxDeviationBps can't
            // overflow (stored < 2^256 / 10^4 for any realistic price).
            uint256 storedValue = current.value;
            uint256 delta = value > storedValue ? value - storedValue : storedValue - value;
            if (delta * 10_000 > storedValue * maxDeviationBps) {
                revert DeviationExceeded(feedId, value, storedValue, maxDeviationBps);
            }
        }

        _rounds[feedId] = Round({value: value, decimals: decimals, updatedAt: updatedAt});
        emit PriceUpdated(feedId, value, decimals, updatedAt);
    }

    /// @notice Latest stored round for a feed. `updatedAt == 0` means no data yet.
    function latestRound(bytes32 feedId) external view returns (uint256 value, uint8 decimals, uint256 updatedAt) {
        Round memory r = _rounds[feedId];
        return (r.value, r.decimals, r.updatedAt);
    }

    function feedIdFor(string calldata label) external pure returns (bytes32) {
        return keccak256(bytes(label));
    }
}
