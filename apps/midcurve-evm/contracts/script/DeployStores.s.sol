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
 * @dev Deploys Store contracts and registers them in the genesis SystemRegistry:
 *      - PoolStore, PositionStore, BalanceStore (data stores)
 *
 *      The SystemRegistry is pre-deployed at 0x0000000000000000000000000000000000001000
 *      via genesis.json. This script only deploys the stores and registers them.
 *
 *      Usage:
 *        forge script script/DeployStores.s.sol --rpc-url http://localhost:8545 --broadcast
 *
 *      Environment:
 *        Uses CORE_PRIVATE_KEY if set, otherwise Foundry's default account 0.
 */
contract DeployStores is Script {
    // Foundry default account (private key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
    // This is pre-funded in Anvil with 10,000 ETH
    address constant CORE = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    // Genesis SystemRegistry address (pre-deployed via genesis.json)
    address constant SYSTEM_REGISTRY = 0x0000000000000000000000000000000000001000;

    function run() external {
        console.log("=== SEMSEE Contract Deployment ===");
        console.log("Deploying from Core address:", CORE);
        console.log("Using genesis SystemRegistry at:", SYSTEM_REGISTRY);
        console.log("");

        // Get reference to genesis SystemRegistry
        SystemRegistry registry = SystemRegistry(SYSTEM_REGISTRY);

        // Start broadcasting transactions
        vm.startBroadcast();

        // Deploy stores
        PoolStore poolStore = new PoolStore();
        console.log("PoolStore deployed at:", address(poolStore));

        PositionStore positionStore = new PositionStore();
        console.log("PositionStore deployed at:", address(positionStore));

        BalanceStore balanceStore = new BalanceStore();
        console.log("BalanceStore deployed at:", address(balanceStore));

        // Register stores in genesis SystemRegistry
        registry.setPoolStore(address(poolStore));
        console.log("Registered PoolStore in SystemRegistry");

        registry.setPositionStore(address(positionStore));
        console.log("Registered PositionStore in SystemRegistry");

        registry.setBalanceStore(address(balanceStore));
        console.log("Registered BalanceStore in SystemRegistry");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("SystemRegistry (genesis):", SYSTEM_REGISTRY);
        console.log("PoolStore:", address(poolStore));
        console.log("PositionStore:", address(positionStore));
        console.log("BalanceStore:", address(balanceStore));
    }
}
