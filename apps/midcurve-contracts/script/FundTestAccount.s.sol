// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

interface IWETH {
    function deposit() external payable;
    function balanceOf(address account) external view returns (uint256);
}

interface IMockUSD {
    function mint(address to, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title FundTestAccountScript
 * @notice Funds the Foundry test account #0 with WETH and MockUSD for UI testing
 * @dev Usage:
 *   export MOCK_USD_ADDRESS="0x..."
 *   pnpm local:fund
 *
 * This script funds the default Foundry test account with:
 * - 100 WETH (wrapped from ETH, requires --value 100ether)
 * - 1,000,000 MockUSD (minted)
 *
 * These amounts are sufficient for extensive UI testing including:
 * - Creating multiple positions
 * - Executing swaps for price manipulation
 * - Testing close order flows
 */
contract FundTestAccountScript is Script {
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // Foundry test account #0
    address constant TEST_ACCOUNT = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    function run() public {
        address mockUSD = vm.envAddress("MOCK_USD_ADDRESS");
        require(mockUSD != address(0), "MOCK_USD_ADDRESS required");

        console.log("=== Fund Test Account ===");
        console.log("Test Account:", TEST_ACCOUNT);
        console.log("MockUSD:", mockUSD);
        console.log("WETH:", WETH);
        console.log("");

        // Check balances before
        uint256 wethBefore = IWETH(WETH).balanceOf(TEST_ACCOUNT);
        uint256 mockUSDBefore = IMockUSD(mockUSD).balanceOf(TEST_ACCOUNT);
        console.log("WETH balance before:", wethBefore / 1e18, "WETH");
        console.log("MockUSD balance before:", mockUSDBefore / 1e6, "mockUSD");
        console.log("");

        vm.startBroadcast();

        // Wrap 100 ETH to WETH
        console.log("Wrapping 100 ETH to WETH...");
        IWETH(WETH).deposit{value: 100 ether}();

        // Mint 1,000,000 MockUSD
        console.log("Minting 1,000,000 MockUSD...");
        IMockUSD(mockUSD).mint(TEST_ACCOUNT, 1_000_000 * 1e6);

        vm.stopBroadcast();

        // Check balances after
        uint256 wethAfter = IWETH(WETH).balanceOf(TEST_ACCOUNT);
        uint256 mockUSDAfter = IMockUSD(mockUSD).balanceOf(TEST_ACCOUNT);

        console.log("");
        console.log("=== Funding Complete ===");
        console.log("WETH balance after:", wethAfter / 1e18, "WETH");
        console.log("MockUSD balance after:", mockUSDAfter / 1e6, "mockUSD");
        console.log("");
        console.log("Test account is now funded for UI testing!");
    }
}
