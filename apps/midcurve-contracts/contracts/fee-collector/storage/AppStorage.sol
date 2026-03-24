// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AppStorage
/// @notice Shared storage struct for the UniswapV3FeeCollector Diamond (V1)
/// @dev All facets share this storage at slot 0 using the Diamond Storage pattern

// =============================================================================
// ENUMS
// =============================================================================

/// @notice Order status lifecycle for collect orders
enum CollectOrderStatus {
    NONE,        // 0 - No order exists at this slot
    ACTIVE,      // 1 - Order is registered and actively monitored
    CANCELLED    // 2 - Order was cancelled by owner
}

/// @notice Swap direction for post-collect token conversion
/// @dev Uses Uniswap's native token ordering (token0/token1)
enum SwapDirection {
    NONE,         // 0 - No swap, user receives both tokens as-is
    TOKEN0_TO_1,  // 1 - Swap token0 to token1
    TOKEN1_TO_0   // 2 - Swap token1 to token0
}

// =============================================================================
// STRUCTS
// =============================================================================

/// @notice Collect order data structure
/// @dev Each position can have at most 1 collect order (keyed by nftId)
struct CollectOrder {
    // Order status
    CollectOrderStatus status;

    // Position data
    uint256 nftId;              // Uniswap V3 position NFT ID
    address owner;              // NFT owner at registration time
    address pool;               // Uniswap V3 pool address

    // Execution configuration
    address payout;             // Recipient of collected fee tokens
    address operator;           // Automation wallet that can execute
    uint256 validUntil;         // Expiration timestamp (0 = no expiry)

    // Post-collect swap configuration
    SwapDirection swapDirection;    // Direction of optional token swap
    uint16 swapSlippageBps;         // Swap slippage tolerance (0-10000, ignored when NONE)

    // Minimum fee threshold
    address minFeeToken;        // Token address that minFeeValue is denominated in (token0 or token1)
    uint256 minFeeValue;        // Minimum fee threshold in minFeeToken units
}

/// @notice Main application storage struct
/// @dev This struct is stored at slot 0 and shared by all facets
struct AppStorage {
    // ========================================
    // CHAIN CONSTANTS (set once at deployment)
    // ========================================

    /// @notice The Uniswap V3 NonfungiblePositionManager address
    address positionManager;

    /// @notice The MidcurveSwapRouter address for post-collect token swaps
    address swapRouter;

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

    /// @notice Mapping from nftId to CollectOrder (one per position)
    mapping(uint256 => CollectOrder) orders;

    /// @notice Mapping to track which orders exist for a position
    mapping(uint256 => bool) orderExists;

    // ========================================
    // REENTRANCY & INITIALIZATION
    // ========================================

    /// @notice Reentrancy guard lock (1 = unlocked, 2 = locked)
    uint256 reentrancyLock;

    /// @notice Whether the contract has been initialized
    bool initialized;
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
}

// =============================================================================
// MODIFIERS CONTRACT
// =============================================================================

/// @title Modifiers
/// @notice Common modifiers for facets
/// @dev Inherit this in facets that need access control or reentrancy guards
abstract contract Modifiers {
    // ============ Reentrancy Guard ============

    modifier nonReentrant() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.reentrancyLock == 1, "REENTRANCY");
        s.reentrancyLock = 2;
        _;
        s.reentrancyLock = 1;
    }

    // ============ Initialization ============

    modifier whenInitialized() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.initialized, "NOT_INITIALIZED");
        _;
    }

    // ============ Order Existence ============

    modifier orderMustExist(uint256 nftId) {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.orderExists[nftId], "ORDER_NOT_FOUND");
        _;
    }

    modifier orderMustNotExist(uint256 nftId) {
        AppStorage storage s = LibAppStorage.appStorage();
        require(!s.orderExists[nftId], "ORDER_ALREADY_EXISTS");
        _;
    }

    // ============ Errors ============

    error NotOwner();                                                                       // 0x30cd7471
    error NotOperator();                                                                    // 0x7c214f04
    error ZeroAddress();                                                                    // 0xd92e233d
    error SlippageBpsOutOfRange(uint16 slippageBps);                                        // 0x49c26c64
    error InvalidMinFeeToken(address provided, address token0, address token1);
    error OrderAlreadyExists(uint256 nftId);
    error OrderNotFound(uint256 nftId);
    error WrongOrderStatus(CollectOrderStatus expected, CollectOrderStatus actual);
    error OrderExpired(uint256 validUntil, uint256 nowTs);
    error NftNotOwnedByRecordedOwner(address expectedOwner, address actualOwner);
    error NftNotApproved(address owner, uint256 nftId);
    error FeeBpsTooHigh(uint16 feeBps, uint16 maxFeeBps);
    error FeeBelowMinimum(uint256 actual, uint256 minimum);
    error TransferFailed();
    error SwapFailed();
    error SwapOutputZero();
    error SwapSlippageBpsOutOfRange(uint16 swapSlippageBps);
    error NoFeesCollected();
}
