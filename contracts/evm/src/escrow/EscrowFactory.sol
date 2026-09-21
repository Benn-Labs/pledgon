// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {EscrowVault} from "./EscrowVault.sol";
import {EscrowConfirmationConsumer} from "./EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../compliance/ComplianceConsumer.sol";
import {ArbitratorRegistry} from "./ArbitratorRegistry.sol";

/// @title EscrowFactory
/// @notice Deploys one EscrowVault per trade. All vaults share a single
/// EscrowConfirmationConsumer and ComplianceConsumer, so the KeystoneForwarder
/// trust relationship is configured once instead of per trade — lower complexity
/// than giving each vault its own forwarder wiring.
///
/// Also the shared home for per-buyer trading volume: EscrowVault.fund() calls
/// back into `recordVolume` before deciding whether the buyer's compliance tier
/// covers the trade, so a buyer can't evade the tier cap by splitting one large
/// purchase into several trades that are each individually small (structuring).
/// Volume resets in fixed `VOLUME_WINDOW`-sized calendar buckets rather than a
/// continuously-rolling window — far cheaper on-chain, at the cost of a real
/// edge case: a buyer can still move up to ~2x a tier's cap by timing trades
/// across a bucket boundary. Tightening that would mean a true rolling window
/// (a timestamped ring buffer, summed at read time) — a real improvement, left
/// for when structuring at the bucket boundary is an actual observed problem
/// rather than a theoretical one.
///
/// Tier caps assume `token` is a stablecoin pegged ~1:1 to USD: they're computed
/// from the token's `decimals()`, not a price feed. A trade in a non-stablecoin
/// token needs its own USD-conversion step before these caps are meaningful.
contract EscrowFactory {
    uint256 public constant VOLUME_WINDOW = 30 days;

    /// @notice USD-equivalent cap (before decimal scaling) per compliance tier:
    /// index 0 is the tier-0 (unverified) cap — trades whose buyer's rolling
    /// volume stays under this never need a compliance report at all — index 1
    /// is the tier-1 (basic KYC) cap. Tier 2 (enhanced) is uncapped.
    uint256 public immutable tier0CapUsd;
    uint256 public immutable tier1CapUsd;

    EscrowConfirmationConsumer public immutable confirmationConsumer;
    ComplianceConsumer public immutable complianceConsumer;
    /// @notice Curated allowlist a trade creator's chosen arbiter must appear
    /// on, unless they leave it as `defaultArbiter` (or address(0), which
    /// resolves to the same thing) — see `_resolveArbiter`. No trade this
    /// factory creates can end up with an arbiter nobody vetted.
    ArbitratorRegistry public immutable arbitratorRegistry;
    /// @notice The arbiter used when a trade creator doesn't pick an
    /// accredited one of their own — the platform's own dispute-resolution
    /// address.
    address public immutable defaultArbiter;

    address[] public allVaults;
    mapping(address => bool) public isVault;
    mapping(address => address[]) public vaultsByBuyer;
    mapping(address => address[]) public vaultsBySeller;
    mapping(address => mapping(uint256 => uint256)) private _volumeByPeriod;

    event VaultCreated(
        address indexed vault,
        address indexed buyer,
        address indexed seller,
        address arbiter,
        address token,
        uint256 bondAmount
    );

    error ZeroAddress();
    error NotAVault(address caller);
    error InvalidTierCaps(uint256 tier0CapUsd, uint256 tier1CapUsd);
    error NotAccreditedArbiter(address arbiter);

    constructor(
        EscrowConfirmationConsumer _confirmationConsumer,
        ComplianceConsumer _complianceConsumer,
        uint256 _tier0CapUsd,
        uint256 _tier1CapUsd,
        ArbitratorRegistry _arbitratorRegistry,
        address _defaultArbiter
    ) {
        if (
            address(_confirmationConsumer) == address(0) || address(_complianceConsumer) == address(0)
                || address(_arbitratorRegistry) == address(0) || _defaultArbiter == address(0)
        ) {
            revert ZeroAddress();
        }
        if (_tier1CapUsd < _tier0CapUsd) revert InvalidTierCaps(_tier0CapUsd, _tier1CapUsd);

        confirmationConsumer = _confirmationConsumer;
        complianceConsumer = _complianceConsumer;
        tier0CapUsd = _tier0CapUsd;
        tier1CapUsd = _tier1CapUsd;
        arbitratorRegistry = _arbitratorRegistry;
        defaultArbiter = _defaultArbiter;
    }

    /// @notice Creates a trade with the caller as buyer. The caller must still
    /// call `fund()` (and the seller `depositBond()`) on the returned vault.
    /// `fundingWindow`/`milestoneConfirmWindow`/`deliveryWindow` are durations
    /// in seconds (0 = no deadline) — see EscrowVault for what each one gates.
    /// `arbiter` must be `address(0)` (resolves to `defaultArbiter`),
    /// `defaultArbiter` itself, or an address `arbitratorRegistry` has
    /// accredited — see `_resolveArbiter`.
    function createTrade(
        address seller,
        address arbiter,
        IERC20 token,
        uint256 bondAmount,
        uint256[] calldata milestoneAmounts,
        uint256 fundingWindow,
        uint256 milestoneConfirmWindow,
        uint256 deliveryWindow
    ) external returns (address vault) {
        return _createTrade(
            msg.sender, seller, arbiter, token, bondAmount, milestoneAmounts, fundingWindow, milestoneConfirmWindow, deliveryWindow
        );
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
        uint256[] calldata milestoneAmounts,
        uint256 fundingWindow,
        uint256 milestoneConfirmWindow,
        uint256 deliveryWindow
    ) external returns (address vault) {
        return _createTrade(
            buyer, seller, arbiter, token, bondAmount, milestoneAmounts, fundingWindow, milestoneConfirmWindow, deliveryWindow
        );
    }

    /// @notice Adds `amount` to `buyer`'s volume for the current period.
    /// Callable only by a vault this factory deployed — see EscrowVault.fund().
    function recordVolume(address buyer, uint256 amount) external returns (uint256 periodVolume) {
        if (!isVault[msg.sender]) revert NotAVault(msg.sender);
        uint256 period = block.timestamp / VOLUME_WINDOW;
        periodVolume = _volumeByPeriod[buyer][period] + amount;
        _volumeByPeriod[buyer][period] = periodVolume;
    }

    /// @notice `buyer`'s recorded volume in the current period.
    function currentPeriodVolume(address buyer) external view returns (uint256) {
        return _volumeByPeriod[buyer][block.timestamp / VOLUME_WINDOW];
    }

    function _createTrade(
        address buyer,
        address seller,
        address arbiter,
        IERC20 token,
        uint256 bondAmount,
        uint256[] calldata milestoneAmounts,
        uint256 fundingWindow,
        uint256 milestoneConfirmWindow,
        uint256 deliveryWindow
    ) private returns (address vault) {
        address resolvedArbiter = _resolveArbiter(arbiter);
        uint256 scale = 10 ** token.decimals();

        vault = address(
            new EscrowVault(
                buyer,
                seller,
                resolvedArbiter,
                token,
                bondAmount,
                milestoneAmounts,
                tier0CapUsd * scale,
                tier1CapUsd * scale,
                confirmationConsumer,
                complianceConsumer,
                fundingWindow,
                milestoneConfirmWindow,
                deliveryWindow
            )
        );

        allVaults.push(vault);
        isVault[vault] = true;
        vaultsByBuyer[buyer].push(vault);
        vaultsBySeller[seller].push(vault);

        emit VaultCreated(vault, buyer, seller, resolvedArbiter, address(token), bondAmount);
    }

    /// @notice `address(0)` and `defaultArbiter` both resolve to
    /// `defaultArbiter` — a trade creator who doesn't specify an arbiter (or
    /// explicitly names the default one) gets the platform's own address.
    /// Anything else must already be accredited; there is no third option
    /// where an arbitrary, unvetted address is accepted, and no "no arbiter"
    /// option at all — every trade this factory creates has someone who can
    /// actually rule on a dispute.
    function _resolveArbiter(address requested) private view returns (address) {
        if (requested == address(0) || requested == defaultArbiter) return defaultArbiter;
        if (!arbitratorRegistry.isAccredited(requested)) revert NotAccreditedArbiter(requested);
        return requested;
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
