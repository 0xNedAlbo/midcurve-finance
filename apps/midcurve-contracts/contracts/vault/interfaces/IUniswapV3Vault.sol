// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IUniswapV3Vault
/// @notice Interface for the UniswapV3 Position Vault
/// @dev Wraps a single Uniswap V3 NFT position into fungible ERC-20 shares
interface IUniswapV3Vault {
    // ============ Events ============

    event VaultInitialized(
        address indexed positionManager,
        uint256 indexed tokenId,
        address indexed initialShareRecipient,
        uint128 initialLiquidity
    );

    event Minted(address indexed to, uint256 shares, uint128 deltaL, uint256 amount0, uint256 amount1);

    event Burned(address indexed from, uint256 shares, uint128 deltaL, uint256 amount0, uint256 amount1);

    event FeesCollected(address indexed user, uint256 fee0, uint256 fee1);

    // ============ Errors ============

    error AlreadyInitialized();
    error NotInitialized();
    error Reentrancy();
    error NFTNotReceived();
    error ZeroShares();
    error InsufficientBalance();

    // ============ Initialization ============

    /// @notice Initialize the vault clone with an NFT already transferred to it
    /// @param positionManager_ The Uniswap V3 NonfungiblePositionManager address
    /// @param tokenId_ The NFT token ID (must already be owned by this contract)
    /// @param name_ ERC-20 token name
    /// @param symbol_ ERC-20 token symbol
    /// @param decimals_ ERC-20 decimals
    /// @param initialShareRecipient_ Address to receive initial shares (== liquidity)
    function initialize(
        address positionManager_,
        uint256 tokenId_,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address initialShareRecipient_
    ) external;

    // ============ Core Functions ============

    /// @notice Mint new shares by adding liquidity proportional to existing supply
    /// @param minShares Minimum shares the caller expects (slippage protection, 0 to skip)
    /// @param maxAmount0 Maximum token0 the caller is willing to provide (slippage protection)
    /// @param maxAmount1 Maximum token1 the caller is willing to provide (slippage protection)
    function mint(uint256 minShares, uint256 maxAmount0, uint256 maxAmount1) external;

    /// @notice Burn shares and withdraw proportional liquidity
    /// @param shares Number of shares to burn
    /// @param minAmount0 Minimum token0 the caller expects to receive (slippage protection)
    /// @param minAmount1 Minimum token1 the caller expects to receive (slippage protection)
    function burn(uint256 shares, uint256 minAmount0, uint256 minAmount1) external;

    /// @notice Claim accumulated fee entitlement without affecting share balance
    function collectFees() external;

    // ============ View Functions ============

    /// @notice Returns the claimable fee amounts for a given user
    /// @param user The address to check
    /// @return fee0 Claimable token0 fees
    /// @return fee1 Claimable token1 fees
    function claimableFees(address user) external view returns (uint256 fee0, uint256 fee1);

    /// @notice Returns the token amounts a given share count represents in liquidity
    /// @param shares Number of shares to quote
    /// @return amount0 Token0 amount
    /// @return amount1 Token1 amount
    /// @return deltaL Liquidity delta
    function quoteBurn(uint256 shares) external view returns (uint256 amount0, uint256 amount1, uint128 deltaL);

    /// @notice Returns the token amounts required to mint a given number of shares
    /// @param shares Number of shares to quote
    /// @return amount0 Token0 amount
    /// @return amount1 Token1 amount
    /// @return deltaL Liquidity delta
    function quoteMint(uint256 shares) external view returns (uint256 amount0, uint256 amount1, uint128 deltaL);

    // ============ State Readers ============

    /// @notice The Uniswap V3 NonfungiblePositionManager
    function positionManager() external view returns (address);

    /// @notice The wrapped NFT token ID
    function tokenId() external view returns (uint256);

    /// @notice Token0 of the underlying position
    function token0() external view returns (address);

    /// @notice Token1 of the underlying position
    function token1() external view returns (address);

    /// @notice The Uniswap V3 pool address
    function pool() external view returns (address);

    /// @notice Lower tick bound of the underlying position
    function tickLower() external view returns (int24);

    /// @notice Upper tick bound of the underlying position
    function tickUpper() external view returns (int24);

    /// @notice Cumulative fee per share for token0 (scaled by 1e18)
    function feePerShare0() external view returns (uint256);

    /// @notice Cumulative fee per share for token1 (scaled by 1e18)
    function feePerShare1() external view returns (uint256);

    /// @notice Fee debt snapshot for a user (token0)
    function feeDebt0(address user) external view returns (uint256);

    /// @notice Fee debt snapshot for a user (token1)
    function feeDebt1(address user) external view returns (uint256);

}
