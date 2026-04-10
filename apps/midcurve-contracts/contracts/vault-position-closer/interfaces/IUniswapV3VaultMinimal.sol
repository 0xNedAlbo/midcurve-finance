// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BurnParams} from "../../vault/interfaces/IMultiTokenVault.sol";

/// @title IUniswapV3VaultMinimal
/// @notice Minimal interface for UniswapV3Vault interactions needed by the closer
interface IUniswapV3VaultMinimal {
    /// @notice The Uniswap V3 pool this vault provides liquidity to
    function pool() external view returns (address);

    /// @notice Token0 of the underlying position
    function token0() external view returns (address);

    /// @notice Token1 of the underlying position
    function token1() external view returns (address);

    /// @notice ERC-20 balance of vault shares
    function balanceOf(address account) external view returns (uint256);

    /// @notice ERC-20 allowance
    function allowance(address owner, address spender) external view returns (uint256);

    /// @notice ERC-20 transferFrom
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    /// @notice Burn shares and receive proportional equity
    /// @param shares Number of shares to burn
    /// @param params Burn parameters (minAmounts, recipient, deadline)
    /// @return tokenAmounts Actual token amounts returned
    function burn(uint256 shares, BurnParams calldata params) external returns (uint256[] memory tokenAmounts);
}
