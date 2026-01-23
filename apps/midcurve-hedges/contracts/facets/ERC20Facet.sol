// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, Modifiers} from "../storage/AppStorage.sol";
import {LibVault} from "../libraries/LibVault.sol";

/// @title ERC20Facet
/// @notice ERC20-compliant share token functionality
/// @dev Implements ERC20 interface for vault shares
contract ERC20Facet is Modifiers {
    // ============ Events ============

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    // ============ Errors ============

    error InsufficientAllowance();
    error TransferToZeroAddress();

    // ============ ERC20 Metadata ============

    /// @notice Returns the name of the token
    function name() external view returns (string memory) {
        return LibAppStorage.appStorage().name;
    }

    /// @notice Returns the symbol of the token
    function symbol() external view returns (string memory) {
        return LibAppStorage.appStorage().symbol;
    }

    /// @notice Returns the number of decimals
    function decimals() external pure returns (uint8) {
        return 18;
    }

    // ============ ERC20 State ============

    /// @notice Returns total supply of shares
    function totalSupply() external view returns (uint256) {
        return LibAppStorage.appStorage().totalShares;
    }

    /// @notice Returns share balance of account
    function balanceOf(address account) external view returns (uint256) {
        return LibAppStorage.appStorage().shares[account];
    }

    /// @notice Returns allowance for spender
    function allowance(address owner, address spender) external view returns (uint256) {
        return LibAppStorage.appStorage().allowances[owner][spender];
    }

    // ============ Shareholder Convenience ============

    /// @notice Returns total shares (alias for totalSupply)
    function totalShares() external view returns (uint256) {
        return LibAppStorage.appStorage().totalShares;
    }

    /// @notice Returns shares balance of account (alias for balanceOf)
    function shares(address account) external view returns (uint256) {
        return LibAppStorage.appStorage().shares[account];
    }

    // ============ ERC20 Actions ============

    /// @notice Transfer shares to another address
    /// @param to Recipient address
    /// @param amount Amount of shares to transfer
    /// @return True on success
    function transfer(address to, uint256 amount) external nonReentrant requireAllowlisted(to) returns (bool) {
        LibVault.transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Approve spender to transfer shares
    /// @param spender Address to approve
    /// @param amount Amount to approve
    /// @return True on success
    function approve(address spender, uint256 amount) external returns (bool) {
        AppStorage storage s = LibAppStorage.appStorage();
        s.allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfer shares from one address to another
    /// @param from Source address
    /// @param to Destination address
    /// @param amount Amount to transfer
    /// @return True on success
    function transferFrom(address from, address to, uint256 amount) external nonReentrant requireAllowlisted(to) returns (bool) {
        AppStorage storage s = LibAppStorage.appStorage();

        uint256 currentAllowance = s.allowances[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) revert InsufficientAllowance();
            s.allowances[from][msg.sender] = currentAllowance - amount;
        }

        LibVault.transfer(from, to, amount);
        return true;
    }

    // ============ Fee Collection ============

    /// @notice Collect fees for the caller
    /// @return collected0 Amount of token0 fees collected
    /// @return collected1 Amount of token1 fees collected
    function collectFees() external nonReentrant returns (uint256 collected0, uint256 collected1) {
        AppStorage storage s = LibAppStorage.appStorage();

        uint256 userShares = s.shares[msg.sender];
        require(userShares > 0, "No shares");

        // Collect position fees to vault
        (uint256 positionFees0, uint256 positionFees1) = LibVault.collectPositionFees();

        // Update fee accumulators
        LibVault.updateFeeAccumulators(positionFees0, positionFees1);

        // Calculate user's pending fees
        collected0 = ((s.accFeePerShare0 * userShares) / LibVault.ACC_PRECISION) - s.feeDebt0[msg.sender];
        collected1 = ((s.accFeePerShare1 * userShares) / LibVault.ACC_PRECISION) - s.feeDebt1[msg.sender];

        // Update user's fee debt
        s.feeDebt0[msg.sender] = (s.accFeePerShare0 * userShares) / LibVault.ACC_PRECISION;
        s.feeDebt1[msg.sender] = (s.accFeePerShare1 * userShares) / LibVault.ACC_PRECISION;

        // Transfer fees to user
        if (collected0 > 0) {
            _safeTransfer(s.asset0, msg.sender, collected0);
        }
        if (collected1 > 0) {
            _safeTransfer(s.asset1, msg.sender, collected1);
        }

        if (collected0 > 0 || collected1 > 0) {
            emit LibVault.CollectFees(msg.sender, collected0, collected1);
        }
    }

    // ============ Internal Helpers ============

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }
}
