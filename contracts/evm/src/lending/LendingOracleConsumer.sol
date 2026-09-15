// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IReceiver} from "../keystone/IReceiver.sol";
import {IERC165} from "../keystone/IERC165.sol";

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
contract LendingOracleConsumer is IReceiver {
    struct Round {
        uint256 value;
        uint8 decimals;
        uint256 updatedAt;
    }

    address public immutable forwarder;

    mapping(bytes32 => Round) private _rounds;

    event PriceUpdated(bytes32 indexed feedId, uint256 value, uint8 decimals, uint256 updatedAt);

    error UnauthorizedForwarder(address caller);
    error StaleReport(bytes32 feedId, uint256 incomingUpdatedAt, uint256 storedUpdatedAt);
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
        (bytes32 feedId, uint256 value, uint8 decimals, uint256 updatedAt) =
            abi.decode(report, (bytes32, uint256, uint8, uint256));

        Round storage current = _rounds[feedId];
        if (updatedAt <= current.updatedAt) {
            revert StaleReport(feedId, updatedAt, current.updatedAt);
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

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
