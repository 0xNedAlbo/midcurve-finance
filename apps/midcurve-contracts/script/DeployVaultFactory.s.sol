// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {UniswapV3Vault} from "../contracts/vault/UniswapV3Vault.sol";
import {AllowlistedUniswapV3Vault} from "../contracts/vault/AllowlistedUniswapV3Vault.sol";
import {UniswapV3VaultFactory} from "../contracts/vault/UniswapV3VaultFactory.sol";

/**
 * @title DeployVaultFactory
 * @notice Deploys UniswapV3Vault implementations + factory
 * @dev Usage:
 *   forge script script/DeployVaultFactory.s.sol \
 *     --sig "run(address)" <positionManager> \
 *     --rpc-url <chain> --broadcast --verify
 *
 * Known NonfungiblePositionManager addresses:
 *   Ethereum:  0xC36442b4a4522E871399CD717aBDD847Ab11FE88
 *   Arbitrum:  0xC36442b4a4522E871399CD717aBDD847Ab11FE88
 *   Optimism:  0xC36442b4a4522E871399CD717aBDD847Ab11FE88
 *   Polygon:   0xC36442b4a4522E871399CD717aBDD847Ab11FE88
 *   Base:      0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1
 */
contract DeployVaultFactoryScript is Script {
    function run(address positionManager) public {
        console.log("=== Deploy UniswapV3VaultFactory ===");
        console.log("Chain ID:", block.chainid);
        console.log("NonfungiblePositionManager:", positionManager);
        console.log("");

        vm.startBroadcast();

        // 1. Deploy base vault implementation
        UniswapV3Vault baseImpl = new UniswapV3Vault();
        console.log("UniswapV3Vault implementation:", address(baseImpl));

        // 2. Deploy allowlisted vault implementation
        AllowlistedUniswapV3Vault allowlistedImpl = new AllowlistedUniswapV3Vault();
        console.log("AllowlistedUniswapV3Vault implementation:", address(allowlistedImpl));

        // 3. Deploy factory
        UniswapV3VaultFactory factory =
            new UniswapV3VaultFactory(address(baseImpl), address(allowlistedImpl), positionManager);
        console.log("UniswapV3VaultFactory:", address(factory));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("=== Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("UniswapV3Vault (impl):", address(baseImpl));
        console.log("AllowlistedUniswapV3Vault (impl):", address(allowlistedImpl));
        console.log("UniswapV3VaultFactory:", address(factory));
        console.log("");
        console.log("Register the factory as SharedContract:");
        console.log("  name: UniswapV3VaultFactory");
        console.log("  type: evm-smart-contract");
        console.log("  version: 1.0");
        console.log("========================================");
    }
}
