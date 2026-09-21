// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The slice of EscrowVault that TradeExpiryKeeper calls back into.
/// Both functions are already permissionless on EscrowVault itself — anyone
/// can call them once the real on-chain deadline check passes — so the keeper
/// needs no special trust relationship with the vault, just this interface.
interface IExpirable {
    function expireFunding() external;
    function expireMilestone(uint256 index) external;
}
