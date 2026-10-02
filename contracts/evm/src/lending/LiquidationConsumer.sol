// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {WorkflowBoundReceiver} from "../keystone/WorkflowBoundReceiver.sol";

/// @title LiquidationConsumer
/// @notice Receives DON-signed liquidation-eligibility verdicts from the
/// liquidation-protection confidential workflow, keyed by borrower. The
/// workflow corroborates LendingPool's own on-chain price against an
/// independent, confidentially-fetched price before attesting eligibility —
/// this is the check that protects against a single manipulated or stale
/// on-chain feed triggering a wrongful liquidation.
///
/// Unlike EscrowConfirmationConsumer's one-way confirmation, eligibility is not
/// monotonic: a borrower can add collateral and become safe again, so — like
/// ComplianceConsumer — each report's `checkedAt` must be newer than the last to
/// be accepted, and the current stored value (true or false) is what counts.
///
/// Report layout: abi.encode(address borrower, bool eligible, uint256 checkedAt)
contract LiquidationConsumer is WorkflowBoundReceiver {
    struct Verdict {
        bool eligible;
        uint256 checkedAt;
    }

    /// @notice How long an eligibility verdict stays actionable, in seconds.
    /// A `true` verdict older than this reads back ineligible — a verdict is a
    /// point-in-time attestation, and acting on it indefinitely (e.g. after
    /// the borrower has since topped up collateral) would let a liquidator
    /// seize a currently-healthy position. 0 disables the expiry.
    uint256 public immutable maxVerdictAge;

    mapping(address => Verdict) private _verdicts;

    event VerdictUpdated(address indexed borrower, bool eligible, uint256 checkedAt);

    error StaleReport(address borrower, uint256 incomingCheckedAt, uint256 storedCheckedAt);
    error FutureCheckedAt(address borrower, uint256 checkedAt, uint256 blockTimestamp);

    /// @param _additionalWorkflowIds Other workflows allowed to write verdicts
    /// besides `_expectedWorkflowId` — the liquidation workflow runs as two
    /// deployments (close-watch and slower "safe" cadence) with distinct
    /// names, hence distinct workflowIds, both reporting here.
    constructor(
        address _forwarder,
        uint256 _maxVerdictAge,
        bytes32 _expectedWorkflowId,
        bytes32[] memory _additionalWorkflowIds
    ) WorkflowBoundReceiver(_forwarder, _expectedWorkflowId) {
        maxVerdictAge = _maxVerdictAge;
        for (uint256 i = 0; i < _additionalWorkflowIds.length; i++) {
            _allowAdditionalWorkflow(_additionalWorkflowIds[i]);
        }
    }

    function onReport(bytes calldata metadata, bytes calldata report) external onlyForwarder {
        _checkWorkflow(metadata);
        (address borrower, bool eligible, uint256 checkedAt_) = abi.decode(report, (address, bool, uint256));

        // Mirror ComplianceConsumer's FutureVerifiedAt guard: a future
        // checkedAt would pin this borrower at the incoming verdict (e.g.
        // eligible=true) while every corrective report reverts StaleReport
        // until real time catches up.
        if (checkedAt_ > block.timestamp) {
            revert FutureCheckedAt(borrower, checkedAt_, block.timestamp);
        }

        Verdict storage current = _verdicts[borrower];
        if (checkedAt_ <= current.checkedAt) {
            revert StaleReport(borrower, checkedAt_, current.checkedAt);
        }

        _verdicts[borrower] = Verdict({eligible: eligible, checkedAt: checkedAt_});
        emit VerdictUpdated(borrower, eligible, checkedAt_);
    }

    /// @notice Whether the DON has attested this borrower liquidatable AND
    /// that attestation is still within `maxVerdictAge` of `checkedAt`. A
    /// stale or never-written verdict reads back false — fail closed.
    function isEligible(address borrower) external view returns (bool) {
        Verdict memory v = _verdicts[borrower];
        if (!v.eligible) return false;
        if (maxVerdictAge == 0) return true;
        return block.timestamp - v.checkedAt <= maxVerdictAge;
    }

    function checkedAt(address borrower) external view returns (uint256) {
        return _verdicts[borrower].checkedAt;
    }
}
