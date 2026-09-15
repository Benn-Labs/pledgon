// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowFactory} from "../../src/escrow/EscrowFactory.sol";
import {EscrowVault} from "../../src/escrow/EscrowVault.sol";
import {EscrowConfirmationConsumer} from "../../src/escrow/EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../../src/compliance/ComplianceConsumer.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract EscrowFactoryTest is Test {
    uint256 constant TIER0_CAP_USD = 999;
    uint256 constant TIER1_CAP_USD = 10_000;
    uint256 constant MAX_VALIDITY = 180 days;

    address forwarder = makeAddr("forwarder");
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address arbiter = makeAddr("arbiter");

    EscrowConfirmationConsumer confirmationConsumer;
    ComplianceConsumer complianceConsumer;
    EscrowFactory factory;
    MockERC20 token;

    function setUp() public {
        confirmationConsumer = new EscrowConfirmationConsumer(forwarder);
        complianceConsumer = new ComplianceConsumer(forwarder, MAX_VALIDITY);
        factory = new EscrowFactory(confirmationConsumer, complianceConsumer, TIER0_CAP_USD, TIER1_CAP_USD);
        token = new MockERC20(6);
    }

    function _amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = a;
        amounts[1] = b;
    }

    function _fundAsBuyer(EscrowVault vault, uint256 amount) internal {
        token.mint(buyer, amount);
        vm.startPrank(buyer);
        token.approve(address(vault), amount);
        vault.fund();
        vm.stopPrank();
    }

    function _setTier(address subject, uint8 tier) internal {
        vm.prank(forwarder);
        complianceConsumer.onReport("", abi.encode(subject, tier, block.timestamp));
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroConfirmationConsumer() public {
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(EscrowConfirmationConsumer(address(0)), complianceConsumer, TIER0_CAP_USD, TIER1_CAP_USD);
    }

    function test_Constructor_RevertsOnZeroComplianceConsumer() public {
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(confirmationConsumer, ComplianceConsumer(address(0)), TIER0_CAP_USD, TIER1_CAP_USD);
    }

    function test_Constructor_RevertsIfTier1CapBelowTier0Cap() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.InvalidTierCaps.selector, 1000, 999));
        new EscrowFactory(confirmationConsumer, complianceConsumer, 1000, 999);
    }

    function test_Constructor_SetsSharedConsumers() public view {
        assertEq(address(factory.confirmationConsumer()), address(confirmationConsumer));
        assertEq(address(factory.complianceConsumer()), address(complianceConsumer));
    }

    // ─── createTrade ──────────────────────────────────────────

    function test_CreateTrade_DeploysVaultWithBuyerAsCaller() public {
        vm.prank(buyer);
        address vault = factory.createTrade(seller, arbiter, IERC20(address(token)), 50e6, _amounts(100e6, 200e6));

        assertEq(EscrowVault(vault).buyer(), buyer);
        assertEq(EscrowVault(vault).seller(), seller);
        assertEq(EscrowVault(vault).arbiter(), arbiter);
        assertEq(address(EscrowVault(vault).token()), address(token));
        assertEq(EscrowVault(vault).bondAmount(), 50e6);
        assertEq(EscrowVault(vault).totalAmount(), 300e6);
        assertEq(EscrowVault(vault).milestoneCount(), 2);
    }

    /// @dev The whole point of sharing one consumer pair across every vault: each
    /// deployed vault must end up pointed at the exact same singletons, not a copy.
    function test_CreateTrade_WiresSharedConsumersIntoVault() public {
        vm.prank(buyer);
        address vault = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));

        assertEq(address(EscrowVault(vault).confirmationConsumer()), address(confirmationConsumer));
        assertEq(address(EscrowVault(vault).complianceConsumer()), address(complianceConsumer));
    }

    function test_CreateTrade_WiresFactoryAsCallback() public {
        vm.prank(buyer);
        address vault = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));

        assertEq(address(EscrowVault(vault).factory()), address(factory));
    }

    function test_CreateTrade_ComputesTierCapsFromTokenDecimals_6() public {
        vm.prank(buyer);
        address vault = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(1, 1));
        assertEq(EscrowVault(vault).tier0Cap(), 999 * 10 ** 6);
        assertEq(EscrowVault(vault).tier1Cap(), 10_000 * 10 ** 6);
    }

    function test_CreateTrade_ComputesTierCapsFromTokenDecimals_18() public {
        MockERC20 token18 = new MockERC20(18);
        vm.prank(buyer);
        address vault = factory.createTrade(seller, arbiter, IERC20(address(token18)), 0, _amounts(1, 1));
        assertEq(EscrowVault(vault).tier0Cap(), 999 * 10 ** 18);
        assertEq(EscrowVault(vault).tier1Cap(), 10_000 * 10 ** 18);
    }

    function test_CreateTrade_EmitsVaultCreated() public {
        vm.prank(buyer);
        vm.expectEmit(false, true, true, true, address(factory));
        emit EscrowFactory.VaultCreated(address(0), buyer, seller, arbiter, address(token), 50e6);
        factory.createTrade(seller, arbiter, IERC20(address(token)), 50e6, _amounts(100e6, 200e6));
    }

    function test_CreateTrade_RecordsVaultInAllVaults() public {
        vm.prank(buyer);
        address vault = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));

        assertEq(factory.vaultCount(), 1);
        assertEq(factory.allVaults(0), vault);
    }

    function test_CreateTrade_MarksVaultAsVault() public {
        vm.prank(buyer);
        address vault = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));
        assertTrue(factory.isVault(vault));
        assertFalse(factory.isVault(seller));
    }

    function test_CreateTrade_TracksMultipleTradesByBuyerAndSeller() public {
        vm.startPrank(buyer);
        address vault1 = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));
        address vault2 = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(200e6, 0));
        vm.stopPrank();

        assertEq(factory.vaultCount(), 2);
        assertEq(factory.vaultsByBuyer(buyer, 0), vault1);
        assertEq(factory.vaultsByBuyer(buyer, 1), vault2);
        assertEq(factory.vaultsBySeller(seller, 0), vault1);
        assertEq(factory.vaultsBySeller(seller, 1), vault2);
        assertTrue(vault1 != vault2);
    }

    function test_CreateTrade_DifferentBuyersTrackedSeparately() public {
        address buyer2 = makeAddr("buyer2");

        vm.prank(buyer);
        factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));
        vm.prank(buyer2);
        factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(150e6, 0));

        assertEq(factory.vaultCount(), 2);
        assertEq(factory.vaultsByBuyer(buyer2, 0), factory.allVaults(1));
    }

    // ─── Revert propagation from EscrowVault's constructor ─────

    function test_CreateTrade_RevertsIfNoMilestones() public {
        uint256[] memory empty = new uint256[](0);
        vm.expectRevert(EscrowVault.NoMilestones.selector);
        factory.createTrade(seller, arbiter, IERC20(address(token)), 0, empty);
    }

    function test_CreateTrade_RevertsIfSellerIsZero() public {
        vm.expectRevert(EscrowVault.ZeroAddress.selector);
        factory.createTrade(address(0), arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));
    }

    function test_CreateTrade_RevertsIfArbiterIsZero() public {
        vm.expectRevert(EscrowVault.ZeroAddress.selector);
        factory.createTrade(seller, address(0), IERC20(address(token)), 0, _amounts(100e6, 0));
    }

    // ─── createTradeFor ─────────────────────────────────────────

    /// @dev The whole point of createTradeFor: an orchestrator (e.g. Marketplace)
    /// can be msg.sender while the vault's real buyer is whoever it names.
    function test_CreateTradeFor_SetsNamedBuyerNotCaller() public {
        address orchestrator = makeAddr("orchestrator");
        address realBuyer = makeAddr("realBuyer");

        vm.prank(orchestrator);
        address vault =
            factory.createTradeFor(realBuyer, seller, arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));

        assertEq(EscrowVault(vault).buyer(), realBuyer);
        assertNotEq(EscrowVault(vault).buyer(), orchestrator);
    }

    function test_CreateTradeFor_RecordsUnderNamedBuyer() public {
        address orchestrator = makeAddr("orchestrator");
        address realBuyer = makeAddr("realBuyer");

        vm.prank(orchestrator);
        address vault =
            factory.createTradeFor(realBuyer, seller, arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));

        assertEq(factory.vaultsByBuyer(realBuyer, 0), vault);
        assertEq(factory.vaultCount(), 1);
    }

    function test_CreateTradeFor_RevertsIfBuyerIsZero() public {
        vm.expectRevert(EscrowVault.ZeroAddress.selector);
        factory.createTradeFor(address(0), seller, arbiter, IERC20(address(token)), 0, _amounts(100e6, 0));
    }

    // ─── recordVolume ─────────────────────────────────────────

    function test_RecordVolume_RevertsIfCallerIsNotAVault() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.NotAVault.selector, address(this)));
        factory.recordVolume(buyer, 100e6);
    }

    function test_RecordVolume_AccumulatesWithinPeriod() public {
        vm.prank(buyer);
        address vault1 = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(300e6, 0));
        vm.prank(buyer);
        address vault2 = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(400e6, 0));

        _fundAsBuyer(EscrowVault(vault1), 300e6);
        assertEq(factory.currentPeriodVolume(buyer), 300e6);

        _fundAsBuyer(EscrowVault(vault2), 400e6);
        assertEq(factory.currentPeriodVolume(buyer), 700e6);
    }

    function test_RecordVolume_ResetsInNewPeriod() public {
        vm.prank(buyer);
        address vault1 = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(300e6, 0));
        _fundAsBuyer(EscrowVault(vault1), 300e6);
        assertEq(factory.currentPeriodVolume(buyer), 300e6);

        vm.warp(block.timestamp + factory.VOLUME_WINDOW() + 1);
        assertEq(factory.currentPeriodVolume(buyer), 0);
    }

    /// @dev The actual point of rolling-volume tracking: a buyer can't dodge the
    /// tier-0 cap by splitting one large purchase into several individually-small
    /// trades (structuring). Each trade below is under TIER0_CAP alone; their sum
    /// isn't.
    function test_Structuring_SecondTradeUnderIndividualCapStillRequiresCompliance() public {
        uint256 tier0Cap = TIER0_CAP_USD * 10 ** 6;
        uint256 firstAmount = 600e6; // under cap alone
        uint256 secondAmount = 600e6; // under cap alone; combined (1200e6) is over

        vm.prank(buyer);
        address vault1 = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(firstAmount, 0));
        _fundAsBuyer(EscrowVault(vault1), firstAmount);
        assertTrue(EscrowVault(vault1).funded(), "first trade alone is under the tier-0 cap");

        vm.prank(buyer);
        address vault2 = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(secondAmount, 0));
        token.mint(buyer, secondAmount);
        vm.startPrank(buyer);
        token.approve(vault2, secondAmount);
        vm.expectRevert(
            abi.encodeWithSelector(
                EscrowVault.ComplianceRequired.selector, buyer, firstAmount + secondAmount, tier0Cap
            )
        );
        EscrowVault(vault2).fund();
        vm.stopPrank();
    }

    function test_Structuring_SecondTradeSucceedsOnceTier1Verified() public {
        uint256 firstAmount = 600e6;
        uint256 secondAmount = 600e6;

        vm.prank(buyer);
        address vault1 = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(firstAmount, 0));
        _fundAsBuyer(EscrowVault(vault1), firstAmount);

        _setTier(buyer, 1);

        vm.prank(buyer);
        address vault2 = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(secondAmount, 0));
        _fundAsBuyer(EscrowVault(vault2), secondAmount);

        assertTrue(EscrowVault(vault2).funded());
        assertEq(factory.currentPeriodVolume(buyer), firstAmount + secondAmount);
    }
}
