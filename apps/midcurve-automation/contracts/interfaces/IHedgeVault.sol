// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAllowlist.sol";
import "./IMulticall.sol";

/**
 * @title IHedgeVault
 * @notice Interface for the Hedge Vault - an ERC-4626 vault managing a single Uniswap V3 LP position
 * @dev The vault implements automated SIL (Stop Impermanent Loss) and TIP (Take Impermanent Profit) triggers
 *
 * Key Concepts:
 * - Quote Token = ERC-4626 asset() - the token in which NAV is measured
 * - Base Token = the other token in the pool - exposure to this token's price movements
 * - SIL = Exit to Quote when actual price drops (protect from Base depreciation)
 * - TIP = Exit to Base when actual price rises (lock in Base appreciation)
 *
 * sqrtPriceX96 Inversion:
 * - token0IsQuote = true:  sqrtPriceX96 ↑ means actual price ↓ (inverted)
 * - token0IsQuote = false: sqrtPriceX96 ↑ means actual price ↑ (normal)
 *
 * Roles:
 * - Manager = Deployer of the contract, can modify SIL/TIP, pause/resume, manage allowlist
 * - Operator = Automation wallet, executes SIL/TIP/Reopen when not paused
 * - Shareholder = ERC-4626 share holders, can deposit/withdraw/collect fees
 */
interface IHedgeVault is IAllowlist, IMulticall {
    // ============ Enums ============

    enum State {
        UNINITIALIZED,          // Before init() called
        IN_POSITION,            // Holds Uniswap V3 NFT with active liquidity
        OUT_OF_POSITION_QUOTE,  // Holds only Quote token (after SIL)
        OUT_OF_POSITION_BASE,   // Holds only Base token (after TIP)
        DEAD                    // Permanently liquidated (loss cap breached)
    }

    // ============ Events ============

    /// @notice Emitted when vault is initialized with a Uniswap V3 position
    event Initialized(
        uint256 indexed tokenId,
        address indexed pool,
        int24 tickLower,
        int24 tickUpper,
        bool token0IsQuote
    );

    /// @notice Emitted when SIL trigger is executed (exit to Quote)
    event SilTriggered(uint160 sqrtPriceX96, uint256 quoteAmount);

    /// @notice Emitted when TIP trigger is executed (exit to Base)
    event TipTriggered(uint160 sqrtPriceX96, uint256 baseAmount);

    /// @notice Emitted when position is reopened after cooldown
    event Reopened(uint256 indexed newTokenId, uint128 liquidity);

    /// @notice Emitted when a position is closed (tracks NFT lifecycle)
    event PositionClosed(uint256 indexed tokenId, State newState);

    /// @notice Emitted when vault transitions to DEAD state
    event VaultDead(uint256 finalNav, uint16 lossPercent);

    /// @notice Emitted when vault is paused by manager
    event VaultPaused();

    /// @notice Emitted when vault is resumed by manager with new tick range
    event VaultResumed(int24 newTickLower, int24 newTickUpper);

    /// @notice Emitted when SIL/TIP thresholds are updated by manager
    event SilTipUpdated(uint160 newSil, uint160 newTip);

    /// @notice Emitted when fees are collected from NFT position (Manager/Operator)
    event FeesCollected(uint256 quoteAmount, uint256 baseSwapped);

    /// @notice Emitted when a shareholder claims their accumulated fees
    event FeesClaimed(address indexed user, address indexed receiver, uint256 quoteAmount);

    /// @notice Emitted when oracle pool is configured
    event OraclePoolSet(address indexed oraclePool, uint32 windowSeconds);

    /// @notice Emitted when max price deviation is updated
    event MaxPriceDeviationSet(uint16 newMaxDeviationBps);

    /// @notice Emitted when pending assets are allocated
    event PendingAssetsAllocated(uint256 amount, State state, uint256 baseReceived, uint128 liquidityAdded);

    // ============ Errors ============

