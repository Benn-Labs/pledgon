// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {EscrowConfirmationConsumer} from "./EscrowConfirmationConsumer.sol";
import {ComplianceConsumer} from "../compliance/ComplianceConsumer.sol";
import {IEscrowFactory} from "./IEscrowFactory.sol";

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
        Refunded,
        Split
    }

    struct Milestone {
        uint256 amount;
        MilestoneStatus status;
        bytes32 docHash;
        /// @notice block.timestamp when the seller submitted docs; 0 until then.
        /// Anchors `milestoneDeadline` — the buyer's confirmation window starts
        /// once there's actually something for them to confirm, not at trade
        /// creation.
        uint256 docsSubmittedAt;
    }

    /// @notice A buyer/seller-proposed alternative to arbiter dispute
    /// resolution: either party proposes a split, the other accepts it
    /// verbatim, no arbiter involved. Works on a Pending, DocsSubmitted, or
    /// Disputed milestone alike — mutual agreement can short-circuit an
    /// arbiter dispute too.
    struct SettlementProposal {
        uint16 sellerBps;
        address proposedBy;
        bool active;
    }

    /// @notice A buyer/seller-proposed full wind-down of the trade — the
    /// mutual escape hatch for "funded but stuck" (no DON, no cooperation on
    /// individual milestones, nobody wants to bother the arbiter). On
    /// acceptance every still-open milestone refunds to the buyer and any
    /// remaining bond returns to the seller.
    struct TradeExitProposal {
        address proposedBy;
        bool active;
    }

    address public immutable buyer;
    address public immutable seller;
    address public immutable arbiter;
    IERC20 public immutable token;
    uint256 public immutable bondAmount;
    /// @notice Tier-0 (unverified) and tier-1 (basic KYC) volume caps, already
    /// scaled to `token`'s decimals. Tier 2 (enhanced) is uncapped.
    uint256 public immutable tier0Cap;
    uint256 public immutable tier1Cap;
    /// @notice Absolute deadline for `fund()`; 0 means no deadline. Computed
    /// once at construction from the `fundingWindow` duration passed in, so
    /// callers reason in "how long from now," not an absolute timestamp that
    /// could drift against when the deploy tx actually lands.
    uint256 public immutable fundingDeadline;
    /// @notice How long, after `submitMilestoneDocs`, the buyer has to
    /// `confirmMilestone` before anyone may call `expireMilestone`. A
    /// duration, not a timestamp — each milestone's own deadline is
    /// `docsSubmittedAt + milestoneConfirmWindow`, see `milestoneDeadline`.
    /// 0 means no deadline.
    uint256 public immutable milestoneConfirmWindow;
    /// @notice How long, after `fund()`, the seller has to
    /// `submitMilestoneDocs` on a Pending milestone before anyone may call
    /// `expireDelivery` — the mirror image of `milestoneConfirmWindow`: that
    /// one protects the seller from a buyer who never confirms delivery,
    /// this one protects the buyer from a seller who never delivers at all.
    /// Deliberately the same absolute deadline (`fundedAt + deliveryWindow`)
    /// for every milestone rather than one that accounts for earlier
    /// milestones' actual completion time — a trade with a long sequential
    /// timeline should just pick a generous window. 0 means no deadline.
    uint256 public immutable deliveryWindow;
    /// @notice block.timestamp when `fund()` was called; 0 until then.
    /// Anchors `deliveryDeadline`.
    uint256 public fundedAt;
    /// @notice The EscrowFactory that deployed this vault — always msg.sender
    /// during construction, since EscrowFactory is the only deployer. Used to
    /// record this vault's funding volume against the buyer's rolling total.
    IEscrowFactory public immutable factory;
    EscrowConfirmationConsumer public immutable confirmationConsumer;
    ComplianceConsumer public immutable complianceConsumer;

    /// @notice Basis-point denominator for dispute/settlement splits, matching
    /// LendingPool's convention. A sellerBps of 10_000 = 100% to seller.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    Milestone[] public milestones;
    uint256 public bondBalance;
    bool public bondDeposited;
    bool public funded;
    /// @notice Terminal: once true, no further state-changing call succeeds.
    /// Set by either `cancelTrade` (unilateral, pre-funding only) or
    /// `acceptTradeExit` (mutual, any time).
    bool public cancelled;

    mapping(uint256 => SettlementProposal) public settlementProposals;
    TradeExitProposal public tradeExitProposal;

    event BondDeposited(uint256 amount);
    event Funded(uint256 totalAmount);
    event DocsSubmitted(uint256 indexed milestoneIndex, bytes32 docHash);
    event MilestoneReleased(uint256 indexed milestoneIndex, bool viaDon);
    event Disputed(uint256 indexed milestoneIndex, address indexed raisedBy, string reason);
    event DisputeResolved(uint256 indexed milestoneIndex, uint16 sellerBps);
    event BondSlashed(address indexed to, uint256 amount);
    event BondReturned(uint256 amount);
    event TradeCancelled(address indexed canceledBy, uint256 bondRefunded);
    event SettlementProposed(uint256 indexed milestoneIndex, address indexed proposedBy, uint16 sellerBps);
    event SettlementCancelled(uint256 indexed milestoneIndex);
    event SettlementAccepted(uint256 indexed milestoneIndex, uint16 sellerBps);
    event TradeExitProposed(address indexed proposedBy);
    event TradeExitCancelled();
    event TradeExited(uint256 buyerRefund, uint256 sellerBondRefund);
    event FundingExpired(uint256 bondRefunded);
    /// @notice A milestone released to the seller because the buyer never
    /// confirmed it within `milestoneConfirmWindow` of docs being submitted.
    event ConfirmationExpired(uint256 indexed milestoneIndex, uint256 amountReleased);
    /// @notice A milestone refunded to the buyer because the seller never
    /// submitted docs for it within `deliveryWindow` of funding.
    event DeliveryExpired(uint256 indexed milestoneIndex, uint256 amountRefunded);

    error NotBuyer(address caller);
    error NotSeller(address caller);
    error NotArbiter(address caller);
    error NotPartyToTrade(address caller);
    error NotCounterparty(address caller);
    error BondAlreadyDeposited();
    error BondNotDeposited();
    error AlreadyFunded();
    error NotFunded();
    error ComplianceRequired(address buyer, uint256 periodVolume, uint256 cap);
    error InvalidMilestoneIndex(uint256 index);
    error InvalidMilestoneStatus(uint256 index, MilestoneStatus actual);
    error DonNotConfirmed(uint256 index);
    error NoMilestones();
    error TransferFailed();
    error ZeroAddress();
    error ArbiterConflict(address arbiter);
    error AlreadyCancelled();
    error CannotCancelAfterFunded();
    error InvalidSplit(uint16 sellerBps);
    error NoActiveProposal(uint256 index);
    error NoActiveExitProposal();
    error TradeAlreadySettled();
    error FundingDeadlinePassed();
    error FundingNotYetExpired();
    error MilestoneNotYetExpired();
    error DeliveryNotYetExpired();

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

    modifier onlyParty() {
        if (msg.sender != buyer && msg.sender != seller) revert NotPartyToTrade(msg.sender);
        _;
    }

    modifier notCancelled() {
        if (cancelled) revert AlreadyCancelled();
        _;
    }

    constructor(
        address _buyer,
        address _seller,
        address _arbiter,
        IERC20 _token,
        uint256 _bondAmount,
        uint256[] memory _milestoneAmounts,
        uint256 _tier0Cap,
        uint256 _tier1Cap,
        EscrowConfirmationConsumer _confirmationConsumer,
        ComplianceConsumer _complianceConsumer,
        uint256 _fundingWindow,
        uint256 _milestoneConfirmWindow,
        uint256 _deliveryWindow
    ) {
        if (_milestoneAmounts.length == 0) revert NoMilestones();
        if (
            _buyer == address(0) || _seller == address(0) || address(_token) == address(0)
                || address(_confirmationConsumer) == address(0) || address(_complianceConsumer) == address(0)
        ) revert ZeroAddress();
        // Arbiter is the one address allowed to be zero: address(0) means "no
        // arbiter" by design, not a misconfiguration. `onlyArbiter` then
        // matches no real caller, so resolveDispute/slashBond are
        // permanently inert on this vault — mutual settlement (and, once
        // funded, trade exit) become the only escape paths.
        // An arbiter who is also a party to the trade can't neutrally resolve
        // a dispute involving themselves — reject that regardless of which
        // path created this vault (direct EscrowFactory call or
        // Marketplace.purchase()).
        if (_arbiter == _buyer || _arbiter == _seller) revert ArbiterConflict(_arbiter);

        buyer = _buyer;
        seller = _seller;
        arbiter = _arbiter;
        token = _token;
        bondAmount = _bondAmount;
        tier0Cap = _tier0Cap;
        tier1Cap = _tier1Cap;
        factory = IEscrowFactory(msg.sender);
        confirmationConsumer = _confirmationConsumer;
        complianceConsumer = _complianceConsumer;
        fundingDeadline = _fundingWindow == 0 ? 0 : block.timestamp + _fundingWindow;
        milestoneConfirmWindow = _milestoneConfirmWindow;
        deliveryWindow = _deliveryWindow;

        for (uint256 i = 0; i < _milestoneAmounts.length; i++) {
            milestones.push(
                Milestone({amount: _milestoneAmounts[i], status: MilestoneStatus.Pending, docHash: bytes32(0), docsSubmittedAt: 0})
            );
        }
    }

    /// @notice Seller posts the performance bond. Required before `fund()` only
    /// when `bondAmount > 0`.
    function depositBond() external onlySeller notCancelled {
        if (bondDeposited) revert BondAlreadyDeposited();
        bondDeposited = true;
        bondBalance = bondAmount;
        if (bondAmount > 0) {
            _safeTransferFrom(seller, address(this), bondAmount);
        }
        emit BondDeposited(bondAmount);
    }

    /// @notice Buyer funds all milestones in one transfer. Requires the buyer's
    /// rolling trading volume (this trade included) to stay within their
    /// compliance tier's cap — see EscrowFactory for how that volume is tracked
    /// and ComplianceConsumer for how the tier is determined.
    function fund() external onlyBuyer notCancelled {
        if (bondAmount > 0 && !bondDeposited) revert BondNotDeposited();
        if (funded) revert AlreadyFunded();
        if (fundingDeadline != 0 && block.timestamp >= fundingDeadline) revert FundingDeadlinePassed();

        uint256 total = totalAmount();
        uint256 periodVolume = factory.recordVolume(buyer, total);
        uint256 cap = _capForTier(complianceConsumer.tierOf(buyer));
        if (periodVolume > cap) revert ComplianceRequired(buyer, periodVolume, cap);

        funded = true;
        fundedAt = block.timestamp;
        _safeTransferFrom(buyer, address(this), total);
        emit Funded(total);
    }

    function submitMilestoneDocs(uint256 index, bytes32 docHash) external onlySeller notCancelled {
        if (!funded) revert NotFunded();
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.Pending) revert InvalidMilestoneStatus(index, m.status);
        m.docHash = docHash;
        m.status = MilestoneStatus.DocsSubmitted;
        m.docsSubmittedAt = block.timestamp;
        emit DocsSubmitted(index, docHash);
    }

    /// @notice Buyer confirms delivery for a milestone the seller has submitted
    /// docs for, releasing its payment.
    function confirmMilestone(uint256 index) external onlyBuyer notCancelled {
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.DocsSubmitted) revert InvalidMilestoneStatus(index, m.status);
        _release(index, m, false);
    }

    /// @notice Permissionless relay: anyone may call once the DON has attested the
    /// off-chain condition for this milestone. Safe because the real check is
    /// `confirmationConsumer.isConfirmed`, not the caller's identity — this lets a
    /// keeper or the seller trigger release without waiting on the buyer.
    function releaseMilestoneViaDon(uint256 index) external notCancelled {
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.DocsSubmitted) {
            revert InvalidMilestoneStatus(index, m.status);
        }
        if (!confirmationConsumer.isConfirmed(address(this), index)) revert DonNotConfirmed(index);
        _release(index, m, true);
    }

    function disputeMilestone(uint256 index, string calldata reason) external notCancelled onlyParty {
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.DocsSubmitted) {
            revert InvalidMilestoneStatus(index, m.status);
        }
        m.status = MilestoneStatus.Disputed;
        emit Disputed(index, msg.sender, reason);
    }

    /// @notice Arbiter rules on a disputed milestone with a seller/buyer split.
    /// `sellerBps == BPS_DENOMINATOR` is a full release to seller (same
    /// bond-auto-return behavior as any other full release); `sellerBps == 0`
    /// is a full refund to buyer; anything between is a genuine split, which
    /// leaves the bond locked in the vault exactly like a full refund does —
    /// call `slashBond` separately if the dispute also warrants forfeiting it.
    function resolveDispute(uint256 index, uint16 sellerBps) external onlyArbiter notCancelled {
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.Disputed) revert InvalidMilestoneStatus(index, m.status);
        if (sellerBps > BPS_DENOMINATOR) revert InvalidSplit(sellerBps);

        // A mutual settlement negotiation may still be sitting active on this
        // index — the arbiter's ruling takes precedence, so clear it rather
        // than leave a stale proposal an old counterparty could later accept
        // against an already-settled milestone.
        delete settlementProposals[index];

        if (sellerBps == BPS_DENOMINATOR) {
            _release(index, m, false);
        } else if (sellerBps == 0) {
            m.status = MilestoneStatus.Refunded;
            _safeTransfer(buyer, m.amount);
            _maybeReturnBond();
        } else {
            uint256 sellerAmount = (m.amount * sellerBps) / BPS_DENOMINATOR;
            uint256 buyerAmount = m.amount - sellerAmount;
            m.status = MilestoneStatus.Split;
            _safeTransfer(seller, sellerAmount);
            _safeTransfer(buyer, buyerAmount);
            _maybeReturnBond();
        }
        emit DisputeResolved(index, sellerBps);
    }

    /// @notice Arbiter forfeits the remaining bond to `to`. Independent of dispute
    /// resolution, for the case where the arbiter wants to seize the bond
    /// (not just let it eventually auto-return) — e.g. mid-trade, before every
    /// milestone has settled.
    function slashBond(address to) external onlyArbiter notCancelled {
        uint256 amount = bondBalance;
        bondBalance = 0;
        _safeTransfer(to, amount);
        emit BondSlashed(to, amount);
    }

    /// @notice Either party unilaterally walks away before funding — nothing
    /// but the seller's own bond is at stake yet, so no counterparty consent
    /// is needed. Refunds any deposited bond to the seller and permanently
    /// closes the vault. Use `proposeTradeExit`/`acceptTradeExit` once funded.
    function cancelTrade() external notCancelled onlyParty {
        if (funded) revert CannotCancelAfterFunded();
        cancelled = true;

        uint256 refund = bondBalance;
        if (refund > 0) {
            bondBalance = 0;
            _safeTransfer(seller, refund);
        }
        emit TradeCancelled(msg.sender, refund);
    }

    /// @notice Permissionless: anyone may call once `fundingDeadline` has passed
    /// without the buyer funding. Same refund shape as `cancelTrade` (bond
    /// back to the seller, vault permanently closed) — the only difference is
    /// who may trigger it and why: a missed deadline instead of a party's own
    /// choice to walk away.
    function expireFunding() external notCancelled {
        if (funded) revert AlreadyFunded();
        if (fundingDeadline == 0 || block.timestamp < fundingDeadline) revert FundingNotYetExpired();
        cancelled = true;

        uint256 refund = bondBalance;
        if (refund > 0) {
            bondBalance = 0;
            _safeTransfer(seller, refund);
        }
        emit FundingExpired(refund);
    }

    /// @notice Permissionless: anyone may call once a milestone has sat in
    /// DocsSubmitted for longer than `milestoneConfirmWindow` without the
    /// buyer confirming it. Releases that milestone to the seller — silence
    /// past the confirmation window counts as accepted delivery, same as a
    /// real-world "no response in N days" auto-release. A buyer with an
    /// actual problem must `disputeMilestone` before this window closes;
    /// once it's closed, inaction can no longer win them a refund. A third
    /// racer alongside `confirmMilestone`/`releaseMilestoneViaDon`, exactly
    /// like those two already race each other.
    function expireMilestone(uint256 index) external notCancelled {
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.DocsSubmitted) revert InvalidMilestoneStatus(index, m.status);
        if (milestoneConfirmWindow == 0 || block.timestamp < m.docsSubmittedAt + milestoneConfirmWindow) {
            revert MilestoneNotYetExpired();
        }
        uint256 amount = m.amount;
        _release(index, m, false);
        emit ConfirmationExpired(index, amount);
    }

    /// @notice Permissionless: anyone may call once a milestone has sat in
    /// Pending for longer than `deliveryWindow` since funding, without the
    /// seller ever submitting docs. Refunds that milestone's stake to the
    /// buyer — the mirror image of `expireMilestone`: there, buyer silence
    /// after delivery favors the seller; here, seller silence before any
    /// delivery favors the buyer.
    function expireDelivery(uint256 index) external notCancelled {
        if (!funded) revert NotFunded();
        Milestone storage m = _milestone(index);
        if (m.status != MilestoneStatus.Pending) revert InvalidMilestoneStatus(index, m.status);
        if (deliveryWindow == 0 || block.timestamp < fundedAt + deliveryWindow) revert DeliveryNotYetExpired();
        delete settlementProposals[index];
        m.status = MilestoneStatus.Refunded;
        _safeTransfer(buyer, m.amount);
        _maybeReturnBond();
        emit DeliveryExpired(index, m.amount);
    }

    /// @notice Absolute deadline for confirming this milestone once the seller
    /// has submitted docs; 0 if docs aren't submitted yet or no window is
    /// configured for this trade.
    function milestoneDeadline(uint256 index) external view returns (uint256) {
        Milestone storage m = _milestone(index);
        if (milestoneConfirmWindow == 0 || m.status != MilestoneStatus.DocsSubmitted) return 0;
        return m.docsSubmittedAt + milestoneConfirmWindow;
    }

    /// @notice Absolute deadline for the seller to submit docs for this
    /// milestone; 0 if not yet funded, the milestone isn't Pending, or no
    /// delivery window is configured for this trade.
    function deliveryDeadline(uint256 index) external view returns (uint256) {
        Milestone storage m = _milestone(index);
        if (deliveryWindow == 0 || !funded || m.status != MilestoneStatus.Pending) return 0;
        return fundedAt + deliveryWindow;
    }

    /// @notice Propose a split for one disputed-or-open milestone that both
    /// parties can settle directly, no arbiter needed. Works on Pending,
    /// DocsSubmitted, or Disputed milestones — mutual agreement can
    /// short-circuit an arbiter dispute too.
    function proposeSettlement(uint256 index, uint16 sellerBps) external notCancelled onlyParty {
        Milestone storage m = _milestone(index);
        if (
            m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.DocsSubmitted
                && m.status != MilestoneStatus.Disputed
        ) revert InvalidMilestoneStatus(index, m.status);
        if (sellerBps > BPS_DENOMINATOR) revert InvalidSplit(sellerBps);

        settlementProposals[index] = SettlementProposal({sellerBps: sellerBps, proposedBy: msg.sender, active: true});
        emit SettlementProposed(index, msg.sender, sellerBps);
    }

    function cancelSettlementProposal(uint256 index) external {
        SettlementProposal memory p = settlementProposals[index];
        if (!p.active) revert NoActiveProposal(index);
        if (msg.sender != p.proposedBy) revert NotPartyToTrade(msg.sender);
        delete settlementProposals[index];
        emit SettlementCancelled(index);
    }

    /// @notice The counterparty accepts a pending settlement proposal exactly
    /// as proposed, executing the split immediately. Re-checks the milestone's
    /// status even though `proposeSettlement` already checked it once — the
    /// milestone could have been resolved through an entirely different path
    /// (the arbiter, a direct confirm) while this proposal sat active, and
    /// accepting a stale proposal against an already-settled milestone would
    /// pay out twice.
    function acceptSettlement(uint256 index) external notCancelled {
        SettlementProposal memory p = settlementProposals[index];
        if (!p.active) revert NoActiveProposal(index);
        address counterparty = p.proposedBy == buyer ? seller : buyer;
        if (msg.sender != counterparty) revert NotCounterparty(msg.sender);

        Milestone storage m = _milestone(index);
        if (
            m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.DocsSubmitted
                && m.status != MilestoneStatus.Disputed
        ) revert InvalidMilestoneStatus(index, m.status);
        delete settlementProposals[index];

        if (p.sellerBps == BPS_DENOMINATOR) {
            _release(index, m, false);
        } else if (p.sellerBps == 0) {
            m.status = MilestoneStatus.Refunded;
            _safeTransfer(buyer, m.amount);
            _maybeReturnBond();
        } else {
            uint256 sellerAmount = (m.amount * p.sellerBps) / BPS_DENOMINATOR;
            uint256 buyerAmount = m.amount - sellerAmount;
            m.status = MilestoneStatus.Split;
            _safeTransfer(seller, sellerAmount);
            _safeTransfer(buyer, buyerAmount);
            _maybeReturnBond();
        }
        emit SettlementAccepted(index, p.sellerBps);
    }

    /// @notice Propose winding the whole trade down — the mutual escape hatch
    /// for a funded trade that's stuck with no DON and no per-milestone
    /// agreement. Available whether or not the trade is funded, so a bond
    /// deposited pre-funding isn't stranded either. Refused once every
    /// milestone has already settled — a trade that finished normally has
    /// nothing left to wind down, and accepting such a proposal would only
    /// relabel a successfully Completed trade as Cancelled.
    function proposeTradeExit() external notCancelled onlyParty {
        if (funded && _allMilestonesSettled()) revert TradeAlreadySettled();
        tradeExitProposal = TradeExitProposal({proposedBy: msg.sender, active: true});
        emit TradeExitProposed(msg.sender);
    }

    function cancelTradeExitProposal() external {
        if (!tradeExitProposal.active) revert NoActiveExitProposal();
        if (msg.sender != tradeExitProposal.proposedBy) revert NotPartyToTrade(msg.sender);
        delete tradeExitProposal;
        emit TradeExitCancelled();
    }

    /// @notice The counterparty accepts a pending trade-exit proposal: every
    /// still-open milestone (Pending, DocsSubmitted, or Disputed) refunds to
    /// the buyer, any remaining bond returns to the seller, and the vault is
    /// permanently closed.
    function acceptTradeExit() external notCancelled {
        TradeExitProposal memory p = tradeExitProposal;
        if (!p.active) revert NoActiveExitProposal();
        address counterparty = p.proposedBy == buyer ? seller : buyer;
        if (msg.sender != counterparty) revert NotCounterparty(msg.sender);
        // Re-check even though propose already did: the trade could have
        // finished normally in the time between propose and accept.
        if (funded && _allMilestonesSettled()) revert TradeAlreadySettled();

        delete tradeExitProposal;
        cancelled = true;

        uint256 buyerRefund;
        if (funded) {
            for (uint256 i = 0; i < milestones.length; i++) {
                Milestone storage m = milestones[i];
                if (
                    m.status == MilestoneStatus.Pending || m.status == MilestoneStatus.DocsSubmitted
                        || m.status == MilestoneStatus.Disputed
                ) {
                    buyerRefund += m.amount;
                    m.status = MilestoneStatus.Refunded;
                    delete settlementProposals[i];
                }
            }
            if (buyerRefund > 0) _safeTransfer(buyer, buyerRefund);
        }

        uint256 sellerBondRefund = bondBalance;
        if (sellerBondRefund > 0) {
            bondBalance = 0;
            _safeTransfer(seller, sellerBondRefund);
        }

        emit TradeExited(buyerRefund, sellerBondRefund);
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
        delete settlementProposals[index];
        _safeTransfer(seller, m.amount);
        emit MilestoneReleased(index, viaDon);
        _maybeReturnBond();
    }

    /// @notice Returns any remaining bond to the seller once every milestone
    /// has reached a terminal, settled state (Released, Refunded, or Split).
    /// Deliberately broader than "every milestone Released" — a milestone
    /// resolved as a refund or split elsewhere in the trade (a dispute
    /// ruling, a mutual settlement, or a delivery-deadline expiry) shouldn't
    /// strand the bond forever with no arbiter around to `slashBond` it
    /// loose. Safe to call after any terminal transition; a no-op if the
    /// bond is already empty or milestones remain open.
    function _maybeReturnBond() private {
        if (bondBalance > 0 && _allMilestonesSettled()) {
            uint256 amount = bondBalance;
            bondBalance = 0;
            _safeTransfer(seller, amount);
            emit BondReturned(amount);
        }
    }

    /// @notice True once every milestone has reached a terminal, paid-out
    /// status — Released, Refunded, or Split. Gates both the bond
    /// auto-return path (`_maybeReturnBond`) and trade-exit eligibility.
    function _allMilestonesSettled() private view returns (bool) {
        for (uint256 i = 0; i < milestones.length; i++) {
            MilestoneStatus s = milestones[i].status;
            if (s != MilestoneStatus.Released && s != MilestoneStatus.Refunded && s != MilestoneStatus.Split) {
                return false;
            }
        }
        return true;
    }

    function _milestone(uint256 index) private view returns (Milestone storage) {
        if (index >= milestones.length) revert InvalidMilestoneIndex(index);
        return milestones[index];
    }

    function _capForTier(uint8 tier) private view returns (uint256) {
        if (tier == 0) return tier0Cap;
        if (tier == 1) return tier1Cap;
        return type(uint256).max;
    }

    function _safeTransfer(address to, uint256 amount) private {
        if (!token.transfer(to, amount)) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        if (!token.transferFrom(from, to, amount)) revert TransferFailed();
    }
}
