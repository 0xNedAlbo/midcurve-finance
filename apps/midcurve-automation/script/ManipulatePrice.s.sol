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
 * @notice Executes swaps to move the ETH price (in USD terms) up or down
 * @dev Usage:
 *   # Push ETH price UP (buy ETH with MockUSD - makes ETH more expensive)
 *   DIRECTION=up SWAP_AMOUNT=1000000000 pnpm local:price-up
 *
 *   # Push ETH price DOWN (sell ETH for MockUSD - makes ETH cheaper)
 *   DIRECTION=down SWAP_AMOUNT=300000000000000000 pnpm local:price-down --value 0.3ether
 *
 * DIRECTION: "up" or "down" (refers to ETH price in USD)
 * SWAP_AMOUNT: Amount in base units (6 decimals for MockUSD, 18 for ETH)
 *
 * Note: When quote token (MockUSD) is token0, the Uniswap V3 internal tick
 * moves in the OPPOSITE direction of the user-facing ETH price:
 *   - price-up → tick moves DOWN (toward MIN_TICK)
 *   - price-down → tick moves UP (toward MAX_TICK)
 *
 * Use smaller swap amounts (e.g., 1000 MockUSD = 1000000000) to avoid
 * draining all liquidity and hitting tick boundaries.
 */
contract ManipulatePriceScript is Script {
    address constant SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    function run() public {
        address mockUSD = vm.envAddress("MOCK_USD_ADDRESS");
        address pool = vm.envAddress("MOCK_USD_WETH_POOL_ADDRESS");
        string memory direction = vm.envString("DIRECTION");
        uint256 amount = vm.envUint("SWAP_AMOUNT");

        require(mockUSD != address(0), "MOCK_USD_ADDRESS required");
        require(pool != address(0), "MOCK_USD_WETH_POOL_ADDRESS required");
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
        console.log("tick change:");
        console.logInt(tickChange);

        // Determine if quote token is token0 (inverted price semantics)
        // When quote is token0: tick DOWN = ETH price UP (more expensive)
        // When quote is token1: tick UP = ETH price UP (more expensive)
        address token0 = poolContract.token0();
        bool isQuoteToken0 = (token0 == mockUSD);

        // Calculate approximate price change
        // Each tick represents ~0.01% price change
        // 100 ticks = ~1% price change
        bool priceWentUp = isQuoteToken0 ? (tickChange < 0) : (tickChange > 0);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 percentChange = tickChange > 0 ? uint256(tickChange) / 100 : uint256(-tickChange) / 100;

        if (tickChange == 0) {
            console.log("Price unchanged (swap amount may be too small)");
        } else if (priceWentUp) {
            console.log("ETH price moved UP by approximately:");
            console.log("  percent:", percentChange);
        } else {
            console.log("ETH price moved DOWN by approximately:");
            console.log("  percent:", percentChange);
        }

        // Warn if hit tick boundaries
        if (tickAfter <= -887272 + 1000) {
            console.log("");
            console.log("WARNING: Hit MIN_TICK boundary! Pool has no more WETH liquidity.");
            console.log("ETH price is now astronomically high. Reset pool with pnpm local:setup");
        } else if (tickAfter >= 887272 - 1000) {
            console.log("");
            console.log("WARNING: Hit MAX_TICK boundary! Pool has no more MockUSD liquidity.");
            console.log("ETH price is now near zero. Reset pool with pnpm local:setup");
        }
    }
}