    error NotOperator();
    error NotManager();
    error NotManagerOrOperator();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidState(State current, State required);
    error VaultIsDead();
    error ZeroShares();
    error CooldownNotExpired(uint256 currentBlock, uint256 requiredBlock);
    error PriceNotInRange(uint160 current, uint160 sil, uint160 tip);
    error SilNotTriggered(uint160 current, uint160 sil, bool token0IsQuote);
    error TipNotTriggered(uint160 current, uint160 tip, bool token0IsQuote);
    error LossCapBreached(uint256 nav, uint16 lossCapBps);
    error VaultPausedError();
    error VaultNotPausedError();
    error IncompatiblePosition(address token0, address token1, address vaultAsset);
    error InvalidSwapDirection();
    error ZeroAddress();
    error TriggerValueDisabled();
    error InvalidTickRange();
    error NoFeesToClaim();
    error PoolNotFromFactory();
    error PoolPairMismatch();
    error ObserveWindowNotAvailable();
    error OracleLiquidityTooLow(uint128 oracleLiq, uint128 minLiq);
    error OracleLiquidityBelowPositionLiquidity(uint128 oracleLiq, uint128 positionLiq, uint16 alphaBps);
    error PriceDeviationTooHigh(uint256 actualBps, uint256 maxAllowedBps);
    error InsufficientAmountReceived(uint256 received, uint256 minimum);
    error ExcessiveAmountSpent(uint256 spent, uint256 maximum);
    error ZeroAmount();

    // ============ Initialization ============

    /// @notice Initialize vault with a Uniswap V3 position
    /// @dev Transfers NFT from caller to vault. Caller must approve this contract first.
    ///      Only callable by manager. NFT must contain the vault's quote token.
    /// @param tokenId The Uniswap V3 NFT position ID to initialize the vault with
    function init(uint256 tokenId) external;

    // ============ Operator Actions ============

    /// @notice Execute Stop Impermanent Loss - exit to Quote token
    /// @dev Only callable by operator when canExecuteSil() returns true and not paused
    /// @param minQuoteAmount Minimum quote tokens to receive (prevents sandwich attacks)
    /// @param swapData Paraswap calldata for Base → Quote swap
    function executeSil(uint256 minQuoteAmount, bytes calldata swapData) external;

    /// @notice Execute Take Impermanent Profit - exit to Base token
    /// @dev Only callable by operator when canExecuteTip() returns true and not paused
    /// @param minBaseAmount Minimum base tokens to receive (prevents sandwich attacks)
    /// @param swapData Paraswap calldata for Quote → Base swap
    function executeTip(uint256 minBaseAmount, bytes calldata swapData) external;

    /// @notice Reopen position when currently holding only quote tokens (after SIL)
    /// @dev Only callable by operator when canReopenFromQuote() returns true and not paused
    /// @param exactBaseAmount Exact amount of base tokens needed for LP
    /// @param maxQuoteAmount Maximum quote tokens to spend
    /// @param swapData Paraswap calldata for Quote → Base (buy exact base)
    function reopenFromQuote(
        uint256 exactBaseAmount,
        uint256 maxQuoteAmount,
        bytes calldata swapData
    ) external;

    /// @notice Reopen position when currently holding only base tokens (after TIP)
    /// @dev Only callable by operator when canReopenFromBase() returns true and not paused
    /// @param exactQuoteAmount Exact amount of quote tokens needed for LP
    /// @param maxBaseAmount Maximum base tokens to spend
    /// @param swapData Paraswap calldata for Base → Quote (buy exact quote)
    function reopenFromBase(
        uint256 exactQuoteAmount,
        uint256 maxBaseAmount,
        bytes calldata swapData
    ) external;

    // ============ Manager Actions - Triggers ============

    /// @notice Set SIL (Stop Impermanent Loss) trigger threshold
    /// @dev Only callable by manager after init(). Reverts if value would disable trigger.
    /// @param newSilSqrtPriceX96 New SIL trigger price in sqrtPriceX96 format
    function setSil(uint160 newSilSqrtPriceX96) external;

