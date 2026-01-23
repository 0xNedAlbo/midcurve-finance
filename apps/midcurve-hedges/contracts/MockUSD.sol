// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockUSD
 * @notice A simple ERC-20 token for testing purposes.
 * @dev This token has an open mint function that allows anyone to mint tokens.
 *      Only for use in local testing environments (Anvil fork).
 */
contract MockUSD {
    string public constant name = "Mock USD";
    string public constant symbol = "mockUSD";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @notice Mint tokens to any address (open for testing)
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint (in 6-decimal units)
     */
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /**
     * @notice Approve spender to transfer tokens
     * @param spender The address allowed to spend tokens
     * @param amount The amount of tokens allowed to spend
     * @return success Always returns true
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfer tokens to another address
     * @param to The recipient address
     * @param amount The amount of tokens to transfer
     * @return success Always returns true if successful
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    /**
     * @notice Transfer tokens from one address to another (requires approval)
     * @param from The sender address
     * @param to The recipient address
     * @param amount The amount of tokens to transfer
     * @return success Always returns true if successful
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    /**
     * @dev Internal transfer function
     */
    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
