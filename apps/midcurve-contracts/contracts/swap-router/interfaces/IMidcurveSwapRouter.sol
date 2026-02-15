// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMidcurveSwapRouter
/// @notice Interface for the MidcurveSwapRouter — a permissionless, multi-venue, multi-hop ERC20 swap router
interface IMidcurveSwapRouter {
    // ============================================================================
    // Structs
    // ============================================================================

    /// @notice Describes a single swap step within a multi-hop path
    /// @param venueId Identifier of the registered venue adapter (e.g., keccak256("UniswapV3"))
    /// @param tokenIn Input token for this hop
    /// @param tokenOut Output token for this hop
    /// @param venueData Venue-specific encoded parameters (e.g., abi.encode(uint24 fee) for UniswapV3)
    struct Hop {
        bytes32 venueId;
        address tokenIn;
        address tokenOut;
        bytes venueData;
    }

    // ============================================================================
    // Events
    // ============================================================================

    event Swap(
        address indexed sender,
        address indexed recipient,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    event AdapterRegistered(bytes32 indexed venueId, address indexed adapter);
    event AdapterDeregistered(bytes32 indexed venueId);
    event SwapTokenAdded(address indexed token);
    event SwapTokenRemoved(address indexed token);
    event ManagerTransferred(address indexed oldManager, address indexed newManager);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    // ============================================================================
    // Errors
    // ============================================================================

    // Swap errors
    error DeadlineExpired();
    error ZeroAmount();
    error SlippageExceeded(uint256 actual, uint256 limit);
    error SwapFailed(uint256 hopIndex);
    error MultihopBuyNotSupported();

    // Path validation errors
    error EmptyPath();
    error PathEndpointMismatch();
    error PathContinuityBroken(uint256 hopIndex);
    error TokenNotAllowed(address token, uint256 hopIndex);
    error HopSelfSwap(uint256 hopIndex);
    error VenueNotRegistered(bytes32 venueId);

    // Access control errors
    error NotManager();

    // Adapter management errors
    error AdapterAlreadyRegistered(bytes32 venueId);
    error AdapterNotRegistered(bytes32 venueId);
    error InvalidAdapterAddress();

    // SwapToken management errors
    error SwapTokenAlreadyWhitelisted(address token);
    error SwapTokenNotWhitelisted(address token);

    // General errors
    error ZeroAddress();

    // ============================================================================
    // Swap Functions
    // ============================================================================

    /// @notice Execute an exact-input (sell) swap, optionally multi-hop
    /// @param tokenIn ERC20 token the caller spends. Must match path[0].tokenIn.
    /// @param tokenOut ERC20 token the caller receives. Must match path[last].tokenOut.
    /// @param amountIn Exact amount of tokenIn to spend
    /// @param minAmountOut Minimum acceptable amount of tokenOut (slippage floor)
    /// @param recipient Address that receives tokenOut
    /// @param deadline Unix timestamp after which the transaction reverts
    /// @param path Ordered array of Hop structs describing the route
    /// @return amountOut Actual amount of tokenOut received
    function sell(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 deadline,
        Hop[] calldata path
    ) external returns (uint256 amountOut);

    /// @notice Execute an exact-output (buy) swap (single-hop only)
    /// @param tokenIn ERC20 token the caller spends. Must match path[0].tokenIn.
    /// @param tokenOut ERC20 token the caller receives. Must match path[last].tokenOut.
    /// @param maxAmountIn Maximum amount of tokenIn willing to spend (slippage ceiling)
    /// @param amountOut Exact amount of tokenOut desired
    /// @param recipient Address that receives tokenOut
    /// @param deadline Unix timestamp after which the transaction reverts
    /// @param path Single-element Hop array describing the route
    /// @return amountIn Actual amount of tokenIn consumed
    function buy(
        address tokenIn,
        address tokenOut,
        uint256 maxAmountIn,
        uint256 amountOut,
        address recipient,
        uint256 deadline,
        Hop[] calldata path
    ) external returns (uint256 amountIn);

    // ============================================================================
    // Manager Functions
    // ============================================================================

    /// @notice Register a venue adapter
    function registerAdapter(bytes32 venueId, address adapter) external;

    /// @notice Deregister a venue adapter
    function deregisterAdapter(bytes32 venueId) external;

    /// @notice Add a token to the SwapToken whitelist
    function addSwapToken(address token) external;

    /// @notice Remove a token from the SwapToken whitelist
    function removeSwapToken(address token) external;

    /// @notice Transfer the manager role to a new address
    function transferManager(address newManager) external;

    /// @notice Permanently renounce the manager role (sets manager to address(0))
    function renounceManager() external;

    /// @notice Recover tokens stuck in the router due to a bug
    function rescueTokens(address token, address to, uint256 amount) external;

    // ============================================================================
    // View Functions
    // ============================================================================

    /// @notice Get the adapter address for a venue
    function getAdapter(bytes32 venueId) external view returns (address);

    /// @notice Check if a token is whitelisted as a SwapToken
    function isSwapToken(address token) external view returns (bool);

    /// @notice Get the current manager address
    function manager() external view returns (address);
}
