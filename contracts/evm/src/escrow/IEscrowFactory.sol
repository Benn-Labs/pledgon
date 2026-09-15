// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The slice of EscrowFactory that EscrowVault calls back into. Kept as
/// a minimal interface (an address, not the full contract type) so the two
/// files don't need to import each other's full definitions.
interface IEscrowFactory {
    /// @notice Adds `amount` to `buyer`'s volume for the current rolling
    /// period and returns the new period total. Reverts if the caller isn't a
    /// vault this factory deployed.
    function recordVolume(address buyer, uint256 amount) external returns (uint256 periodVolume);
}
