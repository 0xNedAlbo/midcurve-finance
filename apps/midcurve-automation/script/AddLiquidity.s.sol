// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IMockUSD {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

/**
 * @title AddLiquidityScript
 * @notice Adds liquidity to the WETH/MockUSD pool and mints a position NFT
 * @dev Usage:
 *   export MOCK_USD_ADDRESS="0x..."
 *   export POOL_ADDRESS="0x..."
 *   pnpm local:add-liquidity
 *
 * Requires sending ETH with the transaction (--value 10ether).
 */
contract AddLiquidityScript is Script {
    address constant NFPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    function run() public {
        address mockUSD = vm.envAddress("MOCK_USD_ADDRESS");
        address pool = vm.envAddress("POOL_ADDRESS");
        require(mockUSD != address(0), "MOCK_USD_ADDRESS required");
        require(pool != address(0), "POOL_ADDRESS required");

        console.log("=== Add Liquidity ===");
        console.log("Pool:", pool);
        console.log("MockUSD:", mockUSD);
        console.log("NFPM:", NFPM);
        console.log("");

        vm.startBroadcast();

        // Get token order from pool
        IUniswapV3Pool poolContract = IUniswapV3Pool(pool);
        address token0 = poolContract.token0();
        address token1 = poolContract.token1();
        console.log("Token0:", token0);
        console.log("Token1:", token1);

        // Get current tick
        (, int24 currentTick, , , , , ) = poolContract.slot0();
        console.log("Current tick:", currentTick);

        // Set wide range around current price (+/- 2000 ticks)
        // This gives approximately +/- 22% price range
        int24 tickSpacing = 60; // For 0.3% fee tier
        int24 tickLower = ((currentTick - 2000) / tickSpacing) * tickSpacing;
        int24 tickUpper = ((currentTick + 2000) / tickSpacing) * tickSpacing;
        console.log("Tick lower:", tickLower);
        console.log("Tick upper:", tickUpper);

        // Wrap 10 ETH to WETH
        console.log("Wrapping 10 ETH to WETH...");
        IWETH(WETH).deposit{value: 10 ether}();

        // Mint 30,000 MockUSD (for ~$3000/ETH price)
        console.log("Minting 30,000 MockUSD...");
        IMockUSD(mockUSD).mint(msg.sender, 30_000 * 1e6);

        // Approve NFPM to spend tokens
        IERC20(WETH).approve(NFPM, type(uint256).max);
        IERC20(mockUSD).approve(NFPM, type(uint256).max);

        // Determine amounts based on token order
        uint256 amount0Desired;
        uint256 amount1Desired;
        if (token0 == WETH) {
            amount0Desired = 10 ether;
            amount1Desired = 30_000 * 1e6;
        } else {
            amount0Desired = 30_000 * 1e6;
            amount1Desired = 10 ether;
        }

        // Mint position
        console.log("Minting position NFT...");
        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: token0,
            token1: token1,
            fee: 3000,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: amount0Desired,
            amount1Desired: amount1Desired,
            amount0Min: 0,
            amount1Min: 0,
            recipient: msg.sender,
            deadline: block.timestamp + 3600
        });

        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) =
            INonfungiblePositionManager(NFPM).mint(params);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Position Minted ===");
        console.log("Token ID:", tokenId);
        console.log("Liquidity:", liquidity);
        console.log("Amount0 used:", amount0);
        console.log("Amount1 used:", amount1);
        console.log("Tick lower:", tickLower);
        console.log("Tick upper:", tickUpper);
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Fund test account with more tokens:");
        console.log("   pnpm local:fund");
        console.log("");
        console.log("2. Check pool price:");
        console.log("   pnpm local:check-price");
    }
}
