// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {WorkflowBoundReceiver} from "../keystone/WorkflowBoundReceiver.sol";

/// @title RebalancingConsumer
/// @notice Receives DON-signed portfolio-rebalancing verdicts from the
/// portfolio-rebalancing confidential workflow, keyed by borrower. Where
/// LiquidationConsumer gates the last-resort seizure of an already
/// underwater position, this contract is the proactive half of
/// lending/borrowing protection: it records when a borrower's LTV has drifted
/// into the rebalance band — above the target LTV but still below the
/// liquidation threshold — so a keeper, executor or frontend integration can
/// top up collateral or repay debt BEFORE the position becomes
/// liquidatable. An advised verdict moves no funds by itself; it is an
/// attestation that rebalancing is warranted, nothing more.
///
/// Verdicts expire exactly like LiquidationConsumer's: acting on a stale
/// point-in-time attestation could trigger a rebalance the position no
/// longer needs, and each report's `checkedAt` must be newer than the last
/// so a corrective verdict can always overwrite an earlier one.
///
/// Report layout: abi.encode(address borrower, bool advised, uint256 checkedAt)
contract RebalancingConsumer is WorkflowBoundReceiver {
    struct Verdict {
        bool advised;
        uint256 checkedAt;
    }

    /// @notice How long a rebalance verdict stays actionable, in seconds.
    /// An `advised` verdict older than this reads back false — the position
    /// may have been rebalanced or liquidated since. 0 disables the expiry.
    uint256 public immutable maxVerdictAge;

    mapping(address => Verdict) private _verdicts;

    event VerdictUpdated(address indexed borrower, bool advised, uint256 checkedAt);

    error StaleReport(address borrower, uint256 incomingCheckedAt, uint256 storedCheckedAt);
    error FutureCheckedAt(address borrower, uint256 checkedAt, uint256 blockTimestamp);

    constructor(address _forwarder, uint256 _maxVerdictAge, bytes32 _expectedWorkflowId)
        WorkflowBoundReceiver(_forwarder, _expectedWorkflowId)
    {
        maxVerdictAge = _maxVerdictAge;
    }

    function onReport(bytes calldata metadata, bytes calldata report) external onlyForwarder {
        _checkWorkflow(metadata);
        (address borrower, bool advised, uint256 checkedAt_) = abi.decode(report, (address, bool, uint256));

        // Mirror LiquidationConsumer's guards: a future checkedAt would pin
        // this borrower at the incoming verdict while every corrective report
        // reverts StaleReport until real time catches up.
        if (checkedAt_ > block.timestamp) {
            revert FutureCheckedAt(borrower, checkedAt_, block.timestamp);
        }

        Verdict storage current = _verdicts[borrower];
        if (checkedAt_ <= current.checkedAt) {
            revert StaleReport(borrower, checkedAt_, current.checkedAt);
        }

        _verdicts[borrower] = Verdict({advised: advised, checkedAt: checkedAt_});
        emit VerdictUpdated(borrower, advised, checkedAt_);
    }

    /// @notice Whether the DON has attested that this borrower's portfolio
    /// should be rebalanced AND that attestation is still within
    /// `maxVerdictAge` of `checkedAt`. A stale or never-written verdict reads
    /// back false — fail closed.
    function isAdvised(address borrower) external view returns (bool) {
        Verdict memory v = _verdicts[borrower];
        if (!v.advised) return false;
        if (maxVerdictAge == 0) return true;
        return block.timestamp - v.checkedAt <= maxVerdictAge;
    }

    function checkedAt(address borrower) external view returns (uint256) {
        return _verdicts[borrower].checkedAt;
    }
}
