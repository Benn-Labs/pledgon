// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IReceiver} from "./IReceiver.sol";
import {IERC165} from "./IERC165.sol";

/// @title WorkflowBoundReceiver
/// @notice Shared base for every consumer in this repo. Authenticates the
/// KeystoneForwarder (WHO delivers) and, when bound, the workflowId carried
/// in the report metadata (WHO authored). The forwarder check alone proves a
/// report is DON-signed, but any workflow registered against that DON could
/// then address any consumer on the chain — the workflowId check pins each
/// consumer to the one workflow meant to write it, so a misconfigured or
/// third-party workflow's report is rejected even when perfectly signed.
///
/// Metadata layout (per Chainlink's "Building Consumer Contracts" docs): the
/// production KeystoneForwarder delivers a 64-byte slice —
/// abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner)
/// followed by 2 bytes of reportId. Only the leading workflowId is checked
/// here. The MockKeystoneForwarder used by `cre workflow simulate` supplies no
/// metadata, so a consumer constructed with expectedWorkflowId == bytes32(0)
/// (unbound) skips the check — that is the only intended unbound
/// configuration; production deployments should pass the real workflow ID.
abstract contract WorkflowBoundReceiver is IReceiver {
    address public immutable forwarder;
    /// @notice The only workflow whose reports this consumer accepts.
    /// bytes32(0) = unbound (any workflow) — simulation only, never production.
    bytes32 public immutable expectedWorkflowId;
    /// @notice Further workflows allowed to write this consumer, for the case
    /// where one consumer legitimately has several authors (e.g. the same
    /// liquidation workflow deployed at two cadences under two names, which
    /// gives each its own workflowId). Only populated by a derived contract's
    /// constructor and only when `expectedWorkflowId` is set — an unbound
    /// consumer accepts everything already, so extras there would be a
    /// misconfiguration that looks like a restriction but isn't.
    mapping(bytes32 => bool) public isAdditionalWorkflow;

    event WorkflowBound(bytes32 indexed workflowId);

    error UnauthorizedForwarder(address caller);
    error UnexpectedWorkflowId(bytes32 received, bytes32 expected);
    error InvalidMetadataLength(uint256 length);
    error ZeroAddress();
    error AdditionalWorkflowWhileUnbound();
    error ZeroWorkflowId();

    constructor(address _forwarder, bytes32 _expectedWorkflowId) {
        if (_forwarder == address(0)) revert ZeroAddress();
        forwarder = _forwarder;
        expectedWorkflowId = _expectedWorkflowId;
        if (_expectedWorkflowId != bytes32(0)) emit WorkflowBound(_expectedWorkflowId);
    }

    function _allowAdditionalWorkflow(bytes32 workflowId) internal {
        if (expectedWorkflowId == bytes32(0)) revert AdditionalWorkflowWhileUnbound();
        if (workflowId == bytes32(0)) revert ZeroWorkflowId();
        isAdditionalWorkflow[workflowId] = true;
        emit WorkflowBound(workflowId);
    }

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        _;
    }

    /// @notice Reverts unless metadata was authored by `expectedWorkflowId` or
    /// one of the additional allowed workflows.
    /// No-op when the consumer is unbound (expectedWorkflowId == 0).
    function _checkWorkflow(bytes calldata metadata) internal view {
        bytes32 expected = expectedWorkflowId;
        if (expected == bytes32(0)) return;
        // The packed identity is 62 bytes (32 + 10 + 20); production delivery
        // is 64 (plus reportId). Anything shorter can't carry a workflowId.
        if (metadata.length < 62) revert InvalidMetadataLength(metadata.length);
        bytes32 received = bytes32(metadata[0:32]);
        if (received != expected && !isAdditionalWorkflow[received]) revert UnexpectedWorkflowId(received, expected);
    }

    function supportsInterface(bytes4 interfaceId) external pure virtual override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
