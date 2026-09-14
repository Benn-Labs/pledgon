// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {EscrowVault} from "./EscrowVault.sol";
import {EscrowConfirmationConsumer} from "./EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../compliance/ComplianceConsumer.sol";

/// @title EscrowFactory
/// @notice Deploys one EscrowVault per trade. All vaults share a single
/// EscrowConfirmationConsumer and ComplianceConsumer, so the KeystoneForwarder
/// trust relationship is configured once instead of per trade — lower complexity
/// than giving each vault its own forwarder wiring.
///
/// The $999 compliance threshold assumes `token` is a stablecoin pegged ~1:1 to
/// USD: it's computed from the token's `decimals()`, not a price feed. A trade in
/// a non-stablecoin token needs its own USD-conversion step before this threshold
/// is meaningful.
contract EscrowFactory {
    uint256 public constant COMPLIANCE_THRESHOLD_USD = 999;

    EscrowConfirmationConsumer public immutable confirmationConsumer;
    ComplianceConsumer public immutable complianceConsumer;

    address[] public allVaults;
    mapping(address => address[]) public vaultsByBuyer;
    mapping(address => address[]) public vaultsBySeller;

    event VaultCreated(
        address indexed vault,
        address indexed buyer,
        address indexed seller,
        address arbiter,
        address token,
        uint256 bondAmount
    );

    error ZeroAddress();

    constructor(EscrowConfirmationConsumer _confirmationConsumer, ComplianceConsumer _complianceConsumer) {
        if (address(_confirmationConsumer) == address(0) || address(_complianceConsumer) == address(0)) {
            revert ZeroAddress();
        }
        confirmationConsumer = _confirmationConsumer;
        complianceConsumer = _complianceConsumer;
    }

    /// @notice Creates a trade with the caller as buyer. The caller must still
    /// call `fund()` (and the seller `depositBond()`) on the returned vault.
    function createTrade(
        address seller,
        address arbiter,
        IERC20 token,
        uint256 bondAmount,
        uint256[] calldata milestoneAmounts
    ) external returns (address vault) {
        return _createTrade(msg.sender, seller, arbiter, token, bondAmount, milestoneAmounts);
    }

    /// @notice Creates a trade on `buyer`'s behalf. For an orchestrator (e.g. a
    /// Marketplace matching a purchaser to a listing) that already knows the real
    /// buyer's identity and isn't the one funding the trade. Safe to leave
    /// permissionless: `fund()` on the resulting vault still requires `buyer`'s
    /// own token approval, so calling this cannot move anyone's funds without
    /// their consent — it only decides who the vault will later require to fund
    /// and confirm it.
    function createTradeFor(
        address buyer,
        address seller,
        address arbiter,
        IERC20 token,
        uint256 bondAmount,
        uint256[] calldata milestoneAmounts
    ) external returns (address vault) {
        return _createTrade(buyer, seller, arbiter, token, bondAmount, milestoneAmounts);
    }

    function _createTrade(
        address buyer,
        address seller,
        address arbiter,
        IERC20 token,
        uint256 bondAmount,
        uint256[] calldata milestoneAmounts
    ) private returns (address vault) {
        uint256 complianceThreshold = COMPLIANCE_THRESHOLD_USD * (10 ** token.decimals());

        vault = address(
            new EscrowVault(
                buyer,
                seller,
                arbiter,
                token,
                bondAmount,
                milestoneAmounts,
                complianceThreshold,
                confirmationConsumer,
                complianceConsumer
            )
        );

        allVaults.push(vault);
        vaultsByBuyer[buyer].push(vault);
        vaultsBySeller[seller].push(vault);

        emit VaultCreated(vault, buyer, seller, arbiter, address(token), bondAmount);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
