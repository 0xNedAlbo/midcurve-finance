// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AppStorage
/// @notice Shared storage struct for the UniswapV3PositionCloser Diamond (V1)
/// @dev All facets share this storage at slot 0 using the Diamond Storage pattern

// =============================================================================
// ENUMS
// =============================================================================

/// @notice Order type for close triggers
enum OrderType {
    STOP_LOSS,   // 0 - Trigger when currentTick <= triggerTick
    TAKE_PROFIT  // 1 - Trigger when currentTick >= triggerTick
}

/// @notice Order status lifecycle
enum OrderStatus {
    NONE,        // 0 - No order exists at this slot
    ACTIVE,      // 1 - Order is registered and actively monitored
    EXECUTED,    // 2 - Order was executed successfully
    CANCELLED    // 3 - Order was cancelled by owner
}

/// @notice Swap direction for post-close token conversion via Paraswap
enum SwapDirection {
    NONE,           // 0 - No swap, user receives both tokens as-is
    BASE_TO_QUOTE,  // 1 - Swap base token to quote token
    QUOTE_TO_BASE   // 2 - Swap quote token to base token
}

// =============================================================================
// STRUCTS
// =============================================================================

/// @notice Close order data structure
/// @dev Each position can have at most 1 STOP_LOSS and 1 TAKE_PROFIT order
struct CloseOrder {
    // Order identification and status
    OrderStatus status;         // Current lifecycle status

    // Position data
    uint256 nftId;              // Uniswap V3 position NFT ID
    address owner;              // NFT owner at registration time
    address pool;               // Uniswap V3 pool address

    // Trigger configuration (tick-based)
    int24 triggerTick;          // Price threshold as tick value

    // Execution configuration
    address payout;             // Recipient of closed position tokens
    address operator;           // Automation wallet that can execute
    uint256 validUntil;         // Expiration timestamp (0 = no expiry)
    uint16 slippageBps;         // Decrease liquidity slippage tolerance (0-10000)

    // Post-close swap configuration
    SwapDirection swapDirection;    // Direction of optional token swap
    address swapQuoteToken;         // Quote token address (for swap direction)
    uint16 swapSlippageBps;         // Swap slippage tolerance (0-10000)
}

/// @notice Main application storage struct
/// @dev This struct is stored at slot 0 and shared by all facets
struct AppStorage {
    // ========================================
    // CHAIN CONSTANTS (set once at deployment)
    // ========================================

    /// @notice The Uniswap V3 NonfungiblePositionManager address
    address positionManager;

    /// @notice The Paraswap AugustusRegistry address for swap validation
    address augustusRegistry;

    // ========================================
    // PROTOCOL CONFIGURATION
    // ========================================

    /// @notice Maximum fee the operator can charge (100 = 1%)
    uint16 maxFeeBps;

    /// @notice Interface version for on-chain querying (e.g., 1_00 = v1.0)
    uint32 interfaceVersion;

    // ========================================
    // ORDER STORAGE
    // ========================================

    /// @notice Mapping from order key to CloseOrder
    /// @dev Key: keccak256(abi.encode(nftId, orderType))
    mapping(bytes32 => CloseOrder) orders;

    /// @notice Mapping to track which orders exist for a position
    /// @dev Used for quick existence checks: nftId => orderType => exists
    mapping(uint256 => mapping(OrderType => bool)) orderExists;

    // ========================================
    // REENTRANCY & INITIALIZATION
    // ========================================

    /// @notice Reentrancy guard lock (1 = unlocked, 2 = locked)
    uint256 reentrancyLock;

    /// @notice Whether the contract has been initialized
    bool initialized;

    // ========================================
    // TRANSIENT STATE (for swap callbacks)
    // ========================================

    /// @notice Expected pool for swap callback validation
    address expectedSwapPool;
}

// =============================================================================
// LIBRARY
// =============================================================================

/// @title LibAppStorage
/// @notice Library for accessing AppStorage at slot 0
library LibAppStorage {
    /// @notice Get the AppStorage struct from slot 0
    /// @return s The AppStorage struct
    function appStorage() internal pure returns (AppStorage storage s) {
        assembly {
            s.slot := 0
        }
    }

    /// @notice Generate order key from nftId and orderType
    /// @param nftId The position NFT ID
    /// @param orderType The order type (STOP_LOSS or TAKE_PROFIT)
    /// @return The order key
    function orderKey(uint256 nftId, OrderType orderType) internal pure returns (bytes32) {
        return keccak256(abi.encode(nftId, orderType));
    }
}

// =============================================================================
// MODIFIERS CONTRACT
// =============================================================================

/// @title Modifiers
/// @notice Common modifiers for facets
/// @dev Inherit this in facets that need access control or reentrancy guards
abstract contract Modifiers {
    // ============ Reentrancy Guard ============

    /// @notice Reentrancy guard modifier
    modifier nonReentrant() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.reentrancyLock == 1, "REENTRANCY");
        s.reentrancyLock = 2;
        _;
        s.reentrancyLock = 1;
    }

    // ============ Initialization ============

    /// @notice Modifier to ensure contract is initialized
    modifier whenInitialized() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.initialized, "NOT_INITIALIZED");
        _;
    }

    // ============ Order Existence ============

    /// @notice Modifier to ensure order exists
    modifier orderMustExist(uint256 nftId, OrderType orderType) {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.orderExists[nftId][orderType], "ORDER_NOT_FOUND");
        _;
    }

    /// @notice Modifier to ensure order does not exist
    modifier orderMustNotExist(uint256 nftId, OrderType orderType) {
        AppStorage storage s = LibAppStorage.appStorage();
        require(!s.orderExists[nftId][orderType], "ORDER_ALREADY_EXISTS");
        _;
    }

    // ============ Errors ============

    error NotOwner();
    error NotOperator();
    error ZeroAddress();
    error SlippageBpsOutOfRange(uint16 slippageBps);
    error InvalidTriggerTick(int24 tick, OrderType orderType);
    error OrderAlreadyExists(uint256 nftId, OrderType orderType);
    error OrderNotFound(uint256 nftId, OrderType orderType);
    error WrongOrderStatus(OrderStatus expected, OrderStatus actual);
    error OrderExpired(uint256 validUntil, uint256 nowTs);
    error TriggerConditionNotMet(int24 currentTick, int24 triggerTick, OrderType orderType);
    error NftNotOwnedByRecordedOwner(address expectedOwner, address actualOwner);
    error NftNotApproved(address owner, uint256 nftId);
    error FeeBpsTooHigh(uint16 feeBps, uint16 maxFeeBps);
    error TransferFailed();
    error InvalidAugustus(address augustus);
    error SwapDeadlineExpired(uint256 deadline, uint256 current);
    error SwapFailed();
    error SwapOutputZero();
    error InvalidQuoteToken(address quoteToken, address token0, address token1);
    error SwapSlippageBpsOutOfRange(uint16 swapSlippageBps);
    error SlippageExceeded(uint256 minExpected, uint256 actual);
}
