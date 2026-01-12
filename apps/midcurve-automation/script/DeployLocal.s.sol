// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {UniswapV3PositionCloser} from "../contracts/UniswapV3PositionCloser.sol";
import {MockUSD} from "../contracts/MockUSD.sol";

/**
 * @title DeployLocalScript
 * @notice Deploys MockUSD token and UniswapV3PositionCloser to local Anvil fork
 * @dev Usage:
 *   pnpm local:deploy
 *
 * This uses the Foundry default account #0 which is pre-funded with ETH.
 * After deployment, note the MockUSD address and use it for subsequent scripts.
 */
contract DeployLocalScript is Script {
    // Mainnet NFPM address (available in fork)
    address constant NFPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
    // Mainnet AugustusRegistry address (available in fork)
    address constant AUGUSTUS_REGISTRY = 0xa68bEA62Dc4034A689AA0F58A76681433caCa663;

    function run() public {
        console.log("=== Local Fork Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("NFPM (forked):", NFPM);
        console.log("AugustusRegistry (forked):", AUGUSTUS_REGISTRY);
        console.log("");

        vm.startBroadcast();

        // Deploy MockUSD token
        MockUSD mockUSD = new MockUSD();
        console.log("MockUSD deployed at:", address(mockUSD));

        // Deploy UniswapV3PositionCloser
        UniswapV3PositionCloser closer = new UniswapV3PositionCloser(NFPM, AUGUSTUS_REGISTRY);
        console.log("PositionCloser deployed at:", address(closer));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("MockUSD:", address(mockUSD));
        console.log("PositionCloser:", address(closer));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Export the MockUSD address:");
        console.log('   export MOCK_USD_ADDRESS="%s"', address(mockUSD));
        console.log("");
        console.log("2. Create the WETH/MockUSD pool:");
        console.log("   pnpm local:create-pool");
    }
}