    /// @notice Set TIP (Take Impermanent Profit) trigger threshold
    /// @dev Only callable by manager after init(). Reverts if value would disable trigger.
    /// @param newTipSqrtPriceX96 New TIP trigger price in sqrtPriceX96 format
    function setTip(uint160 newTipSqrtPriceX96) external;

    /// @notice Disable SIL trigger
    /// @dev Only callable by manager after init(). Sets to value that never triggers.
    function disableSil() external;

    /// @notice Disable TIP trigger
    /// @dev Only callable by manager after init(). Sets to value that never triggers.
    function disableTip() external;

    /// @notice Pause the hedge - close position and exit to Quote
    /// @dev Only callable by manager when IN_POSITION. Sets isPaused=true.
    /// @param swapData Paraswap calldata for Base → Quote swap
    function pause(bytes calldata swapData) external;

    /// @notice Resume the hedge - open new position with specified tick range
    /// @dev Only callable by manager when OUT_OF_POSITION_* and isPaused=true.
    ///      If price > TIP: swaps to Base, stays OUT_OF_POSITION_BASE
    ///      If price < SIL: stays OUT_OF_POSITION_QUOTE
    ///      If SIL < price < TIP: opens new LP position
    /// @param newTickLower New lower tick for LP position
    /// @param newTickUpper New upper tick for LP position
    /// @param swapData Paraswap calldata for token conversion
    function resume(int24 newTickLower, int24 newTickUpper, bytes calldata swapData) external;

    // ============ Manager/Operator Actions - Oracle ============

    /// @notice Set the oracle pool for TWAP price feeds
    /// @dev Only callable by manager or operator.
    /// @param tokenA One token of the pair (order doesn't matter)
    /// @param tokenB The other token of the pair
    /// @param fee Uniswap V3 fee tier for the oracle pool
    /// @param windowSeconds TWAP window (e.g., 1800 for 30 minutes)
    /// @param minOracleLiquidity Hard minimum active liquidity for oracle pool
    /// @param alphaBps Require L(oracle) >= alphaBps/10000 * L(positionPool). Set 0 to disable.
    function setOraclePoolForPair(
        address tokenA,
        address tokenB,
        uint24 fee,
        uint32 windowSeconds,
        uint128 minOracleLiquidity,
        uint16 alphaBps
    ) external;

    /// @notice Set maximum allowed price deviation from TWAP for swaps
    /// @dev Only callable by manager. Set to 0 to disable TWAP validation.
    /// @param newMaxDeviationBps Maximum deviation in basis points (e.g., 100 = 1%)
    function setMaxPriceDeviation(uint16 newMaxDeviationBps) external;

    // ============ Manager/Operator Actions - Asset Allocation ============

    /// @notice Allocate unused quote assets based on current vault state
    /// @dev Only callable by manager or operator. Deploys unallocated deposit capital.
    ///      IN_POSITION: Swaps portion to base and increases liquidity
    ///      OUT_OF_POSITION_BASE: Swaps all to base
    ///      OUT_OF_POSITION_QUOTE: No action needed
    /// @param minAmountIn Minimum base tokens received from swap (slippage protection)
    /// @param swapData Paraswap calldata (required for IN_POSITION and OUT_OF_POSITION_BASE)
    function allocatePendingAssets(uint256 minAmountIn, bytes calldata swapData) external;

    // ============ Fee Collection ============

    /// @notice Collect fees from NFT position and swap Base to Quote
    /// @dev Only callable by manager or operator when IN_POSITION.
    ///      Harvests fees from NFT, swaps Base fees to Quote, updates accumulators.
    /// @param minQuoteAmount Minimum quote tokens to receive from base fee swap
    /// @param swapData Paraswap calldata for Base → Quote swap (empty = skip swap, only add Quote fees)
    function collectFeesFromPosition(uint256 minQuoteAmount, bytes calldata swapData) external;

    /// @notice Claim accumulated Quote fees for msg.sender
    /// @dev Does NOT harvest from NFT - only pays out already-accumulated fees.
    ///      Can be called in any state including DEAD.
    /// @param receiver Address to receive the fees
    /// @return quoteAmount Quote token fees claimed
    function collect(address receiver) external returns (uint256 quoteAmount);

