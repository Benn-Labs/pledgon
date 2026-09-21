// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ArbitratorRegistry
/// @notice Curated on-chain allowlist of arbitrators a trade creator may pick
/// instead of EscrowFactory's default arbiter. Ownership is kept separate
/// from EscrowFactory itself — accreditation (who's trustworthy enough to
/// arbitrate) is a governance decision independent of the trading contracts,
/// and this registry can be reused by future factories without redeploying
/// the accreditation list.
///
/// No arbiter picked at trade creation is ever left unresolved: EscrowFactory
/// treats an unaccredited, non-default address as invalid rather than
/// accepting it — see EscrowFactory._resolveArbiter. That, not this registry,
/// is what guarantees every trade has a real arbiter able to rule on a
/// dispute.
contract ArbitratorRegistry {
    address public owner;
    mapping(address => bool) private _accredited;
    /// @notice Append-only record of every address ever accredited — a
    /// revoked one stays listed here, so check `isAccredited` for current
    /// status. Lets callers enumerate candidates via plain contract reads
    /// (`accreditedCount()` + `allAccredited(i)`, same shape as
    /// EscrowFactory.vaultCount()/allVaults) instead of scanning event logs,
    /// which breaks on RPC providers that cap `eth_getLogs` to a short block
    /// range — see the frontend's useMyVaults.ts for where that already bit
    /// this codebase once.
    address[] public allAccredited;

    event ArbitratorAccredited(address indexed arbitrator);
    event ArbitratorRevoked(address indexed arbitrator);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner(address caller);
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
    }

    function accredit(address arbitrator) external onlyOwner {
        if (arbitrator == address(0)) revert ZeroAddress();
        if (!_accredited[arbitrator]) {
            allAccredited.push(arbitrator);
        }
        _accredited[arbitrator] = true;
        emit ArbitratorAccredited(arbitrator);
    }

    function revoke(address arbitrator) external onlyOwner {
        _accredited[arbitrator] = false;
        emit ArbitratorRevoked(arbitrator);
    }

    function isAccredited(address arbitrator) external view returns (bool) {
        return _accredited[arbitrator];
    }

    function accreditedCount() external view returns (uint256) {
        return allAccredited.length;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
