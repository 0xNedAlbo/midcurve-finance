// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AppStorage
/// @notice Shared storage struct for the MidcurveHedgeVault Diamond
/// @dev All facets share this storage using the Diamond Storage pattern at slot 0
///
/// Storage Layout:
/// - All state from UniswapV3PositionVault, HedgeVault, MidcurveHedgeVaultV1
/// - Former immutables are now regular storage (set once at initialization)
/// - Mappings preserved with same semantics

/// @notice Vault state machine states
enum VaultState {
    UNINITIALIZED, // 0 - Initial state, vault not yet initialized
    IN_POSITION,   // 1 - Liquidity is in the Uniswap V3 position
    IN_ASSET0,     // 2 - Exited position, holding only asset0
    IN_ASSET1,     // 3 - Exited position, holding only asset1
    CLOSED         // 4 - Vault permanently closed
}

/// @notice Main application storage struct
/// @dev This struct is stored at slot 0 and shared by all facets
struct AppStorage {
    // ========================================
    // CHAIN CONSTANTS (set once at initialization)
    // ========================================

    /// @notice The Uniswap V3 NonfungiblePositionManager address
    address positionManager;

    /// @notice The Paraswap AugustusRegistry address for swap validation
    address augustusRegistry;

    // ========================================
    // POSITION DATA (derived from positionId at init)
    // ========================================

    /// @notice The Uniswap V3 position NFT ID
    uint256 positionId;

    /// @notice The Uniswap V3 Factory address (derived from positionManager)
    address uniswapFactory;

    /// @notice The first token of the pair (token0 from position)
    address asset0;

    /// @notice The second token of the pair (token1 from position)
    address asset1;

    /// @notice The Uniswap V3 pool address
    address pool;

    /// @notice Lower tick of the position range
    int24 tickLower;

    /// @notice Upper tick of the position range
    int24 tickUpper;

    // ========================================
    // ACCESS CONTROL
    // ========================================

    /// @notice The manager address (deployer, has admin rights)
    address manager;

    /// @notice The operator address (can execute vault operations)
    address operator;

    // ========================================
    // ERC20 SHARE ACCOUNTING
    // ========================================

    /// @notice Token name (ERC20)
    string name;

    /// @notice Token symbol (ERC20)
    string symbol;

    /// @notice Total shares issued
    uint256 totalShares;

    /// @notice Shares per account
    mapping(address => uint256) shares;

    /// @notice Allowances for transferFrom (ERC20)
    mapping(address => mapping(address => uint256)) allowances;

    // ========================================
    // FEE ACCOUNTING
    // ========================================

    /// @notice Precision for fee per share calculations
    /// @dev Use LibVault.ACC_PRECISION constant (1e18)

    /// @notice Accumulated fee per share for token0 (scaled by ACC_PRECISION)
    uint256 accFeePerShare0;

    /// @notice Accumulated fee per share for token1 (scaled by ACC_PRECISION)
    uint256 accFeePerShare1;

    /// @notice Fee debt for token0 per account (scaled by ACC_PRECISION)
    mapping(address => uint256) feeDebt0;

    /// @notice Fee debt for token1 per account (scaled by ACC_PRECISION)
    mapping(address => uint256) feeDebt1;

    // ========================================
    // HEDGE STATE MACHINE
    // ========================================

    /// @notice Current state of the vault
    VaultState currentState;

    /// @notice Upper sqrtPrice trigger (disabled when set to type(uint160).max)
    uint160 triggerPriceUpper;

    /// @notice Lower sqrtPrice trigger (disabled when set to 0)
    uint160 triggerPriceLower;

    /// @notice Whether the vault is paused
    bool paused;

    /// @notice Slippage tolerance for exiting position (in basis points, 100 = 1%)
    uint256 exitPositionSlippageBps;

    /// @notice Slippage tolerance for entering position (in basis points, 100 = 1%)
    uint256 enterPositionSlippageBps;

    // ========================================
    // SHAREHOLDER SLIPPAGE SETTINGS
    // ========================================

    /// @notice Per-shareholder deposit slippage tolerance in basis points
    /// @dev 0 means use default (DEFAULT_DEPOSIT_SLIPPAGE_BPS = 100)
    mapping(address => uint256) shareholderDepositSlippageBps;

    /// @notice Per-shareholder withdrawal slippage tolerance in basis points
    /// @dev 0 means use default (DEFAULT_WITHDRAW_SLIPPAGE_BPS = 100)
    mapping(address => uint256) shareholderWithdrawSlippageBps;

    // ========================================
    // ALLOWLIST
    // ========================================

    /// @notice Whether the allowlist is enabled
    bool allowlistEnabled;

    /// @notice Mapping of allowlisted addresses
    mapping(address => bool) allowlist;

    // ========================================
    // INITIALIZATION & REENTRANCY
    // ========================================

    /// @notice Whether the vault has been initialized
    bool initialized;

    /// @notice Reentrancy guard lock (1 = unlocked, 2 = locked)
    uint256 reentrancyLock;
}

/// @title LibAppStorage
/// @notice Library for accessing AppStorage
library LibAppStorage {
    /// @notice Get the AppStorage struct from slot 0
    /// @return s The AppStorage struct
    function appStorage() internal pure returns (AppStorage storage s) {
        assembly {
            s.slot := 0
        }
    }
}

/// @title Modifiers
/// @notice Common modifiers for facets
/// @dev Inherit this in facets that need access control
abstract contract Modifiers {
    /// @notice Modifier to restrict access to the manager
    modifier onlyManager() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(msg.sender == s.manager, "Only manager");
        _;
    }

    /// @notice Modifier to restrict access to the operator
    modifier onlyOperator() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(msg.sender == s.operator, "Only operator");
        _;
    }

    /// @notice Modifier to restrict access to manager or operator
    modifier onlyManagerOrOperator() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(msg.sender == s.manager || msg.sender == s.operator, "Only manager or operator");
        _;
    }

    /// @notice Modifier to ensure vault is initialized
    modifier whenInitialized() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.initialized, "Not initialized");
        _;
    }

    /// @notice Modifier to ensure vault is not paused
    modifier whenNotPaused() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(!s.paused, "Vault paused");
        _;
    }

    /// @notice Reentrancy guard modifier
    modifier nonReentrant() {
        AppStorage storage s = LibAppStorage.appStorage();
        require(s.reentrancyLock == 1, "Reentrancy");
        s.reentrancyLock = 2;
        _;
        s.reentrancyLock = 1;
    }

    /// @notice Modifier to check allowlist for a receiver
    /// @param account The address to check
    modifier requireAllowlisted(address account) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.allowlistEnabled && !s.allowlist[account]) {
            revert NotAllowlisted(account);
        }
        _;
    }

    // ============ Errors ============

    error NotAllowlisted(address account);
}
