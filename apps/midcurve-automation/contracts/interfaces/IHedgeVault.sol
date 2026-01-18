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

    enum DepositMode {
        CLOSED,         // Only deployer can deposit, shares non-transferable
        SEMI_PRIVATE,   // Only existing shareholders can deposit
        PUBLIC          // Anyone can deposit
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

    // ============ Errors ============

    error NotOperator();
    error NotShareholder();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidState(State current, State required);
    error CooldownNotExpired(uint256 currentBlock, uint256 requiredBlock);
    error PriceNotInRange(uint160 current, uint160 sil, uint160 tip);
    error SilNotTriggered(uint160 current, uint160 sil, bool token0IsQuote);
    error TipNotTriggered(uint160 current, uint160 tip, bool token0IsQuote);
    error LossCapBreached(uint256 nav, uint256 costBasis, uint16 lossCapBps);
    error DepositsDisabled();
    error TransfersDisabled();
    error IncompatiblePosition(address token0, address token1, address vaultAsset);
    error InvalidSwapDirection();
    error ZeroAddress();
    error InvalidSilTipRange();

    // ============ Initialization ============

    /// @notice Initialize vault with existing Uniswap V3 position
    /// @dev Transfers NFT from caller to vault. Caller must approve this contract first.
    /// @param tokenId The NFT token ID to transfer to vault
    function init(uint256 tokenId) external;

    // ============ Operator Actions ============

    /// @notice Execute Stop Impermanent Loss - exit to Quote token
    /// @dev Only callable by operator when canExecuteSil() returns true
    /// @param swapData Paraswap calldata for Base → Quote swap
    function executeSil(bytes calldata swapData) external;

    /// @notice Execute Take Impermanent Profit - exit to Base token
    /// @dev Only callable by operator when canExecuteTip() returns true
    /// @param swapData Paraswap calldata for Quote → Base swap
    function executeTip(bytes calldata swapData) external;

    /// @notice Reopen position after cooldown when price is back in range
    /// @dev Only callable by operator when canExecuteReopen() returns true
    /// @param swapData Paraswap calldata for token conversion before minting LP
    function executeReopen(bytes calldata swapData) external;

    // ============ View Functions - Config ============

    /// @notice Current vault state
    function state() external view returns (State);

    /// @notice Deposit mode (CLOSED, SEMI_PRIVATE, PUBLIC)
    function depositMode() external view returns (DepositMode);

    /// @notice Operator address (automation wallet)
    function operator() external view returns (address);

    /// @notice SIL trigger price in sqrtPriceX96 format
    function silSqrtPriceX96() external view returns (uint160);

    /// @notice TIP trigger price in sqrtPriceX96 format
    function tipSqrtPriceX96() external view returns (uint160);

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

    /// @notice Total cost basis in Quote tokens (sum of all deposits at deposit-time prices)
    function costBasis() external view returns (uint256);

    /// @notice Block number when position was last closed
    function lastCloseBlock() external view returns (uint256);

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
}
