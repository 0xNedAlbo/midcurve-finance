// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {UniswapV3PositionCloser} from "../contracts/UniswapV3PositionCloser.sol";

/**
 * @title DeployScript
 * @notice Deployment script for UniswapV3PositionCloser shared contract
 * @dev Usage:
 *   With Ledger:
 *     forge script script/Deploy.s.sol --rpc-url <chain> --broadcast --verify --ledger
 *
 *   With private key:
 *     forge script script/Deploy.s.sol --rpc-url <chain> --broadcast --verify --private-key $DEPLOYER_PRIVATE_KEY
 *
 * Supported chains: mainnet, arbitrum, base, optimism, polygon
 */
contract DeployScript is Script {
    // Uniswap V3 NonfungiblePositionManager addresses per chain
    mapping(uint256 => address) public positionManagers;

    function setUp() public {
        // Ethereum, Arbitrum, Optimism, Polygon use the same NFPM address
        positionManagers[1] = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
        positionManagers[42161] = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
        positionManagers[10] = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
        positionManagers[137] = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;

        // Base uses a different NFPM address
        positionManagers[8453] = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;
    }

    function run() public {
        uint256 chainId = block.chainid;
        address nfpm = positionManagers[chainId];
        require(nfpm != address(0), "Unsupported chain");

        console.log("=== UniswapV3PositionCloser Deployment ===");
        console.log("Chain ID:", chainId);
        console.log("NFPM Address:", nfpm);
        console.log("");

        vm.startBroadcast();

        UniswapV3PositionCloser closer = new UniswapV3PositionCloser(nfpm);

        vm.stopBroadcast();

        console.log("Deployed at:", address(closer));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Update config/shared-contracts.json with:");
        console.log('   "contractAddress": "%s"', address(closer));
        console.log("");
        console.log("2. Verify on block explorer:");
        console.log("   forge verify-contract \\");
        console.log("     --chain-id %s \\", chainId);
        console.log("     --constructor-args $(cast abi-encode 'constructor(address)' %s) \\", nfpm);
        console.log("     %s \\", address(closer));
        console.log("     contracts/UniswapV3PositionCloser.sol:UniswapV3PositionCloser");
    }
}
