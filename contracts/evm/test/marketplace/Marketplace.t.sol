// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Marketplace} from "../../src/marketplace/Marketplace.sol";
import {EscrowFactory} from "../../src/escrow/EscrowFactory.sol";
import {EscrowVault} from "../../src/escrow/EscrowVault.sol";
import {EscrowConfirmationConsumer} from "../../src/escrow/EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../../src/compliance/ComplianceConsumer.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract MarketplaceTest is Test {
    address forwarder = makeAddr("forwarder");
    address seller = makeAddr("seller");
    address arbiter = makeAddr("arbiter");
    address buyer = makeAddr("buyer");

    EscrowFactory factory;
    Marketplace marketplace;
    MockERC20 token;

    function setUp() public {
        EscrowConfirmationConsumer confirmationConsumer = new EscrowConfirmationConsumer(forwarder);
        ComplianceConsumer complianceConsumer = new ComplianceConsumer(forwarder);
        factory = new EscrowFactory(confirmationConsumer, complianceConsumer);
        marketplace = new Marketplace(factory);
        token = new MockERC20(6);
    }

    function _amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = a;
        amounts[1] = b;
    }

    function _createListing(uint256[] memory amounts, uint256 bondAmount) internal returns (uint256 listingId) {
        vm.prank(seller);
        listingId = marketplace.createListing(IERC20(address(token)), bondAmount, amounts, arbiter, "ipfs://listing");
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroFactory() public {
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        new Marketplace(EscrowFactory(address(0)));
    }

    // ─── createListing ────────────────────────────────────────

    function test_CreateListing_StoresFieldsAndEmits() public {
        uint256[] memory amounts = _amounts(100e6, 200e6);

        vm.expectEmit(true, true, false, true, address(marketplace));
        emit Marketplace.ListingCreated(0, seller, address(token), 50e6, 300e6, "ipfs://listing");

        vm.prank(seller);
        uint256 listingId = marketplace.createListing(IERC20(address(token)), 50e6, amounts, arbiter, "ipfs://listing");

        assertEq(listingId, 0);
        (
            address storedSeller,
            address storedArbiter,
            IERC20 storedToken,
            uint256 storedBond,
            string memory storedURI,
            Marketplace.ListingStatus status,
            address vault
        ) = marketplace.listings(listingId);

        assertEq(storedSeller, seller);
        assertEq(storedArbiter, arbiter);
        assertEq(address(storedToken), address(token));
        assertEq(storedBond, 50e6);
        assertEq(storedURI, "ipfs://listing");
        assertEq(uint8(status), uint8(Marketplace.ListingStatus.Active));
        assertEq(vault, address(0));

        assertEq(marketplace.listingMilestones(listingId), amounts);
        assertEq(marketplace.listingTotalAmount(listingId), 300e6);
        assertEq(marketplace.listingCount(), 1);
    }

    function test_CreateListing_RevertsOnEmptyMilestones() public {
        uint256[] memory empty = new uint256[](0);
        vm.expectRevert(Marketplace.NoMilestones.selector);
        marketplace.createListing(IERC20(address(token)), 0, empty, arbiter, "ipfs://listing");
    }

    function test_CreateListing_RevertsOnZeroArbiter() public {
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        marketplace.createListing(IERC20(address(token)), 0, _amounts(1, 1), address(0), "ipfs://listing");
    }

    function test_CreateListing_RevertsOnZeroToken() public {
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        marketplace.createListing(IERC20(address(0)), 0, _amounts(1, 1), arbiter, "ipfs://listing");
    }

    function test_CreateListing_IncrementsListingIdsIndependently() public {
        uint256 id0 = _createListing(_amounts(1, 1), 0);
        uint256 id1 = _createListing(_amounts(2, 2), 0);
        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(marketplace.listingCount(), 2);
    }

    // ─── cancelListing ────────────────────────────────────────

    function test_CancelListing_RevertsIfNotSeller() public {
        uint256 listingId = _createListing(_amounts(1, 1), 0);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotSeller.selector, buyer));
        vm.prank(buyer);
        marketplace.cancelListing(listingId);
    }

    function test_CancelListing_SetsCancelled() public {
        uint256 listingId = _createListing(_amounts(1, 1), 0);

        vm.prank(seller);
        marketplace.cancelListing(listingId);

        (,,,,, Marketplace.ListingStatus status,) = marketplace.listings(listingId);
        assertEq(uint8(status), uint8(Marketplace.ListingStatus.Cancelled));
    }

    function test_CancelListing_RevertsIfNotActive() public {
        uint256 listingId = _createListing(_amounts(1, 1), 0);
        vm.startPrank(seller);
        marketplace.cancelListing(listingId);

        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId, Marketplace.ListingStatus.Cancelled)
        );
        marketplace.cancelListing(listingId);
        vm.stopPrank();
    }

    function test_CancelListing_RevertsOnInvalidListingId() public {
        vm.expectRevert(abi.encodeWithSelector(Marketplace.InvalidListingId.selector, 0));
        marketplace.cancelListing(0);
    }

    // ─── purchase ─────────────────────────────────────────────

    function test_Purchase_CreatesVaultWithBuyerAsRealBuyer() public {
        uint256 listingId = _createListing(_amounts(100e6, 200e6), 50e6);

        vm.prank(buyer);
        address vault = marketplace.purchase(listingId);

        assertEq(EscrowVault(vault).buyer(), buyer, "the actual purchaser, not the marketplace, must be the vault's buyer");
        assertEq(EscrowVault(vault).seller(), seller);
        assertEq(EscrowVault(vault).arbiter(), arbiter);
        assertEq(EscrowVault(vault).bondAmount(), 50e6);
        assertEq(EscrowVault(vault).totalAmount(), 300e6);
    }

    function test_Purchase_MarksListingSoldAndRecordsVault() public {
        uint256 listingId = _createListing(_amounts(100e6, 0), 0);

        vm.prank(buyer);
        address vault = marketplace.purchase(listingId);

        (,,,,, Marketplace.ListingStatus status, address recordedVault) = marketplace.listings(listingId);
        assertEq(uint8(status), uint8(Marketplace.ListingStatus.Sold));
        assertEq(recordedVault, vault);
    }

    function test_Purchase_EmitsListingPurchased() public {
        uint256 listingId = _createListing(_amounts(100e6, 0), 0);

        vm.prank(buyer);
        vm.expectEmit(true, true, false, false, address(marketplace));
        emit Marketplace.ListingPurchased(listingId, buyer, address(0));
        marketplace.purchase(listingId);
    }

    function test_Purchase_RevertsIfAlreadySold() public {
        uint256 listingId = _createListing(_amounts(100e6, 0), 0);
        vm.prank(buyer);
        marketplace.purchase(listingId);

        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId, Marketplace.ListingStatus.Sold)
        );
        vm.prank(makeAddr("anotherBuyer"));
        marketplace.purchase(listingId);
    }

    function test_Purchase_RevertsIfCancelled() public {
        uint256 listingId = _createListing(_amounts(100e6, 0), 0);
        vm.prank(seller);
        marketplace.cancelListing(listingId);

        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId, Marketplace.ListingStatus.Cancelled)
        );
        vm.prank(buyer);
        marketplace.purchase(listingId);
    }

    function test_Purchase_TwoListingsProduceIndependentVaults() public {
        uint256 listingId0 = _createListing(_amounts(100e6, 0), 0);
        uint256 listingId1 = _createListing(_amounts(200e6, 0), 0);

        vm.prank(buyer);
        address vault0 = marketplace.purchase(listingId0);
        vm.prank(buyer);
        address vault1 = marketplace.purchase(listingId1);

        assertTrue(vault0 != vault1);
        assertEq(factory.vaultCount(), 2);
    }
}
