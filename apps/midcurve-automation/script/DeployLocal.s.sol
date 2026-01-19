// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {UniswapV3PositionCloser} from "../contracts/UniswapV3PositionCloser.sol";
import {MockUSD} from "../contracts/MockUSD.sol";
import {MockAugustus} from "../contracts/mocks/MockAugustus.sol";
import {MockAugustusRegistry} from "../contracts/mocks/MockAugustusRegistry.sol";

/**
 * @title DeployLocalScript
 * @notice Deploys MockUSD, MockAugustus, MockAugustusRegistry, and UniswapV3PositionCloser to local Anvil fork
 * @dev Usage:
 *   pnpm local:deploy
 *
 * This uses the Foundry default account #0 which is pre-funded with ETH.
 * The MockAugustus contract is used instead of real Paraswap since Paraswap API
 * cannot price custom tokens like mockUSD.
 */
contract DeployLocalScript is Script {
    // Mainnet NFPM address (available in fork)
    address constant NFPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;

    function run() public {
        console.log("=== Local Fork Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("NFPM (forked):", NFPM);
        console.log("");

        vm.startBroadcast();

        // Deploy MockUSD token
        MockUSD mockUSD = new MockUSD();
        console.log("MockUSD deployed at:", address(mockUSD));

        // Deploy MockAugustus (for local swap execution)
        MockAugustus mockAugustus = new MockAugustus();
        console.log("MockAugustus deployed at:", address(mockAugustus));

        // Deploy MockAugustusRegistry and register MockAugustus
        MockAugustusRegistry mockRegistry = new MockAugustusRegistry();
        mockRegistry.setValidAugustus(address(mockAugustus), true);
        console.log("MockAugustusRegistry deployed at:", address(mockRegistry));

        // Deploy UniswapV3PositionCloser with mock registry
        UniswapV3PositionCloser closer = new UniswapV3PositionCloser(NFPM, address(mockRegistry));
        console.log("PositionCloser deployed at:", address(closer));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("MockUSD:", address(mockUSD));
        console.log("MockAugustus:", address(mockAugustus));
        console.log("MockAugustusRegistry:", address(mockRegistry));
        console.log("PositionCloser:", address(closer));
    }
}
