// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
 * - Manager = Deployer of the contract, can modify SIL/TIP, pause/resume, manage whitelist
 * - Operator = Automation wallet, executes SIL/TIP/Reopen when not paused
 * - Shareholder = ERC-4626 share holders, can deposit/withdraw/collect fees
 */
interface IHedgeVault {
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
    event VaultDead(uint256 finalNav, uint256 costBasis, uint16 lossPercent);

    /// @notice Emitted when vault is paused by manager
    event VaultPaused();

    /// @notice Emitted when vault is resumed by manager with new tick range
    event VaultResumed(int24 newTickLower, int24 newTickUpper);

    /// @notice Emitted when SIL/TIP thresholds are updated by manager
    event SilTipUpdated(uint160 newSil, uint160 newTip);

    /// @notice Emitted when an address is added to or removed from whitelist
    event WhitelistUpdated(address indexed account, bool whitelisted);

    /// @notice Emitted when whitelist is enabled or disabled
    event WhitelistEnabledChanged(bool enabled);

    /// @notice Emitted when fees are collected from NFT position (Manager/Operator)
    event FeesCollected(uint256 quoteAmount, uint256 baseSwapped);

    /// @notice Emitted when a shareholder claims their accumulated fees
    event FeesClaimed(address indexed user, address indexed receiver, uint256 quoteAmount);

    // ============ Errors ============

    error NotOperator();
    error NotManager();
    error NotManagerOrOperator();
    error NotWhitelisted(address account);
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidState(State current, State required);
    error CooldownNotExpired(uint256 currentBlock, uint256 requiredBlock);
    error PriceNotInRange(uint160 current, uint160 sil, uint160 tip);
    error SilNotTriggered(uint160 current, uint160 sil, bool token0IsQuote);
    error TipNotTriggered(uint160 current, uint160 tip, bool token0IsQuote);
    error LossCapBreached(uint256 nav, uint256 costBasis, uint16 lossCapBps);
    error VaultPausedError();
    error VaultNotPausedError();
    error IncompatiblePosition(address token0, address token1, address vaultAsset);
    error InvalidSwapDirection();
    error ZeroAddress();
    error InvalidSilTipRange();
    error InvalidTickRange();
    error NoFeesToClaim();

    // ============ Initialization ============

    /// @notice Initialize vault with the Uniswap V3 position set at deployment
    /// @dev Transfers NFT from caller to vault. Caller must approve this contract first.
    ///      The nftId is set in the constructor and cannot be changed.
    function init() external;

    // ============ Operator Actions ============

    /// @notice Execute Stop Impermanent Loss - exit to Quote token
    /// @dev Only callable by operator when canExecuteSil() returns true and not paused
    /// @param swapData Paraswap calldata for Base → Quote swap
    function executeSil(bytes calldata swapData) external;

    /// @notice Execute Take Impermanent Profit - exit to Base token
    /// @dev Only callable by operator when canExecuteTip() returns true and not paused
    /// @param swapData Paraswap calldata for Quote → Base swap
    function executeTip(bytes calldata swapData) external;

    /// @notice Reopen position after cooldown when price is back in range
    /// @dev Only callable by operator when canExecuteReopen() returns true and not paused
    /// @param swapData Paraswap calldata for token conversion before minting LP
    function executeReopen(bytes calldata swapData) external;

    // ============ Manager Actions - Triggers ============

    /// @notice Update SIL and TIP trigger thresholds
    /// @dev Only callable by manager. Can be called in any state except DEAD.
    /// @param newSilSqrtPriceX96 New SIL trigger price in sqrtPriceX96 format
    /// @param newTipSqrtPriceX96 New TIP trigger price in sqrtPriceX96 format
    function setSilTip(uint160 newSilSqrtPriceX96, uint160 newTipSqrtPriceX96) external;

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

    // ============ Manager Actions - Whitelist ============

    /// @notice Enable or disable the whitelist
    /// @dev Only callable by manager. When disabled, anyone can receive shares.
    /// @param enabled True to enable whitelist, false to disable
    function setWhitelistEnabled(bool enabled) external;

    /// @notice Add addresses to the whitelist
    /// @dev Only callable by manager. Addresses can receive shares via deposit/mint/transfer.
    /// @param accounts Addresses to add to whitelist
    function addToWhitelist(address[] calldata accounts) external;

    /// @notice Remove addresses from the whitelist
    /// @dev Only callable by manager. Removed addresses can still redeem/withdraw and transfer to whitelisted addresses.
    /// @param accounts Addresses to remove from whitelist
    function removeFromWhitelist(address[] calldata accounts) external;

    // ============ Fee Collection ============

    /// @notice Collect fees from NFT position and swap Base to Quote
    /// @dev Only callable by manager or operator when IN_POSITION.
    ///      Harvests fees from NFT, swaps Base fees to Quote, updates accumulators.
    /// @param swapData Paraswap calldata for Base → Quote swap (empty = skip swap, only add Quote fees)
    function collectFeesFromPosition(bytes calldata swapData) external;

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

    /// @notice Maximum loss in basis points before DEAD state (e.g., 1000 = 10%)
    function lossCapBps() external view returns (uint16);

    /// @notice Number of blocks to wait after close before reopen is allowed
    function reopenCooldownBlocks() external view returns (uint256);

    /// @notice NFT token ID that will be transferred on init (set at deployment)
    function nftId() external view returns (uint256);

    // ============ View Functions - Whitelist ============

    /// @notice Whether the whitelist is enabled
    function whitelistEnabled() external view returns (bool);

    /// @notice Check if an address is whitelisted
    /// @param account Address to check
    /// @return True if address is on whitelist
    function whitelist(address account) external view returns (bool);

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

    /// @notice Total cost basis in Quote tokens (sum of all deposits at deposit-time prices)
    function costBasis() external view returns (uint256);

    /// @notice Block number when position was last closed
    function lastCloseBlock() external view returns (uint256);

    /// @notice Calculate current NAV in Quote tokens
    function totalAssets() external view returns (uint256);

    // ============ View Functions - Trigger Conditions ============

    /// @notice Check if SIL trigger conditions are met
    /// @return True if price has crossed SIL threshold (actual price dropped)
    function canExecuteSil() external view returns (bool);

    /// @notice Check if TIP trigger conditions are met
    /// @return True if price has crossed TIP threshold (actual price rose)
    function canExecuteTip() external view returns (bool);

    /// @notice Check if reopen conditions are met
    /// @return True if cooldown expired AND price is between SIL and TIP
    function canExecuteReopen() external view returns (bool);

    // ============ View Functions - Fee State ============

    /// @notice Accumulated quote fees per share (scaled by 1e18)
    function accQuoteFeesPerShare() external view returns (uint256);

    /// @notice Total unclaimed quote token fees held by vault
    function totalUnclaimedQuoteFees() external view returns (uint256);
}
