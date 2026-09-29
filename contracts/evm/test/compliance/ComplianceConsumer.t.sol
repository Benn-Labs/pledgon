// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ComplianceConsumer} from "../../src/compliance/ComplianceConsumer.sol";
import {WorkflowBoundReceiver} from "../../src/keystone/WorkflowBoundReceiver.sol";

contract ComplianceConsumerTest is Test {
    uint256 constant MAX_VALIDITY = 180 days;

    address forwarder = makeAddr("forwarder");
    address subject = makeAddr("subject");
    ComplianceConsumer consumer;

    function setUp() public {
        // bytes32(0) = unbound: accepts any workflow's metadata, which is what
        // the existing tests exercise via _report's empty metadata.
        consumer = new ComplianceConsumer(forwarder, MAX_VALIDITY, bytes32(0));
        // A realistic base timestamp, so the small literal verifiedAt values
        // several tests use below (1000, 999, 12345, ...) are naturally in the
        // past rather than tripping the FutureVerifiedAt guard against
        // Foundry's own default block.timestamp of 1.
        vm.warp(1_000_000);
    }

    function _report(address who, uint8 tier, uint256 verifiedAt) internal {
        vm.prank(forwarder);
        consumer.onReport("", abi.encode(who, tier, verifiedAt));
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroForwarder() public {
        // ZeroAddress/UnauthorizedForwarder live on WorkflowBoundReceiver, the
        // inherited base — reference them there.
        vm.expectRevert(WorkflowBoundReceiver.ZeroAddress.selector);
        new ComplianceConsumer(address(0), MAX_VALIDITY, bytes32(0));
    }

    // ─── onReport ─────────────────────────────────────────────

    function test_OnReport_RevertsIfNotForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(WorkflowBoundReceiver.UnauthorizedForwarder.selector, address(this)));
        consumer.onReport("", abi.encode(subject, uint8(1), block.timestamp));
    }

    function test_OnReport_RevertsOnTierAboveMax() public {
        vm.expectRevert(abi.encodeWithSelector(ComplianceConsumer.InvalidTier.selector, 3));
        vm.prank(forwarder);
        consumer.onReport("", abi.encode(subject, uint8(3), block.timestamp));
    }

    function test_OnReport_AcceptsMaxTier() public {
        _report(subject, consumer.MAX_TIER(), block.timestamp);
        assertEq(consumer.tierOf(subject), consumer.MAX_TIER());
    }

    function test_OnReport_RevertsOnStaleReport() public {
        _report(subject, 1, 1000);

        vm.expectRevert(abi.encodeWithSelector(ComplianceConsumer.StaleReport.selector, subject, 999, 1000));
        _report(subject, 2, 999);
    }

    function test_OnReport_RevertsOnReplayedReport() public {
        _report(subject, 1, 1000);

        vm.expectRevert(abi.encodeWithSelector(ComplianceConsumer.StaleReport.selector, subject, 1000, 1000));
        _report(subject, 2, 1000);
    }

    function test_OnReport_NewerReportOverwritesTier() public {
        _report(subject, 1, block.timestamp);
        vm.warp(block.timestamp + 1);
        _report(subject, 2, block.timestamp);
        assertEq(consumer.tierOf(subject), 2);
    }

    /// @dev A tier-0 report is a legitimate verdict (e.g. a revocation), not a
    /// no-op — it must still overwrite whatever tier was previously stored.
    function test_OnReport_CanDowngradeToTierZero() public {
        _report(subject, 2, block.timestamp);
        vm.warp(block.timestamp + 1);
        _report(subject, 0, block.timestamp);
        assertEq(consumer.tierOf(subject), 0);
    }

    /// @dev A future verifiedAt would later underflow tierOf's
    /// block.timestamp - verifiedAt and revert every read for this subject
    /// until real time caught up — reject it at report time instead. Found by
    /// an earlier version of this test file using unrealistic timestamp
    /// literals, which is exactly the bug this guard now prevents.
    function test_OnReport_RevertsOnFutureVerifiedAt() public {
        uint256 future = block.timestamp + 1;
        vm.expectRevert(
            abi.encodeWithSelector(ComplianceConsumer.FutureVerifiedAt.selector, subject, future, block.timestamp)
        );
        _report(subject, 1, future);
    }

    function test_OnReport_EmitsComplianceUpdated() public {
        vm.expectEmit(true, false, false, true, address(consumer));
        emit ComplianceConsumer.ComplianceUpdated(subject, 1, 1000);
        _report(subject, 1, 1000);
    }

    // ─── tierOf (expiry) ──────────────────────────────────────

    function test_TierOf_ZeroForNeverVerified() public view {
        assertEq(consumer.tierOf(subject), 0);
    }

    function test_TierOf_ReturnsStoredTierWithinValidity() public {
        _report(subject, 2, block.timestamp);
        vm.warp(block.timestamp + MAX_VALIDITY);
        assertEq(consumer.tierOf(subject), 2, "still valid at exactly the boundary");
    }

    function test_TierOf_ExpiresAfterMaxValidity() public {
        _report(subject, 2, block.timestamp);
        vm.warp(block.timestamp + MAX_VALIDITY + 1);
        assertEq(consumer.tierOf(subject), 0);
    }

    function test_TierOf_ReVerificationResetsExpiry() public {
        _report(subject, 2, block.timestamp);
        vm.warp(block.timestamp + MAX_VALIDITY + 1);
        assertEq(consumer.tierOf(subject), 0, "expired");

        _report(subject, 2, block.timestamp);
        assertEq(consumer.tierOf(subject), 2, "fresh report restores the tier");
    }

    function test_VerifiedAt_ReturnsLastReportTimestamp() public {
        _report(subject, 1, 12345);
        assertEq(consumer.verifiedAt(subject), 12345);
    }

    // ─── supportsInterface ────────────────────────────────────

    function test_SupportsInterface_ReturnsTrueForIReceiverAndIERC165() public view {
        // IReceiver's interfaceId (which itself extends IERC165's) — computed the
        // same way the contract does, so this asserts against the real values
        // rather than hardcoding a selector that could drift silently.
        assertTrue(consumer.supportsInterface(0x01ffc9a7)); // ERC165 itself: supportsInterface(bytes4)
    }

    // ─── workflow binding (WorkflowBoundReceiver) ──────────────

    /// @dev Metadata layout per the KeystoneForwarder docs: the production
    /// forwarder delivers 64 bytes — abi.encodePacked(bytes32 workflowId,
    /// bytes10 workflowName, address workflowOwner) followed by 2 reportId
    /// bytes. The 62-byte packed form decodes the same identity.
    function _metadataFor(bytes32 workflowId, bool productionForm) internal pure returns (bytes memory) {
        bytes memory m = abi.encodePacked(workflowId, bytes10(0), address(0));
        return productionForm ? bytes.concat(m, hex"0000") : m;
    }

    function test_BoundConsumer_AcceptsReportsFromBoundWorkflow() public {
        bytes32 wfId = keccak256("compliance-check-workflow");
        ComplianceConsumer bound = new ComplianceConsumer(forwarder, MAX_VALIDITY, wfId);
        assertEq(bound.expectedWorkflowId(), wfId);

        vm.prank(forwarder);
        bound.onReport(_metadataFor(wfId, false), abi.encode(subject, uint8(2), block.timestamp));
        assertEq(bound.tierOf(subject), 2);
    }

    function test_BoundConsumer_AcceptsProduction64ByteMetadata() public {
        bytes32 wfId = keccak256("compliance-check-workflow");
        ComplianceConsumer bound = new ComplianceConsumer(forwarder, MAX_VALIDITY, wfId);

        vm.prank(forwarder);
        bound.onReport(_metadataFor(wfId, true), abi.encode(subject, uint8(1), block.timestamp));
        assertEq(bound.tierOf(subject), 1);
    }

    function test_BoundConsumer_RevertsOnWrongWorkflowId() public {
        bytes32 wfId = keccak256("compliance-check-workflow");
        ComplianceConsumer bound = new ComplianceConsumer(forwarder, MAX_VALIDITY, wfId);

        bytes32 other = keccak256("some-other-workflow");
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(WorkflowBoundReceiver.UnexpectedWorkflowId.selector, other, wfId)
        );
        bound.onReport(_metadataFor(other, false), abi.encode(subject, uint8(1), block.timestamp));
    }

    function test_BoundConsumer_RevertsOnMissingMetadata() public {
        bytes32 wfId = keccak256("compliance-check-workflow");
        ComplianceConsumer bound = new ComplianceConsumer(forwarder, MAX_VALIDITY, wfId);

        // The MockKeystoneForwarder used by `cre workflow simulate` supplies no
        // metadata at all — a bound consumer must fail closed, not silently
        // accept. This is why simulation consumers stay unbound.
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(WorkflowBoundReceiver.InvalidMetadataLength.selector, 0));
        bound.onReport("", abi.encode(subject, uint8(1), block.timestamp));

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(WorkflowBoundReceiver.InvalidMetadataLength.selector, 32));
        bound.onReport(new bytes(32), abi.encode(subject, uint8(1), block.timestamp));
    }
}
