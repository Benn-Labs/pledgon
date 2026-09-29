// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {WorkflowBoundReceiver} from "../keystone/WorkflowBoundReceiver.sol";

/// @title EscrowConfirmationConsumer
/// @notice Receives DON-signed milestone-condition verdicts from the
/// escrow-confirmation confidential workflow and stores them keyed by
/// (vault, milestoneIndex). Shared by every EscrowVault the factory deploys, so
/// the KeystoneForwarder trust relationship is configured once instead of
/// re-wired per trade.
///
/// Report layout (must match encodeConfirmationReport in workflow.go):
///   abi.encode(address vault, uint256 milestoneIndex, bool confirmed)
contract EscrowConfirmationConsumer is WorkflowBoundReceiver {
    mapping(bytes32 => bool) private _confirmed;

    event MilestoneConfirmed(address indexed vault, uint256 indexed milestoneIndex);

    constructor(address _forwarder, bytes32 _expectedWorkflowId)
        WorkflowBoundReceiver(_forwarder, _expectedWorkflowId)
    {}

    function onReport(bytes calldata metadata, bytes calldata report) external onlyForwarder {
        _checkWorkflow(metadata);
        (address vault, uint256 milestoneIndex, bool confirmed) = abi.decode(report, (address, uint256, bool));

        if (confirmed) {
            _confirmed[_key(vault, milestoneIndex)] = true;
            emit MilestoneConfirmed(vault, milestoneIndex);
        }
    }

    /// @notice Whether the DON has attested the off-chain condition for this
    /// milestone. Never flips back to false once set — a workflow re-run reporting
    /// `confirmed: false` is treated as "no new information", not a revocation.
    function isConfirmed(address vault, uint256 milestoneIndex) external view returns (bool) {
        return _confirmed[_key(vault, milestoneIndex)];
    }

    function _key(address vault, uint256 milestoneIndex) private pure returns (bytes32) {
        return keccak256(abi.encode(vault, milestoneIndex));
    }
}
