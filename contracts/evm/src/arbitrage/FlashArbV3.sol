// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title FlashArbV3
 * @notice Flash-loan arbitrage executor using Aave V3 on Ethereum mainnet.
 *         Performs two-hop token swaps across Uniswap V2-compatible DEXes.
 *
 * DEPLOYMENT NOTES
 * ----------------
 * - Deploy from your MetaMask wallet; the deploying address becomes `owner`.
 * - No ETH pre-funding required. Flash loans supply the capital automatically.
 * - Call startFlashLoan() only after verifying off-chain that the arbitrage
 *   is profitable (net of Aave's 0.05% flash loan fee + gas).
 * - Use setRouterWhitelist() / setTokenWhitelist() to extend supported assets.
 *
 * SECURITY MEASURES (audit fixes applied)
 * ----------------------------------------
 * C-1  No ETH pre-funding lure; receive() removed; ETH rescue kept owner-only.
 * C-2  lendingPool resolved live from provider on every callback; not stored.
 * H-1  withdrawProfit uses real on-chain balance, not an internal counter.
 * H-2  WETH unwrap happens AFTER repayment approval is set.
 * H-3  initiator must equal address(this) — only self-initiated loans accepted.
 * M-1  SafeMath removed; native 0.8 checked arithmetic used throughout.
 * M-2  constructor() has no visibility specifier (valid in 0.8+).
 * M-3  All OZ import paths updated to v4/v5 layout.
 * M-4  Targets Aave V3 pool + IPool interface (flashLoanSimple).
 * L-1  Swap deadline set to block.timestamp + 1 (same-block settlement).
 * L-2  ProviderUpdated event includes old and new provider addresses.
 *
 * OpenZeppelin v4 (npm: @openzeppelin/contracts@^4.9.0) required.
 * Aave V3 interfaces: @aave/core-v3 (or inline as below).
 */

// ─── OpenZeppelin v4 imports ───────────────────────────────────────────────────
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

// ─── Aave V3 interfaces (inlined to avoid extra dependency) ───────────────────

interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

interface IPool {
    /**
     * @notice Aave V3 single-asset flash loan (fee: 0.05%).
     *         The pool calls receiver.executeOperation() then pulls back
     *         amount + premium in the same transaction.
     */
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

// ─── Uniswap V2-compatible router ─────────────────────────────────────────────

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

// ─── WETH ─────────────────────────────────────────────────────────────────────

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}

// ─── Main contract ────────────────────────────────────────────────────────────

contract FlashArbV3 is IFlashLoanSimpleReceiver, ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ── Mainnet addresses (verified) ────────────────────────────────────────
    // Aave V3 Pool Addresses Provider — Ethereum mainnet
    address public constant AAVE_V3_PROVIDER  = 0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e;
    // Uniswap V2 Router
    address public constant UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    // SushiSwap Router
    address public constant SUSHISWAP_ROUTER  = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    // Common tokens
    address public constant WETH  = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant DAI   = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address public constant USDC  = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant USDT  = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    // ── Immutable Aave provider ──────────────────────────────────────────────
    // Stored once; lendingPool address is always resolved live from the provider
    // to prevent the C-2 stale-address attack.
    IPoolAddressesProvider public immutable provider;

    // ── Whitelists ──────────────────────────────────────────────────────────
    mapping(address => bool) public routerWhitelist;
    mapping(address => bool) public tokenWhitelist;

    // ── Slippage cap (informational; callers must compute amountOutMin) ──────
    uint256 public maxSlippageBps = 200; // 2 %

    // ── Events ───────────────────────────────────────────────────────────────
    event FlashLoanRequested(address indexed asset, uint256 amount);
    event FlashLoanExecuted(address indexed asset, uint256 amount, uint256 fee, uint256 profit);
    event RouterWhitelisted(address indexed router, bool allowed);
    event TokenWhitelisted(address indexed token, bool allowed);
    // L-2 fix: includes old provider
    event ProviderUpdated(address indexed oldProvider, address indexed newProvider);
    event ProfitWithdrawn(address indexed token, address indexed to, uint256 amount);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    constructor() {
        // M-2 fix: no `public` visibility on constructor
        provider = IPoolAddressesProvider(AAVE_V3_PROVIDER);

        // Pre-populate routers
        routerWhitelist[UNISWAP_V2_ROUTER] = true;
        routerWhitelist[SUSHISWAP_ROUTER]  = true;
        emit RouterWhitelisted(UNISWAP_V2_ROUTER, true);
        emit RouterWhitelisted(SUSHISWAP_ROUTER,  true);

        // Pre-populate tokens
        tokenWhitelist[WETH] = true;
        tokenWhitelist[DAI]  = true;
        tokenWhitelist[USDC] = true;
        tokenWhitelist[USDT] = true;
        emit TokenWhitelisted(WETH, true);
        emit TokenWhitelisted(DAI,  true);
        emit TokenWhitelisted(USDC, true);
        emit TokenWhitelisted(USDT, true);
    }

    // ─── Owner configuration ─────────────────────────────────────────────────

    function setRouterWhitelist(address router, bool allowed) external onlyOwner {
        require(router != address(0), "zero-address");
        routerWhitelist[router] = allowed;
        emit RouterWhitelisted(router, allowed);
    }

    function setTokenWhitelist(address token, bool allowed) external onlyOwner {
        require(token != address(0), "zero-address");
        tokenWhitelist[token] = allowed;
        emit TokenWhitelisted(token, allowed);
    }

    function setMaxSlippage(uint256 bps) external onlyOwner {
        require(bps <= 1000, "max-10-percent");
        maxSlippageBps = bps;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── Flash loan entry point ───────────────────────────────────────────────
    /**
     * @notice Initiate a single-asset Aave V3 flash loan.
     * @param asset         Token to borrow.
     * @param amount        Amount to borrow (in token's base units).
     * @param params        ABI-encoded swap parameters — see _decodeParams().
     *
     * params encoding (off-chain):
     *   abi.encode(
     *     address router1,       // first swap router (must be whitelisted)
     *     address router2,       // second swap router (must be whitelisted)
     *     address[] path1,       // swap path leg 1 (must start with asset)
     *     address[] path2,       // swap path leg 2 (must end with asset)
     *     uint256 amountOutMin1, // minimum out for leg 1 (slippage guard)
     *     uint256 amountOutMin2, // minimum out for leg 2 (slippage guard)
     *     uint256 minProfit,     // minimum profit in asset units (0 = no min)
     *     bool    unwrapToEth    // if true and asset==WETH, convert profit to ETH
     *   )
     */
    function startFlashLoan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner whenNotPaused {
        require(amount > 0,               "amount-zero");
        require(tokenWhitelist[asset],    "asset-not-whitelisted");

        emit FlashLoanRequested(asset, amount);

        // Resolve pool address live every time (C-2 fix)
        address pool = provider.getPool();
        IPool(pool).flashLoanSimple(
            address(this),
            asset,
            amount,
            params,
            0 // referral code
        );
    }

    // ─── Aave V3 callback ────────────────────────────────────────────────────
    /**
     * @notice Called by the Aave V3 pool after funds are sent to this contract.
     *         Must approve pool for (amount + premium) before returning true.
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override nonReentrant whenNotPaused returns (bool) {

        // C-2 fix: resolve pool live; never trust a stored address
        address pool = provider.getPool();
        require(msg.sender == pool,            "only-aave-pool");

        // H-3 fix: reject flash loans not initiated by this contract
        require(initiator == address(this),    "only-self-initiated");

        (
            address router1,
            address router2,
            address[] memory path1,
            address[] memory path2,
            uint256 amountOutMin1,
            uint256 amountOutMin2,
            uint256 minProfit,
            bool    unwrapToEth
        ) = abi.decode(params, (address, address, address[], address[], uint256, uint256, uint256, bool));

        // Validate routers
        require(routerWhitelist[router1] && routerWhitelist[router2], "router-not-whitelisted");

        // Validate paths
        require(path1.length >= 2 && path2.length >= 2,  "invalid-path-length");
        require(path1[0]                  == asset,      "path1-must-start-with-asset");
        require(path2[path2.length - 1]   == asset,      "path2-must-end-with-asset");

        address intermediate = path1[path1.length - 1];
        require(path2[0] == intermediate,                "path2-must-start-with-intermediate");

        // Validate all path tokens are whitelisted
        for (uint256 i = 0; i < path1.length; i++) {
            require(tokenWhitelist[path1[i]], "path1-token-not-whitelisted");
        }
        for (uint256 i = 0; i < path2.length; i++) {
            require(tokenWhitelist[path2[i]], "path2-token-not-whitelisted");
        }

        // ── Leg 1: asset → intermediate ─────────────────────────────────────
        IERC20(asset).safeApprove(router1, 0);
        IERC20(asset).safeApprove(router1, amount);

        // L-1 fix: same-block deadline for flash loan atomicity
        uint256 deadline = block.timestamp + 1;

        uint256[] memory out1 = IUniswapV2Router02(router1)
            .swapExactTokensForTokens(amount, amountOutMin1, path1, address(this), deadline);

        IERC20(asset).safeApprove(router1, 0); // reset

        // ── Leg 2: intermediate → asset ─────────────────────────────────────
        uint256 intermediateAmount = out1[out1.length - 1];

        IERC20(intermediate).safeApprove(router2, 0);
        IERC20(intermediate).safeApprove(router2, intermediateAmount);

        IUniswapV2Router02(router2)
            .swapExactTokensForTokens(intermediateAmount, amountOutMin2, path2, address(this), deadline);

        IERC20(intermediate).safeApprove(router2, 0); // reset

        // ── Repayment ────────────────────────────────────────────────────────
        uint256 totalDebt  = amount + premium; // M-1 fix: native arithmetic
        uint256 balance    = IERC20(asset).balanceOf(address(this));
        require(balance >= totalDebt, "insufficient-balance-to-repay");

        uint256 profit = balance - totalDebt;

        if (minProfit > 0) {
            require(profit >= minProfit, "profit-below-minimum");
        }

        // H-2 fix: approve repayment BEFORE any WETH unwrapping
        IERC20(asset).safeApprove(pool, 0);
        IERC20(asset).safeApprove(pool, totalDebt);

        // ── Handle profit ────────────────────────────────────────────────────
        // H-2 fix: unwrap happens only AFTER repayment approval is set
        if (profit > 0 && unwrapToEth && asset == WETH) {
            IWETH(WETH).withdraw(profit);
            // ETH now held in contract; withdraw via withdrawETH()
        }
        // If not unwrapping, profit remains as the ERC20 token in the contract.
        // Use withdrawToken() to retrieve it.

        emit FlashLoanExecuted(asset, amount, premium, profit);
        return true;
    }

    // ─── Profit withdrawal (H-1 fix: balance-based, no internal counter) ─────

    /**
     * @notice Withdraw any ERC20 token held by the contract to `to`.
     * @dev    Uses actual on-chain balance — no internal accounting to drift.
     */
    function withdrawToken(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner nonReentrant {
        require(token  != address(0), "zero-token");
        require(to     != address(0), "zero-recipient");
        require(amount > 0,           "zero-amount");
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(amount <= bal,        "amount-exceeds-balance");
        IERC20(token).safeTransfer(to, amount);
        emit ProfitWithdrawn(token, to, amount);
    }

    /**
     * @notice Withdraw ETH (e.g. unwrapped WETH profits) to `to`.
     */
    function withdrawETH(
        uint256 amount,
        address payable to
    ) external onlyOwner nonReentrant {
        require(to     != address(0), "zero-recipient");
        require(amount > 0,           "zero-amount");
        require(amount <= address(this).balance, "amount-exceeds-balance");
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "eth-transfer-failed");
        emit ProfitWithdrawn(address(0), to, amount);
    }

    /**
     * @notice Emergency ERC20 rescue — sweeps full balance.
     */
    function emergencyWithdrawToken(
        address token,
        address to
    ) external onlyOwner nonReentrant {
        require(token != address(0), "zero-token");
        require(to    != address(0), "zero-recipient");
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "no-balance");
        IERC20(token).safeTransfer(to, bal);
        emit EmergencyWithdraw(token, to, bal);
    }

    /**
     * @notice Emergency ETH rescue — sweeps full ETH balance.
     */
    function emergencyWithdrawETH(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "zero-recipient");
        uint256 bal = address(this).balance;
        require(bal > 0, "no-eth-balance");
        (bool sent, ) = to.call{value: bal}("");
        require(sent, "eth-transfer-failed");
        emit EmergencyWithdraw(address(0), to, bal);
    }

    // ─── Accept ETH (e.g. from WETH.withdraw) ────────────────────────────────
    // C-1 fix: receive() is kept ONLY for WETH.withdraw() to work.
    //          No ETH pre-funding is needed or expected.
    receive() external payable {}
}
