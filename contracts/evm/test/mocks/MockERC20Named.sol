// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../../src/interfaces/IERC20.sol";

/// @notice Same minimal test ERC20 as MockERC20, but with a configurable
/// name/symbol instead of a hardcoded one. Needed wherever multiple mock
/// tokens must be visually distinguishable — MockERC20's hardcoded "MOCK"
/// symbol on two different lending tokens (collateral vs. debt) would make
/// them indistinguishable in a wallet or UI.
contract MockERC20Named is IERC20 {
    string public name;
    string public symbol;
    uint8 private immutable _decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        _decimals = decimals_;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MockERC20Named: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "MockERC20Named: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
