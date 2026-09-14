// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IReceiver} from "../keystone/IReceiver.sol";
import {IERC165} from "../keystone/IERC165.sol";

/// @title EscrowConfirmationConsumer
/// @notice Receives DON-signed milestone-condition verdicts from the
/// escrow-confirmation confidential workflow and stores them keyed by
/// (vault, milestoneIndex). Shared by every EscrowVault the factory deploys, so
/// the KeystoneForwarder trust relationship is configured once instead of
/// re-wired per trade.
///
/// Report layout (must match encodeConfirmationReport in workflow.go):
///   abi.encode(address vault, uint256 milestoneIndex, bool confirmed)
contract EscrowConfirmationConsumer is IReceiver {
    address public immutable forwarder;

    mapping(bytes32 => bool) private _confirmed;

    event MilestoneConfirmed(address indexed vault, uint256 indexed milestoneIndex);

    error UnauthorizedForwarder(address caller);
    error ZeroAddress();

    constructor(address _forwarder) {
        if (_forwarder == address(0)) revert ZeroAddress();
        forwarder = _forwarder;
    }

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        _;
    }

    function onReport(bytes calldata, bytes calldata report) external onlyForwarder {
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

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
