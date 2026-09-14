// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC165} from "./IERC165.sol";

/// @notice Minimal interface a CRE consumer must implement to receive reports
/// forwarded by the KeystoneForwarder.
interface IReceiver is IERC165 {
    /// @param metadata workflow ID, DON ID, and execution metadata
    /// @param report ABI-encoded payload produced by the workflow's GenerateReport call
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
