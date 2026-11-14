// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FlashArbV3} from "../../src/arbitrage/FlashArbV3.sol";

contract FlashArbV3Test is Test {
    FlashArbV3 public bot;

    function setUp() public {
        bot = new FlashArbV3();
    }

    function test_Deploy_SetsOwner() public view {
        assertEq(bot.owner(), address(this));
    }

    function test_Deploy_PrepopulatesRouters() public view {
        assertTrue(bot.routerWhitelist(bot.UNISWAP_V2_ROUTER()));
        assertTrue(bot.routerWhitelist(bot.SUSHISWAP_ROUTER()));
        assertFalse(bot.routerWhitelist(address(0)));
    }

    function test_Deploy_PrepopulatesTokens() public view {
        assertTrue(bot.tokenWhitelist(bot.WETH()));
        assertTrue(bot.tokenWhitelist(bot.DAI()));
        assertTrue(bot.tokenWhitelist(bot.USDC()));
        assertTrue(bot.tokenWhitelist(bot.USDT()));
    }

    function test_SetRouterWhitelist_OnlyOwner() public {
        address newRouter = makeAddr("newRouter");
        vm.prank(makeAddr("notOwner"));
        vm.expectRevert("Ownable: caller is not the owner");
        bot.setRouterWhitelist(newRouter, true);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(makeAddr("notOwner"));
        vm.expectRevert("Ownable: caller is not the owner");
        bot.pause();
    }
}
