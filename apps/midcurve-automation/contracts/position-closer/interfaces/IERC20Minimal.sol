// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IERC20Minimal
/// @notice Minimal ERC20 interface for token transfers
interface IERC20Minimal {
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}
