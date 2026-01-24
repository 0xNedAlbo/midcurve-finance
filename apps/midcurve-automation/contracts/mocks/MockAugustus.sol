// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockAugustus
 * @notice Mock Paraswap Augustus for local testing - swaps via Uniswap V3 pool directly
 * @dev Implements IAugustus interface and executes swaps through configured pool
 *
 * This contract bypasses Paraswap's routing and directly swaps through a single
 * Uniswap V3 pool. Used for local development where Paraswap API cannot price
 * custom tokens like mockUSD.
 */

interface IERC20Minimal {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV3PoolMinimal {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

library TickMath {
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
}

contract MockAugustus {
    /// @notice TokenTransferProxy is this contract (we handle approvals internally)
    address public immutable tokenTransferProxy;

    /// @notice The pool to use for swaps
    address public pool;

    /// @notice For swap callback validation
    address private _expectedPool;

    constructor() {
        // TokenTransferProxy is this contract
        tokenTransferProxy = address(this);
    }

    /**
     * @notice Configure the pool to use for swaps
     * @param _pool The Uniswap V3 pool address
     */
    function setPool(address _pool) external {
        pool = _pool;
    }

    /**
     * @notice Get the TokenTransferProxy address (required by IAugustus interface)
     * @return The address that needs token approval for swaps
     */
    function getTokenTransferProxy() external view returns (address) {
        return tokenTransferProxy;
    }

    /**
     * @notice Execute a swap via the configured pool
     * @param tokenIn Token to swap from
     * @param tokenOut Token to swap to
     * @param amountIn Amount of tokenIn to swap
     * @param minAmountOut Minimum amount of tokenOut expected (slippage protection)
     * @return amountOut The amount of tokenOut received
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        require(pool != address(0), "Pool not configured");

        // Transfer tokens from caller to this contract
        require(IERC20Minimal(tokenIn).transferFrom(msg.sender, address(this), amountIn), "TransferFrom failed");

        // Determine swap direction
        address token0 = IUniswapV3PoolMinimal(pool).token0();
        bool zeroForOne = (tokenIn == token0);

        // Price limit (extreme to ensure swap executes)
        uint160 sqrtPriceLimitX96 = zeroForOne
            ? TickMath.MIN_SQRT_RATIO + 1
            : TickMath.MAX_SQRT_RATIO - 1;

        // Track output balance before swap
        uint256 balanceBefore = IERC20Minimal(tokenOut).balanceOf(address(this));

        // Set expected pool for callback validation
        _expectedPool = pool;

        // Execute swap (positive amountSpecified = exact input)
        IUniswapV3PoolMinimal(pool).swap(
            address(this),
            zeroForOne,
            // forge-lint: disable-next-line(unsafe-typecast)
            int256(amountIn),
            sqrtPriceLimitX96,
            ""
        );

        // Clear expected pool
        _expectedPool = address(0);

        // Calculate output amount
        amountOut = IERC20Minimal(tokenOut).balanceOf(address(this)) - balanceBefore;
        require(amountOut >= minAmountOut, "Slippage exceeded");

        // Transfer output to caller
        require(IERC20Minimal(tokenOut).transfer(msg.sender, amountOut), "Transfer failed");
    }

    /**
     * @notice Uniswap V3 swap callback
     * @dev Called by the pool during swap to receive tokens
     */
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata /* data */
    ) external {
        require(msg.sender == _expectedPool, "Invalid callback");

        // Pay the pool the tokens it requested
        if (amount0Delta > 0) {
            address token0 = IUniswapV3PoolMinimal(msg.sender).token0();
            // forge-lint: disable-next-line(unsafe-typecast)
            require(IERC20Minimal(token0).transfer(msg.sender, uint256(amount0Delta)), "Transfer failed");
        }
        if (amount1Delta > 0) {
            address token1 = IUniswapV3PoolMinimal(msg.sender).token1();
            // forge-lint: disable-next-line(unsafe-typecast)
            require(IERC20Minimal(token1).transfer(msg.sender, uint256(amount1Delta)), "Transfer failed");
        }
    }
}