    /// @notice View pending fees for a user
    /// @param user Address to check
    /// @return pendingQuote Quote token fees claimable
    function pendingFees(address user) external view returns (uint256 pendingQuote);

    // ============ View Functions - Config ============

    /// @notice Current vault state
    function state() external view returns (State);

    /// @notice Manager address (deployer, has admin powers)
    function manager() external view returns (address);

    /// @notice Operator address (automation wallet)
    function operator() external view returns (address);

    /// @notice Whether the vault is paused (automation disabled)
    function isPaused() external view returns (bool);

    /// @notice SIL trigger price in sqrtPriceX96 format
    function silSqrtPriceX96() external view returns (uint160);

    /// @notice TIP trigger price in sqrtPriceX96 format
    function tipSqrtPriceX96() external view returns (uint160);

    /// @notice Check if SIL trigger is enabled
    /// @return True if SIL is set to a value that can trigger
    function silEnabled() external view returns (bool);

    /// @notice Check if TIP trigger is enabled
    /// @return True if TIP is set to a value that can trigger
    function tipEnabled() external view returns (bool);

    /// @notice Maximum loss in basis points before DEAD state (e.g., 1000 = 10%)
    function lossCapBps() external view returns (uint16);

    /// @notice Number of blocks to wait after close before reopen is allowed
    function reopenCooldownBlocks() external view returns (uint256);

    // ============ View Functions - Position ============

    /// @notice Base token address (the non-quote token)
    function baseToken() external view returns (address);

    /// @notice Uniswap V3 pool address
    function pool() external view returns (address);

    /// @notice Whether token0 is the quote token (determines sqrtPriceX96 interpretation)
    function token0IsQuote() external view returns (bool);

    /// @notice Lower tick of the LP position range
    function tickLower() external view returns (int24);

    /// @notice Upper tick of the LP position range
    function tickUpper() external view returns (int24);

    /// @notice Current NFT token ID (0 if not in position)
    function currentTokenId() external view returns (uint256);

    /// @notice Ordered list of all NFT token IDs ever held (oldest first)
    function tokenIdHistory() external view returns (uint256[] memory);

    /// @notice Number of positions opened (including current)
    function positionCount() external view returns (uint256);

    // ============ View Functions - Accounting ============

    /// @notice Block number when position was last closed
    function lastCloseBlock() external view returns (uint256);

    /// @notice Calculate current NAV in Quote tokens
    function totalAssets() external view returns (uint256);

    /// @notice Unallocated quote assets from deposits (not yet deployed to position)
    function pendingAssets() external view returns (uint256);

    // ============ View Functions - Trigger Conditions ============

    /// @notice Check if SIL trigger conditions are met
    /// @return True if price has crossed SIL threshold (actual price dropped)
    function canExecuteSil() external view returns (bool);

    /// @notice Check if TIP trigger conditions are met
    /// @return True if price has crossed TIP threshold (actual price rose)
    function canExecuteTip() external view returns (bool);

    /// @notice Check if reopen from quote conditions are met
    /// @return True if state is OUT_OF_POSITION_QUOTE AND cooldown expired AND price is in range
    function canReopenFromQuote() external view returns (bool);

    /// @notice Check if reopen from base conditions are met
    /// @return True if state is OUT_OF_POSITION_BASE AND cooldown expired AND price is in range
    function canReopenFromBase() external view returns (bool);

    // ============ View Functions - Oracle ============

    /// @notice Oracle pool address for TWAP price feeds
    function oraclePool() external view returns (address);

    /// @notice TWAP observation window in seconds
    function oracleWindowSeconds() external view returns (uint32);

    /// @notice Maximum allowed price deviation from TWAP in basis points
    function maxPriceDeviationBps() external view returns (uint16);

    // ============ View Functions - Fee State ============

    /// @notice Accumulated quote fees per share (scaled by 1e18)
    function accQuoteFeesPerShare() external view returns (uint256);

    /// @notice Total unclaimed quote token fees held by vault
    function totalUnclaimedQuoteFees() external view returns (uint256);
}
