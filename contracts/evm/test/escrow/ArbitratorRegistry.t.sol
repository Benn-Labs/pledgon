// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArbitratorRegistry} from "../../src/escrow/ArbitratorRegistry.sol";

contract ArbitratorRegistryTest is Test {
    address owner = makeAddr("owner");
    address stranger = makeAddr("stranger");
    address candidate = makeAddr("candidate");

    ArbitratorRegistry registry;

    function setUp() public {
        registry = new ArbitratorRegistry(owner);
    }

    // ─── Constructor ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(ArbitratorRegistry.ZeroAddress.selector);
        new ArbitratorRegistry(address(0));
    }

    function test_Constructor_SetsOwner() public view {
        assertEq(registry.owner(), owner);
    }

    // ─── accredit / revoke ──────────────────────────────────────

    function test_Accredit_RevertsIfNotOwner() public {
        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.NotOwner.selector, stranger));
        vm.prank(stranger);
        registry.accredit(candidate);
    }

    function test_Accredit_RevertsOnZeroAddress() public {
        vm.expectRevert(ArbitratorRegistry.ZeroAddress.selector);
        vm.prank(owner);
        registry.accredit(address(0));
    }

    function test_Accredit_MarksAddressAccreditedAndEmits() public {
        vm.expectEmit(true, false, false, false, address(registry));
        emit ArbitratorRegistry.ArbitratorAccredited(candidate);
        vm.prank(owner);
        registry.accredit(candidate);

        assertTrue(registry.isAccredited(candidate));
    }

    function test_Revoke_RevertsIfNotOwner() public {
        vm.prank(owner);
        registry.accredit(candidate);

        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.NotOwner.selector, stranger));
        vm.prank(stranger);
        registry.revoke(candidate);
    }

    function test_Revoke_UnmarksAddressAndEmits() public {
        vm.prank(owner);
        registry.accredit(candidate);

        vm.expectEmit(true, false, false, false, address(registry));
        emit ArbitratorRegistry.ArbitratorRevoked(candidate);
        vm.prank(owner);
        registry.revoke(candidate);

        assertFalse(registry.isAccredited(candidate));
    }

    function test_IsAccredited_FalseForNeverAccredited() public view {
        assertFalse(registry.isAccredited(candidate));
    }

    function test_AllAccredited_RecordsEachAddressOnce() public {
        address second = makeAddr("second");
        vm.startPrank(owner);
        registry.accredit(candidate);
        registry.accredit(second);
        vm.stopPrank();

        assertEq(registry.accreditedCount(), 2);
        assertEq(registry.allAccredited(0), candidate);
        assertEq(registry.allAccredited(1), second);
    }

    function test_AllAccredited_ReAccreditingDoesNotDuplicate() public {
        vm.startPrank(owner);
        registry.accredit(candidate);
        registry.accredit(candidate);
        vm.stopPrank();

        assertEq(registry.accreditedCount(), 1);
    }

    /// @dev The enumeration is an append-only history, not "currently
    /// accredited" — callers must still check isAccredited per entry, same
    /// as EscrowFactory.allVaults() combined with per-vault state reads.
    function test_AllAccredited_KeepsRevokedAddressListedButNotAccredited() public {
        vm.startPrank(owner);
        registry.accredit(candidate);
        registry.revoke(candidate);
        vm.stopPrank();

        assertEq(registry.accreditedCount(), 1);
        assertEq(registry.allAccredited(0), candidate);
        assertFalse(registry.isAccredited(candidate));
    }

    // ─── transferOwnership ──────────────────────────────────────

    function test_TransferOwnership_RevertsIfNotOwner() public {
        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.NotOwner.selector, stranger));
        vm.prank(stranger);
        registry.transferOwnership(stranger);
    }

    function test_TransferOwnership_RevertsOnZeroAddress() public {
        vm.expectRevert(ArbitratorRegistry.ZeroAddress.selector);
        vm.prank(owner);
        registry.transferOwnership(address(0));
    }

    function test_TransferOwnership_UpdatesOwnerAndEmits() public {
        address newOwner = makeAddr("newOwner");
        vm.expectEmit(true, true, false, false, address(registry));
        emit ArbitratorRegistry.OwnershipTransferred(owner, newOwner);
        vm.prank(owner);
        registry.transferOwnership(newOwner);

        assertEq(registry.owner(), newOwner);
    }

    function test_TransferOwnership_OldOwnerLosesAccess() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        registry.transferOwnership(newOwner);

        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.NotOwner.selector, owner));
        vm.prank(owner);
        registry.accredit(candidate);
    }
}
