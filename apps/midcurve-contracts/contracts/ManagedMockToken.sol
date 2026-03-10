// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title ManagedMockToken
 * @notice ERC-20 token with manager-controlled mint and burn for testnet use.
 * @dev Deployed on Sepolia as mcUSD (6 decimals) and mcWETH (18 decimals).
 *      Only the manager address can mint new tokens or burn existing ones.
 */
contract ManagedMockToken is ERC20 {
    uint8 private immutable _decimals;
    address public manager;

    event ManagerTransferred(address indexed previous, address indexed next);

    modifier onlyManager() {
        require(msg.sender == manager, "ManagedMockToken: not manager");
        _;
    }

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address manager_)
        ERC20(name_, symbol_)
    {
        require(manager_ != address(0), "ManagedMockToken: zero manager");
        _decimals = decimals_;
        manager = manager_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyManager {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyManager {
        _burn(from, amount);
    }

    function transferManager(address newManager) external onlyManager {
        require(newManager != address(0), "ManagedMockToken: zero manager");
        emit ManagerTransferred(manager, newManager);
        manager = newManager;
    }
}
