// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Marketplace} from "../../src/marketplace/Marketplace.sol";
import {EscrowFactory} from "../../src/escrow/EscrowFactory.sol";
import {EscrowVault} from "../../src/escrow/EscrowVault.sol";
import {EscrowConfirmationConsumer} from "../../src/escrow/EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../../src/compliance/ComplianceConsumer.sol";
import {ArbitratorRegistry} from "../../src/escrow/ArbitratorRegistry.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract MarketplaceTest is Test {
    /// @dev Matches Marketplace.QUANTITY_SCALE — "1 whole unit" of quantity.
    uint256 constant Q = 1e18;

    address forwarder = makeAddr("forwarder");
    address seller = makeAddr("seller");
    address arbiter = makeAddr("arbiter");
    address buyer = makeAddr("buyer");
    address defaultArbiter = makeAddr("defaultArbiter");
    address feeRecipient = makeAddr("feeRecipient");

    EscrowFactory factory;
    ArbitratorRegistry registry;
    Marketplace marketplace;
    MockERC20 token;

    function setUp() public {
        EscrowConfirmationConsumer confirmationConsumer = new EscrowConfirmationConsumer(forwarder);
        ComplianceConsumer complianceConsumer = new ComplianceConsumer(forwarder, 180 days);
        registry = new ArbitratorRegistry(address(this));
        registry.accredit(arbiter);
        factory = new EscrowFactory(
            confirmationConsumer, complianceConsumer, 999, 10_000, registry, defaultArbiter, address(this), feeRecipient, 0
        );
        marketplace = new Marketplace(factory);
        token = new MockERC20(6);
    }

    // ─── Helpers ──────────────────────────────────────────────

    function _singleBps() internal pure returns (uint16[] memory bps) {
        bps = new uint16[](1);
        bps[0] = 10_000;
    }

    function _bps(uint16 a, uint16 b) internal pure returns (uint16[] memory bps) {
        bps = new uint16[](2);
        bps[0] = a;
        bps[1] = b;
    }

    function _bps3(uint16 a, uint16 b, uint16 c) internal pure returns (uint16[] memory bps) {
        bps = new uint16[](3);
        bps[0] = a;
        bps[1] = b;
        bps[2] = c;
    }

    function _createListing(uint16[] memory bps, uint256 totalQuantity, uint256 unitPrice, uint256 bondRatePerUnit)
        internal
        returns (uint256 listingId)
    {
        listingId = _createListingFull(bps, totalQuantity, unitPrice, bondRatePerUnit, 0, 0, 0);
    }

    function _createListingFull(
        uint16[] memory bps,
        uint256 totalQuantity,
        uint256 unitPrice,
        uint256 bondRatePerUnit,
        uint256 fundingWindow,
        uint256 milestoneConfirmWindow,
        uint256 deliveryWindow
    ) internal returns (uint256 listingId) {
        vm.prank(seller);
        listingId = marketplace.createListing(
            IERC20(address(token)),
            bps,
            arbiter,
            "ipfs://listing",
            totalQuantity,
            unitPrice,
            bondRatePerUnit,
            fundingWindow,
            milestoneConfirmWindow,
            deliveryWindow
        );
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroFactory() public {
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        new Marketplace(EscrowFactory(address(0)));
    }

    // ─── createListing ────────────────────────────────────────

    function test_CreateListing_StoresFieldsAndEmits() public {
        uint16[] memory bps = _bps(4000, 6000);
        uint256 totalQuantity = 5000 * Q;
        uint256 unitPrice = 2e6;

        vm.expectEmit(true, true, false, true, address(marketplace));
        emit Marketplace.ListingCreated(0, seller, address(token), totalQuantity, unitPrice, "ipfs://listing");

        vm.prank(seller);
        uint256 listingId = marketplace.createListing(
            IERC20(address(token)), bps, arbiter, "ipfs://listing", totalQuantity, unitPrice, 0, 0, 0, 0
        );

        assertEq(listingId, 0);
        (address storedSeller, address storedArbiter, IERC20 storedToken, string memory storedURI, Marketplace.ListingStatus status)
        = marketplace.listings(listingId);

        assertEq(storedSeller, seller);
        assertEq(storedArbiter, arbiter);
        assertEq(address(storedToken), address(token));
        assertEq(storedURI, "ipfs://listing");
        assertEq(uint8(status), uint8(Marketplace.ListingStatus.Active));

        (uint256 storedTotalQuantity, uint256 remainingQuantity, uint256 storedUnitPrice, uint256 bondRate) =
            marketplace.listingPricing(listingId);
        assertEq(storedTotalQuantity, totalQuantity);
        assertEq(remainingQuantity, totalQuantity);
        assertEq(storedUnitPrice, unitPrice);
        assertEq(bondRate, 0);

        assertEq(marketplace.listingMilestoneBps(listingId).length, 2);
        assertEq(marketplace.listingCount(), 1);
    }

    function test_CreateListing_RevertsOnEmptyMilestones() public {
        uint16[] memory empty = new uint16[](0);
        vm.expectRevert(Marketplace.NoMilestones.selector);
        marketplace.createListing(IERC20(address(token)), empty, arbiter, "ipfs://listing", Q, 1e6, 0, 0, 0, 0);
    }

    function test_CreateListing_RevertsOnZeroQuantity() public {
        vm.expectRevert(abi.encodeWithSelector(Marketplace.InvalidQuantity.selector, 0, 0));
        marketplace.createListing(IERC20(address(token)), _singleBps(), arbiter, "ipfs://listing", 0, 1e6, 0, 0, 0, 0);
    }

    function test_CreateListing_RevertsIfBpsDoesNotSumTo10000() public {
        uint16[] memory bad = _bps(4000, 5000); // sums to 9000
        vm.expectRevert(abi.encodeWithSelector(Marketplace.InvalidBps.selector, 9000));
        marketplace.createListing(IERC20(address(token)), bad, arbiter, "ipfs://listing", Q, 1e6, 0, 0, 0, 0);
    }

    /// @dev A zero arbiter is valid at listing time — it resolves to
    /// EscrowFactory's default arbiter once purchased, not "no arbiter."
    function test_CreateListing_AllowsZeroArbiter() public {
        vm.prank(seller);
        uint256 listingId = marketplace.createListing(
            IERC20(address(token)), _singleBps(), address(0), "ipfs://listing", Q, 1e6, 0, 0, 0, 0
        );

        vm.prank(buyer);
        address vault = marketplace.purchase(listingId, Q);
        assertEq(EscrowVault(vault).arbiter(), defaultArbiter);
    }

    function test_CreateListing_RevertsOnZeroToken() public {
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        marketplace.createListing(IERC20(address(0)), _singleBps(), arbiter, "ipfs://listing", Q, 1e6, 0, 0, 0, 0);
    }

    function test_CreateListing_IncrementsListingIdsIndependently() public {
        uint256 id0 = _createListing(_singleBps(), Q, 1e6, 0);
        uint256 id1 = _createListing(_singleBps(), 2 * Q, 1e6, 0);
        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(marketplace.listingCount(), 2);
    }

    // ─── cancelListing ────────────────────────────────────────

    function test_CancelListing_RevertsIfNotSeller() public {
        uint256 listingId = _createListing(_singleBps(), Q, 1e6, 0);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotSeller.selector, buyer));
        vm.prank(buyer);
        marketplace.cancelListing(listingId);
    }

    function test_CancelListing_SetsCancelled() public {
        uint256 listingId = _createListing(_singleBps(), Q, 1e6, 0);

        vm.prank(seller);
        marketplace.cancelListing(listingId);

        (,,,, Marketplace.ListingStatus status) = marketplace.listings(listingId);
        assertEq(uint8(status), uint8(Marketplace.ListingStatus.Cancelled));
    }

    function test_CancelListing_RevertsIfNotActive() public {
        uint256 listingId = _createListing(_singleBps(), Q, 1e6, 0);
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
        uint16[] memory bps = _bps(4000, 6000);
        uint256 listingId = _createListing(bps, 100 * Q, 3e6, 5e5);

        vm.prank(buyer);
        address vault = marketplace.purchase(listingId, 100 * Q);

        assertEq(EscrowVault(vault).buyer(), buyer, "the actual purchaser, not the marketplace, must be the vault's buyer");
        assertEq(EscrowVault(vault).seller(), seller);
        assertEq(EscrowVault(vault).arbiter(), arbiter);
        assertEq(EscrowVault(vault).bondAmount(), 100 * 5e5);
        assertEq(EscrowVault(vault).totalAmount(), 100 * 3e6);
    }

    function test_Purchase_ThreadsDeadlineWindowsIntoVault() public {
        uint256 listingId = _createListingFull(_singleBps(), 100 * Q, 1e6, 0, 1 days, 2 days, 3 days);

        vm.prank(buyer);
        address vault = marketplace.purchase(listingId, 100 * Q);

        assertEq(EscrowVault(vault).fundingDeadline(), block.timestamp + 1 days);
        assertEq(EscrowVault(vault).milestoneConfirmWindow(), 2 days);
        assertEq(EscrowVault(vault).deliveryWindow(), 3 days);
    }

    function test_Purchase_FullQuantity_MarksSoldAndRecordsVault() public {
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);

        vm.prank(buyer);
        address vault = marketplace.purchase(listingId, 100 * Q);

        (,,,, Marketplace.ListingStatus status) = marketplace.listings(listingId);
        assertEq(uint8(status), uint8(Marketplace.ListingStatus.Sold));
        assertEq(marketplace.listingVaultCount(listingId), 1);
        assertEq(marketplace.listingVaults(listingId, 0), vault);
    }

    /// @dev The actual point of this feature: buying part of a listing's
    /// supply decrements it and leaves the listing purchasable, instead of
    /// closing it the way a full purchase does.
    function test_Purchase_PartialQuantity_DecrementsAndStaysActive() public {
        uint256 listingId = _createListing(_singleBps(), 5000 * Q, 1e6, 0);

        vm.prank(buyer);
        marketplace.purchase(listingId, 100 * Q);

        (,,,, Marketplace.ListingStatus status) = marketplace.listings(listingId);
        assertEq(uint8(status), uint8(Marketplace.ListingStatus.Active));

        (uint256 totalQuantity, uint256 remainingQuantity,,) = marketplace.listingPricing(listingId);
        assertEq(totalQuantity, 5000 * Q);
        assertEq(remainingQuantity, 4900 * Q);
    }

    function test_Purchase_ExactRemaining_FlipsToSold() public {
        uint256 listingId = _createListing(_singleBps(), 5000 * Q, 1e6, 0);
        vm.prank(buyer);
        marketplace.purchase(listingId, 3000 * Q);

        vm.prank(makeAddr("buyer2"));
        marketplace.purchase(listingId, 2000 * Q); // exact remainder

        (,,,, Marketplace.ListingStatus status) = marketplace.listings(listingId);
        assertEq(uint8(status), uint8(Marketplace.ListingStatus.Sold));
        (, uint256 remainingQuantity,,) = marketplace.listingPricing(listingId);
        assertEq(remainingQuantity, 0);
    }

    function test_Purchase_EmitsListingSoldOutWhenExhausted() public {
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        vm.expectEmit(true, false, false, false, address(marketplace));
        emit Marketplace.ListingSoldOut(listingId);
        vm.prank(buyer);
        marketplace.purchase(listingId, 100 * Q);
    }

    function test_Purchase_RevertsOnZeroQuantity() public {
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.InvalidQuantity.selector, 0, 100 * Q));
        marketplace.purchase(listingId, 0);
    }

    function test_Purchase_RevertsOnQuantityExceedingRemaining() public {
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.InvalidQuantity.selector, 101 * Q, 100 * Q));
        marketplace.purchase(listingId, 101 * Q);
    }

    function test_Purchase_BondScalesWithQuantity() public {
        uint256 listingId = _createListing(_singleBps(), 1000 * Q, 2e6, 1e5);
        vm.prank(buyer);
        address vault = marketplace.purchase(listingId, 250 * Q);
        assertEq(EscrowVault(vault).bondAmount(), 250 * 1e5);
    }

    /// @dev bps [3333, 3333, 3334] against a total that isn't evenly
    /// divisible by three — the last milestone must absorb whatever floor
    /// division on the first two left over, so nothing goes missing.
    function test_Purchase_RemainderGoesToLastMilestone_NoRoundingDust() public {
        uint16[] memory bps = _bps3(3333, 3333, 3334);
        uint256 listingId = _createListing(bps, 100 * Q, 1e6, 0);

        vm.prank(buyer);
        address vault = marketplace.purchase(listingId, 7 * Q); // totalAmount = 7e6

        uint256 sum;
        for (uint256 i = 0; i < 3; i++) {
            (uint256 amount,,,) = EscrowVault(vault).milestones(i);
            sum += amount;
        }
        assertEq(sum, 7e6, "milestone amounts must sum exactly to the total, no rounding dust");
    }

    function test_Purchase_MultipleBuyersTrackedInListingVaults() public {
        uint256 listingId = _createListing(_singleBps(), 1000 * Q, 1e6, 0);
        address buyer2 = makeAddr("buyer2");

        vm.prank(buyer);
        address vault1 = marketplace.purchase(listingId, 100 * Q);
        vm.prank(buyer2);
        address vault2 = marketplace.purchase(listingId, 200 * Q);

        assertEq(marketplace.listingVaultCount(listingId), 2);
        assertEq(marketplace.listingVaults(listingId, 0), vault1);
        assertEq(marketplace.listingVaults(listingId, 1), vault2);
        assertTrue(vault1 != vault2);
        assertEq(EscrowVault(vault1).buyer(), buyer);
        assertEq(EscrowVault(vault2).buyer(), buyer2);
    }

    function test_Purchase_EmitsListingPurchased() public {
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);

        vm.prank(buyer);
        vm.expectEmit(true, true, false, false, address(marketplace));
        emit Marketplace.ListingPurchased(listingId, buyer, address(0), 0, 0);
        marketplace.purchase(listingId, 100 * Q);
    }

    function test_Purchase_RevertsIfAlreadySold() public {
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        vm.prank(buyer);
        marketplace.purchase(listingId, 100 * Q);

        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId, Marketplace.ListingStatus.Sold)
        );
        vm.prank(makeAddr("anotherBuyer"));
        marketplace.purchase(listingId, Q);
    }

    function test_Purchase_RevertsIfCancelled() public {
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        vm.prank(seller);
        marketplace.cancelListing(listingId);

        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId, Marketplace.ListingStatus.Cancelled)
        );
        vm.prank(buyer);
        marketplace.purchase(listingId, 100 * Q);
    }

    function test_Purchase_TwoListingsProduceIndependentVaults() public {
        uint256 listingId0 = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        uint256 listingId1 = _createListing(_singleBps(), 200 * Q, 1e6, 0);

        vm.prank(buyer);
        address vault0 = marketplace.purchase(listingId0, 100 * Q);
        vm.prank(buyer);
        address vault1 = marketplace.purchase(listingId1, 200 * Q);

        assertTrue(vault0 != vault1);
        assertEq(factory.vaultCount(), 2);
    }

    // ─── previewPurchase ────────────────────────────────────────

    function test_PreviewPurchase_MatchesActualPurchaseAmounts() public {
        uint16[] memory bps = _bps3(3333, 3333, 3334);
        uint256 listingId = _createListing(bps, 1000 * Q, 2_500_000, 100_000);

        (uint256[] memory previewAmounts, uint256 previewBond, uint256 previewTotal) =
            marketplace.previewPurchase(listingId, 37 * Q);

        vm.prank(buyer);
        address vault = marketplace.purchase(listingId, 37 * Q);

        assertEq(EscrowVault(vault).totalAmount(), previewTotal);
        assertEq(EscrowVault(vault).bondAmount(), previewBond);
        for (uint256 i = 0; i < previewAmounts.length; i++) {
            (uint256 amount,,,) = EscrowVault(vault).milestones(i);
            assertEq(amount, previewAmounts[i]);
        }
    }

    function test_PreviewPurchase_RevertsOnQuantityExceedingRemaining() public {
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.InvalidQuantity.selector, 101 * Q, 100 * Q));
        marketplace.previewPurchase(listingId, 101 * Q);
    }

    function test_PreviewPurchase_RevertsOnZeroQuantity() public {
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.InvalidQuantity.selector, 0, 100 * Q));
        marketplace.previewPurchase(listingId, 0);
    }

    // ─── Vault creation fee pass-through ───────────────────────

    function test_Purchase_ForwardsExactFeeToFactory() public {
        factory.setVaultCreationFee(0.01 ether);
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        vm.deal(buyer, 1 ether);

        vm.prank(buyer);
        address vault = marketplace.purchase{value: 0.01 ether}(listingId, 100 * Q);

        assertTrue(vault != address(0));
        assertEq(address(factory).balance, 0.01 ether);
    }

    function test_Purchase_RevertsIfValueDoesNotMatchFactoryFee() public {
        factory.setVaultCreationFee(0.01 ether);
        uint256 listingId = _createListing(_singleBps(), 100 * Q, 1e6, 0);
        vm.deal(buyer, 1 ether);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.IncorrectFeeAmount.selector, 0, 0.01 ether));
        marketplace.purchase(listingId, 100 * Q);
    }
}
