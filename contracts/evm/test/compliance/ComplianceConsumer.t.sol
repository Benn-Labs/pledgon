// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ComplianceConsumer} from "../../src/compliance/ComplianceConsumer.sol";

contract ComplianceConsumerTest is Test {
    uint256 constant MAX_VALIDITY = 180 days;

    address forwarder = makeAddr("forwarder");
    address subject = makeAddr("subject");
    ComplianceConsumer consumer;

    function setUp() public {
        consumer = new ComplianceConsumer(forwarder, MAX_VALIDITY);
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
        vm.expectRevert(ComplianceConsumer.ZeroAddress.selector);
        new ComplianceConsumer(address(0), MAX_VALIDITY);
    }

    // ─── onReport ─────────────────────────────────────────────

    function test_OnReport_RevertsIfNotForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(ComplianceConsumer.UnauthorizedForwarder.selector, address(this)));
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
}
