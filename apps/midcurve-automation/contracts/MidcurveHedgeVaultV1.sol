// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {HedgeVault} from "./HedgeVault.sol";
import {Multicall} from "./base/Multicall.sol";
import {AllowlistBase} from "./base/AllowlistBase.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title MidcurveHedgeVaultV1
/// @notice Extended hedge vault with multicall, public swap functions, and allowlist
/// @dev Enables single-token entry/exit workflows via multicall batching
///
/// Example usage - withdraw and exit to single token:
/// ```
/// bytes[] memory calls = new bytes[](2);
/// calls[0] = abi.encodeCall(vault.redeem, (shares, msg.sender, msg.sender));
/// calls[1] = abi.encodeCall(vault.performTokenSell, (asset1, asset0, amount1, minAmount0, swapData));
/// vault.multicall(calls);
/// ```
contract MidcurveHedgeVaultV1 is HedgeVault, Multicall, AllowlistBase {
    // ============ Errors ============

    error InvalidTokenPair();
    error VaultBalanceDecreased(address token, uint256 expected, uint256 actual);

    // ============ Constants ============

    /// @notice Interface version (semantic versioning)
    string public constant VERSION = "1.0.0";

    // ============ Constructor ============

    constructor(
        address positionManager_,
        uint256 positionId_,
        address operator_,
        address augustusRegistry_
    ) HedgeVault(positionManager_, positionId_, operator_, augustusRegistry_) {
        // Enable allowlist by default
        _allowlistEnabled = true;
        // Add manager to allowlist
        _allowlist[msg.sender] = true;
        emit AddedToAllowlist(msg.sender);
        emit AllowlistEnabledChanged(true);
    }

    // ============ Allowlist Management ============

    /// @notice Whether the allowlist is enabled
    function allowlistEnabled() external view returns (bool) {
        return _isAllowlistEnabled();
    }

    /// @notice Check if an address is on the allowlist
    /// @param account Address to check
    /// @return True if address is allowlisted
    function allowlist(address account) external view returns (bool) {
        return _isAllowlisted(account);
    }

    /// @notice Enable or disable the allowlist
    /// @param enabled True to enable, false to disable
    function setAllowlistEnabled(bool enabled) external onlyManager {
        _setAllowlistEnabled(enabled);
    }

    /// @notice Add addresses to the allowlist
    /// @param accounts Addresses to add
    function addToAllowlist(address[] calldata accounts) external onlyManager {
        _addToAllowlist(accounts);
    }

    /// @notice Remove addresses from the allowlist
    /// @param accounts Addresses to remove
    function removeFromAllowlist(address[] calldata accounts) external onlyManager {
        _removeFromAllowlist(accounts);
    }

    // ============ Allowlist-Gated Overrides ============

    /// @notice Deposit assets and receive shares (allowlist-gated on receiver)
    /// @dev If allowlist is enabled, receiver must be allowlisted
    function deposit(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) external override nonReentrant whenNotPaused returns (uint256 sharesOut) {
        _requireAllowlisted(receiver);
        sharesOut = _deposit(amount0, amount1, receiver);
    }

    /// @notice Mint exact shares by depositing assets (allowlist-gated on receiver)
    /// @dev If allowlist is enabled, receiver must be allowlisted
    function mint(
        uint256 sharesToMint,
        address receiver
    ) external override nonReentrant whenNotPaused returns (uint256 amount0, uint256 amount1) {
        _requireAllowlisted(receiver);
        (amount0, amount1) = _mint(sharesToMint, receiver);
    }

    /// @notice Transfer shares to another address (allowlist-gated on recipient)
    /// @dev If allowlist is enabled, recipient must be allowlisted
    /// @param to Recipient address
    /// @param amount Amount of shares to transfer
    function transfer(address to, uint256 amount) external override nonReentrant {
        _requireAllowlisted(to);
        _transfer(msg.sender, to, amount);
    }

    // ============ Internal Helpers ============

    /// @dev Internal deposit logic (extracted from HedgeVault.deposit)
    function _deposit(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) internal returns (uint256 sharesOut) {
        if (
            currentState == VaultState.UNINITIALIZED ||
            currentState == VaultState.CLOSED
        ) {
            revert InvalidState();
        }

        if (currentState == VaultState.IN_POSITION) {
            sharesOut = _depositInPosition(amount0, amount1, receiver);
        } else if (currentState == VaultState.IN_ASSET0) {
            sharesOut = _depositInAsset0(amount0, receiver);
        } else if (currentState == VaultState.IN_ASSET1) {
            sharesOut = _depositInAsset1(amount1, receiver);
        }
    }

    /// @dev Internal mint logic (extracted from HedgeVault.mint)
    function _mint(
        uint256 sharesToMint,
        address receiver
    ) internal returns (uint256 amount0, uint256 amount1) {
        if (
            currentState == VaultState.UNINITIALIZED ||
            currentState == VaultState.CLOSED
        ) {
            revert InvalidState();
        }
        if (sharesToMint == 0) revert ZeroAmount();

        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _mintInPosition(sharesToMint, receiver);
        } else if (currentState == VaultState.IN_ASSET0) {
            amount0 = _mintInAsset0(sharesToMint, receiver);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _mintInAsset1(sharesToMint, receiver);
        }
    }

    // ============ Public Swap Functions ============

    /// @notice Sell exact amount of a token via Paraswap (for multicall UX)
    /// @dev Callable by anyone. Ensures vault balances don't decrease unexpectedly.
    ///      The swap is executed using vault balances, not user-provided tokens.
    ///      Use this in a multicall after redeem/withdraw to convert to single token,
    ///      or before deposit to convert from single token.
    /// @param sellToken Token to sell (must be asset0 or asset1)
    /// @param buyToken Token to receive (must be asset0 or asset1)
    /// @param sellAmount Exact amount to sell
    /// @param minAmountReceived Minimum amount to receive (slippage protection)
    /// @param swapData Paraswap calldata (abi.encode(augustus, swapCalldata))
    /// @return amountReceived Actual amount received
    function performTokenSell(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minAmountReceived,
        bytes calldata swapData
    ) external nonReentrant returns (uint256 amountReceived) {
        // Validate tokens are vault assets
        if (
            !((sellToken == _asset0 && buyToken == _asset1) ||
                (sellToken == _asset1 && buyToken == _asset0))
        ) {
            revert InvalidTokenPair();
        }

        // Record vault balances before (total balances including reserved fees)
        uint256 totalBefore0 = IERC20(_asset0).balanceOf(address(this));
        uint256 totalBefore1 = IERC20(_asset1).balanceOf(address(this));

        // Execute swap
        amountReceived = _sellToken(
            sellToken,
            buyToken,
            sellAmount,
            minAmountReceived,
            swapData
        );

        // Record vault balances after
        uint256 totalAfter0 = IERC20(_asset0).balanceOf(address(this));
        uint256 totalAfter1 = IERC20(_asset1).balanceOf(address(this));

        // Verify balances: bought token should not decrease, sold token should decrease by exactly sellAmount
        if (sellToken == _asset0) {
            // Selling asset0 → buying asset1
            if (totalAfter1 < totalBefore1) {
                revert VaultBalanceDecreased(_asset1, totalBefore1, totalAfter1);
            }
            if (totalAfter0 < totalBefore0 - sellAmount) {
                revert VaultBalanceDecreased(
                    _asset0,
                    totalBefore0 - sellAmount,
                    totalAfter0
                );
            }
        } else {
            // Selling asset1 → buying asset0
            if (totalAfter0 < totalBefore0) {
                revert VaultBalanceDecreased(_asset0, totalBefore0, totalAfter0);
            }
            if (totalAfter1 < totalBefore1 - sellAmount) {
                revert VaultBalanceDecreased(
                    _asset1,
                    totalBefore1 - sellAmount,
                    totalAfter1
                );
            }
        }
    }

    /// @notice Buy exact amount of a token via Paraswap (for multicall UX)
    /// @dev Callable by anyone. Ensures vault balances don't decrease unexpectedly.
    ///      The swap is executed using vault balances, not user-provided tokens.
    ///      Use this in a multicall after redeem/withdraw to convert to single token,
    ///      or before deposit to convert from single token.
    /// @param buyToken Token to buy (must be asset0 or asset1)
    /// @param sellToken Token to spend (must be asset0 or asset1)
    /// @param buyAmount Exact amount to buy
    /// @param maxAmountSold Maximum amount to spend (slippage protection)
    /// @param swapData Paraswap calldata (abi.encode(augustus, swapCalldata))
    /// @return amountSold Actual amount spent
    function performTokenBuy(
        address buyToken,
        address sellToken,
        uint256 buyAmount,
        uint256 maxAmountSold,
        bytes calldata swapData
    ) external nonReentrant returns (uint256 amountSold) {
        // Validate tokens are vault assets
        if (
            !((sellToken == _asset0 && buyToken == _asset1) ||
                (sellToken == _asset1 && buyToken == _asset0))
        ) {
            revert InvalidTokenPair();
        }

        // Record vault balances before
        uint256 totalBefore0 = IERC20(_asset0).balanceOf(address(this));
        uint256 totalBefore1 = IERC20(_asset1).balanceOf(address(this));

        // Execute swap
        amountSold = _buyToken(
            buyToken,
            sellToken,
            buyAmount,
            maxAmountSold,
            swapData
        );

        // Record vault balances after
        uint256 totalAfter0 = IERC20(_asset0).balanceOf(address(this));
        uint256 totalAfter1 = IERC20(_asset1).balanceOf(address(this));

        // Verify balances: bought token should not decrease, sold token should decrease by at most amountSold
        if (sellToken == _asset0) {
            // Selling asset0 → buying asset1
            if (totalAfter1 < totalBefore1) {
                revert VaultBalanceDecreased(_asset1, totalBefore1, totalAfter1);
            }
            if (totalAfter0 < totalBefore0 - amountSold) {
                revert VaultBalanceDecreased(
                    _asset0,
                    totalBefore0 - amountSold,
                    totalAfter0
                );
            }
        } else {
            // Selling asset1 → buying asset0
            if (totalAfter0 < totalBefore0) {
                revert VaultBalanceDecreased(_asset0, totalBefore0, totalAfter0);
            }
            if (totalAfter1 < totalBefore1 - amountSold) {
                revert VaultBalanceDecreased(
                    _asset1,
                    totalBefore1 - amountSold,
                    totalAfter1
                );
            }
        }
    }
}
