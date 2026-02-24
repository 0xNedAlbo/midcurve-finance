// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MidcurveSwapRouter} from "../contracts/swap-router/MidcurveSwapRouter.sol";
import {UniswapV3Adapter} from "../contracts/swap-router/adapters/UniswapV3Adapter.sol";
import {ParaswapAdapter} from "../contracts/swap-router/adapters/ParaswapAdapter.sol";

/**
 * @title DeploySwapRouter
 * @notice Deploys MidcurveSwapRouter + UniswapV3Adapter + ParaswapAdapter and configures default SwapTokens
 * @dev Usage (production via TypeScript wrapper):
 *   CHAIN=arbitrum OWNER=0x... pnpm deploy:swap-router -- --broadcast --verify
 *
 * Usage (direct forge):
 *   forge script script/DeploySwapRouter.s.sol \
 *     --sig "run(address,address,address,address,address,address)" \
 *     <uniswapSwapRouter> <weth> <usdc> <manager> <augustus> <tokenTransferProxy> \
 *     --rpc-url <chain> --broadcast
 *
 * Known SwapRouter02 addresses:
 *   Ethereum:  0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
 *   Arbitrum:  0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
 *   Optimism:  0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
 *   Polygon:   0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
 *   Base:      0x2626664c2603336E57B271c5C0b26F421741e481
 *
 * Paraswap Augustus V6.2 (all chains): 0x6A000F20005980200259B80c5102003040001068
 * Paraswap TokenTransferProxy for V6.2: same as Augustus (V6.2 is its own proxy)
 */
contract DeploySwapRouterScript is Script {
    function run(
        address uniswapV3SwapRouter,
        address weth,
        address usdc,
        address manager_,
        address augustus,
        address tokenTransferProxy
    ) public {
        console.log("=== Deploy MidcurveSwapRouter ===");
        console.log("Chain ID:", block.chainid);
        console.log("Uniswap V3 SwapRouter02:", uniswapV3SwapRouter);
        console.log("WETH:", weth);
        console.log("USDC:", usdc);
        console.log("Manager:", manager_);
        console.log("Paraswap Augustus:", augustus);
        console.log("Paraswap TokenTransferProxy:", tokenTransferProxy);
        console.log("");

        vm.startBroadcast();

        // 1. Deploy UniswapV3Adapter
        UniswapV3Adapter uniswapAdapter = new UniswapV3Adapter(uniswapV3SwapRouter);
        console.log("UniswapV3Adapter deployed at:", address(uniswapAdapter));

        // 2. Deploy MidcurveSwapRouter
        MidcurveSwapRouter router = new MidcurveSwapRouter(manager_);
        console.log("MidcurveSwapRouter deployed at:", address(router));

        // 3. Register UniswapV3 adapter
        router.registerAdapter(uniswapAdapter.VENUE_ID(), address(uniswapAdapter));
        console.log("Registered UniswapV3Adapter with venueId:", vm.toString(uniswapAdapter.VENUE_ID()));

        // 4. Deploy and register ParaswapAdapter
        ParaswapAdapter paraswapAdapter = new ParaswapAdapter(address(router), augustus, tokenTransferProxy);
        console.log("ParaswapAdapter deployed at:", address(paraswapAdapter));

        bytes32 paraswapVenueId = keccak256("Paraswap");
        router.registerAdapter(paraswapVenueId, address(paraswapAdapter));
        console.log("Registered ParaswapAdapter with venueId:", vm.toString(paraswapVenueId));

        // 5. Add default SwapTokens
        router.addSwapToken(weth);
        console.log("Added SwapToken WETH:", weth);

        router.addSwapToken(usdc);
        console.log("Added SwapToken USDC:", usdc);

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("=== Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("MidcurveSwapRouter:", address(router));
        console.log("UniswapV3Adapter:", address(uniswapAdapter));
        console.log("ParaswapAdapter:", address(paraswapAdapter));
        console.log("");
        console.log("========================================");
    }
}
