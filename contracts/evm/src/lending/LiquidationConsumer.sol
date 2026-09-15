// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IReceiver} from "../keystone/IReceiver.sol";
import {IERC165} from "../keystone/IERC165.sol";

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
contract LiquidationConsumer is IReceiver {
    struct Verdict {
        bool eligible;
        uint256 checkedAt;
    }

    address public immutable forwarder;

    mapping(address => Verdict) private _verdicts;

    event VerdictUpdated(address indexed borrower, bool eligible, uint256 checkedAt);

    error UnauthorizedForwarder(address caller);
    error StaleReport(address borrower, uint256 incomingCheckedAt, uint256 storedCheckedAt);
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
        (address borrower, bool eligible, uint256 checkedAt) = abi.decode(report, (address, bool, uint256));

        Verdict storage current = _verdicts[borrower];
        if (checkedAt <= current.checkedAt) {
            revert StaleReport(borrower, checkedAt, current.checkedAt);
        }

        _verdicts[borrower] = Verdict({eligible: eligible, checkedAt: checkedAt});
        emit VerdictUpdated(borrower, eligible, checkedAt);
    }

    function isEligible(address borrower) external view returns (bool) {
        return _verdicts[borrower].eligible;
    }

    function checkedAt(address borrower) external view returns (uint256) {
        return _verdicts[borrower].checkedAt;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
