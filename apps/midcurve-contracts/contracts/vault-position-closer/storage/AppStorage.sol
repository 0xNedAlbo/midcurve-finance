// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AppStorage
/// @notice Shared storage struct for the UniswapV3VaultPositionCloser Diamond (V1)
/// @dev All facets share this storage at slot 0 using the Diamond Storage pattern.
///      Enums and structs are intentionally redefined (not imported from position-closer)
///      to keep the two Diamonds' storage layouts fully independent.

// =============================================================================
// ENUMS
// =============================================================================

/// @notice Trigger mode for close orders (tick-based)
enum TriggerMode {
    LOWER,   // 0 - Trigger when currentTick <= triggerTick
    UPPER    // 1 - Trigger when currentTick >= triggerTick
}

/// @notice Order status lifecycle
enum OrderStatus {
    NONE,        // 0 - No order exists at this slot
    ACTIVE,      // 1 - Order is registered and actively monitored
    EXECUTED,    // 2 - Order was executed successfully
    CANCELLED    // 3 - Order was cancelled by owner
}

/// @notice Swap direction for post-close token conversion
enum SwapDirection {
    NONE,         // 0 - No swap, user receives both tokens as-is
    TOKEN0_TO_1,  // 1 - Swap token0 to token1
    TOKEN1_TO_0   // 2 - Swap token1 to token0
}

// =============================================================================
// STRUCTS
// =============================================================================

/// @notice Close order data structure for vault positions
/// @dev Each user can have at most 1 LOWER and 1 UPPER order per vault
struct VaultCloseOrder {
    // Order identification and status
    OrderStatus status;         // Current lifecycle status

    // Vault data
    address vault;              // UniswapV3Vault ERC-20 address
    address owner;              // Share holder at registration time
    address pool;               // Uniswap V3 pool address (cached from vault.pool())

    // Share amount
    uint256 shares;             // 0 = close all at execution time, >0 = exact amount

    // Trigger configuration (tick-based)
    int24 triggerTick;          // Price threshold as tick value

    // Execution configuration
    address payout;             // Recipient of closed position tokens
    address operator;           // Automation wallet that can execute
    uint256 validUntil;         // Expiration timestamp (0 = no expiry)
    uint16 slippageBps;         // Decrease liquidity slippage tolerance (0-10000)

    // Post-close swap configuration
    SwapDirection swapDirection;    // Direction of optional token swap
    uint16 swapSlippageBps;         // Swap slippage tolerance (0-10000)
}

/// @notice Main application storage struct
/// @dev This struct is stored at slot 0 and shared by all facets
struct AppStorage {
    // ========================================
    // CHAIN CONSTANTS (set once at deployment)
    // ========================================

    /// @notice The MidcurveSwapRouter address for post-close token swaps
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

    /// @notice Mapping from order key to VaultCloseOrder
    /// @dev Key: keccak256(abi.encode(vault, owner, triggerMode))
    mapping(bytes32 => VaultCloseOrder) orders;

    /// @notice Mapping to track which orders exist for a user's vault position
    /// @dev Used for quick existence checks: vault => owner => triggerMode => exists
    mapping(address => mapping(address => mapping(TriggerMode => bool))) orderExists;

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

    /// @notice Generate order key from vault, owner, and triggerMode
    /// @param vault The vault address
    /// @param owner The share holder address
    /// @param triggerMode The trigger mode (LOWER or UPPER)
    /// @return The order key
    function orderKey(address vault, address owner, TriggerMode triggerMode) internal pure returns (bytes32) {
        return keccak256(abi.encode(vault, owner, triggerMode));
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

    modifier orderMustExist(address vault, address owner, TriggerMode triggerMode) {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.orderExists[vault][owner][triggerMode], "ORDER_NOT_FOUND");
        _;
    }

    // ============ Errors ============

    error NotOwner();                                                                       // 0x30cd7471
    error NotOperator();                                                                    // 0x7c214f04
    error ZeroAddress();                                                                    // 0xd92e233d
    error ZeroShares();                                                                     // 0x27a78595
    error SlippageBpsOutOfRange(uint16 slippageBps);                                        // 0x49c26c64
    error OrderAlreadyExists(address vault, address owner, TriggerMode triggerMode);        // 0x6e3a5765
    error OrderNotFound(address vault, address owner, TriggerMode triggerMode);             // 0x8b3c98a1
    error WrongOrderStatus(OrderStatus expected, OrderStatus actual);                       // 0x010aa335
    error OrderExpired(uint256 validUntil, uint256 nowTs);                                  // 0x4b2d84db
    error TriggerConditionNotMet(int24 currentTick, int24 triggerTick, TriggerMode triggerMode); // 0xc8c8fafb
    error InsufficientShares(address owner, uint256 required, uint256 actual);              // 0x3e0a840d
    error InsufficientAllowance(address owner, uint256 required, uint256 actual);           // 0x7dc7a0d1
    error FeeBpsTooHigh(uint16 feeBps, uint16 maxFeeBps);                                   // 0x84c6b9b5
    error TransferFailed();                                                                 // 0x90b8ec18
    error SwapFailed();                                                                     // 0x81ceff30
    error SwapOutputZero();                                                                 // 0x5273e2e8
    error SwapSlippageBpsOutOfRange(uint16 swapSlippageBps);                                // 0x22fecc1f
    error InsufficientAmountForGuaranteed(uint256 available, uint256 required);             // 0xb4eca305
}
