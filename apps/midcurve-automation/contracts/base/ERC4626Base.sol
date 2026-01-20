// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IERC20Minimal.sol";

/// @title ERC4626Base
/// @notice Minimal ERC-4626 tokenized vault implementation
/// @dev Abstract contract providing ERC-20 and ERC-4626 base functionality
abstract contract ERC4626Base {
    // ERC-20 state
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ERC-4626 asset
    address public immutable asset;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    constructor(address asset_, string memory name_, string memory symbol_) {
        asset = asset_;
        name = name_;
        symbol = symbol_;
        decimals = IERC20Minimal(asset_).decimals();
    }

    // ============ ERC-20 ============

    function approve(address spender, uint256 amount) public virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal virtual {
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal virtual {
        totalSupply += amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal virtual {
        balanceOf[from] -= amount;
        unchecked {
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    // ============ ERC-4626 Views ============

    function totalAssets() public view virtual returns (uint256);

    function convertToShares(uint256 assets) public view virtual returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? assets : (assets * supply) / totalAssets();
    }

    function convertToAssets(uint256 shares) public view virtual returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }

    function maxDeposit(address) public view virtual returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) public view virtual returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address owner) public view virtual returns (uint256) {
        return convertToAssets(balanceOf[owner]);
    }

    function maxRedeem(address owner) public view virtual returns (uint256) {
        return balanceOf[owner];
    }

    function previewDeposit(uint256 assets) public view virtual returns (uint256) {
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) public view virtual returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? shares : (shares * totalAssets() + supply - 1) / supply;
    }

    function previewWithdraw(uint256 assets) public view virtual returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? assets : (assets * supply + totalAssets() - 1) / totalAssets();
    }

    function previewRedeem(uint256 shares) public view virtual returns (uint256) {
        return convertToAssets(shares);
    }
}
