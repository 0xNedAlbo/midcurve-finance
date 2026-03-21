// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MidcurveTreasury} from "../contracts/treasury/MidcurveTreasury.sol";

/**
 * @title DeployTreasury
 * @notice Deploys MidcurveTreasury — one instance per app deployment
 * @dev Usage (direct forge):
 *   forge script script/DeployTreasury.s.sol \
 *     --sig "run(address,address,address,address)" \
 *     <admin> <operator> <swapRouter> <weth> \
 *     --rpc-url <chain> --broadcast --verify
 *
 * Known WETH addresses:
 *   Arbitrum:  0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
 *   Ethereum:  0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
 *   Base:      0x4200000000000000000000000000000000000006
 */
contract DeployTreasuryScript is Script {
    function run(address admin_, address operator_, address swapRouter_, address weth_) public {
        console.log("=== Deploy MidcurveTreasury ===");
        console.log("Chain ID:", block.chainid);
        console.log("Admin:", admin_);
        console.log("Operator:", operator_);
        console.log("SwapRouter:", swapRouter_);
        console.log("WETH:", weth_);
        console.log("");

        vm.startBroadcast();

        MidcurveTreasury treasury = new MidcurveTreasury(admin_, operator_, swapRouter_, weth_);
        console.log("MidcurveTreasury deployed at:", address(treasury));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("=== Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("MidcurveTreasury:", address(treasury));
        console.log("");
        console.log("========================================");
    }
}
