// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {WorkflowBoundReceiver} from "../keystone/WorkflowBoundReceiver.sol";
import {IExpirable} from "./IExpirable.sol";

/// @title TradeExpiryKeeper
/// @notice Relays DON-scheduled expiry calls from the trade-expiry cron
/// workflow to whichever EscrowVault has missed a deadline. Unlike
/// EscrowConfirmationConsumer/ComplianceConsumer, which store a verdict for a
/// vault to pull later, this contract acts immediately on `onReport` — the
/// underlying check (`block.timestamp` past a deadline already recorded
/// on-chain) needs no DON attestation to be trustworthy, so there's nothing to
/// store: the DON round-trip here exists purely so the cron workflow has a way
/// to submit a transaction at all (CRE workflows can only write on-chain via a
/// signed report through the Forwarder), not because the fact needs
/// verifying. `expireFunding`/`expireMilestone` are already permissionless on
/// EscrowVault, so a human calling them directly is just as valid as this
/// keeper calling them — this is automation, not a trust boundary.
///
/// Report layout (must match encodeExpiryReport in workflows/trade-expiry):
///   abi.encode(address vault, bool isMilestone, uint256 milestoneIndex)
contract TradeExpiryKeeper is WorkflowBoundReceiver {
    event FundingExpiryRelayed(address indexed vault);
    event MilestoneExpiryRelayed(address indexed vault, uint256 indexed milestoneIndex);

    constructor(address _forwarder, bytes32 _expectedWorkflowId)
        WorkflowBoundReceiver(_forwarder, _expectedWorkflowId)
    {}

    function onReport(bytes calldata metadata, bytes calldata report) external onlyForwarder {
        _checkWorkflow(metadata);
        (address vault, bool isMilestone, uint256 milestoneIndex) = abi.decode(report, (address, bool, uint256));

        if (isMilestone) {
            IExpirable(vault).expireMilestone(milestoneIndex);
            emit MilestoneExpiryRelayed(vault, milestoneIndex);
        } else {
            IExpirable(vault).expireFunding();
            emit FundingExpiryRelayed(vault);
        }
    }
}
