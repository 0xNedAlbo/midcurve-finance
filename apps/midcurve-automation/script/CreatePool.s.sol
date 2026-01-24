// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
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
    function token1() external view returns (address);
}

/**
 * @title CreatePoolScript
 * @notice Creates a WETH/MockUSD pool on the local Anvil fork
 * @dev Usage:
 *   export MOCK_USD_ADDRESS="0x..."  # from DeployLocal output
 *   pnpm local:create-pool
 *
 * Creates a 0.3% fee tier pool and initializes at ~$3000/ETH price.
 */
contract CreatePoolScript is Script {
    // Mainnet addresses (available in fork)
    address constant FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // Pool fee tier (0.3%)
    uint24 constant FEE = 3000;

    function run() public {
        // MockUSD address from environment
        address mockUSD = vm.envAddress("MOCK_USD_ADDRESS");
        require(mockUSD != address(0), "MOCK_USD_ADDRESS environment variable required");

        console.log("=== Create WETH/MockUSD Pool ===");
        console.log("Factory:", FACTORY);
        console.log("WETH:", WETH);
        console.log("MockUSD:", mockUSD);
        console.log("Fee Tier: 0.3%");
        console.log("");

        vm.startBroadcast();

        IUniswapV3Factory factory = IUniswapV3Factory(FACTORY);

        // Check if pool already exists
        address existingPool = factory.getPool(WETH, mockUSD, FEE);
        if (existingPool != address(0)) {
            console.log("Pool already exists:", existingPool);
            vm.stopBroadcast();
            return;
        }

        // Create pool
        address pool = factory.createPool(WETH, mockUSD, FEE);
        console.log("Pool created:", pool);

        // Determine token order and set initial price
        IUniswapV3Pool poolContract = IUniswapV3Pool(pool);
        address token0 = poolContract.token0();

        // Initial price: ~3000 MockUSD per ETH
        // sqrtPriceX96 = sqrt(price) * 2^96
        //
        // Price calculation with decimal adjustment:
        // - WETH has 18 decimals
        // - MockUSD has 6 decimals
        // - Decimal adjustment factor = 10^(18-6) = 10^12
        //
        // If token0 = WETH: price = token1/token0 = mockUSD/WETH (in raw units)
        //   Raw price = 3000 * 10^6 / 10^18 = 3000 / 10^12 = 3e-9
        //   sqrtPriceX96 = sqrt(3e-9) * 2^96 = 4.339e21
        //
        // If token0 = MockUSD: price = token1/token0 = WETH/mockUSD (in raw units)
        //   Raw price = 10^18 / (3000 * 10^6) = 10^12 / 3000 = 3.33e8
        //   sqrtPriceX96 = sqrt(3.33e8) * 2^96 = 1.445e51

        uint160 sqrtPriceX96;
        if (token0 == WETH) {
            // token0 = WETH, token1 = MockUSD
            // price = mockUSD/WETH in raw units
            // For 3000 USD/ETH: calculated using @midcurve/shared priceToSqrtRatioX96
            sqrtPriceX96 = 4339505466299284316182528; // ~3000 USD/ETH
            console.log("Token order: WETH (token0), MockUSD (token1)");
        } else {
            // token0 = MockUSD, token1 = WETH
            // price = WETH/mockUSD in raw units
            // For 3000 USD/ETH: calculated using @midcurve/shared priceToSqrtRatioX96
            sqrtPriceX96 = 1446501726624926496477173928747177; // ~3000 USD/ETH
            console.log("Token order: MockUSD (token0), WETH (token1)");
        }

        poolContract.initialize(sqrtPriceX96);
        console.log("Pool initialized with sqrtPriceX96:", sqrtPriceX96);

        vm.stopBroadcast();

        // Read back slot0 to verify
        (uint160 currentPrice, int24 currentTick, , , , , ) = poolContract.slot0();
        console.log("");
        console.log("=== Pool State ===");
        console.log("sqrtPriceX96:", currentPrice);
        console.log("tick:", currentTick);
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Export the pool address:");
        console.log('   export MOCK_USD_WETH_POOL_ADDRESS="%s"', pool);
        console.log("");
        console.log("2. Add liquidity to the pool:");
        console.log("   pnpm local:add-liquidity");
    }
}
