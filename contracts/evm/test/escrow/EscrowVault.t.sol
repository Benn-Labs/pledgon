// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/escrow/EscrowVault.sol";
import {IEscrowFactory} from "../../src/escrow/IEscrowFactory.sol";
import {EscrowConfirmationConsumer} from "../../src/escrow/EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../../src/compliance/ComplianceConsumer.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev The test contract itself plays EscrowFactory's part of IEscrowFactory:
/// EscrowVault captures msg.sender as `factory` at construction, so deploying a
/// vault directly from here (as every test does) makes this contract that
/// vault's factory. Volume tracking here is a plain running total per buyer —
/// no period bucketing — since bucket-window behavior belongs to
/// EscrowFactory.t.sol, not vault-level tests.
contract EscrowVaultTest is Test, IEscrowFactory {
    uint8 constant DECIMALS = 6;
    uint256 constant TIER0_CAP = 999 * 10 ** DECIMALS;
    uint256 constant TIER1_CAP = 10_000 * 10 ** DECIMALS;
    uint256 constant MAX_VALIDITY = 180 days;

    MockERC20 token;
    EscrowConfirmationConsumer confirmationConsumer;
    ComplianceConsumer complianceConsumer;

    mapping(address => uint256) public recordedVolume;

    address forwarder = makeAddr("forwarder");
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address arbiter = makeAddr("arbiter");
    address stranger = makeAddr("stranger");

    function setUp() public {
        token = new MockERC20(DECIMALS);
        confirmationConsumer = new EscrowConfirmationConsumer(forwarder);
        complianceConsumer = new ComplianceConsumer(forwarder, MAX_VALIDITY);
    }

    // ─── IEscrowFactory (this contract stands in for the factory) ──

    function recordVolume(address account, uint256 amount) external returns (uint256 periodVolume) {
        periodVolume = recordedVolume[account] + amount;
        recordedVolume[account] = periodVolume;
    }

    // ─── Helpers ──────────────────────────────────────────────

    function _newVault(uint256[] memory amounts, uint256 bondAmount) internal returns (EscrowVault vault) {
        vault = new EscrowVault(
            buyer,
            seller,
            arbiter,
            IERC20(address(token)),
            bondAmount,
            amounts,
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer
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

    function _setTier(address subject, uint8 tier) internal {
        vm.prank(forwarder);
        complianceConsumer.onReport("", abi.encode(subject, tier, block.timestamp));
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
            address(0),
            seller,
            arbiter,
            IERC20(address(token)),
            0,
            _singleMilestone(100),
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer
        );
    }

    function test_Constructor_RevertsOnZeroToken() public {
        vm.expectRevert(EscrowVault.ZeroAddress.selector);
        new EscrowVault(
            buyer,
            seller,
            arbiter,
            IERC20(address(0)),
            0,
            _singleMilestone(100),
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer
        );
    }

    function test_Constructor_RevertsIfArbiterIsBuyer() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.ArbiterConflict.selector, buyer));
        new EscrowVault(
            buyer,
            seller,
            buyer,
            IERC20(address(token)),
            0,
            _singleMilestone(100),
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer
        );
    }

    function test_Constructor_RevertsIfArbiterIsSeller() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.ArbiterConflict.selector, seller));
        new EscrowVault(
            buyer,
            seller,
            seller,
            IERC20(address(token)),
            0,
            _singleMilestone(100),
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer
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

    function test_Constructor_CapturesDeployerAsFactory() public {
        EscrowVault vault = _newVault(_singleMilestone(100), 0);
        assertEq(address(vault.factory()), address(this));
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

    function test_Fund_RecordsVolumeOnFactory() public {
        _fundedVault(500e6, 0);
        assertEq(recordedVolume[buyer], 500e6);
    }

    function test_Fund_Tier0_UnderCap_Succeeds() public {
        // TIER0_CAP itself is not > TIER0_CAP, so no compliance report needed.
        EscrowVault vault = _fundedVault(TIER0_CAP, 0);
        assertTrue(vault.funded());
    }

    function test_Fund_Tier0_OverCap_Reverts() public {
        EscrowVault vault = _newVault(_singleMilestone(TIER0_CAP + 1), 0);
        _mintAndApprove(buyer, vault, TIER0_CAP + 1);

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.ComplianceRequired.selector, buyer, TIER0_CAP + 1, TIER0_CAP));
        vm.prank(buyer);
        vault.fund();
    }

    function test_Fund_Tier1_CoversAboveTier0Cap() public {
        EscrowVault vault = _newVault(_singleMilestone(TIER0_CAP + 1), 0);
        _mintAndApprove(buyer, vault, TIER0_CAP + 1);
        _setTier(buyer, 1);

        vm.prank(buyer);
        vault.fund();

        assertTrue(vault.funded());
    }

    function test_Fund_Tier1_StillRevertsAboveTier1Cap() public {
        EscrowVault vault = _newVault(_singleMilestone(TIER1_CAP + 1), 0);
        _mintAndApprove(buyer, vault, TIER1_CAP + 1);
        _setTier(buyer, 1);

        vm.expectRevert(
            abi.encodeWithSelector(EscrowVault.ComplianceRequired.selector, buyer, TIER1_CAP + 1, TIER1_CAP)
        );
        vm.prank(buyer);
        vault.fund();
    }

    function test_Fund_Tier2_Uncapped() public {
        uint256 hugeAmount = TIER1_CAP * 1000;
        EscrowVault vault = _newVault(_singleMilestone(hugeAmount), 0);
        _mintAndApprove(buyer, vault, hugeAmount);
        _setTier(buyer, 2);

        vm.prank(buyer);
        vault.fund();

        assertTrue(vault.funded());
    }

    function test_Fund_ExpiredTierBackToUnverified_Reverts() public {
        EscrowVault vault = _newVault(_singleMilestone(TIER0_CAP + 1), 0);
        _mintAndApprove(buyer, vault, TIER0_CAP + 1);
        _setTier(buyer, 1);

        vm.warp(block.timestamp + MAX_VALIDITY + 1);

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.ComplianceRequired.selector, buyer, TIER0_CAP + 1, TIER0_CAP));
        vm.prank(buyer);
        vault.fund();
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
        amounts[1] = 700e6; // total 1_000e6 > TIER0_CAP (999e6): needs tier 1
        EscrowVault vault = _newVault(amounts, 50e6);

        _mintAndApprove(seller, vault, 50e6);
        vm.prank(seller);
        vault.depositBond();

        _setTier(buyer, 1);
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
