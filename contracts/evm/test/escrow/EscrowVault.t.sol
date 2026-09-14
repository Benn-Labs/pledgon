// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/escrow/EscrowVault.sol";
import {EscrowConfirmationConsumer} from "../../src/escrow/EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../../src/compliance/ComplianceConsumer.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract EscrowVaultTest is Test {
    uint8 constant DECIMALS = 6;
    uint256 constant THRESHOLD = 999 * 10 ** DECIMALS;

    MockERC20 token;
    EscrowConfirmationConsumer confirmationConsumer;
    ComplianceConsumer complianceConsumer;

    address forwarder = makeAddr("forwarder");
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address arbiter = makeAddr("arbiter");
    address stranger = makeAddr("stranger");

    function setUp() public {
        token = new MockERC20(DECIMALS);
        confirmationConsumer = new EscrowConfirmationConsumer(forwarder);
        complianceConsumer = new ComplianceConsumer(forwarder);
    }

    // ─── Helpers ──────────────────────────────────────────────

    function _newVault(uint256[] memory amounts, uint256 bondAmount) internal returns (EscrowVault vault) {
        vault = new EscrowVault(
            buyer, seller, arbiter, IERC20(address(token)), bondAmount, amounts, THRESHOLD, confirmationConsumer, complianceConsumer
        );
    }

    function _singleMilestone(uint256 amount) internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](1);
        amounts[0] = amount;
    }

    function _mintAndApprove(address who, EscrowVault vault, uint256 amount) internal {
        token.mint(who, amount);
        vm.prank(who);
        token.approve(address(vault), amount);
    }

    function _fundedVault(uint256 milestoneAmount, uint256 bondAmount) internal returns (EscrowVault vault) {
        vault = _newVault(_singleMilestone(milestoneAmount), bondAmount);
        if (bondAmount > 0) {
            _mintAndApprove(seller, vault, bondAmount);
            vm.prank(seller);
            vault.depositBond();
        }
        _mintAndApprove(buyer, vault, milestoneAmount);
        vm.prank(buyer);
        vault.fund();
    }

    function _setCompliant(address subject, bool compliant) internal {
        vm.prank(forwarder);
        complianceConsumer.onReport("", abi.encode(subject, compliant, block.timestamp));
    }

    function _setDonConfirmed(EscrowVault vault, uint256 index) internal {
        vm.prank(forwarder);
        confirmationConsumer.onReport("", abi.encode(address(vault), index, true));
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnEmptyMilestones() public {
        uint256[] memory amounts = new uint256[](0);
        vm.expectRevert(EscrowVault.NoMilestones.selector);
        _newVault(amounts, 0);
    }

    function test_Constructor_RevertsOnZeroBuyer() public {
        vm.expectRevert(EscrowVault.ZeroAddress.selector);
        new EscrowVault(
            address(0), seller, arbiter, IERC20(address(token)), 0, _singleMilestone(100), THRESHOLD, confirmationConsumer, complianceConsumer
        );
    }

    function test_Constructor_RevertsOnZeroToken() public {
        vm.expectRevert(EscrowVault.ZeroAddress.selector);
        new EscrowVault(
            buyer, seller, arbiter, IERC20(address(0)), 0, _singleMilestone(100), THRESHOLD, confirmationConsumer, complianceConsumer
        );
    }

    function test_Constructor_SumsTotalAmount() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100;
        amounts[1] = 250;
        EscrowVault vault = _newVault(amounts, 0);
        assertEq(vault.totalAmount(), 350);
        assertEq(vault.milestoneCount(), 2);
    }

    // ─── depositBond ──────────────────────────────────────────

    function test_DepositBond_TransfersFromSellerAndSetsBalance() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 50e6);
        _mintAndApprove(seller, vault, 50e6);

        vm.prank(seller);
        vault.depositBond();

        assertEq(vault.bondBalance(), 50e6);
        assertTrue(vault.bondDeposited());
        assertEq(token.balanceOf(address(vault)), 50e6);
    }

    function test_DepositBond_RevertsIfNotSeller() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 50e6);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotSeller.selector, buyer));
        vm.prank(buyer);
        vault.depositBond();
    }

    function test_DepositBond_RevertsIfAlreadyDeposited() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 50e6);
        _mintAndApprove(seller, vault, 100e6);
        vm.prank(seller);
        vault.depositBond();

        vm.expectRevert(EscrowVault.BondAlreadyDeposited.selector);
        vm.prank(seller);
        vault.depositBond();
    }

    function test_DepositBond_ZeroBondDoesNotTransfer() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 0);
        vm.prank(seller);
        vault.depositBond();

        assertTrue(vault.bondDeposited());
        assertEq(vault.bondBalance(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    // ─── fund ─────────────────────────────────────────────────

    function test_Fund_RevertsIfBondRequiredNotDeposited() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 50e6);
        _mintAndApprove(buyer, vault, 100e6);

        vm.expectRevert(EscrowVault.BondNotDeposited.selector);
        vm.prank(buyer);
        vault.fund();
    }

    function test_Fund_RevertsIfNotBuyer() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 0);
        vm.prank(seller);
        vault.depositBond();

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotBuyer.selector, seller));
        vm.prank(seller);
        vault.fund();
    }

    function test_Fund_TransfersTotalAndSetsFunded() public {
        EscrowVault vault = _fundedVault(500e6, 0);
        assertTrue(vault.funded());
        assertEq(token.balanceOf(address(vault)), 500e6);
    }

    function test_Fund_RevertsIfAlreadyFunded() public {
        EscrowVault vault = _fundedVault(500e6, 0);
        _mintAndApprove(buyer, vault, 500e6);

        vm.expectRevert(EscrowVault.AlreadyFunded.selector);
        vm.prank(buyer);
        vault.fund();
    }

    function test_Fund_BelowThreshold_NoComplianceNeeded() public {
        // 999e6 is not > THRESHOLD (999e6), so no compliance check is triggered.
        EscrowVault vault = _fundedVault(THRESHOLD, 0);
        assertTrue(vault.funded());
    }

    function test_Fund_AboveThreshold_RevertsWithoutCompliance() public {
        EscrowVault vault = _newVault(_singleMilestone(THRESHOLD + 1), 0);
        _mintAndApprove(buyer, vault, THRESHOLD + 1);

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.ComplianceRequired.selector, buyer, THRESHOLD + 1));
        vm.prank(buyer);
        vault.fund();
    }

    function test_Fund_AboveThreshold_SucceedsWithCompliance() public {
        EscrowVault vault = _newVault(_singleMilestone(THRESHOLD + 1), 0);
        _mintAndApprove(buyer, vault, THRESHOLD + 1);
        _setCompliant(buyer, true);

        vm.prank(buyer);
        vault.fund();

        assertTrue(vault.funded());
    }

    // ─── submitMilestoneDocs ──────────────────────────────────

    function test_SubmitMilestoneDocs_RevertsIfNotSeller() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotSeller.selector, buyer));
        vm.prank(buyer);
        vault.submitMilestoneDocs(0, keccak256("docs"));
    }

    function test_SubmitMilestoneDocs_RevertsIfNotFunded() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 0);
        vm.expectRevert(EscrowVault.NotFunded.selector);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
    }

    function test_SubmitMilestoneDocs_SetsHashAndStatus() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        bytes32 docHash = keccak256("deed-transfer.pdf");

        vm.prank(seller);
        vault.submitMilestoneDocs(0, docHash);

        (, EscrowVault.MilestoneStatus status, bytes32 storedHash) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.DocsSubmitted));
        assertEq(storedHash, docHash);
    }

    function test_SubmitMilestoneDocs_RevertsIfWrongStatus() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.startPrank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));

        vm.expectRevert(
            abi.encodeWithSelector(EscrowVault.InvalidMilestoneStatus.selector, 0, EscrowVault.MilestoneStatus.DocsSubmitted)
        );
        vault.submitMilestoneDocs(0, keccak256("docs-again"));
        vm.stopPrank();
    }

    // ─── confirmMilestone ─────────────────────────────────────

    function test_ConfirmMilestone_RevertsIfDocsNotSubmitted() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.expectRevert(
            abi.encodeWithSelector(EscrowVault.InvalidMilestoneStatus.selector, 0, EscrowVault.MilestoneStatus.Pending)
        );
        vm.prank(buyer);
        vault.confirmMilestone(0);
    }

    function test_ConfirmMilestone_TransfersToSellerAndEmits() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));

        vm.expectEmit(true, false, false, true, address(vault));
        emit EscrowVault.MilestoneReleased(0, false);

        vm.prank(buyer);
        vault.confirmMilestone(0);

        assertEq(token.balanceOf(seller), 100e6);
        (, EscrowVault.MilestoneStatus status,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Released));
    }

    function test_ConfirmMilestone_ReturnsBondOnFinalMilestone() public {
        EscrowVault vault = _fundedVault(100e6, 20e6);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));

        vm.prank(buyer);
        vault.confirmMilestone(0);

        assertEq(token.balanceOf(seller), 100e6 + 20e6);
        assertEq(vault.bondBalance(), 0);
    }

    function test_ConfirmMilestone_KeepsBondLockedWhileMilestonesRemain() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e6;
        amounts[1] = 200e6;
        EscrowVault vault = _newVault(amounts, 20e6);
        _mintAndApprove(seller, vault, 20e6);
        vm.prank(seller);
        vault.depositBond();
        _mintAndApprove(buyer, vault, 300e6);
        vm.prank(buyer);
        vault.fund();

        vm.startPrank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs-0"));
        vm.stopPrank();
        vm.prank(buyer);
        vault.confirmMilestone(0);

        assertEq(vault.bondBalance(), 20e6, "bond stays locked until every milestone releases");
        assertEq(token.balanceOf(seller), 100e6);
    }

    // ─── releaseMilestoneViaDon ───────────────────────────────

    function test_ReleaseViaDon_RevertsIfNotConfirmed() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.DonNotConfirmed.selector, 0));
        vault.releaseMilestoneViaDon(0);
    }

    function test_ReleaseViaDon_CallableByAnyoneWhenConfirmed() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        _setDonConfirmed(vault, 0);

        vm.prank(stranger);
        vault.releaseMilestoneViaDon(0);

        assertEq(token.balanceOf(seller), 100e6);
    }

    function test_ReleaseViaDon_WorksWithoutDocsSubmitted() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        _setDonConfirmed(vault, 0);

        vault.releaseMilestoneViaDon(0);

        (, EscrowVault.MilestoneStatus status,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Released));
    }

    function test_ReleaseViaDon_RevertsIfAlreadyReleased() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        _setDonConfirmed(vault, 0);
        vault.releaseMilestoneViaDon(0);

        vm.expectRevert(
            abi.encodeWithSelector(EscrowVault.InvalidMilestoneStatus.selector, 0, EscrowVault.MilestoneStatus.Released)
        );
        vault.releaseMilestoneViaDon(0);
    }

    // ─── disputeMilestone ─────────────────────────────────────

    function test_DisputeMilestone_RevertsIfNotParty() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotPartyToTrade.selector, stranger));
        vm.prank(stranger);
        vault.disputeMilestone(0, "not delivered");
    }

    function test_DisputeMilestone_ByBuyerOrSeller_SetsDisputed() public {
        EscrowVault vault = _fundedVault(100e6, 0);

        vm.prank(buyer);
        vault.disputeMilestone(0, "not delivered");

        (, EscrowVault.MilestoneStatus status,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Disputed));
    }

    function test_DisputeMilestone_RevertsIfWrongStatus() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        _setDonConfirmed(vault, 0);
        vault.releaseMilestoneViaDon(0);

        vm.expectRevert(
            abi.encodeWithSelector(EscrowVault.InvalidMilestoneStatus.selector, 0, EscrowVault.MilestoneStatus.Released)
        );
        vm.prank(buyer);
        vault.disputeMilestone(0, "too late");
    }

    // ─── resolveDispute ───────────────────────────────────────

    function test_ResolveDispute_RevertsIfNotArbiter() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.disputeMilestone(0, "not delivered");

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotArbiter.selector, buyer));
        vm.prank(buyer);
        vault.resolveDispute(0, true);
    }

    function test_ResolveDispute_ReleaseToSeller() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.disputeMilestone(0, "quality concern");

        vm.prank(arbiter);
        vault.resolveDispute(0, true);

        assertEq(token.balanceOf(seller), 100e6);
        (, EscrowVault.MilestoneStatus status,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Released));
    }

    /// @dev Documents the known gap: refunding a disputed milestone leaves the
    /// bond locked, since the auto-return path only fires when every milestone
    /// reaches Released. The arbiter must call slashBond separately.
    function test_ResolveDispute_RefundToBuyer_LeavesBondLocked() public {
        EscrowVault vault = _fundedVault(100e6, 20e6);
        vm.prank(buyer);
        vault.disputeMilestone(0, "seller never delivered");

        vm.prank(arbiter);
        vault.resolveDispute(0, false);

        assertEq(token.balanceOf(buyer), 100e6, "milestone amount refunded back to buyer");
        (, EscrowVault.MilestoneStatus status,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Refunded));
        assertEq(vault.bondBalance(), 20e6, "bond is stuck until the arbiter explicitly slashes it");
    }

    // ─── slashBond ────────────────────────────────────────────

    function test_SlashBond_RevertsIfNotArbiter() public {
        EscrowVault vault = _fundedVault(100e6, 20e6);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotArbiter.selector, buyer));
        vm.prank(buyer);
        vault.slashBond(buyer);
    }

    function test_SlashBond_TransfersAndZeroesBalance() public {
        EscrowVault vault = _fundedVault(100e6, 20e6);

        vm.prank(arbiter);
        vault.slashBond(buyer);

        assertEq(vault.bondBalance(), 0);
        assertEq(token.balanceOf(buyer), 20e6);
    }

    // ─── Full lifecycle ───────────────────────────────────────

    function test_FullLifecycle_TwoMilestones_BondReturnedAtEnd() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 300e6;
        amounts[1] = 700e6; // total 1_000e6 > THRESHOLD (999e6): compliance required
        EscrowVault vault = _newVault(amounts, 50e6);

        _mintAndApprove(seller, vault, 50e6);
        vm.prank(seller);
        vault.depositBond();

        _setCompliant(buyer, true);
        _mintAndApprove(buyer, vault, 1_000e6);
        vm.prank(buyer);
        vault.fund();

        vm.startPrank(seller);
        vault.submitMilestoneDocs(0, keccak256("milestone-0-docs"));
        vm.stopPrank();
        vm.prank(buyer);
        vault.confirmMilestone(0);
        assertEq(vault.bondBalance(), 50e6, "bond still locked, milestone 1 remains");

        // Second milestone released via DON attestation instead of buyer confirm.
        _setDonConfirmed(vault, 1);
        vault.releaseMilestoneViaDon(1);

        assertEq(token.balanceOf(seller), 300e6 + 700e6 + 50e6);
        assertEq(vault.bondBalance(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
    }
}
