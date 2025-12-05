// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/stores/SystemRegistry.sol";
import "../src/stores/PoolStore.sol";
import "../src/stores/PositionStore.sol";
import "../src/stores/BalanceStore.sol";

/**
 * @title DeployStores
 * @notice Deployment script for SEMSEE Store contracts
 * @dev Assumes SystemRegistry is already deployed at 0x1000 via genesis allocation.
 *      Deploys PoolStore, PositionStore, BalanceStore and registers them.
 *
 *      Usage:
 *        forge script script/DeployStores.s.sol --rpc-url http://localhost:8545 --broadcast
 *
 *      The script broadcasts from the CORE address (0x1) which must have ETH balance.
 */
contract DeployStores is Script {
    address constant SYSTEM_REGISTRY = 0x0000000000000000000000000000000000001000;
    address constant CORE = 0x0000000000000000000000000000000000000001;

    function run() external {
        // Check if SystemRegistry exists at well-known address
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(SYSTEM_REGISTRY)
        }

        if (codeSize == 0) {
            console.log("ERROR: SystemRegistry not deployed at 0x1000");
            console.log("Ensure genesis.json is configured correctly");
            revert("SystemRegistry not found");
        }

        console.log("SystemRegistry found at:", SYSTEM_REGISTRY);

        SystemRegistry registry = SystemRegistry(SYSTEM_REGISTRY);

        // Check if stores are already registered (idempotency for prod mode)
        if (registry.poolStore() != address(0)) {
            console.log("Stores already deployed and registered:");
            console.log("  PoolStore:", registry.poolStore());
            console.log("  PositionStore:", registry.positionStore());
            console.log("  BalanceStore:", registry.balanceStore());
            console.log("Skipping deployment.");
            return;
        }

        console.log("Deploying Store contracts from Core address:", CORE);

        // Start broadcasting transactions from Core
        vm.startBroadcast(CORE);

        // Deploy stores
        PoolStore poolStore = new PoolStore();
        console.log("PoolStore deployed at:", address(poolStore));

        PositionStore positionStore = new PositionStore();
        console.log("PositionStore deployed at:", address(positionStore));

        BalanceStore balanceStore = new BalanceStore();
        console.log("BalanceStore deployed at:", address(balanceStore));

        // Register stores in SystemRegistry
        registry.setPoolStore(address(poolStore));
        console.log("Registered PoolStore in SystemRegistry");

        registry.setPositionStore(address(positionStore));
        console.log("Registered PositionStore in SystemRegistry");

        registry.setBalanceStore(address(balanceStore));
        console.log("Registered BalanceStore in SystemRegistry");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("SystemRegistry:", SYSTEM_REGISTRY);
        console.log("PoolStore:", address(poolStore));
        console.log("PositionStore:", address(positionStore));
        console.log("BalanceStore:", address(balanceStore));
    }
}
