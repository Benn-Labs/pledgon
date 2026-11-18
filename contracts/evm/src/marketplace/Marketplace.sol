// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {EscrowFactory} from "../escrow/EscrowFactory.sol";

/// @title Marketplace
/// @notice Plain Solidity — no DON involvement. A listing is a standing offer
/// to sell up to `totalQuantity` of something at `unitPrice` per unit, with a
/// fixed milestone payout split (as basis points, not a fixed amount — the
/// actual amount only exists once a buyer picks a quantity). Each `purchase`
/// buys some or all of the remaining quantity, opening its own escrow trade
/// via `EscrowFactory.createTradeFor` sized to exactly that purchase — the
/// caller (not this contract) becomes the trade's real buyer. A listing stays
/// `Active` (and purchasable by anyone, including a different buyer) until
/// its quantity is exhausted, at which point it flips to `Sold`.
///
/// Listing lifecycle, modeled on Garantor's marketplace (the TON predecessor's
/// `marketplace_listing.tact`): creating a listing costs `listingFee` wei of
/// native ETH and the listing is valid for one `LISTING_WINDOW` (a month) —
/// `purchase` reverts once `expiresAt` passes. The seller can `renewListing`
/// for another window at the current fee (renewing an expired-but-otherwise-
/// Active listing reactivates it, so a missed month doesn't force recreating
/// the listing), `updatePrice` to re-price the remaining quantity, and
/// `restockListing` to add more supply — each seller-gated, each only on
/// `Active` listings. Already-open vaults are unaffected by any of these:
/// they are separate escrow contracts that keep the terms they were created
/// with. Fees accumulate in this contract and are pulled via `withdrawFees`,
/// same pull-based pattern as `EscrowFactory`.
///
/// `quantity` (both `totalQuantity`/`remainingQuantity` and a purchase's own
/// quantity) is fixed-point scaled by `QUANTITY_SCALE`, independent of the
/// payment token's own `decimals()` — same idea as a DeFi price ratio's scale
/// being independent of either side's token decimals. `unitPrice` and
/// `bondRatePerUnit` are both "token smallest-units per one whole quantity
/// unit," so a purchase's total and required bond are:
///   totalAmount = quantity * unitPrice / QUANTITY_SCALE
///   bondAmount  = quantity * bondRatePerUnit / QUANTITY_SCALE
/// A listing created with `totalQuantity == QUANTITY_SCALE` (i.e. "1 whole
/// unit") behaves exactly like a single indivisible item: the first (and only
/// possible) purchase must take the full remaining quantity, immediately
/// flipping the listing to `Sold` — the general quantity model subsumes the
/// old single-unit listing as its simplest case, not a separate code path.
contract Marketplace {
    enum ListingStatus {
        Active,
        Cancelled,
        Sold,
        /// Removed by the platform admin (see `takeDownListing`) rather than
        /// delisted by its seller.
        TakenDown
    }

    /// @notice Basis-point denominator `milestoneBps` must sum to — matches
    /// EscrowVault.BPS_DENOMINATOR's convention.
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Fixed-point scale `quantity` (listing and per-purchase alike)
    /// is expressed in, independent of the payment token's own decimals.
    uint256 public constant QUANTITY_SCALE = 1e18;
    /// @notice How long a created or renewed listing stays purchasable,
    /// modeled on Garantor's marketplace listing window (`listingWindow`,
    /// 30-day default): listings are valid monthly and the seller pays the
    /// listing fee again to renew for another window.
    uint256 public constant LISTING_WINDOW = 30 days;

    struct Listing {
        address seller;
        address arbiter;
        IERC20 token;
        uint16[] milestoneBps; // sums to BPS_DENOMINATOR; the split applied to each purchase's own total
        string metadataURI; // off-chain listing content (e.g. an IPFS URI)
        ListingStatus status;
        uint256 totalQuantity; // as originally listed plus any restocks, QUANTITY_SCALE-scaled
        uint256 remainingQuantity; // decrements on each purchase; status flips to Sold at 0
        uint256 unitPrice; // token smallest-units per QUANTITY_SCALE of quantity
        uint256 bondRatePerUnit; // token smallest-units of bond per QUANTITY_SCALE of quantity
        uint256 fundingWindow; // seconds; 0 = no deadline; forwarded to the escrow vault a purchase creates
        uint256 milestoneConfirmWindow; // seconds; 0 = no deadline; forwarded likewise
        uint256 deliveryWindow; // seconds; 0 = no deadline; forwarded likewise
        uint256 expiresAt; // block.timestamp + LISTING_WINDOW at create/renew; purchase reverts past it
    }

    EscrowFactory public immutable factory;
    /// @notice Flat fee, in wei, required as `msg.value` on every
    /// `createListing`/`renewListing` call. Zero is valid (fees off).
    /// Owner-adjustable (where "owner" is `factory.owner()` — the same admin
    /// key as moderation, so transferring factory ownership moves this right
    /// too), like EscrowFactory's `vaultCreationFee`.
    uint256 public listingFee;

    Listing[] private _listings;
    /// @notice Every vault a purchase of this listing has opened — a listing
    /// can now be purchased many times (by the same or different buyers)
    /// before its quantity is exhausted, so there's no single "the" vault.
    mapping(uint256 => address[]) public listingVaults;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        address token,
        uint256 totalQuantity,
        uint256 unitPrice,
        string metadataURI
    );
    event ListingCancelled(uint256 indexed listingId);
    /// @notice Emitted alongside the status change when the platform admin
    /// removes a listing, so the stated reason is part of the public record.
    event ListingTakenDown(uint256 indexed listingId, address indexed admin, string reason);
    event ListingPurchased(
        uint256 indexed listingId, address indexed buyer, address indexed vault, uint256 quantity, uint256 totalAmount
    );
    event ListingSoldOut(uint256 indexed listingId);
    /// @notice A month of validity paid for: `expiresAt` pushed one
    /// `LISTING_WINDOW` out from max(now, previous expiresAt).
    event ListingRenewed(uint256 indexed listingId, uint256 expiresAt);
    /// @notice The seller re-priced the remaining quantity; vaults already
    /// opened keep the price they were purchased at.
    event ListingPriceUpdated(uint256 indexed listingId, uint256 unitPrice);
    /// @notice The seller added supply: both `totalQuantity` and
    /// `remainingQuantity` increase by `addQuantity`.
    event ListingRestocked(uint256 indexed listingId, uint256 addQuantity, uint256 remainingQuantity);
    event ListingFeeUpdated(uint256 previousFee, uint256 newFee);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    error NotSeller(address caller);
    error NotAdmin(address caller);
    error InvalidListingId(uint256 listingId);
    error ListingNotActive(uint256 listingId, ListingStatus actual);
    error ListingExpired(uint256 listingId, uint256 expiresAt);
    error NoMilestones();
    error ZeroAddress();
    error InvalidBps(uint256 sum);
    error InvalidQuantity(uint256 requested, uint256 available);
    error InvalidPrice();
    error IncorrectFeeAmount(uint256 sent, uint256 required);
    error FeeTransferFailed();

    constructor(EscrowFactory _factory, uint256 _listingFee) {
        if (address(_factory) == address(0)) revert ZeroAddress();
        factory = _factory;
        listingFee = _listingFee;
    }

    /// @notice Lists up to `totalQuantity` of something for sale at
    /// `unitPrice` per unit (see the contract-level doc comment for the
    /// fixed-point convention both use). `milestoneBps` is the payout split
    /// applied to every purchase's own total — it must sum to exactly
    /// `BPS_DENOMINATOR`; the actual per-milestone amount only exists once a
    /// buyer picks a quantity. `bondRatePerUnit` is the seller's performance
    /// bond, charged proportionally per purchase (so a small purchase doesn't
    /// require the same bond as buying out the whole listing).
    /// `fundingWindow`/`milestoneConfirmWindow`/`deliveryWindow` are
    /// durations in seconds (0 = no deadline) forwarded to
    /// `EscrowFactory.createTradeFor` at purchase time — see EscrowVault for
    /// what each one gates. `arbiter` may be `address(0)` — resolved to
    /// `EscrowFactory`'s default arbiter at purchase time, same as calling
    /// `createTrade` directly; a non-zero value must be that default or an
    /// accredited address, or the purchase reverts — see
    /// `EscrowFactory._resolveArbiter`.
    function createListing(
        IERC20 token,
        uint16[] calldata milestoneBps,
        address arbiter,
        string calldata metadataURI,
        uint256 totalQuantity,
        uint256 unitPrice,
        uint256 bondRatePerUnit,
        uint256 fundingWindow,
        uint256 milestoneConfirmWindow,
        uint256 deliveryWindow
    ) external payable returns (uint256 listingId) {
        if (msg.value != listingFee) revert IncorrectFeeAmount(msg.value, listingFee);
        if (milestoneBps.length == 0) revert NoMilestones();
        if (address(token) == address(0)) revert ZeroAddress();
        if (totalQuantity == 0) revert InvalidQuantity(0, 0);

        uint256 bpsSum;
        for (uint256 i = 0; i < milestoneBps.length; i++) {
            bpsSum += milestoneBps[i];
        }
        if (bpsSum != BPS_DENOMINATOR) revert InvalidBps(bpsSum);

        listingId = _listings.length;
        _listings.push();
        Listing storage listing = _listings[listingId];
        listing.seller = msg.sender;
        listing.arbiter = arbiter;
        listing.token = token;
        listing.milestoneBps = milestoneBps;
        listing.metadataURI = metadataURI;
        listing.status = ListingStatus.Active;
        listing.totalQuantity = totalQuantity;
        listing.remainingQuantity = totalQuantity;
        listing.unitPrice = unitPrice;
        listing.bondRatePerUnit = bondRatePerUnit;
        listing.fundingWindow = fundingWindow;
        listing.milestoneConfirmWindow = milestoneConfirmWindow;
        listing.deliveryWindow = deliveryWindow;
        listing.expiresAt = block.timestamp + LISTING_WINDOW;

        emit ListingCreated(listingId, msg.sender, address(token), totalQuantity, unitPrice, metadataURI);
    }

    function cancelListing(uint256 listingId) external {
        Listing storage listing = _mustGet(listingId);
        if (msg.sender != listing.seller) revert NotSeller(msg.sender);
        if (listing.status != ListingStatus.Active) revert ListingNotActive(listingId, listing.status);

        listing.status = ListingStatus.Cancelled;
        emit ListingCancelled(listingId);
    }

    /// @notice Extends an Active listing's validity by one `LISTING_WINDOW`
    /// from max(now, current `expiresAt`) — so renewing early doesn't waste
    /// time and renewing after expiry reactivates the listing instead of
    /// forcing the seller to recreate it (Garantor's RenewListing semantics).
    /// Requires exactly `listingFee` wei, like `createListing`. `Sold`,
    /// `Cancelled` and `TakenDown` listings are terminal and cannot renew.
    function renewListing(uint256 listingId) external payable {
        Listing storage listing = _mustGet(listingId);
        if (msg.sender != listing.seller) revert NotSeller(msg.sender);
        if (listing.status != ListingStatus.Active) revert ListingNotActive(listingId, listing.status);
        if (msg.value != listingFee) revert IncorrectFeeAmount(msg.value, listingFee);

        uint256 base = block.timestamp > listing.expiresAt ? block.timestamp : listing.expiresAt;
        listing.expiresAt = base + LISTING_WINDOW;

        emit ListingRenewed(listingId, listing.expiresAt);
    }

    /// @notice Re-prices the remaining quantity. Only affects purchases made
    /// after the update — vaults already opened are separate escrow contracts
    /// that keep the unit price they were purchased at (Garantor's
    /// UpdatePrice semantics: "seller re-prices remaining inventory").
    function updatePrice(uint256 listingId, uint256 newUnitPrice) external {
        Listing storage listing = _mustGet(listingId);
        if (msg.sender != listing.seller) revert NotSeller(msg.sender);
        if (listing.status != ListingStatus.Active) revert ListingNotActive(listingId, listing.status);
        if (newUnitPrice == 0) revert InvalidPrice();

        listing.unitPrice = newUnitPrice;
        emit ListingPriceUpdated(listingId, newUnitPrice);
    }

    /// @notice Adds `addQuantity` to the listing's supply: both
    /// `totalQuantity` and `remainingQuantity` increase by `addQuantity`.
    /// Has no effect on purchases already made. Restocking an `Active`
    /// listing whose quantity is exhausted is impossible — it is already
    /// `Sold` and `Sold` is terminal; the seller creates a new listing
    /// instead (same as Garantor).
    function restockListing(uint256 listingId, uint256 addQuantity) external {
        Listing storage listing = _mustGet(listingId);
        if (msg.sender != listing.seller) revert NotSeller(msg.sender);
        if (listing.status != ListingStatus.Active) revert ListingNotActive(listingId, listing.status);
        if (addQuantity == 0) revert InvalidQuantity(0, listing.remainingQuantity);
        if (addQuantity > type(uint256).max - listing.remainingQuantity) {
            revert InvalidQuantity(addQuantity, listing.remainingQuantity);
        }

        listing.totalQuantity += addQuantity;
        listing.remainingQuantity += addQuantity;

        emit ListingRestocked(listingId, addQuantity, listing.remainingQuantity);
    }

    /// @notice Platform moderation: the owner of `factory` (the same admin
    /// key — typically a multisig — that runs the escrow factory) can pull an
    /// Active listing that breaches the platform's terms (malicious,
    /// fraudulent, inappropriate). The admin right is deliberately derived
    /// from `factory.owner()` rather than stored here, so transferring the
    /// factory's ownership to a multisig moves this right with it and there is
    /// no second owner to keep in sync.
    ///
    /// Scope is intentionally narrow: it only stops NEW purchases. Vaults a
    /// buyer has already opened from this listing are separate escrow
    /// contracts the admin has no power over — funds in them stay governed by
    /// their own milestones, arbiter and deadlines, so a takedown can never be
    /// used to seize or redirect anyone's money. `reason` is emitted, not
    /// stored.
    function takeDownListing(uint256 listingId, string calldata reason) external {
        if (msg.sender != factory.owner()) revert NotAdmin(msg.sender);
        Listing storage listing = _mustGet(listingId);
        if (listing.status != ListingStatus.Active) revert ListingNotActive(listingId, listing.status);

        listing.status = ListingStatus.TakenDown;
        emit ListingTakenDown(listingId, msg.sender, reason);
    }

    /// @notice Adjusts the fee charged on `createListing`/`renewListing`.
    /// Only `factory.owner()` — the same admin key as `takeDownListing`, so
    /// ownership transfer moves this right with it. Zero is valid (fees off).
    function setListingFee(uint256 newFee) external {
        if (msg.sender != factory.owner()) revert NotAdmin(msg.sender);
        emit ListingFeeUpdated(listingFee, newFee);
        listingFee = newFee;
    }

    /// @notice Sends this contract's entire ETH balance (accumulated listing
    /// and renewal fees) to `factory.feeRecipient()`. Pull-based and
    /// owner-triggered rather than pushed on every fee collection — see
    /// EscrowFactory.withdrawFees for why a push could brick fee collection
    /// for everyone if the recipient can't receive ETH.
    function withdrawFees() external {
        if (msg.sender != factory.owner()) revert NotAdmin(msg.sender);
        uint256 amount = address(this).balance;
        (bool ok,) = factory.feeRecipient().call{value: amount}("");
        if (!ok) revert FeeTransferFailed();
        emit FeesWithdrawn(factory.feeRecipient(), amount);
    }

    /// @notice Buys `quantity` of a listing's remaining supply: opens a new
    /// escrow trade sized to exactly that quantity, with the caller as
    /// buyer. The caller must still call `fund()` (and the seller
    /// `depositBond()`) on the returned vault — purchasing does not move
    /// `token` funds, only the vault-creation fee. The listing stays `Active`
    /// (purchasable again, by anyone) as long as quantity remains; it flips to
    /// `Sold` only once this purchase exhausts it exactly. Requires exactly
    /// `factory.vaultCreationFee()` wei as `msg.value` — this contract is only
    /// a pass-through, forwarded straight to `EscrowFactory.createTradeFor`,
    /// which is what actually enforces the amount.
    function purchase(uint256 listingId, uint256 quantity) external payable returns (address vault) {
        Listing storage listing = _mustGet(listingId);
        if (listing.status != ListingStatus.Active) revert ListingNotActive(listingId, listing.status);
        _mustBeUnexpired(listing, listingId);
        if (quantity == 0 || quantity > listing.remainingQuantity) {
            revert InvalidQuantity(quantity, listing.remainingQuantity);
        }

        listing.remainingQuantity -= quantity;
        bool soldOut = listing.remainingQuantity == 0;
        if (soldOut) {
            listing.status = ListingStatus.Sold;
        }

        (uint256[] memory milestoneAmounts, uint256 bondAmount, uint256 totalAmount) = _computeAmounts(listing, quantity);

        vault = factory.createTradeFor{value: msg.value}(
            msg.sender,
            listing.seller,
            listing.arbiter,
            listing.token,
            bondAmount,
            milestoneAmounts,
            listing.fundingWindow,
            listing.milestoneConfirmWindow,
            listing.deliveryWindow
        );
        listingVaults[listingId].push(vault);

        emit ListingPurchased(listingId, msg.sender, vault, quantity, totalAmount);
        if (soldOut) emit ListingSoldOut(listingId);
    }

    /// @notice Exactly what `purchase(listingId, quantity)` would charge and
    /// escrow right now, without changing any state — lets the frontend show
    /// a buyer the real numbers (milestone amounts, bond, total) before they
    /// commit, guaranteed to match since both call the same private helper.
    function previewPurchase(uint256 listingId, uint256 quantity)
        external
        view
        returns (uint256[] memory milestoneAmounts, uint256 bondAmount, uint256 totalAmount)
    {
        Listing storage listing = _mustGet(listingId);
        if (quantity == 0 || quantity > listing.remainingQuantity) {
            revert InvalidQuantity(quantity, listing.remainingQuantity);
        }
        _mustBeUnexpired(listing, listingId);
        return _computeAmounts(listing, quantity);
    }

    function listingCount() external view returns (uint256) {
        return _listings.length;
    }

    function listingVaultCount(uint256 listingId) external view returns (uint256) {
        return listingVaults[listingId].length;
    }

    /// @notice Scalar listing fields. `milestoneBps` is omitted (Solidity
    /// can't include a dynamic array in an auto-generated struct getter) —
    /// use `listingMilestoneBps` for that. Pricing/quantity and the deadline
    /// windows are omitted too — packing everything into one return list
    /// hits solc's "stack too deep" limit on this struct — use
    /// `listingPricing`/`listingWindows` for those.
    function listings(uint256 listingId)
        external
        view
        returns (address seller, address arbiter, IERC20 token, string memory metadataURI, ListingStatus status)
    {
        Listing storage listing = _mustGet(listingId);
        return (listing.seller, listing.arbiter, listing.token, listing.metadataURI, listing.status);
    }

    /// @notice Quantity and pricing fields. Split out from `listings` — see
    /// its doc comment for why.
    function listingPricing(uint256 listingId)
        external
        view
        returns (uint256 totalQuantity, uint256 remainingQuantity, uint256 unitPrice, uint256 bondRatePerUnit)
    {
        Listing storage listing = _mustGet(listingId);
        return (listing.totalQuantity, listing.remainingQuantity, listing.unitPrice, listing.bondRatePerUnit);
    }

    /// @notice The deadline windows forwarded to the escrow vault a purchase
    /// of this listing creates. Split out from `listings` — see its doc
    /// comment for why.
    function listingWindows(uint256 listingId)
        external
        view
        returns (uint256 fundingWindow, uint256 milestoneConfirmWindow, uint256 deliveryWindow)
    {
        Listing storage listing = _mustGet(listingId);
        return (listing.fundingWindow, listing.milestoneConfirmWindow, listing.deliveryWindow);
    }

    /// @notice When this listing's current validity window ends. Purchasing
    /// reverts past it until the seller renews. Split out from `listings` —
    /// see its doc comment for why.
    function listingExpiry(uint256 listingId) external view returns (uint256 expiresAt) {
        return _mustGet(listingId).expiresAt;
    }

    function listingMilestoneBps(uint256 listingId) external view returns (uint16[] memory) {
        return _mustGet(listingId).milestoneBps;
    }

    /// @notice Splits `quantity`'s total by the listing's `milestoneBps`.
    /// Every milestone except the last is `totalAmount * bps / BPS_DENOMINATOR`
    /// (floor division); the last absorbs whatever's left over, so the sum
    /// always equals `totalAmount` exactly — no rounding dust goes missing.
    /// Pure math given an already-validated quantity — both callers
    /// (`purchase`, `previewPurchase`) check `quantity` against
    /// `remainingQuantity` themselves before calling this, since `purchase`
    /// needs to do that check *before* it decrements `remainingQuantity`.
    function _computeAmounts(Listing storage listing, uint256 quantity)
        private
        view
        returns (uint256[] memory milestoneAmounts, uint256 bondAmount, uint256 totalAmount)
    {
        totalAmount = (quantity * listing.unitPrice) / QUANTITY_SCALE;
        bondAmount = (quantity * listing.bondRatePerUnit) / QUANTITY_SCALE;

        uint16[] storage bps = listing.milestoneBps;
        milestoneAmounts = new uint256[](bps.length);
        uint256 allocated;
        for (uint256 i = 0; i + 1 < bps.length; i++) {
            milestoneAmounts[i] = (totalAmount * bps[i]) / BPS_DENOMINATOR;
            allocated += milestoneAmounts[i];
        }
        milestoneAmounts[bps.length - 1] = totalAmount - allocated;
    }

    function _mustGet(uint256 listingId) private view returns (Listing storage) {
        if (listingId >= _listings.length) revert InvalidListingId(listingId);
        return _listings[listingId];
    }

    /// @notice Expiry is a time gate on top of the status enum, not a status
    /// of its own (an expired listing is still `Active` — it just can't be
    /// purchased until renewed, and renewing reactivates it). Checked in
    /// `purchase`/`previewPurchase`; seller-side management functions
    /// (cancel/renew/reprice/restock) deliberately don't check it.
    function _mustBeUnexpired(Listing storage listing, uint256 listingId) private view {
        if (block.timestamp > listing.expiresAt) {
            revert ListingExpired(listingId, listing.expiresAt);
        }
    }
}
