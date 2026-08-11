// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { MidcurveTreasury } from "../contracts/treasury/MidcurveTreasury.sol";
import { MidcurveTreasuryFactory } from "../contracts/treasury/MidcurveTreasuryFactory.sol";

/**
 * @title DeployTreasuryFactory
 * @notice Deploys the MidcurveTreasury implementation + factory — once per chain, by the publisher
 * @dev Usage:
 *   forge script script/DeployTreasuryFactory.s.sol \
 *     --sig "run(address,address)" <swapRouter> <weth> \
 *     --rpc-url <chain> --broadcast --verify
 *
 * `--verify` is not optional. Verifying the implementation is what gives every clone a working
 * Read/Write surface on the block explorer: Etherscan-family explorers resolve an EIP-1167 clone
 * to its implementation and serve the implementation's source and ABI at the clone's address. No
 * per-instance verification is needed — and none is possible, since instances are deployed by
 * users from the browser.
 *
 * Record the factory under `contracts` in deployments/<network>.json, and the implementation
 * under `references` — the latter is recorded for provenance and never seeded. Putting the
 * implementation in `contracts` trips the never-seed guard in prisma/seed-contracts.ts, which is
 * there because registering it as a treasury would route execution fees into a contract whose
 * admin is address(0).
 *
 * Known WETH addresses:
 *   Arbitrum:  0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
 *   Ethereum:  0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
 *   Base:      0x4200000000000000000000000000000000000006
 */
contract DeployTreasuryFactoryScript is Script {
    function run(address swapRouter_, address weth_) public {
        console.log("=== Deploy MidcurveTreasury implementation + factory ===");
        console.log("Chain ID:", block.chainid);
        console.log("SwapRouter:", swapRouter_);
        console.log("WETH:", weth_);
        console.log("");

        vm.startBroadcast();

        MidcurveTreasury implementation = new MidcurveTreasury(swapRouter_, weth_);
        console.log("MidcurveTreasury implementation deployed at:", address(implementation));

        MidcurveTreasuryFactory factory = new MidcurveTreasuryFactory(address(implementation));
        console.log("MidcurveTreasuryFactory deployed at:", address(factory));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("=== Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("MidcurveTreasuryImplementation:", address(implementation));
        console.log("MidcurveTreasuryFactory:", address(factory));
        console.log("");
        console.log("Add both to deployments/<network>.json.");
        console.log("Seeded as SharedContract: MidcurveTreasuryFactory only");
        console.log("  type: evm-smart-contract");
        console.log("  version: 1.0");
        console.log("========================================");
    }
}
