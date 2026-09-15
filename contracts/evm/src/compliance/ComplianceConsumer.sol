// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IReceiver} from "../keystone/IReceiver.sol";
import {IERC165} from "../keystone/IERC165.sol";

/// @title ComplianceConsumer
/// @notice Receives DON-signed KYC/KYB tier verdicts from the compliance-check
/// confidential workflow, keyed by subject address. The workflow runs the
/// KYC/AML/sanctions check inside an enclave — only the resulting tier crosses
/// out, never the underlying PII or the provider's credentials. Shared by every
/// EscrowVault.
///
/// Tiers: 0 = unverified (default, and what an expired verdict reads back as),
/// 1 = basic KYC, 2 = enhanced KYC/KYB. Callers read tiers via `tierOf`, not the
/// raw report, so expiry is enforced at every read site automatically.
///
/// A verdict is only valid for `maxValidity` after it was checked — past that,
/// `tierOf` reads back 0 regardless of the stored tier, so a subject who never
/// gets re-verified silently reverts to unverified rather than staying
/// permanently compliant on a stale check (e.g. one made before they were
/// sanctioned).
///
/// Report layout (must match encodeComplianceReport in workflow.go):
///   abi.encode(address subject, uint8 tier, uint256 verifiedAt)
contract ComplianceConsumer is IReceiver {
    uint8 public constant MAX_TIER = 2;

    struct Status {
        uint8 tier;
        uint256 verifiedAt;
    }

    address public immutable forwarder;
    uint256 public immutable maxValidity;

    mapping(address => Status) private _status;

    event ComplianceUpdated(address indexed subject, uint8 tier, uint256 verifiedAt);

    error UnauthorizedForwarder(address caller);
    error StaleReport(address subject, uint256 incomingVerifiedAt, uint256 storedVerifiedAt);
    error InvalidTier(uint8 tier);
    error FutureVerifiedAt(address subject, uint256 verifiedAt, uint256 blockTimestamp);
    error ZeroAddress();

    constructor(address _forwarder, uint256 _maxValidity) {
        if (_forwarder == address(0)) revert ZeroAddress();
        forwarder = _forwarder;
        maxValidity = _maxValidity;
    }

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        _;
    }

    function onReport(bytes calldata, bytes calldata report) external onlyForwarder {
        (address subject, uint8 tier, uint256 verifiedAt) = abi.decode(report, (address, uint8, uint256));
        if (tier > MAX_TIER) revert InvalidTier(tier);
        // tierOf() computes block.timestamp - verifiedAt; a future verifiedAt
        // would underflow that subtraction and revert every future tierOf() read
        // for this subject until real time catches up — reject it here instead.
        if (verifiedAt > block.timestamp) revert FutureVerifiedAt(subject, verifiedAt, block.timestamp);

        Status storage current = _status[subject];
        // Monotonic: reject out-of-order or replayed verdicts.
        if (verifiedAt <= current.verifiedAt) {
            revert StaleReport(subject, verifiedAt, current.verifiedAt);
        }

        _status[subject] = Status({tier: tier, verifiedAt: verifiedAt});
        emit ComplianceUpdated(subject, tier, verifiedAt);
    }

    /// @notice The subject's current tier: 0 if never verified, if the DON
    /// explicitly reported tier 0, or if the last verdict is older than
    /// `maxValidity`.
    function tierOf(address subject) public view returns (uint8) {
        Status memory s = _status[subject];
        if (block.timestamp - s.verifiedAt > maxValidity) return 0;
        return s.tier;
    }

    function verifiedAt(address subject) external view returns (uint256) {
        return _status[subject].verifiedAt;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
