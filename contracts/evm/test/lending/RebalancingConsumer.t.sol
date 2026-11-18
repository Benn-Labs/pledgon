// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {RebalancingConsumer} from "../../src/lending/RebalancingConsumer.sol";
import {WorkflowBoundReceiver} from "../../src/keystone/WorkflowBoundReceiver.sol";
import {IReceiver} from "../../src/keystone/IReceiver.sol";

contract RebalancingConsumerTest is Test {
    address forwarder = makeAddr("forwarder");
    address borrower = makeAddr("borrower");

    RebalancingConsumer consumer;

    function setUp() public {
        consumer = new RebalancingConsumer(forwarder, 15 minutes, bytes32(0));
    }

    function _report(address who, bool advised, uint256 checkedAt) internal pure returns (bytes memory) {
        return abi.encode(who, advised, checkedAt);
    }

    function test_Constructor_RevertsOnZeroForwarder() public {
        vm.expectRevert(WorkflowBoundReceiver.ZeroAddress.selector);
        new RebalancingConsumer(address(0), 15 minutes, bytes32(0));
    }

    function test_OnReport_StoresAdvisedVerdict() public {
        vm.prank(forwarder);
        consumer.onReport("", _report(borrower, true, block.timestamp));

        assertTrue(consumer.isAdvised(borrower));
        assertEq(consumer.checkedAt(borrower), block.timestamp);
    }

    function test_OnReport_StoresNotAdvisedVerdict() public {
        vm.prank(forwarder);
        consumer.onReport("", _report(borrower, false, block.timestamp));

        assertFalse(consumer.isAdvised(borrower));
        assertEq(consumer.checkedAt(borrower), block.timestamp);
    }

    function test_OnReport_EmitsVerdictUpdated() public {
        vm.expectEmit(true, false, false, true, address(consumer));
        emit RebalancingConsumer.VerdictUpdated(borrower, true, block.timestamp);
        vm.prank(forwarder);
        consumer.onReport("", _report(borrower, true, block.timestamp));
    }

    function test_OnReport_RevertsFromNonForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(WorkflowBoundReceiver.UnauthorizedForwarder.selector, address(this)));
        consumer.onReport("", _report(borrower, true, block.timestamp));
    }

    function test_OnReport_RevertsFutureCheckedAt() public {
        uint256 future = block.timestamp + 1 hours;
        vm.expectRevert(
            abi.encodeWithSelector(RebalancingConsumer.FutureCheckedAt.selector, borrower, future, block.timestamp)
        );
        vm.prank(forwarder);
        consumer.onReport("", _report(borrower, true, future));
    }

    function test_OnReport_RevertsStaleReport() public {
        vm.startPrank(forwarder);
        consumer.onReport("", _report(borrower, true, block.timestamp));

        vm.expectRevert(
            abi.encodeWithSelector(
                RebalancingConsumer.StaleReport.selector, borrower, block.timestamp - 1, block.timestamp
            )
        );
        consumer.onReport("", _report(borrower, false, block.timestamp - 1));
        vm.stopPrank();
    }

    function test_OnReport_NewerReportOverwrites() public {
        vm.startPrank(forwarder);
        consumer.onReport("", _report(borrower, true, block.timestamp));
        vm.warp(block.timestamp + 1);
        consumer.onReport("", _report(borrower, false, block.timestamp));
        vm.stopPrank();

        assertFalse(consumer.isAdvised(borrower));
        assertEq(consumer.checkedAt(borrower), block.timestamp);
    }

    function test_IsAdvised_ExpiresWithMaxVerdictAge() public {
        vm.prank(forwarder);
        consumer.onReport("", _report(borrower, true, block.timestamp));
        assertTrue(consumer.isAdvised(borrower));

        vm.warp(block.timestamp + 16 minutes);
        assertFalse(consumer.isAdvised(borrower), "a verdict older than maxVerdictAge must read back false");
    }

    function test_IsAdvised_AdvisedWithinMaxVerdictAge() public {
        vm.prank(forwarder);
        consumer.onReport("", _report(borrower, true, block.timestamp));

        vm.warp(block.timestamp + 14 minutes);
        assertTrue(consumer.isAdvised(borrower));
    }

    function test_IsAdvised_ZeroMaxVerdictAgeDisablesExpiry() public {
        RebalancingConsumer noExpiry = new RebalancingConsumer(forwarder, 0, bytes32(0));
        vm.prank(forwarder);
        noExpiry.onReport("", _report(borrower, true, block.timestamp));

        vm.warp(block.timestamp + 365 days);
        assertTrue(noExpiry.isAdvised(borrower));
    }

    function test_IsAdvised_UnknownBorrowerReadsFalse() public {
        assertFalse(consumer.isAdvised(makeAddr("nobody")));
        assertEq(consumer.checkedAt(makeAddr("nobody")), 0);
    }

    function test_OnReport_RejectsWrongWorkflowId() public {
        bytes32 expectedId = bytes32(uint256(0xA11CE));
        RebalancingConsumer bound = new RebalancingConsumer(forwarder, 15 minutes, expectedId);

        bytes memory metadata = abi.encodePacked(bytes32(uint256(0xB0B)), bytes10("other"), makeAddr("owner"));
        vm.expectRevert(
            abi.encodeWithSelector(
                WorkflowBoundReceiver.UnexpectedWorkflowId.selector, bytes32(uint256(0xB0B)), expectedId
            )
        );
        vm.prank(forwarder);
        bound.onReport(metadata, _report(borrower, true, block.timestamp));
    }

    function test_SupportsInterface() public view {
        assertTrue(consumer.supportsInterface(type(IReceiver).interfaceId));
    }
}
