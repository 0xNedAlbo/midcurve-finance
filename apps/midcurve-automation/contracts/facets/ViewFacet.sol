// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, VaultState} from "../storage/AppStorage.sol";
import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {LibVault} from "../libraries/LibVault.sol";
import {UniswapV3Math} from "../libraries/UniswapV3Math.sol";
import {TickMath} from "../libraries/TickMath.sol";

/// @title ViewFacet
/// @notice Read-only view functions for vault state and accounting
/// @dev Provides previews, conversions, limits, and state queries
contract ViewFacet {
    // ============ State Getters ============

    function asset0() external view returns (address) {
        return LibAppStorage.appStorage().asset0;
    }

    function asset1() external view returns (address) {
        return LibAppStorage.appStorage().asset1;
    }

    function positionManager() external view returns (address) {
        return LibAppStorage.appStorage().positionManager;
    }

    function uniswapFactory() external view returns (address) {
        return LibAppStorage.appStorage().uniswapFactory;
    }

    function pool() external view returns (address) {
        return LibAppStorage.appStorage().pool;
    }

    function positionId() external view returns (uint256) {
        return LibAppStorage.appStorage().positionId;
    }

    function tickLower() external view returns (int24) {
        return LibAppStorage.appStorage().tickLower;
    }

    function tickUpper() external view returns (int24) {
        return LibAppStorage.appStorage().tickUpper;
    }

    function manager() external view returns (address) {
        return LibAppStorage.appStorage().manager;
    }

    function operator() external view returns (address) {
        return LibAppStorage.appStorage().operator;
    }

    function currentState() external view returns (VaultState) {
        return LibAppStorage.appStorage().currentState;
    }

    function initialized() external view returns (bool) {
        return LibAppStorage.appStorage().initialized;
    }

    function paused() external view returns (bool) {
        return LibAppStorage.appStorage().paused;
    }

    function triggerPriceUpper() external view returns (uint160) {
        return LibAppStorage.appStorage().triggerPriceUpper;
    }

    function triggerPriceLower() external view returns (uint160) {
        return LibAppStorage.appStorage().triggerPriceLower;
    }

    function exitPositionSlippageBps() external view returns (uint256) {
        return LibAppStorage.appStorage().exitPositionSlippageBps;
    }

    function enterPositionSlippageBps() external view returns (uint256) {
        return LibAppStorage.appStorage().enterPositionSlippageBps;
    }

    function allowlistEnabled() external view returns (bool) {
        return LibAppStorage.appStorage().allowlistEnabled;
    }

    function allowlist(address account) external view returns (bool) {
        return LibAppStorage.appStorage().allowlist[account];
    }

    // ============ Fee Getters ============

    function accFeePerShare0() external view returns (uint256) {
        return LibAppStorage.appStorage().accFeePerShare0;
    }

    function accFeePerShare1() external view returns (uint256) {
        return LibAppStorage.appStorage().accFeePerShare1;
    }

    function feeDebt0(address account) external view returns (uint256) {
        return LibAppStorage.appStorage().feeDebt0[account];
    }

    function feeDebt1(address account) external view returns (uint256) {
        return LibAppStorage.appStorage().feeDebt1[account];
    }

    /// @notice View pending fees for an account
    function pendingFees(address account) external view returns (uint256 pending0, uint256 pending1) {
        AppStorage storage s = LibAppStorage.appStorage();
        uint256 userShares = s.shares[account];
        if (userShares > 0) {
            pending0 = ((s.accFeePerShare0 * userShares) / LibVault.ACC_PRECISION) - s.feeDebt0[account];
            pending1 = ((s.accFeePerShare1 * userShares) / LibVault.ACC_PRECISION) - s.feeDebt1[account];
        }
    }

    // ============ Slippage Getters ============

    function getDepositSlippageBps(address shareholder) external view returns (uint256) {
        return LibVault.getDepositSlippageBps(shareholder);
    }

    function getWithdrawSlippageBps(address shareholder) external view returns (uint256) {
        return LibVault.getWithdrawSlippageBps(shareholder);
    }

    // ============ Total Assets ============

    /// @notice Get total assets in the vault
    function totalAssets() external view returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = LibVault.getPositionAmounts();
        (uint256 balance0, uint256 balance1) = LibVault.getVaultBalances();
        amount0 += balance0;
        amount1 += balance1;
    }

    // ============ Conversions ============

    /// @notice Convert assets to shares
    function convertToShares(uint256 amount0, uint256 amount1) external view returns (uint256 sharesOut) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.IN_POSITION) {
            sharesOut = _previewDepositInPosition(amount0, amount1);
        } else if (s.currentState == VaultState.IN_ASSET0) {
            sharesOut = _previewDepositInAsset0(amount0);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            sharesOut = _previewDepositInAsset1(amount1);
        }
    }

    /// @notice Convert shares to assets
    function convertToAssets(uint256 sharesToConvert) external view returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewMintInPosition(sharesToConvert);
        } else if (s.currentState == VaultState.IN_ASSET0) {
            amount0 = _previewMintInAsset0(sharesToConvert);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            amount1 = _previewMintInAsset1(sharesToConvert);
        }
    }

    // ============ Limits ============

    function maxDeposit(address) external view returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.UNINITIALIZED || s.currentState == VaultState.CLOSED) {
            return (0, 0);
        }
        return (type(uint256).max, type(uint256).max);
    }

    function maxMint(address) external view returns (uint256 maxShares) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.UNINITIALIZED || s.currentState == VaultState.CLOSED) {
            return 0;
        }
        return type(uint256).max;
    }

    function maxWithdraw(address owner) external view returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.UNINITIALIZED) {
            return (0, 0);
        }

        uint256 ownerShares = s.shares[owner];
        if (ownerShares == 0) return (0, 0);

        if (s.currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewMintInPosition(ownerShares);
        } else if (s.currentState == VaultState.IN_ASSET0 || s.currentState == VaultState.CLOSED) {
            amount0 = _previewMintInAsset0(ownerShares);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            amount1 = _previewMintInAsset1(ownerShares);
        }
    }

    function maxRedeem(address owner) external view returns (uint256 maxShares) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.UNINITIALIZED) {
            return 0;
        }
        return s.shares[owner];
    }

    // ============ Previews ============

    function previewDeposit(uint256 amount0, uint256 amount1) external view returns (uint256 sharesOut) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.UNINITIALIZED || s.currentState == VaultState.CLOSED) {
            return 0;
        }

        if (s.currentState == VaultState.IN_POSITION) {
            sharesOut = _previewDepositInPosition(amount0, amount1);
        } else if (s.currentState == VaultState.IN_ASSET0) {
            sharesOut = _previewDepositInAsset0(amount0);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            sharesOut = _previewDepositInAsset1(amount1);
        }
    }

    function previewMint(uint256 sharesToMint) external view returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewMintInPosition(sharesToMint);
        } else if (s.currentState == VaultState.IN_ASSET0) {
            amount0 = _previewMintInAsset0(sharesToMint);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            amount1 = _previewMintInAsset1(sharesToMint);
        }
    }

    function previewWithdraw(uint256 amount0, uint256 amount1) external view returns (uint256 sharesNeeded) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.IN_POSITION) {
            sharesNeeded = _previewWithdrawInPosition(amount0, amount1);
        } else if (s.currentState == VaultState.IN_ASSET0 || s.currentState == VaultState.CLOSED) {
            sharesNeeded = _previewWithdrawInAsset0(amount0);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            sharesNeeded = _previewWithdrawInAsset1(amount1);
        }
    }

    function previewRedeem(uint256 sharesToRedeem) external view returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewRedeemInPosition(sharesToRedeem);
        } else if (s.currentState == VaultState.IN_ASSET0 || s.currentState == VaultState.CLOSED) {
            amount0 = _previewRedeemInAsset0(sharesToRedeem);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            amount1 = _previewRedeemInAsset1(sharesToRedeem);
        }
    }

    // ============ Internal Preview Helpers: IN_POSITION ============

    function _previewDepositInPosition(uint256 amount0, uint256 amount1) internal view returns (uint256 sharesOut) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (amount0 == 0 && amount1 == 0) return 0;

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();

        (, , , , , , , uint128 liquidityBefore, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);
        if (liquidityBefore == 0) return 0;

        uint128 expectedLiquidity = UniswapV3Math.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(s.tickLower),
            TickMath.getSqrtRatioAtTick(s.tickUpper),
            amount0,
            amount1
        );

        sharesOut = (uint256(expectedLiquidity) * s.totalShares) / uint256(liquidityBefore);
    }

    function _previewMintInPosition(uint256 sharesToMint) internal view returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (sharesToMint == 0 || s.totalShares == 0) return (0, 0);

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();
        (, , , , , , , uint128 liquidityBefore, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);
        if (liquidityBefore == 0) return (0, 0);

        uint128 liquidityRequired = uint128((sharesToMint * uint256(liquidityBefore)) / s.totalShares);

        (amount0, amount1) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            s.tickLower,
            s.tickUpper,
            liquidityRequired
        );
    }

    function _previewWithdrawInPosition(uint256 amount0, uint256 amount1) internal view returns (uint256 sharesNeeded) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (amount0 == 0 && amount1 == 0) return 0;

        (, , , , , , , uint128 liquidityBefore, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);
        if (liquidityBefore == 0 || s.totalShares == 0) return 0;

        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(s.tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(s.tickUpper);

        uint128 L0 = amount0 > 0 ? UniswapV3Math.getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0) : 0;
        uint128 L1 = amount1 > 0 ? UniswapV3Math.getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1) : 0;

        uint128 liquidityNeeded = L0 > L1 ? L0 : L1;

        sharesNeeded = (uint256(liquidityNeeded) * s.totalShares) / uint256(liquidityBefore);
    }

    function _previewRedeemInPosition(uint256 sharesToRedeem) internal view returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (sharesToRedeem == 0 || s.totalShares == 0) return (0, 0);

        (, , , , , , , uint128 liquidityBefore, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);
        if (liquidityBefore == 0) return (0, 0);

        uint128 liquidityToRedeem = uint128((sharesToRedeem * uint256(liquidityBefore)) / s.totalShares);

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();
        (amount0, amount1) = UniswapV3Math.getAmountsForLiquidity(sqrtPriceX96, s.tickLower, s.tickUpper, liquidityToRedeem);
    }

    // ============ Internal Preview Helpers: IN_ASSET0 ============

    function _previewDepositInAsset0(uint256 amount0) internal view returns (uint256 sharesOut) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (amount0 == 0) return 0;
        (uint256 balance, ) = LibVault.getVaultBalances();
        if (balance == 0) return 0;
        sharesOut = (amount0 * s.totalShares) / balance;
    }

    function _previewMintInAsset0(uint256 sharesToMint) internal view returns (uint256 amount0) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (sharesToMint == 0 || s.totalShares == 0) return 0;
        (uint256 balance, ) = LibVault.getVaultBalances();
        amount0 = (sharesToMint * balance) / s.totalShares;
    }

    function _previewWithdrawInAsset0(uint256 amount0) internal view returns (uint256 sharesNeeded) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (amount0 == 0 || s.totalShares == 0) return 0;
        (uint256 balance, ) = LibVault.getVaultBalances();
        if (balance == 0) return 0;
        sharesNeeded = (amount0 * s.totalShares) / balance;
    }

    function _previewRedeemInAsset0(uint256 sharesToRedeem) internal view returns (uint256 amount0) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (sharesToRedeem == 0 || s.totalShares == 0) return 0;
        (uint256 balance, ) = LibVault.getVaultBalances();
        amount0 = (sharesToRedeem * balance) / s.totalShares;
    }

    // ============ Internal Preview Helpers: IN_ASSET1 ============

    function _previewDepositInAsset1(uint256 amount1) internal view returns (uint256 sharesOut) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (amount1 == 0) return 0;
        (, uint256 balance) = LibVault.getVaultBalances();
        if (balance == 0) return 0;
        sharesOut = (amount1 * s.totalShares) / balance;
    }

    function _previewMintInAsset1(uint256 sharesToMint) internal view returns (uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (sharesToMint == 0 || s.totalShares == 0) return 0;
        (, uint256 balance) = LibVault.getVaultBalances();
        amount1 = (sharesToMint * balance) / s.totalShares;
    }

    function _previewWithdrawInAsset1(uint256 amount1) internal view returns (uint256 sharesNeeded) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (amount1 == 0 || s.totalShares == 0) return 0;
        (, uint256 balance) = LibVault.getVaultBalances();
        if (balance == 0) return 0;
        sharesNeeded = (amount1 * s.totalShares) / balance;
    }

    function _previewRedeemInAsset1(uint256 sharesToRedeem) internal view returns (uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (sharesToRedeem == 0 || s.totalShares == 0) return 0;
        (, uint256 balance) = LibVault.getVaultBalances();
        amount1 = (sharesToRedeem * balance) / s.totalShares;
    }
}
