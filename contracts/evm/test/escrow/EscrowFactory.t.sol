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
        complianceConsumer = new ComplianceConsumer(forwarder);
        factory = new EscrowFactory(confirmationConsumer, complianceConsumer);
        token = new MockERC20(6);
    }

    function _amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = a;
        amounts[1] = b;
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroConfirmationConsumer() public {
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(EscrowConfirmationConsumer(address(0)), complianceConsumer);
    }

    function test_Constructor_RevertsOnZeroComplianceConsumer() public {
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(confirmationConsumer, ComplianceConsumer(address(0)));
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

    function test_CreateTrade_ComputesThresholdFromTokenDecimals_6() public {
        vm.prank(buyer);
        address vault = factory.createTrade(seller, arbiter, IERC20(address(token)), 0, _amounts(1, 1));
        assertEq(EscrowVault(vault).complianceThreshold(), 999 * 10 ** 6);
    }

    function test_CreateTrade_ComputesThresholdFromTokenDecimals_18() public {
        MockERC20 token18 = new MockERC20(18);
        vm.prank(buyer);
        address vault = factory.createTrade(seller, arbiter, IERC20(address(token18)), 0, _amounts(1, 1));
        assertEq(EscrowVault(vault).complianceThreshold(), 999 * 10 ** 18);
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
}
