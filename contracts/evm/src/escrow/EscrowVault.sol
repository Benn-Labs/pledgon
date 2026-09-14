// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {EscrowConfirmationConsumer} from "./EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../compliance/ComplianceConsumer.sol";

/// @title EscrowVault
/// @notice One vault per trade, deployed by EscrowFactory. Holds a seller
/// performance bond and per-milestone payments in `token`. A milestone releases
/// either when the buyer confirms it, or when the shared
/// EscrowConfirmationConsumer reports the DON verified the underlying off-chain
/// condition (e.g. title recorded, payment cleared) — whichever happens first.
contract EscrowVault {
    enum MilestoneStatus {
        Pending,
        DocsSubmitted,
        Released,
        Disputed,
        Refunded
    }

    struct Milestone {
        uint256 amount;
        MilestoneStatus status;
        bytes32 docHash;
    }

    address public immutable buyer;
    address public immutable seller;
    address public immutable arbiter;
    IERC20 public immutable token;
    uint256 public immutable bondAmount;
    uint256 public immutable complianceThreshold;
    EscrowConfirmationConsumer public immutable confirmationConsumer;
    ComplianceConsumer public immutable complianceConsumer;

    Milestone[] public milestones;
    uint256 public bondBalance;
    bool public bondDeposited;
    bool public funded;

    event BondDeposited(uint256 amount);
    event Funded(uint256 totalAmount);
    event DocsSubmitted(uint256 indexed milestoneIndex, bytes32 docHash);
    event MilestoneReleased(uint256 indexed milestoneIndex, bool viaDon);
    event Disputed(uint256 indexed milestoneIndex, address indexed raisedBy, string reason);
    event DisputeResolved(uint256 indexed milestoneIndex, bool releasedToSeller);
    event BondSlashed(address indexed to, uint256 amount);
    event BondReturned(uint256 amount);

    error NotBuyer(address caller);
    error NotSeller(address caller);
    error NotArbiter(address caller);
    error NotPartyToTrade(address caller);
    error BondAlreadyDeposited();
    error BondNotDeposited();
    error AlreadyFunded();
    error NotFunded();
    error ComplianceRequired(address buyer, uint256 totalAmount);
    error InvalidMilestoneIndex(uint256 index);
    error InvalidMilestoneStatus(uint256 index, MilestoneStatus actual);
    error DonNotConfirmed(uint256 index);
    error NoMilestones();
    error TransferFailed();
    error ZeroAddress();

    modifier onlyBuyer() {
        if (msg.sender != buyer) revert NotBuyer(msg.sender);
        _;
    }

    modifier onlySeller() {
        if (msg.sender != seller) revert NotSeller(msg.sender);
        _;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter(msg.sender);
        _;
    }

    constructor(
        address _buyer,
        address _seller,
        address _arbiter,
        IERC20 _token,
        uint256 _bondAmount,
        uint256[] memory _milestoneAmounts,
        uint256 _complianceThreshold,
        EscrowConfirmationConsumer _confirmationConsumer,
        ComplianceConsumer _complianceConsumer
    ) {
        if (_milestoneAmounts.length == 0) revert NoMilestones();
        if (
            _buyer == address(0) || _seller == address(0) || _arbiter == address(0) || address(_token) == address(0)
                || address(_confirmationConsumer) == address(0) || address(_complianceConsumer) == address(0)
        ) revert ZeroAddress();

        buyer = _buyer;
        seller = _seller;
        arbiter = _arbiter;
        token = _token;
        bondAmount = _bondAmount;
        complianceThreshold = _complianceThreshold;
        confirmationConsumer = _confirmationConsumer;
        complianceConsumer = _complianceConsumer;

        for (uint256 i = 0; i < _milestoneAmounts.length; i++) {
            milestones.push(Milestone({amount: _milestoneAmounts[i], status: MilestoneStatus.Pending, docHash: bytes32(0)}));
        }
    }

    /// @notice Seller posts the performance bond. Required before `fund()` only
    /// when `bondAmount > 0`.
    function depositBond() external onlySeller {
        if (bondDeposited) revert BondAlreadyDeposited();
        bondDeposited = true;
        bondBalance = bondAmount;
        if (bondAmount > 0) {
            _safeTransferFrom(seller, address(this), bondAmount);
        }
        emit BondDeposited(bondAmount);
    }

    /// @notice Buyer funds all milestones in one transfer. Trades above the
    /// $999-equivalent compliance threshold require a prior `compliant: true`
    /// verdict for the buyer from the compliance-check workflow.
    function fund() external onlyBuyer {
        if (bondAmount > 0 && !bondDeposited) revert BondNotDeposited();
        if (funded) revert AlreadyFunded();

        uint256 total = totalAmount();
        if (total > complianceThreshold && !complianceConsumer.isCompliant(buyer)) {
            revert ComplianceRequired(buyer, total);
        }

        funded = true;
        _safeTransferFrom(buyer, address(this), total);
        emit Funded(total);
    }

    function submitMilestoneDocs(uint256 index, bytes32 docHash) external onlySeller {
        if (!funded) revert NotFunded();
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.Pending) revert InvalidMilestoneStatus(index, m.status);
        m.docHash = docHash;
        m.status = MilestoneStatus.DocsSubmitted;
        emit DocsSubmitted(index, docHash);
    }

    /// @notice Buyer confirms delivery for a milestone the seller has submitted
    /// docs for, releasing its payment.
    function confirmMilestone(uint256 index) external onlyBuyer {
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.DocsSubmitted) revert InvalidMilestoneStatus(index, m.status);
        _release(index, m, false);
    }

    /// @notice Permissionless relay: anyone may call once the DON has attested the
    /// off-chain condition for this milestone. Safe because the real check is
    /// `confirmationConsumer.isConfirmed`, not the caller's identity — this lets a
    /// keeper or the seller trigger release without waiting on the buyer.
    function releaseMilestoneViaDon(uint256 index) external {
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.DocsSubmitted) {
            revert InvalidMilestoneStatus(index, m.status);
        }
        if (!confirmationConsumer.isConfirmed(address(this), index)) revert DonNotConfirmed(index);
        _release(index, m, true);
    }

    function disputeMilestone(uint256 index, string calldata reason) external {
        if (msg.sender != buyer && msg.sender != seller) revert NotPartyToTrade(msg.sender);
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.DocsSubmitted) {
            revert InvalidMilestoneStatus(index, m.status);
        }
        m.status = MilestoneStatus.Disputed;
        emit Disputed(index, msg.sender, reason);
    }

    /// @notice Arbiter rules on a disputed milestone. Releasing to the buyer
    /// leaves the bond locked in the vault — call `slashBond` separately if the
    /// dispute also warrants forfeiting it.
    function resolveDispute(uint256 index, bool releaseToSeller) external onlyArbiter {
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.Disputed) revert InvalidMilestoneStatus(index, m.status);

        if (releaseToSeller) {
            _release(index, m, false);
        } else {
            m.status = MilestoneStatus.Refunded;
            _safeTransfer(buyer, m.amount);
        }
        emit DisputeResolved(index, releaseToSeller);
    }

    /// @notice Arbiter forfeits the remaining bond to `to`. Independent of dispute
    /// resolution so it can follow a refunded milestone, where the bond would
    /// otherwise stay locked (the auto-return path only fires when every
    /// milestone reaches Released).
    function slashBond(address to) external onlyArbiter {
        uint256 amount = bondBalance;
        bondBalance = 0;
        _safeTransfer(to, amount);
        emit BondSlashed(to, amount);
    }

    function totalAmount() public view returns (uint256 total) {
        for (uint256 i = 0; i < milestones.length; i++) {
            total += milestones[i].amount;
        }
    }

    function milestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    function _release(uint256 index, Milestone storage m, bool viaDon) private {
        m.status = MilestoneStatus.Released;
        _safeTransfer(seller, m.amount);
        emit MilestoneReleased(index, viaDon);

        if (bondBalance > 0 && _allMilestonesReleased()) {
            uint256 amount = bondBalance;
            bondBalance = 0;
            _safeTransfer(seller, amount);
            emit BondReturned(amount);
        }
    }

    function _allMilestonesReleased() private view returns (bool) {
        for (uint256 i = 0; i < milestones.length; i++) {
            if (milestones[i].status != MilestoneStatus.Released) return false;
        }
        return true;
    }

    function _milestone(uint256 index) private view returns (Milestone storage) {
        if (index >= milestones.length) revert InvalidMilestoneIndex(index);
        return milestones[index];
    }

    function _safeTransfer(address to, uint256 amount) private {
        if (!token.transfer(to, amount)) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        if (!token.transferFrom(from, to, amount)) revert TransferFailed();
    }
}
