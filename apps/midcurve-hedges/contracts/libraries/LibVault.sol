// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage} from "../storage/AppStorage.sol";
import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {UniswapV3Math} from "./UniswapV3Math.sol";
import {SafeERC20} from "./SafeERC20.sol";

/// @title LibVault
/// @notice Shared library for vault operations across facets
/// @dev Contains constants and internal helper functions used by multiple facets
library LibVault {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Precision for fee per share calculations
    uint256 internal constant ACC_PRECISION = 1e18;

    /// @notice Basis points denominator (100% = 10000)
    uint256 internal constant BPS_DENOMINATOR = 10000;

    /// @notice Default slippage tolerance for deposits in basis points (1% = 100)
    uint256 internal constant DEFAULT_DEPOSIT_SLIPPAGE_BPS = 100;

    /// @notice Default slippage tolerance for withdrawals in basis points (1% = 100)
    uint256 internal constant DEFAULT_WITHDRAW_SLIPPAGE_BPS = 100;

    // ============ Events ============

    /// @notice ERC20 Transfer event
    event Transfer(address indexed from, address indexed to, uint256 amount);

    /// @notice ERC20 Approval event
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    /// @notice Emitted when the vault is initialized with a position
    event VaultInitialized(
        uint256 indexed positionId,
        uint256 initialShares,
        uint256 amount0,
        uint256 amount1
    );

    /// @notice Emitted when fees are collected for an account
    event CollectFees(address indexed account, uint256 amount0, uint256 amount1);

    /// @notice Emitted when a deposit is made
    event Deposit(
        address indexed caller,
        address indexed receiver,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );

    /// @notice Emitted when a withdrawal is made
    event Withdraw(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );

    /// @notice Emitted when a shareholder changes their deposit slippage
    event DepositSlippageChanged(address indexed shareholder, uint256 oldSlippageBps, uint256 newSlippageBps);

    /// @notice Emitted when a shareholder changes their withdraw slippage
    event WithdrawSlippageChanged(address indexed shareholder, uint256 oldSlippageBps, uint256 newSlippageBps);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error EmptyPosition();
    error NotInitialized();
    error AlreadyInitialized();
    error InvalidState();
    error Unauthorized();
    error InsufficientShares();
    error InsufficientAllowance();
    error TransferToZeroAddress();
    error MintToZeroAddress();

    // ============ Share Functions ============

    /// @dev Mint shares to an account
    function mint(address to, uint256 amount) internal {
        if (to == address(0)) revert MintToZeroAddress();
        AppStorage storage s = LibAppStorage.appStorage();

        s.totalShares += amount;
        s.shares[to] += amount;

        // Add fee debt for new shares
        s.feeDebt0[to] += (s.accFeePerShare0 * amount) / ACC_PRECISION;
        s.feeDebt1[to] += (s.accFeePerShare1 * amount) / ACC_PRECISION;

        emit Transfer(address(0), to, amount);
    }

    /// @dev Burn shares from an account
    function burn(address from, uint256 amount) internal {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.shares[from] < amount) revert InsufficientShares();

        s.shares[from] -= amount;
        s.totalShares -= amount;

        // Update fee debt to match remaining shares
        s.feeDebt0[from] = (s.accFeePerShare0 * s.shares[from]) / ACC_PRECISION;
        s.feeDebt1[from] = (s.accFeePerShare1 * s.shares[from]) / ACC_PRECISION;

        emit Transfer(from, address(0), amount);
    }

    /// @dev Internal transfer logic
    function transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert TransferToZeroAddress();
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.shares[from] < amount) revert InsufficientShares();

        // Update share balances
        s.shares[from] -= amount;
        s.shares[to] += amount;

        // Update fee debts to match new share balances
        s.feeDebt0[from] = (s.accFeePerShare0 * s.shares[from]) / ACC_PRECISION;
        s.feeDebt1[from] = (s.accFeePerShare1 * s.shares[from]) / ACC_PRECISION;
        s.feeDebt0[to] = (s.accFeePerShare0 * s.shares[to]) / ACC_PRECISION;
        s.feeDebt1[to] = (s.accFeePerShare1 * s.shares[to]) / ACC_PRECISION;

        emit Transfer(from, to, amount);
    }

    // ============ Position Accounting ============

    /// @notice Get the amounts in the Uniswap V3 position
    function getPositionAmounts() internal view returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();

        try INonfungiblePositionManager(s.positionManager).positions(s.positionId)
        returns (
            uint96,
            address,
            address,
            address,
            uint24,
            int24,
            int24,
            uint128 liquidity,
            uint256,
            uint256,
            uint128,
            uint128
        ) {
            if (liquidity > 0) {
                (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();
                (amount0, amount1) = UniswapV3Math.getAmountsForLiquidity(
                    sqrtPriceX96,
                    s.tickLower,
                    s.tickUpper,
                    liquidity
                );
            }
        } catch {}
    }

    /// @notice Get vault balances excluding reserved fees
    function getVaultBalances() internal view returns (uint256 balance0, uint256 balance1) {
        AppStorage storage s = LibAppStorage.appStorage();

        balance0 = IERC20(s.asset0).balanceOf(address(this));
        balance1 = IERC20(s.asset1).balanceOf(address(this));

        // Subtract fees reserved for shareholders
        uint256 reservedFees0 = (s.accFeePerShare0 * s.totalShares) / ACC_PRECISION;
        uint256 reservedFees1 = (s.accFeePerShare1 * s.totalShares) / ACC_PRECISION;

        if (balance0 > reservedFees0) {
            balance0 -= reservedFees0;
        } else {
            balance0 = 0;
        }

        if (balance1 > reservedFees1) {
            balance1 -= reservedFees1;
        } else {
            balance1 = 0;
        }
    }

    /// @notice Collect position fees to vault
    function collectPositionFees() internal returns (uint256 collected0, uint256 collected1) {
        AppStorage storage s = LibAppStorage.appStorage();
        (collected0, collected1) = INonfungiblePositionManager(s.positionManager).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: s.positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
    }

    /// @notice Update fee accumulators
    function updateFeeAccumulators(uint256 collected0, uint256 collected1) internal {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.totalShares > 0) {
            s.accFeePerShare0 += (collected0 * ACC_PRECISION) / s.totalShares;
            s.accFeePerShare1 += (collected1 * ACC_PRECISION) / s.totalShares;
        }
    }

    // ============ Liquidity Helpers ============

    /// @notice Decrease liquidity and collect tokens to vault
    function decreaseLiquidity(
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min
    ) internal returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();

        (amount0, amount1) = INonfungiblePositionManager(s.positionManager).decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: s.positionId,
                liquidity: liquidity,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: block.timestamp
            })
        );

        INonfungiblePositionManager(s.positionManager).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: s.positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
    }

    // ============ Slippage Helpers ============

    /// @notice Get the deposit slippage for a shareholder
    function getDepositSlippageBps(address shareholder) internal view returns (uint256 slippageBps) {
        AppStorage storage s = LibAppStorage.appStorage();
        slippageBps = s.shareholderDepositSlippageBps[shareholder];
        if (slippageBps == 0) {
            slippageBps = DEFAULT_DEPOSIT_SLIPPAGE_BPS;
        }
    }

    /// @notice Get the withdrawal slippage for a shareholder
    function getWithdrawSlippageBps(address shareholder) internal view returns (uint256 slippageBps) {
        AppStorage storage s = LibAppStorage.appStorage();
        slippageBps = s.shareholderWithdrawSlippageBps[shareholder];
        if (slippageBps == 0) {
            slippageBps = DEFAULT_WITHDRAW_SLIPPAGE_BPS;
        }
    }
}
