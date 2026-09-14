// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal ERC20 interface for escrow token transfers. Escrow assumes
/// `token` is a stablecoin pegged ~1:1 to USD — the $999 compliance threshold is
/// computed directly from `decimals()`, with no price conversion.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}
