// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IMidcurveSwapRouter } from "./interfaces/IMidcurveSwapRouter.sol";
import { IVenueAdapter } from "./interfaces/IVenueAdapter.sol";

/// @title MidcurveSwapRouter
/// @notice Permissionless, multi-venue, multi-hop ERC20 swap router with atomic execution guarantees
/// @dev The router does not hold tokens between transactions. It pulls input tokens from the caller
///      via transferFrom, executes an ordered sequence of swaps across registered venue adapters,
///      and sends the final output to a designated recipient. If any hop fails or slippage tolerance
///      is violated, the entire transaction reverts.
contract MidcurveSwapRouter is IMidcurveSwapRouter {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // ============================================================================
    // State
    // ============================================================================

    /// @notice The manager address. Can register adapters, manage SwapTokens, rescue tokens.
    ///         Set to address(0) via renounceManager() to make configuration permanent.
    address public manager;

    /// @notice Registered venue adapters (venueId => adapter address)
    mapping(bytes32 => address) public venueAdapters;

    /// @notice Whitelisted intermediary tokens for path validation
    EnumerableSet.AddressSet private _swapTokens;

    /// @dev Reentrancy lock (1 = unlocked, 2 = locked)
    uint256 private _reentrancyLock;

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyLock == 2) revert("ReentrancyGuard: reentrant call");
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    /// @param manager_ Initial manager address. Must not be address(0).
    constructor(address manager_) {
        if (manager_ == address(0)) revert ZeroAddress();
        manager = manager_;
        _reentrancyLock = 1;
    }

    // ============================================================================
    // Swap Functions
    // ============================================================================

    /// @inheritdoc IMidcurveSwapRouter
    function sell(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 deadline,
        Hop[] calldata path
    ) external nonReentrant returns (uint256 amountOut) {
        // 1. Deadline check
        if (block.timestamp > deadline) revert DeadlineExpired();

        // 2. Amount check
        if (amountIn == 0) revert ZeroAmount();

        // 3. Validate path
        _validatePath(tokenIn, tokenOut, path);

        // 4. Pull input tokens from caller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // 5. Execute hops sequentially
        uint256 currentAmount = amountIn;

        for (uint256 i = 0; i < path.length; i++) {
            Hop calldata hop = path[i];
            address adapter = venueAdapters[hop.venueId];

            // Transfer current tokens to the adapter
            IERC20(hop.tokenIn).safeTransfer(adapter, currentAmount);

            // Execute swap on adapter — output goes back to this router
            currentAmount = IVenueAdapter(adapter).swapExactInput(
                hop.tokenIn, hop.tokenOut, currentAmount, hop.venueData
            );

            if (currentAmount == 0) revert SwapFailed(i);
        }

        amountOut = currentAmount;

        // 6. Slippage check
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        // 7. Transfer output to recipient
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        // 8. Emit event
        emit Swap(msg.sender, recipient, tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @inheritdoc IMidcurveSwapRouter
    function buy(
        address tokenIn,
        address tokenOut,
        uint256 maxAmountIn,
        uint256 amountOut,
        address recipient,
        uint256 deadline,
        Hop[] calldata path
    ) external nonReentrant returns (uint256 amountIn) {
        // 1. Deadline check
        if (block.timestamp > deadline) revert DeadlineExpired();

        // 2. Amount check
        if (amountOut == 0) revert ZeroAmount();

        // 3. Single-hop only for buy (multi-hop exact-output not yet supported)
        if (path.length != 1) revert MultihopBuyNotSupported();

        // 4. Validate path
        _validatePath(tokenIn, tokenOut, path);

        // 5. Pull max input tokens from caller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), maxAmountIn);

        // 6. Transfer tokens to adapter
        Hop calldata hop = path[0];
        address adapter = venueAdapters[hop.venueId];
        IERC20(tokenIn).safeTransfer(adapter, maxAmountIn);

        // 7. Execute exact-output swap
        amountIn = IVenueAdapter(adapter).swapExactOutput(
            hop.tokenIn, hop.tokenOut, amountOut, maxAmountIn, hop.venueData
        );

        // 8. Transfer output to recipient
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        // 9. Refund unused input tokens to caller
        uint256 remainder = IERC20(tokenIn).balanceOf(address(this));
        if (remainder > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, remainder);
        }

        // 10. Emit event
        emit Swap(msg.sender, recipient, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ============================================================================
    // Manager Functions
    // ============================================================================

    /// @inheritdoc IMidcurveSwapRouter
    function registerAdapter(bytes32 venueId, address adapter) external onlyManager {
        if (adapter == address(0)) revert InvalidAdapterAddress();
        if (venueAdapters[venueId] != address(0)) revert AdapterAlreadyRegistered(venueId);

        venueAdapters[venueId] = adapter;
        emit AdapterRegistered(venueId, adapter);
    }

    /// @inheritdoc IMidcurveSwapRouter
    function deregisterAdapter(bytes32 venueId) external onlyManager {
        if (venueAdapters[venueId] == address(0)) revert AdapterNotRegistered(venueId);

        delete venueAdapters[venueId];
        emit AdapterDeregistered(venueId);
    }

    /// @inheritdoc IMidcurveSwapRouter
    function addSwapToken(address token) external onlyManager {
        if (token == address(0)) revert ZeroAddress();
        if (!_swapTokens.add(token)) revert SwapTokenAlreadyWhitelisted(token);

        emit SwapTokenAdded(token);
    }

    /// @inheritdoc IMidcurveSwapRouter
    function removeSwapToken(address token) external onlyManager {
        if (!_swapTokens.remove(token)) revert SwapTokenNotWhitelisted(token);

        emit SwapTokenRemoved(token);
    }

    /// @inheritdoc IMidcurveSwapRouter
    function transferManager(address newManager) external onlyManager {
        if (newManager == address(0)) revert ZeroAddress();

        address oldManager = manager;
        manager = newManager;
        emit ManagerTransferred(oldManager, newManager);
    }

    /// @inheritdoc IMidcurveSwapRouter
    function renounceManager() external onlyManager {
        address oldManager = manager;
        manager = address(0);
        emit ManagerTransferred(oldManager, address(0));
    }

    /// @inheritdoc IMidcurveSwapRouter
    function rescueTokens(address token, address to, uint256 amount) external onlyManager {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit TokensRescued(token, to, amount);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /// @inheritdoc IMidcurveSwapRouter
    function getAdapter(bytes32 venueId) external view returns (address) {
        return venueAdapters[venueId];
    }

    /// @inheritdoc IMidcurveSwapRouter
    function isSwapToken(address token) external view returns (bool) {
        return _swapTokens.contains(token);
    }

    /// @inheritdoc IMidcurveSwapRouter
    function getSwapTokens() external view returns (address[] memory) {
        return _swapTokens.values();
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    /// @dev Validate the swap path according to PRD §6 rules:
    ///      1. Path must not be empty
    ///      2. Path continuity (consecutive hop tokenOut == tokenIn)
    ///      3. Path endpoints (first tokenIn == tokenIn param, last tokenOut == tokenOut param)
    ///      4. Allowed tokens per hop (intermediaries must be in {tokenIn, tokenOut} ∪ SwapTokens)
    ///      5. No self-swaps per hop
    ///      6. Venue must be registered
    function _validatePath(address tokenIn, address tokenOut, Hop[] calldata path) internal view {
        // Rule 1: Non-empty path
        if (path.length == 0) revert EmptyPath();

        // Rule 3: Endpoints
        if (path[0].tokenIn != tokenIn || path[path.length - 1].tokenOut != tokenOut) {
            revert PathEndpointMismatch();
        }

        for (uint256 i = 0; i < path.length; i++) {
            Hop calldata hop = path[i];

            // Rule 5: No self-swaps
            if (hop.tokenIn == hop.tokenOut) revert HopSelfSwap(i);

            // Rule 6: Venue must be registered
            if (venueAdapters[hop.venueId] == address(0)) revert VenueNotRegistered(hop.venueId);

            // Rule 2: Continuity (for hops after the first)
            if (i > 0 && path[i - 1].tokenOut != hop.tokenIn) {
                revert PathContinuityBroken(i);
            }

            // Rule 4: Allowed tokens per hop
            // Both tokenIn and tokenOut of each hop must be in {overallTokenIn, overallTokenOut} ∪ SwapTokens
            if (!_isAllowedToken(hop.tokenIn, tokenIn, tokenOut)) {
                revert TokenNotAllowed(hop.tokenIn, i);
            }
            if (!_isAllowedToken(hop.tokenOut, tokenIn, tokenOut)) {
                revert TokenNotAllowed(hop.tokenOut, i);
            }
        }
    }

    /// @dev Check if a token is allowed in a hop: must be one of the overall endpoints or a whitelisted SwapToken
    function _isAllowedToken(address token, address overallTokenIn, address overallTokenOut) internal view returns (bool) {
        return token == overallTokenIn || token == overallTokenOut || _swapTokens.contains(token);
    }
}
