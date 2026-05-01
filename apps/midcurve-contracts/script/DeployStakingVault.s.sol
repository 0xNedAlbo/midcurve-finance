// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

import {UniswapV3StakingVault} from "../contracts/staking-vault/UniswapV3StakingVault.sol";
import {UniswapV3StakingVaultFactory} from
    "../contracts/staking-vault/UniswapV3StakingVaultFactory.sol";

/**
 * @title DeployStakingVault
 * @notice Deploys the UniswapV3StakingVault implementation and factory.
 * @dev Usage:
 *   forge script script/DeployStakingVault.s.sol \
 *     --sig "run(address)" <positionManager> \
 *     --rpc-url <chain> --broadcast --verify
 *
 * Known NonfungiblePositionManager addresses:
 *   Ethereum:  0xC36442b4a4522E871399CD717aBDD847Ab11FE88
 *   Arbitrum:  0xC36442b4a4522E871399CD717aBDD847Ab11FE88
 *   Base:      0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1
 */
contract DeployStakingVaultScript is Script {
    function run(address positionManager) public {
        console.log("=== Deploy UniswapV3StakingVaultFactory ===");
        console.log("Chain ID:", block.chainid);
        console.log("NonfungiblePositionManager:", positionManager);
        console.log("");

        vm.startBroadcast();

        UniswapV3StakingVault impl = new UniswapV3StakingVault(positionManager);
        console.log("UniswapV3StakingVault (impl):", address(impl));

        UniswapV3StakingVaultFactory factory =
            new UniswapV3StakingVaultFactory(address(impl), positionManager);
        console.log("UniswapV3StakingVaultFactory:", address(factory));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("=== Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("UniswapV3StakingVault (impl):", address(impl));
        console.log("UniswapV3StakingVaultFactory:", address(factory));
        console.log("========================================");
    }
}
