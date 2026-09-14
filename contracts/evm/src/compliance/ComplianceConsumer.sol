// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IReceiver} from "../keystone/IReceiver.sol";
import {IERC165} from "../keystone/IERC165.sol";

/// @title ComplianceConsumer
/// @notice Receives DON-signed KYC/KYB verdicts from the compliance-check
/// confidential workflow, keyed by subject address. The workflow runs the
/// KYC/AML/sanctions check inside an enclave — only compliant:true/false crosses
/// out, never the underlying PII or the provider's credentials. Shared by every
/// EscrowVault: a buyer verified once is compliant across all trades until a new
/// report revokes it.
///
/// Report layout (must match encodeComplianceReport in workflow.go):
///   abi.encode(address subject, bool compliant, uint256 verifiedAt)
contract ComplianceConsumer is IReceiver {
    struct Status {
        bool compliant;
        uint256 verifiedAt;
    }

    address public immutable forwarder;

    mapping(address => Status) private _status;

    event ComplianceUpdated(address indexed subject, bool compliant, uint256 verifiedAt);

    error UnauthorizedForwarder(address caller);
    error StaleReport(address subject, uint256 incomingVerifiedAt, uint256 storedVerifiedAt);
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
        (address subject, bool compliant, uint256 verifiedAt) = abi.decode(report, (address, bool, uint256));

        Status storage current = _status[subject];
        // Monotonic: reject out-of-order or replayed verdicts.
        if (verifiedAt <= current.verifiedAt) {
            revert StaleReport(subject, verifiedAt, current.verifiedAt);
        }

        _status[subject] = Status({compliant: compliant, verifiedAt: verifiedAt});
        emit ComplianceUpdated(subject, compliant, verifiedAt);
    }

    function isCompliant(address subject) external view returns (bool) {
        return _status[subject].compliant;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
