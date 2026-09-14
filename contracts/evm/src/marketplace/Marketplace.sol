// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {EscrowFactory} from "../escrow/EscrowFactory.sol";

/// @title Marketplace
/// @notice Plain Solidity — no DON involvement. Sellers list a fixed milestone
/// structure and price; a buyer's `purchase()` call closes the listing and opens
/// an escrow trade via `EscrowFactory.createTradeFor`, with the buyer (not this
/// contract) as the trade's real buyer. Listings are for unique items/services:
/// once purchased, a listing cannot be purchased again.
contract Marketplace {
    enum ListingStatus {
        Active,
        Cancelled,
        Sold
    }

    struct Listing {
        address seller;
        address arbiter;
        IERC20 token;
        uint256 bondAmount;
        uint256[] milestoneAmounts;
        string metadataURI; // off-chain listing content (e.g. an IPFS URI)
        ListingStatus status;
        address vault; // set once purchased
    }

    EscrowFactory public immutable factory;

    Listing[] private _listings;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        address token,
        uint256 bondAmount,
        uint256 totalAmount,
        string metadataURI
    );
    event ListingCancelled(uint256 indexed listingId);
    event ListingPurchased(uint256 indexed listingId, address indexed buyer, address indexed vault);

    error NotSeller(address caller);
    error InvalidListingId(uint256 listingId);
    error ListingNotActive(uint256 listingId, ListingStatus actual);
    error NoMilestones();
    error ZeroAddress();

    constructor(EscrowFactory _factory) {
        if (address(_factory) == address(0)) revert ZeroAddress();
        factory = _factory;
    }

    /// @notice Lists an item/service for sale. `arbiter` and `milestoneAmounts`
    /// are forwarded as-is to the escrow vault a purchase creates.
    function createListing(
        IERC20 token,
        uint256 bondAmount,
        uint256[] calldata milestoneAmounts,
        address arbiter,
        string calldata metadataURI
    ) external returns (uint256 listingId) {
        if (milestoneAmounts.length == 0) revert NoMilestones();
        if (address(token) == address(0) || arbiter == address(0)) revert ZeroAddress();

        listingId = _listings.length;
        _listings.push();
        Listing storage listing = _listings[listingId];
        listing.seller = msg.sender;
        listing.arbiter = arbiter;
        listing.token = token;
        listing.bondAmount = bondAmount;
        listing.milestoneAmounts = milestoneAmounts;
        listing.metadataURI = metadataURI;
        listing.status = ListingStatus.Active;

        emit ListingCreated(listingId, msg.sender, address(token), bondAmount, _sum(milestoneAmounts), metadataURI);
    }

    function cancelListing(uint256 listingId) external {
        Listing storage listing = _mustGet(listingId);
        if (msg.sender != listing.seller) revert NotSeller(msg.sender);
        if (listing.status != ListingStatus.Active) revert ListingNotActive(listingId, listing.status);

        listing.status = ListingStatus.Cancelled;
        emit ListingCancelled(listingId);
    }

    /// @notice Buys a listing: closes it and opens an escrow trade with the
    /// caller as buyer. The caller must still call `fund()` (and the seller
    /// `depositBond()`) on the returned vault — purchasing does not move funds.
    function purchase(uint256 listingId) external returns (address vault) {
        Listing storage listing = _mustGet(listingId);
        if (listing.status != ListingStatus.Active) revert ListingNotActive(listingId, listing.status);

        listing.status = ListingStatus.Sold;

        vault = factory.createTradeFor(
            msg.sender, listing.seller, listing.arbiter, listing.token, listing.bondAmount, listing.milestoneAmounts
        );
        listing.vault = vault;

        emit ListingPurchased(listingId, msg.sender, vault);
    }

    function listingCount() external view returns (uint256) {
        return _listings.length;
    }

    /// @notice Scalar listing fields. `milestoneAmounts` is omitted (Solidity
    /// can't include a dynamic array in an auto-generated struct getter) — use
    /// `listingMilestones` for that.
    function listings(uint256 listingId)
        external
        view
        returns (
            address seller,
            address arbiter,
            IERC20 token,
            uint256 bondAmount,
            string memory metadataURI,
            ListingStatus status,
            address vault
        )
    {
        Listing storage listing = _mustGet(listingId);
        return (
            listing.seller,
            listing.arbiter,
            listing.token,
            listing.bondAmount,
            listing.metadataURI,
            listing.status,
            listing.vault
        );
    }

    function listingMilestones(uint256 listingId) external view returns (uint256[] memory) {
        return _mustGet(listingId).milestoneAmounts;
    }

    function listingTotalAmount(uint256 listingId) external view returns (uint256) {
        return _sum(_mustGet(listingId).milestoneAmounts);
    }

    function _mustGet(uint256 listingId) private view returns (Listing storage) {
        if (listingId >= _listings.length) revert InvalidListingId(listingId);
        return _listings[listingId];
    }

    function _sum(uint256[] memory amounts) private pure returns (uint256 total) {
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
    }
}
