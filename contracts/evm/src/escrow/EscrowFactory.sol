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
///
/// `owner`/`vaultCreationFee`/`feeRecipient` are the one mutable, admin-gated
/// corner of this contract — everything else here is immutable, matching the
/// rest of this codebase's "no admin" pattern (see ComplianceConsumer,
/// LendingPool). A flat per-vault fee, paid in native ETH rather than `token`,
/// is the one case that needs adjustability without a redeploy: charging in
/// `token` would need `transferFrom` against the real buyer, but
/// `createTradeFor` is called by Marketplace on the buyer's behalf, so
/// `msg.sender` here is Marketplace, not the buyer — ETH just forwards through
/// `payable`/`msg.value` regardless of which contract is in between. Fees
/// accumulate in this contract's own balance rather than pushing to
/// `feeRecipient` on every vault creation (a pull-based `withdrawFees`,
/// deliberately, so a `feeRecipient` that can't receive ETH — reverts,
/// out of gas, mid-upgrade multisig — can never brick vault creation for
/// everyone else).
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

    address public owner;
    /// @notice Flat fee, in wei, required as `msg.value` on every
    /// `createTrade`/`createTradeFor` call. Zero is valid (fees off).
    uint256 public vaultCreationFee;
    address public feeRecipient;

    address[] public allVaults;
    mapping(address => bool) public isVault;
    /// @notice Wallets the owner has exempted from the volume/tier caps — a
    /// testing and operations aid, not a compliance tier: a super user is
    /// treated as top-tier (uncapped) when funding a vault. Owner-managed and
    /// revocable; consulted at `fund()` time, so granting or revoking applies
    /// to trades that are already created but not yet funded. Leave it empty
    /// (or revoke every entry) for a deployment where the caps must bind
    /// everyone.
    mapping(address => bool) public isSuperUser;
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
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SuperUserSet(address indexed account, bool enabled);
    event VaultCreationFeeUpdated(uint256 previousFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    error ZeroAddress();
    error NotAVault(address caller);
    error InvalidTierCaps(uint256 tier0CapUsd, uint256 tier1CapUsd);
    error NotAccreditedArbiter(address arbiter);
    error NotOwner(address caller);
    error IncorrectFeeAmount(uint256 sent, uint256 required);
    error FeeTransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    constructor(
        EscrowConfirmationConsumer _confirmationConsumer,
        ComplianceConsumer _complianceConsumer,
        uint256 _tier0CapUsd,
        uint256 _tier1CapUsd,
        ArbitratorRegistry _arbitratorRegistry,
        address _defaultArbiter,
        address _owner,
        address _feeRecipient,
        uint256 _vaultCreationFee
    ) {
        if (
            address(_confirmationConsumer) == address(0) || address(_complianceConsumer) == address(0)
                || address(_arbitratorRegistry) == address(0) || _defaultArbiter == address(0) || _owner == address(0)
                || _feeRecipient == address(0)
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
        owner = _owner;
        feeRecipient = _feeRecipient;
        vaultCreationFee = _vaultCreationFee;
    }

    /// @notice Creates a trade with the caller as buyer. The caller must still
    /// call `fund()` (and the seller `depositBond()`) on the returned vault.
    /// `fundingWindow`/`milestoneConfirmWindow`/`deliveryWindow` are durations
    /// in seconds (0 = no deadline) — see EscrowVault for what each one gates.
    /// `arbiter` must be `address(0)` (resolves to `defaultArbiter`),
    /// `defaultArbiter` itself, or an address `arbitratorRegistry` has
    /// accredited — see `_resolveArbiter`. Requires exactly `vaultCreationFee`
    /// wei as `msg.value`.
    function createTrade(
        address seller,
        address arbiter,
        IERC20 token,
        uint256 bondAmount,
        uint256[] calldata milestoneAmounts,
        uint256 fundingWindow,
        uint256 milestoneConfirmWindow,
        uint256 deliveryWindow
    ) external payable returns (address vault) {
        _collectFee();
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
    /// and confirm it. Requires exactly `vaultCreationFee` wei as `msg.value`
    /// (an orchestrator like Marketplace must forward it from whoever's paying).
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
    ) external payable returns (address vault) {
        _collectFee();
        return _createTrade(
            buyer, seller, arbiter, token, bondAmount, milestoneAmounts, fundingWindow, milestoneConfirmWindow, deliveryWindow
        );
    }

    function _collectFee() private {
        if (msg.value != vaultCreationFee) revert IncorrectFeeAmount(msg.value, vaultCreationFee);
    }

    /// @notice Adds `amount` to `buyer`'s volume for the current period.
    /// Callable only by a vault this factory deployed — see EscrowVault.fund().
    /// A super user's volume is neither recorded nor counted: returning 0 makes
    /// the vault's `periodVolume > cap` check pass at every tier, which is
    /// exactly "top tier / uncapped" without the vault needing to know about
    /// super users at all.
    function recordVolume(address buyer, uint256 amount) external returns (uint256 periodVolume) {
        if (!isVault[msg.sender]) revert NotAVault(msg.sender);
        if (isSuperUser[buyer]) return 0;
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

    // ─── Owner actions ─────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Grants or revokes the volume-cap exemption (see `isSuperUser`).
    function setSuperUser(address account, bool enabled) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isSuperUser[account] = enabled;
        emit SuperUserSet(account, enabled);
    }

    function setVaultCreationFee(uint256 newFee) external onlyOwner {
        emit VaultCreationFeeUpdated(vaultCreationFee, newFee);
        vaultCreationFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /// @notice Sends this contract's entire ETH balance (accumulated vault
    /// creation fees) to `feeRecipient`. Pull-based and owner-triggered rather
    /// than pushed on every `createTrade`/`createTradeFor` call — see the
    /// contract-level doc comment for why.
    function withdrawFees() external onlyOwner {
        uint256 amount = address(this).balance;
        (bool ok,) = feeRecipient.call{value: amount}("");
        if (!ok) revert FeeTransferFailed();
        emit FeesWithdrawn(feeRecipient, amount);
    }
}
