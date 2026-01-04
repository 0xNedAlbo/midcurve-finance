// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IWETH {
    function deposit() external payable;
}

interface IMockUSD {
    function mint(address to, uint256 amount) external;
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IUniswapV3Pool {
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
    function token0() external view returns (address);
}

/**
 * @title ManipulatePriceScript
 * @notice Executes swaps to move the pool price up or down
 * @dev Usage:
 *   # Push price UP (buy ETH with MockUSD)
 *   DIRECTION=up SWAP_AMOUNT=50000000000 pnpm local:price-up
 *
 *   # Push price DOWN (sell ETH for MockUSD)
 *   DIRECTION=down SWAP_AMOUNT=5000000000000000000 pnpm local:price-down --value 5ether
 *
 * DIRECTION: "up" or "down"
 * SWAP_AMOUNT: Amount in base units (6 decimals for MockUSD, 18 for ETH)
 */
contract ManipulatePriceScript is Script {
    address constant SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    function run() public {
        address mockUSD = vm.envAddress("MOCK_USD_ADDRESS");
        address pool = vm.envAddress("POOL_ADDRESS");
        string memory direction = vm.envString("DIRECTION");
        uint256 amount = vm.envUint("SWAP_AMOUNT");

        require(mockUSD != address(0), "MOCK_USD_ADDRESS required");
        require(pool != address(0), "POOL_ADDRESS required");
        require(bytes(direction).length > 0, "DIRECTION required (up or down)");
        require(amount > 0, "SWAP_AMOUNT required");

        bool isUp = keccak256(bytes(direction)) == keccak256(bytes("up"));
        bool isDown = keccak256(bytes(direction)) == keccak256(bytes("down"));
        require(isUp || isDown, "DIRECTION must be 'up' or 'down'");

        console.log("=== Price Manipulation ===");
        console.log("Direction:", direction);
        console.log("Swap Amount:", amount);
        console.log("Pool:", pool);
        console.log("");

        IUniswapV3Pool poolContract = IUniswapV3Pool(pool);

        // Read price before
        (uint160 priceBefore, int24 tickBefore, , , , , ) = poolContract.slot0();
        console.log("=== Before Swap ===");
        console.log("sqrtPriceX96:", priceBefore);
        console.log("tick:", tickBefore);
        console.log("");

        vm.startBroadcast();

        if (isUp) {
            // Buy ETH with MockUSD = ETH price goes UP
            console.log("Buying ETH with MockUSD (price goes UP)...");

            // Mint MockUSD for the swap
            IMockUSD(mockUSD).mint(msg.sender, amount);
            IERC20(mockUSD).approve(SWAP_ROUTER, amount);

            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: mockUSD,
                tokenOut: WETH,
                fee: 3000,
                recipient: msg.sender,
                deadline: block.timestamp + 3600,
                amountIn: amount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

            uint256 amountOut = ISwapRouter(SWAP_ROUTER).exactInputSingle(params);
            console.log("Swapped MockUSD for WETH");
            console.log("  MockUSD in:", amount / 1e6);
            console.log("  WETH out:", amountOut / 1e18);
        } else {
            // Sell ETH for MockUSD = ETH price goes DOWN
            console.log("Selling ETH for MockUSD (price goes DOWN)...");

            // Wrap ETH for the swap
            IWETH(WETH).deposit{value: amount}();
            IERC20(WETH).approve(SWAP_ROUTER, amount);

            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: mockUSD,
                fee: 3000,
                recipient: msg.sender,
                deadline: block.timestamp + 3600,
                amountIn: amount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

            uint256 amountOut = ISwapRouter(SWAP_ROUTER).exactInputSingle(params);
            console.log("Swapped WETH for MockUSD");
            console.log("  WETH in:", amount / 1e18);
            console.log("  MockUSD out:", amountOut / 1e6);
        }

        vm.stopBroadcast();

        // Read price after
        (uint160 priceAfter, int24 tickAfter, , , , , ) = poolContract.slot0();
        int256 tickChange = int256(tickAfter) - int256(tickBefore);

        console.log("");
        console.log("=== After Swap ===");
        console.log("sqrtPriceX96:", priceAfter);
        console.log("tick:", tickAfter);
        console.logInt(tickChange);

        // Calculate approximate price change
        // Each tick represents ~0.01% price change
        // 100 ticks = ~1% price change
        if (tickChange > 0) {
            console.log("Price moved UP by approximately:");
            console.log("  percent:", uint256(tickChange) / 100);
        } else if (tickChange < 0) {
            console.log("Price moved DOWN by approximately:");
            console.log("  percent:", uint256(-tickChange) / 100);
        } else {
            console.log("Price unchanged (swap amount may be too small)");
        }
    }
}
