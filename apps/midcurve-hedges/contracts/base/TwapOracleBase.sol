// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {IUniswapV3Factory} from "../interfaces/IUniswapV3Factory.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {FullMath} from "../libraries/FullMath.sol";
import {TickMath} from "../libraries/TickMath.sol";

/// @title TwapOracleBase
/// @notice Abstract base contract for TWAP oracle functionality
/// @dev Provides TWAP price fetching and execution price validation against TWAP
abstract contract TwapOracleBase {
    // ============ Errors ============

    error PoolNotFromFactory();
    error PoolPairMismatch();
    error ObserveWindowNotAvailable();
    error OracleLiquidityTooLow(uint128 oracleLiq, uint128 minLiq);
    error OracleLiquidityBelowPositionLiquidity(uint128 oracleLiq, uint128 posLiq, uint16 alphaBps);
    error PriceDeviationTooHigh(uint256 actualBps, uint256 maxAllowedBps);

    // ============ Events ============

    event OraclePoolSet(address indexed oraclePool, uint32 windowSeconds);
    event MaxPriceDeviationSet(uint16 newMaxDeviationBps);

    // ============ State ============

    address public oraclePool;
    uint32 public oracleWindowSeconds;
    uint16 public maxPriceDeviationBps;

    // ============ Abstract Hooks ============

    /// @dev Returns token info needed for oracle operations
    /// @return quoteToken The quote token address
    /// @return baseToken The base token address
    /// @return token0IsQuote Whether token0 is the quote token
    /// @return factory The Uniswap V3 factory
    /// @return positionPool The position pool address (for liquidity comparison)
    function _getOracleTokenInfo() internal view virtual returns (
        address quoteToken,
        address baseToken,
        bool token0IsQuote,
        IUniswapV3Factory factory,
        address positionPool
    );

    // ============ Internal Setters ============

    /// @dev Set oracle pool for a token pair
    /// @param tokenA One token of the pair
    /// @param tokenB The other token of the pair
    /// @param fee Uniswap V3 fee tier
    /// @param windowSeconds TWAP observation window
    /// @param minOracleLiquidity Minimum liquidity required in oracle pool
    /// @param alphaBps Require oracle liquidity >= alphaBps/10000 * position pool liquidity (0 to disable)
    function _setOraclePoolForPair(
        address tokenA,
        address tokenB,
        uint24 fee,
        uint32 windowSeconds,
        uint128 minOracleLiquidity,
        uint16 alphaBps
    ) internal {
        (, , , IUniswapV3Factory factory, address posPool) = _getOracleTokenInfo();

        // 1) Resolve pool from factory (canonical validation)
        address expected = factory.getPool(tokenA, tokenB, fee);
        if (expected == address(0)) revert PoolNotFromFactory();

        // 2) Basic pair sanity
        _requirePoolMatchesPair(expected, tokenA, tokenB);

        // 3) Ensure observe(window) works for the chosen window (history available)
        _requireObserveWindowAvailable(expected, windowSeconds);

        // 4) Liquidity checks
        uint128 oracleLiq = IUniswapV3PoolMinimal(expected).liquidity();
        if (oracleLiq < minOracleLiquidity) revert OracleLiquidityTooLow(oracleLiq, minOracleLiquidity);

        if (alphaBps != 0 && posPool != address(0)) {
            uint128 posLiq = IUniswapV3PoolMinimal(posPool).liquidity();

            // Require: oracleLiq >= posLiq * alphaBps / 10000
            // Use 256-bit math to avoid overflow
            uint256 rhs = (uint256(posLiq) * uint256(alphaBps)) / 10_000;

            if (uint256(oracleLiq) < rhs) {
                revert OracleLiquidityBelowPositionLiquidity(oracleLiq, posLiq, alphaBps);
            }
        }

        // 5) Store config
        oraclePool = expected;
        oracleWindowSeconds = windowSeconds;

        emit OraclePoolSet(expected, windowSeconds);
    }

    /// @dev Set maximum allowed price deviation from TWAP
    /// @param newMaxDeviationBps Maximum deviation in basis points (0 to disable)
    function _setMaxPriceDeviation(uint16 newMaxDeviationBps) internal {
        maxPriceDeviationBps = newMaxDeviationBps;
        emit MaxPriceDeviationSet(newMaxDeviationBps);
    }

    // ============ TWAP Price Functions ============

    /// @notice Get TWAP price from oracle pool as quote per base, scaled to 1e18
    /// @dev Uses FullMath.mulDiv for overflow-safe 512-bit intermediate calculations
    /// @return priceQuotePerBase1e18 Price as (quote per 1 base) * 1e18
    function _getTwapPriceQuotePerBase1e18() internal view returns (uint256 priceQuotePerBase1e18) {
        if (oraclePool == address(0)) return 0;

        (address quoteToken, address baseToken, bool token0IsQuote, , ) = _getOracleTokenInfo();

        int24 arithmeticMeanTick = _getArithmeticMeanTick(oracleWindowSeconds);
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        uint8 quoteDecimals = IERC20(quoteToken).decimals();
        uint8 baseDecimals = IERC20(baseToken).decimals();

        // sqrtPriceX96 encodes sqrt(token1 / token0) * 2^96
        // price_token1_per_token0 = (sqrtPriceX96)^2 / 2^192
        //
        // We need quote_per_base. Relationship to token0/token1 depends on token0IsQuote.

        if (token0IsQuote) {
            // token0 = quote, token1 = base
            // sqrtPriceX96 = sqrt(base / quote) * 2^96
            // price_base_per_quote = sqrtPriceX96^2 / 2^192
            // price_quote_per_base = 2^192 / sqrtPriceX96^2
            //
            // Normalized: price_quote_per_base * 10^(baseDecimals - quoteDecimals) * 1e18
            // = (2^192 * 1e18 * 10^baseDecimals) / (sqrtPriceX96^2 * 10^quoteDecimals)
            //
            // Use FullMath: mulDiv(2^192 * 10^baseDecimals, 1e18, sqrtPriceX96^2 * 10^quoteDecimals)
            uint256 numerator = (uint256(1) << 192) * _pow10(baseDecimals);
            uint256 denominator = uint256(sqrtPriceX96) * uint256(sqrtPriceX96) * _pow10(quoteDecimals);
            if (denominator == 0) return 0;
            priceQuotePerBase1e18 = FullMath.mulDiv(numerator, 1e18, denominator);
        } else {
            // token0 = base, token1 = quote
            // sqrtPriceX96 = sqrt(quote / base) * 2^96
            // price_quote_per_base = sqrtPriceX96^2 / 2^192
            //
            // Normalized: price_quote_per_base * 10^(baseDecimals - quoteDecimals) * 1e18
            // = (sqrtPriceX96^2 * 1e18 * 10^baseDecimals) / (2^192 * 10^quoteDecimals)
            //
            // Use FullMath: mulDiv(sqrtPriceX96^2 * 10^baseDecimals, 1e18, 2^192 * 10^quoteDecimals)
            uint256 sqrtPriceSq = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
            uint256 numerator = sqrtPriceSq * _pow10(baseDecimals);
            uint256 denominator = (uint256(1) << 192) * _pow10(quoteDecimals);
            priceQuotePerBase1e18 = FullMath.mulDiv(numerator, 1e18, denominator);
        }
    }

    /// @notice Validate execution price against TWAP
    /// @dev Uses FullMath for overflow-safe calculations with arbitrary token decimals
    /// @param sellAmount Amount of token sold (in native decimals)
    /// @param buyAmount Amount of token bought (in native decimals)
    /// @param isBuyingBase True if buying base token (selling quote)
    function _validatePriceAgainstTwap(
        uint256 sellAmount,
        uint256 buyAmount,
        bool isBuyingBase
    ) internal view {
        if (oraclePool == address(0)) return;
        if (maxPriceDeviationBps == 0) return;

        uint256 twapPrice = _getTwapPriceQuotePerBase1e18();
        if (twapPrice == 0) return;

        (address quoteToken, address baseToken, , , ) = _getOracleTokenInfo();

        uint8 quoteDecimals = IERC20(quoteToken).decimals();
        uint8 baseDecimals = IERC20(baseToken).decimals();

        // Calculate execution price as quote_per_base * 1e18
        uint256 executionPrice;
        if (isBuyingBase) {
            // Selling quote, buying base
            // price = sellAmount(quote) / buyAmount(base) normalized
            // = (sellAmount / 10^quoteDecimals) / (buyAmount / 10^baseDecimals) * 1e18
            // = sellAmount * 10^baseDecimals * 1e18 / (buyAmount * 10^quoteDecimals)
            executionPrice = FullMath.mulDiv(
                sellAmount * _pow10(baseDecimals),
                1e18,
                buyAmount * _pow10(quoteDecimals)
            );
        } else {
            // Selling base, buying quote
            // price = buyAmount(quote) / sellAmount(base) normalized
            // = (buyAmount / 10^quoteDecimals) / (sellAmount / 10^baseDecimals) * 1e18
            // = buyAmount * 10^baseDecimals * 1e18 / (sellAmount * 10^quoteDecimals)
            executionPrice = FullMath.mulDiv(
                buyAmount * _pow10(baseDecimals),
                1e18,
                sellAmount * _pow10(quoteDecimals)
            );
        }

        // Calculate deviation in basis points using FullMath
        uint256 deviation;
        if (executionPrice > twapPrice) {
            deviation = FullMath.mulDiv(executionPrice - twapPrice, 10000, twapPrice);
        } else {
            deviation = FullMath.mulDiv(twapPrice - executionPrice, 10000, twapPrice);
        }

        if (deviation > maxPriceDeviationBps) {
            revert PriceDeviationTooHigh(deviation, maxPriceDeviationBps);
        }
    }

    // ============ Internal Helpers ============

    /// @notice Helper to compute 10^d safely
    function _pow10(uint8 d) internal pure returns (uint256) {
        uint256 result = 1;
        for (uint8 i = 0; i < d; i++) {
            result *= 10;
        }
        return result;
    }

    /// @notice Get arithmetic mean tick from oracle pool over the configured window
    /// @param windowSeconds TWAP window in seconds
    /// @return arithmeticMeanTick The time-weighted average tick
    function _getArithmeticMeanTick(uint32 windowSeconds) internal view returns (int24 arithmeticMeanTick) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = windowSeconds;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives, ) = IUniswapV3PoolMinimal(oraclePool).observe(secondsAgos);

        int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
        // forge-lint: disable-next-line(unsafe-typecast)
        arithmeticMeanTick = int24(tickCumulativesDelta / int56(int32(windowSeconds)));
    }

    /// @notice Validate that pool contains the expected token pair
    function _requirePoolMatchesPair(address poolAddr, address tokenA, address tokenB) internal view {
        address t0 = IUniswapV3PoolMinimal(poolAddr).token0();
        address t1 = IUniswapV3PoolMinimal(poolAddr).token1();

        bool ok = (t0 == tokenA && t1 == tokenB) || (t0 == tokenB && t1 == tokenA);
        if (!ok) revert PoolPairMismatch();
    }

    /// @notice Validate that observe window is available for the pool
    function _requireObserveWindowAvailable(address poolAddr, uint32 windowSeconds) internal view {
        // Call observe([windowSeconds, 0]) and ensure it does not revert
        uint32[] memory secs = new uint32[](2);
        secs[0] = windowSeconds;
        secs[1] = 0;

        try IUniswapV3PoolMinimal(poolAddr).observe(secs) returns (int56[] memory, uint160[] memory) {
            // ok
        } catch {
            revert ObserveWindowNotAvailable();
        }
    }
}
