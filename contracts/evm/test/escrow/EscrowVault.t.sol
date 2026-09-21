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
        vault = _newVaultWithWindows(amounts, bondAmount, 0, 0, 0);
    }

    function _newVaultWithWindows(
        uint256[] memory amounts,
        uint256 bondAmount,
        uint256 fundingWindow,
        uint256 milestoneConfirmWindow,
        uint256 deliveryWindow
    ) internal returns (EscrowVault vault) {
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
            complianceConsumer,
            fundingWindow,
            milestoneConfirmWindow,
            deliveryWindow
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
        vault = _fundedVaultWithWindows(milestoneAmount, bondAmount, 0, 0, 0);
    }

    function _fundedVaultWithWindows(
        uint256 milestoneAmount,
        uint256 bondAmount,
        uint256 fundingWindow,
        uint256 milestoneConfirmWindow,
        uint256 deliveryWindow
    ) internal returns (EscrowVault vault) {
        vault = _newVaultWithWindows(_singleMilestone(milestoneAmount), bondAmount, fundingWindow, milestoneConfirmWindow, deliveryWindow);
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
            complianceConsumer,
            0,
            0,
            0
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
            complianceConsumer,
            0,
            0,
            0
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
            complianceConsumer,
            0,
            0,
            0
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
            complianceConsumer,
            0,
            0,
            0
        );
    }

    function test_Constructor_AllowsZeroArbiter() public {
        EscrowVault vault = new EscrowVault(
            buyer,
            seller,
            address(0),
            IERC20(address(token)),
            0,
            _singleMilestone(100e6),
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer,
            0,
            0,
            0
        );
        assertEq(vault.arbiter(), address(0));
    }

    function test_ResolveDispute_RevertsForAnyoneWhenNoArbiter() public {
        EscrowVault vault = new EscrowVault(
            buyer,
            seller,
            address(0),
            IERC20(address(token)),
            0,
            _singleMilestone(100e6),
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer,
            0,
            0,
            0
        );
        _mintAndApprove(buyer, vault, 100e6);
        vm.prank(buyer);
        vault.fund();
        vm.prank(buyer);
        vault.disputeMilestone(0, "no arbiter escrow");

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotArbiter.selector, buyer));
        vm.prank(buyer);
        vault.resolveDispute(0, 10_000);

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotArbiter.selector, seller));
        vm.prank(seller);
        vault.resolveDispute(0, 10_000);
    }

    function test_SlashBond_RevertsForAnyoneWhenNoArbiter() public {
        EscrowVault vault = new EscrowVault(
            buyer,
            seller,
            address(0),
            IERC20(address(token)),
            20e6,
            _singleMilestone(100e6),
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer,
            0,
            0,
            0
        );
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotArbiter.selector, buyer));
        vm.prank(buyer);
        vault.slashBond(buyer);
    }

    function test_MutualSettlement_StillWorksWithNoArbiter() public {
        EscrowVault vault = new EscrowVault(
            buyer,
            seller,
            address(0),
            IERC20(address(token)),
            0,
            _singleMilestone(100e6),
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer,
            0,
            0,
            0
        );
        _mintAndApprove(buyer, vault, 100e6);
        vm.prank(buyer);
        vault.fund();
        vm.prank(buyer);
        vault.disputeMilestone(0, "no arbiter escrow");

        vm.prank(seller);
        vault.proposeSettlement(0, 6_000);
        vm.prank(buyer);
        vault.acceptSettlement(0);

        assertEq(token.balanceOf(seller), 60e6);
        assertEq(token.balanceOf(buyer), 40e6);
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

        (, EscrowVault.MilestoneStatus status, bytes32 storedHash,) = vault.milestones(0);
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
        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
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

        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
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

        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
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
        vault.resolveDispute(0, 10_000);
    }

    function test_ResolveDispute_RevertsOnInvalidSplit() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.disputeMilestone(0, "not delivered");

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.InvalidSplit.selector, 10_001));
        vm.prank(arbiter);
        vault.resolveDispute(0, 10_001);
    }

    function test_ResolveDispute_ReleaseToSeller() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.disputeMilestone(0, "quality concern");

        vm.prank(arbiter);
        vault.resolveDispute(0, 10_000);

        assertEq(token.balanceOf(seller), 100e6);
        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Released));
    }

    /// @dev Documents the known gap: refunding a disputed milestone leaves the
    /// bond locked, since the auto-return path only fires when every milestone
    /// reaches Released. The arbiter must call slashBond separately.
    /// @dev With only one milestone, refunding it also settles the whole
    /// trade — so the bond auto-returns to the seller even though the
    /// milestone itself was a refund, not a release. See
    /// `test_ResolveDispute_RefundToBuyer_MultiMilestone_LeavesBondLockedUntilOthersSettle`
    /// for the case where the bond stays locked because other milestones
    /// are still open.
    function test_ResolveDispute_RefundToBuyer_LastMilestoneAutoReturnsBond() public {
        EscrowVault vault = _fundedVault(100e6, 20e6);
        vm.prank(buyer);
        vault.disputeMilestone(0, "seller never delivered");

        vm.prank(arbiter);
        vault.resolveDispute(0, 0);

        assertEq(token.balanceOf(buyer), 100e6, "milestone amount refunded back to buyer");
        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Refunded));
        assertEq(vault.bondBalance(), 0, "bond auto-returns once the only milestone is settled, even by refund");
        assertEq(token.balanceOf(seller), 20e6, "bond returned to seller");
    }

    /// @dev The genuine "still locked" case: a refund on one milestone while
    /// another remains open. The arbiter can still `slashBond` mid-trade if
    /// warranted; this just confirms the auto-return path doesn't fire early.
    function test_ResolveDispute_RefundToBuyer_MultiMilestone_LeavesBondLockedUntilOthersSettle() public {
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

        vm.prank(buyer);
        vault.disputeMilestone(0, "seller never delivered");
        vm.prank(arbiter);
        vault.resolveDispute(0, 0);

        assertEq(vault.bondBalance(), 20e6, "bond stays locked while milestone 1 is still open");
    }

    function test_ResolveDispute_SplitPaysBothPartiesAndMarksSplit() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(seller);
        vault.disputeMilestone(0, "partial delivery");

        vm.prank(arbiter);
        vault.resolveDispute(0, 6_000); // 60% seller / 40% buyer

        assertEq(token.balanceOf(seller), 60e6);
        assertEq(token.balanceOf(buyer), 40e6);
        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Split));
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

    // ─── cancelTrade ──────────────────────────────────────────

    function test_CancelTrade_RevertsIfNotParty() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 0);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotPartyToTrade.selector, stranger));
        vm.prank(stranger);
        vault.cancelTrade();
    }

    function test_CancelTrade_RevertsIfAlreadyFunded() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.expectRevert(EscrowVault.CannotCancelAfterFunded.selector);
        vm.prank(buyer);
        vault.cancelTrade();
    }

    function test_CancelTrade_BySeller_RefundsBondAndBlocksFurtherActions() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 20e6);
        _mintAndApprove(seller, vault, 20e6);
        vm.prank(seller);
        vault.depositBond();

        vm.prank(seller);
        vault.cancelTrade();

        assertTrue(vault.cancelled());
        assertEq(token.balanceOf(seller), 20e6, "bond refunded to seller");
        assertEq(vault.bondBalance(), 0);

        vm.expectRevert(EscrowVault.AlreadyCancelled.selector);
        vm.prank(buyer);
        vault.fund();
    }

    function test_CancelTrade_ByBuyer_NoBondDeposited() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 20e6);
        vm.prank(buyer);
        vault.cancelTrade();
        assertTrue(vault.cancelled());
        assertEq(token.balanceOf(seller), 0);
    }

    // ─── proposeSettlement / acceptSettlement ──────────────────

    function test_ProposeSettlement_RevertsIfNotParty() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotPartyToTrade.selector, stranger));
        vm.prank(stranger);
        vault.proposeSettlement(0, 5_000);
    }

    function test_AcceptSettlement_RevertsIfNotCounterparty() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(seller);
        vault.proposeSettlement(0, 5_000);

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotCounterparty.selector, stranger));
        vm.prank(stranger);
        vault.acceptSettlement(0);
    }

    function test_AcceptSettlement_RevertsIfNoActiveProposal() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NoActiveProposal.selector, 0));
        vm.prank(buyer);
        vault.acceptSettlement(0);
    }

    function test_ProposeThenCancelSettlement_ReopensMilestoneForNewProposal() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(seller);
        vault.proposeSettlement(0, 5_000);
        vm.prank(seller);
        vault.cancelSettlementProposal(0);

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NoActiveProposal.selector, 0));
        vm.prank(buyer);
        vault.acceptSettlement(0);
    }

    function test_MutualSettlement_SplitPaysBothPartiesAndSkipsArbiter() public {
        EscrowVault vault = _fundedVault(100e6, 0);

        vm.prank(seller);
        vault.proposeSettlement(0, 7_000); // seller proposes 70/30

        vm.prank(buyer);
        vault.acceptSettlement(0);

        assertEq(token.balanceOf(seller), 70e6);
        assertEq(token.balanceOf(buyer), 30e6);
        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Split));
    }

    function test_MutualSettlement_WorksOnDisputedMilestone() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.disputeMilestone(0, "quality concern");

        vm.prank(buyer);
        vault.proposeSettlement(0, 4_000);
        vm.prank(seller);
        vault.acceptSettlement(0);

        assertEq(token.balanceOf(seller), 40e6);
        assertEq(token.balanceOf(buyer), 60e6);
    }

    function test_MutualSettlement_FullToSellerReturnsBondOnLastMilestone() public {
        EscrowVault vault = _fundedVault(100e6, 20e6);
        vm.prank(seller);
        vault.proposeSettlement(0, 10_000);
        vm.prank(buyer);
        vault.acceptSettlement(0);

        assertEq(token.balanceOf(seller), 120e6, "milestone + auto-returned bond");
        assertEq(vault.bondBalance(), 0);
    }

    /// @dev Regression test for a real double-payout hole: a proposal made
    /// while a milestone was Pending must not still be acceptable after the
    /// milestone was independently resolved through a different path (here,
    /// a direct buyer confirm). `_release` proactively clears the proposal,
    /// so the observable failure is `NoActiveProposal` — the belt-and-suspenders
    /// status recheck inside `acceptSettlement` exists for any path that might
    /// ever skip that cleanup.
    function test_AcceptSettlement_RevertsIfMilestoneResolvedThroughAnotherPath() public {
        EscrowVault vault = _fundedVault(100e6, 0);

        vm.prank(seller);
        vault.proposeSettlement(0, 5_000);

        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        vm.prank(buyer);
        vault.confirmMilestone(0);
        assertEq(token.balanceOf(seller), 100e6);

        (,, bool active) = vault.settlementProposals(0);
        assertFalse(active, "proposal cleared as a side effect of the direct confirm");

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NoActiveProposal.selector, 0));
        vm.prank(buyer);
        vault.acceptSettlement(0);

        assertEq(token.balanceOf(seller), 100e6, "no double payout");
    }

    function test_ResolveDispute_ClearsStaleSettlementProposal() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.disputeMilestone(0, "quality concern");
        vm.prank(seller);
        vault.proposeSettlement(0, 8_000);

        vm.prank(arbiter);
        vault.resolveDispute(0, 3_000);

        (, address proposedBy, bool active) = vault.settlementProposals(0);
        assertFalse(active, "stale proposal cleared once the arbiter ruled");
        assertEq(proposedBy, address(0));

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NoActiveProposal.selector, 0));
        vm.prank(buyer);
        vault.acceptSettlement(0);
    }

    function test_TradeExit_ClearsStaleSettlementProposal() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.proposeSettlement(0, 4_000);

        vm.prank(seller);
        vault.proposeTradeExit();
        vm.prank(buyer);
        vault.acceptTradeExit();

        (,, bool active) = vault.settlementProposals(0);
        assertFalse(active);
    }

    // ─── proposeTradeExit / acceptTradeExit ─────────────────────

    function test_ProposeTradeExit_RevertsIfNotParty() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotPartyToTrade.selector, stranger));
        vm.prank(stranger);
        vault.proposeTradeExit();
    }

    function test_AcceptTradeExit_RevertsIfNotCounterparty() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.proposeTradeExit();

        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotCounterparty.selector, stranger));
        vm.prank(stranger);
        vault.acceptTradeExit();
    }

    function test_TradeExit_RefundsOpenMilestonesToBuyerAndBondToSeller() public {
        EscrowVault vault = _fundedVault(100e6, 20e6);

        vm.prank(buyer);
        vault.proposeTradeExit();
        vm.prank(seller);
        vault.acceptTradeExit();

        assertEq(token.balanceOf(buyer), 100e6, "unreleased milestone refunded");
        assertEq(token.balanceOf(seller), 20e6, "bond returned");
        assertTrue(vault.cancelled());
        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Refunded));
    }

    function test_TradeExit_SkipsAlreadySettledMilestones() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e6;
        amounts[1] = 200e6;
        EscrowVault vault = _newVault(amounts, 0);
        _mintAndApprove(buyer, vault, 300e6);
        vm.prank(buyer);
        vault.fund();

        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        vm.prank(buyer);
        vault.confirmMilestone(0);
        assertEq(token.balanceOf(seller), 100e6);

        vm.prank(seller);
        vault.proposeTradeExit();
        vm.prank(buyer);
        vault.acceptTradeExit();

        assertEq(token.balanceOf(buyer), 200e6, "only the still-open milestone refunds");
        (, EscrowVault.MilestoneStatus status0,,) = vault.milestones(0);
        (, EscrowVault.MilestoneStatus status1,,) = vault.milestones(1);
        assertEq(uint8(status0), uint8(EscrowVault.MilestoneStatus.Released), "untouched by the exit");
        assertEq(uint8(status1), uint8(EscrowVault.MilestoneStatus.Refunded));
    }

    function test_TradeExit_WorksPreFundingAndRefundsBond() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 20e6);
        _mintAndApprove(seller, vault, 20e6);
        vm.prank(seller);
        vault.depositBond();

        vm.prank(seller);
        vault.proposeTradeExit();
        vm.prank(buyer);
        vault.acceptTradeExit();

        assertEq(token.balanceOf(seller), 20e6);
        assertTrue(vault.cancelled());
    }

    function test_AcceptTradeExit_RevertsIfCancelled() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.proposeTradeExit();
        vm.prank(seller);
        vault.acceptTradeExit();

        vm.expectRevert(EscrowVault.AlreadyCancelled.selector);
        vm.prank(buyer);
        vault.proposeTradeExit();
    }

    /// @dev Regression test: a completed trade has nothing left to wind down,
    /// and accepting an exit proposal on one would relabel it Cancelled
    /// instead of Completed while also force-moving any bond still locked
    /// from a non-Released final milestone (e.g. one resolved via Split).
    function test_ProposeTradeExit_RevertsIfAllMilestonesSettled() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        vm.prank(buyer);
        vault.confirmMilestone(0);

        vm.expectRevert(EscrowVault.TradeAlreadySettled.selector);
        vm.prank(buyer);
        vault.proposeTradeExit();
    }

    function test_AcceptTradeExit_RevertsIfMilestonesSettledBetweenProposeAndAccept() public {
        EscrowVault vault = _fundedVault(100e6, 20e6);
        vm.prank(buyer);
        vault.proposeTradeExit();

        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        vm.prank(buyer);
        vault.confirmMilestone(0);

        vm.expectRevert(EscrowVault.TradeAlreadySettled.selector);
        vm.prank(seller);
        vault.acceptTradeExit();

        assertFalse(vault.cancelled(), "the completed trade must not be relabeled Cancelled");
    }

    function test_ProposeTradeExit_RevertsWhenFinalMilestoneOnlySplitNotFullyReleased() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(buyer);
        vault.disputeMilestone(0, "quality concern");
        vm.prank(arbiter);
        vault.resolveDispute(0, 6_000);

        vm.expectRevert(EscrowVault.TradeAlreadySettled.selector);
        vm.prank(buyer);
        vault.proposeTradeExit();
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

    // ─── funding deadline / expireFunding ──────────────────────

    function test_FundingDeadline_ZeroWhenNoWindowConfigured() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 0);
        assertEq(vault.fundingDeadline(), 0);
    }

    function test_FundingDeadline_SetAtConstruction() public {
        EscrowVault vault = _newVaultWithWindows(_singleMilestone(100e6), 0, 1 days, 0, 0);
        assertEq(vault.fundingDeadline(), block.timestamp + 1 days);
    }

    function test_Fund_RevertsAfterFundingDeadline() public {
        EscrowVault vault = _newVaultWithWindows(_singleMilestone(100e6), 0, 1 days, 0, 0);
        _mintAndApprove(buyer, vault, 100e6);

        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(EscrowVault.FundingDeadlinePassed.selector);
        vm.prank(buyer);
        vault.fund();
    }

    function test_ExpireFunding_RevertsIfNoDeadlineConfigured() public {
        EscrowVault vault = _newVault(_singleMilestone(100e6), 0);
        vm.expectRevert(EscrowVault.FundingNotYetExpired.selector);
        vault.expireFunding();
    }

    function test_ExpireFunding_RevertsIfNotYetExpired() public {
        EscrowVault vault = _newVaultWithWindows(_singleMilestone(100e6), 0, 1 days, 0, 0);
        vm.expectRevert(EscrowVault.FundingNotYetExpired.selector);
        vault.expireFunding();
    }

    function test_ExpireFunding_RevertsIfAlreadyFunded() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 1 days, 0, 0);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(EscrowVault.AlreadyFunded.selector);
        vault.expireFunding();
    }

    /// @dev Callable by a stranger — no relationship to the trade at all —
    /// same as `releaseMilestoneViaDon`'s permissionless style, since the
    /// deadline check is self-verifying and needs no special caller.
    function test_ExpireFunding_CallableByStranger_RefundsBondAndCancels() public {
        EscrowVault vault = _newVaultWithWindows(_singleMilestone(100e6), 20e6, 1 days, 0, 0);
        _mintAndApprove(seller, vault, 20e6);
        vm.prank(seller);
        vault.depositBond();

        vm.warp(block.timestamp + 1 days);
        vm.prank(stranger);
        vault.expireFunding();

        assertTrue(vault.cancelled());
        assertEq(token.balanceOf(seller), 20e6, "bond refunded to seller");
        assertEq(vault.bondBalance(), 0);

        vm.expectRevert(EscrowVault.AlreadyCancelled.selector);
        vm.prank(buyer);
        vault.fund();
    }

    function test_ExpireFunding_NoBondDeposited_NoTransfer() public {
        EscrowVault vault = _newVaultWithWindows(_singleMilestone(100e6), 20e6, 1 days, 0, 0);
        vm.warp(block.timestamp + 1 days);
        vault.expireFunding();
        assertTrue(vault.cancelled());
        assertEq(token.balanceOf(seller), 0);
    }

    // ─── milestone confirmation deadline / expireMilestone ─────
    // Timeout releases to the seller (silence past the window counts as
    // accepted delivery) — NOT a refund to the buyer, which would let a
    // buyer who actually received the goods simply stay silent and reclaim
    // the payment too. See ConfirmationExpired's doc comment.

    function test_MilestoneDeadline_ZeroBeforeDocsSubmitted() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 1 days, 0);
        assertEq(vault.milestoneDeadline(0), 0);
    }

    function test_MilestoneDeadline_ZeroWhenNoWindowConfigured() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        assertEq(vault.milestoneDeadline(0), 0);
    }

    function test_MilestoneDeadline_SetAfterDocsSubmitted() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 1 days, 0);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        assertEq(vault.milestoneDeadline(0), block.timestamp + 1 days);
    }

    function test_ExpireMilestone_RevertsIfNoWindowConfigured() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        vm.expectRevert(EscrowVault.MilestoneNotYetExpired.selector);
        vault.expireMilestone(0);
    }

    function test_ExpireMilestone_RevertsIfNotYetExpired() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 1 days, 0);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        vm.expectRevert(EscrowVault.MilestoneNotYetExpired.selector);
        vault.expireMilestone(0);
    }

    function test_ExpireMilestone_RevertsIfWrongStatus() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 1 days, 0);
        vm.expectRevert(
            abi.encodeWithSelector(EscrowVault.InvalidMilestoneStatus.selector, 0, EscrowVault.MilestoneStatus.Pending)
        );
        vault.expireMilestone(0);
    }

    /// @dev Callable by a stranger, same rationale as expireFunding above.
    /// Confirms the milestone releases to the SELLER (not a buyer refund —
    /// that would be the theft vector this design specifically avoids), and
    /// that a stale settlement proposal is cleared and ConfirmationExpired
    /// fires alongside the normal MilestoneReleased event.
    function test_ExpireMilestone_CallableByStranger_ReleasesToSellerAndClearsSettlementProposal() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 1 days, 0);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        vm.prank(seller);
        vault.proposeSettlement(0, 5000);

        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(true, false, false, true, address(vault));
        emit EscrowVault.ConfirmationExpired(0, 100e6);
        vm.prank(stranger);
        vault.expireMilestone(0);

        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Released));
        assertEq(token.balanceOf(seller), 100e6, "milestone released to seller, not refunded to buyer");
        assertEq(token.balanceOf(buyer), 0);

        (,, bool active) = vault.settlementProposals(0);
        assertFalse(active, "stale settlement proposal cleared");
    }

    // ─── delivery deadline / expireDelivery ────────────────────
    // The mirror image: a seller who never submits docs at all can't lock
    // the buyer's payment forever either.

    function test_DeliveryDeadline_ZeroWhenNotFunded() public {
        EscrowVault vault = _newVaultWithWindows(_singleMilestone(100e6), 0, 0, 0, 1 days);
        assertEq(vault.deliveryDeadline(0), 0);
    }

    function test_DeliveryDeadline_ZeroWhenNoWindowConfigured() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        assertEq(vault.deliveryDeadline(0), 0);
    }

    function test_DeliveryDeadline_ZeroOnceDocsSubmitted() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 0, 1 days);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        assertEq(vault.deliveryDeadline(0), 0);
    }

    function test_DeliveryDeadline_SetAtFunding() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 0, 1 days);
        assertEq(vault.deliveryDeadline(0), block.timestamp + 1 days);
    }

    function test_ExpireDelivery_RevertsIfNotFunded() public {
        EscrowVault vault = _newVaultWithWindows(_singleMilestone(100e6), 0, 0, 0, 1 days);
        vm.expectRevert(EscrowVault.NotFunded.selector);
        vault.expireDelivery(0);
    }

    function test_ExpireDelivery_RevertsIfNoWindowConfigured() public {
        EscrowVault vault = _fundedVault(100e6, 0);
        vm.expectRevert(EscrowVault.DeliveryNotYetExpired.selector);
        vault.expireDelivery(0);
    }

    function test_ExpireDelivery_RevertsIfNotYetExpired() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 0, 1 days);
        vm.expectRevert(EscrowVault.DeliveryNotYetExpired.selector);
        vault.expireDelivery(0);
    }

    function test_ExpireDelivery_RevertsIfWrongStatus() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 0, 1 days);
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(
            abi.encodeWithSelector(EscrowVault.InvalidMilestoneStatus.selector, 0, EscrowVault.MilestoneStatus.DocsSubmitted)
        );
        vault.expireDelivery(0);
    }

    /// @dev Callable by a stranger, same rationale as expireFunding/
    /// expireMilestone. Confirms a stale settlement proposal is cleared.
    function test_ExpireDelivery_CallableByStranger_RefundsBuyerAndClearsSettlementProposal() public {
        EscrowVault vault = _fundedVaultWithWindows(100e6, 0, 0, 0, 1 days);
        vm.prank(buyer);
        vault.proposeSettlement(0, 5000);

        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(true, false, false, true, address(vault));
        emit EscrowVault.DeliveryExpired(0, 100e6);
        vm.prank(stranger);
        vault.expireDelivery(0);

        (, EscrowVault.MilestoneStatus status,,) = vault.milestones(0);
        assertEq(uint8(status), uint8(EscrowVault.MilestoneStatus.Refunded));
        assertEq(token.balanceOf(buyer), 100e6, "milestone stake refunded to buyer");

        (,, bool active) = vault.settlementProposals(0);
        assertFalse(active, "stale settlement proposal cleared");
    }

    // ─── bond auto-return broadened to "all settled" ───────────

    /// @dev Before this broadening, a Refunded milestone anywhere would
    /// strand the bond forever absent an arbiter's slashBond call. Now the
    /// bond returns once every milestone reaches ANY terminal status —
    /// exercised here with one milestone Released normally and the other
    /// Refunded via a genuine delivery-deadline expiry (seller never
    /// delivered it at all).
    function test_BondReturn_TriggersOnceEveryMilestoneSettledEvenIfSomeAreRefunded() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e6;
        amounts[1] = 200e6;
        EscrowVault vault = _newVaultWithWindows(amounts, 50e6, 0, 0, 1 days);

        _mintAndApprove(seller, vault, 50e6);
        vm.prank(seller);
        vault.depositBond();
        _mintAndApprove(buyer, vault, 300e6);
        vm.prank(buyer);
        vault.fund();

        // Milestone 0 released normally.
        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs-0"));
        vm.prank(buyer);
        vault.confirmMilestone(0);
        assertEq(vault.bondBalance(), 50e6, "bond still locked, milestone 1 remains open");

        // Seller never delivers milestone 1 at all; once the delivery
        // deadline lapses, it's refunded to the buyer instead of released.
        vm.warp(block.timestamp + 1 days + 1);
        vault.expireDelivery(1);

        (, EscrowVault.MilestoneStatus status1,,) = vault.milestones(1);
        assertEq(uint8(status1), uint8(EscrowVault.MilestoneStatus.Refunded));

        assertEq(vault.bondBalance(), 0, "bond auto-returned once every milestone settled, despite the refund");
        assertEq(token.balanceOf(seller), 100e6 + 50e6);
        assertEq(token.balanceOf(buyer), 200e6);
    }

    /// @dev The actual "all settled, not all released" case: a genuine
    /// buyer refund (via disputeMilestone + resolveDispute) still frees the
    /// bond once nothing else is open, with no arbiter slashBond call needed.
    function test_BondReturn_TriggersAfterDisputeRefundOnLastOpenMilestone() public {
        address arbitratedVault_arbiter = makeAddr("bondReturnArbiter");
        EscrowVault vault = new EscrowVault(
            buyer,
            seller,
            arbitratedVault_arbiter,
            IERC20(address(token)),
            50e6,
            _singleMilestone(100e6),
            TIER0_CAP,
            TIER1_CAP,
            confirmationConsumer,
            complianceConsumer,
            0,
            0,
            0
        );
        _mintAndApprove(seller, vault, 50e6);
        vm.prank(seller);
        vault.depositBond();
        _mintAndApprove(buyer, vault, 100e6);
        vm.prank(buyer);
        vault.fund();

        vm.prank(seller);
        vault.submitMilestoneDocs(0, keccak256("docs"));
        vm.prank(buyer);
        vault.disputeMilestone(0, "not delivered");

        vm.prank(arbitratedVault_arbiter);
        vault.resolveDispute(0, 0); // full refund to buyer

        assertEq(vault.bondBalance(), 0, "bond auto-returned once the only milestone settled, even though refunded");
        assertEq(token.balanceOf(seller), 50e6);
        assertEq(token.balanceOf(buyer), 100e6);
    }
}
