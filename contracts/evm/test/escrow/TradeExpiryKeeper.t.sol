// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TradeExpiryKeeper} from "../../src/escrow/TradeExpiryKeeper.sol";
import {EscrowVault} from "../../src/escrow/EscrowVault.sol";
import {IEscrowFactory} from "../../src/escrow/IEscrowFactory.sol";
import {EscrowConfirmationConsumer} from "../../src/escrow/EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../../src/compliance/ComplianceConsumer.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev Stands in for EscrowFactory, same rationale as EscrowVaultTest.
contract TradeExpiryKeeperTest is Test, IEscrowFactory {
    uint256 constant TIER0_CAP = 999e6;
    uint256 constant TIER1_CAP = 10_000e6;

    address forwarder = makeAddr("forwarder");
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address arbiter = makeAddr("arbiter");

    MockERC20 token;
    EscrowConfirmationConsumer confirmationConsumer;
    ComplianceConsumer complianceConsumer;
    TradeExpiryKeeper keeper;

    function recordVolume(address, uint256 amount) external pure returns (uint256) {
        return amount;
    }

    function setUp() public {
        token = new MockERC20(6);
        confirmationConsumer = new EscrowConfirmationConsumer(forwarder);
        complianceConsumer = new ComplianceConsumer(forwarder, 180 days);
        keeper = new TradeExpiryKeeper(forwarder);
    }

    function _newVault(uint256 fundingWindow, uint256 milestoneConfirmWindow) internal returns (EscrowVault vault) {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100e6;
        vault = new EscrowVault(
            buyer,
            seller,
            arbiter,
            IERC20(address(token)),
            0,
            amounts,
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer,
            fundingWindow,
            milestoneConfirmWindow,
            0
        );
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroForwarder() public {
        vm.expectRevert(TradeExpiryKeeper.ZeroAddress.selector);
        new TradeExpiryKeeper(address(0));
    }

    // ─── onReport ─────────────────────────────────────────────

    function test_OnReport_RevertsIfNotForwarder() public {
        EscrowVault vault = _newVault(1 days, 0);
        vm.expectRevert(abi.encodeWithSelector(TradeExpiryKeeper.UnauthorizedForwarder.selector, address(this)));
        keeper.onReport("", abi.encode(address(vault), false, uint256(0)));
    }

    function test_OnReport_RelaysFundingExpiry() public {
        EscrowVault vault = _newVault(1 days, 0);
        vm.warp(block.timestamp + 1 days);

        vm.prank(forwarder);
        keeper.onReport("", abi.encode(address(vault), false, uint256(0)));

        assertTrue(vault.cancelled());
    }

    function test_OnReport_RelaysMilestoneExpiry() public {
        EscrowVault vault = _newVault(0, 1 days);
        token.mint(buyer, 100e6);
        vm.prank(buyer);
        token.approve(address(vault), 100e6);
        vm.prank(buyer);
        vault.fund();
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));

        vm.warp(block.timestamp + 1 days);

        vm.prank(forwarder);
        keeper.onReport("", abi.encode(address(vault), true, uint256(0)));

        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Released), "confirmation timeout releases to seller");
    }

    function test_OnReport_RevertsIfVaultNotYetExpired() public {
        EscrowVault vault = _newVault(1 days, 0);
        vm.prank(forwarder);
        vm.expectRevert(EscrowVault.FundingNotYetExpired.selector);
        keeper.onReport("", abi.encode(address(vault), false, uint256(0)));
    }
}
