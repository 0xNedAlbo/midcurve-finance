// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, VaultState, Modifiers} from "../storage/AppStorage.sol";
import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {LibVault} from "../libraries/LibVault.sol";
import {UniswapV3Math} from "../libraries/UniswapV3Math.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {SafeERC20} from "../libraries/SafeERC20.sol";

/// @title DepositWithdrawFacet
/// @notice Handles deposits, withdrawals, mints, and redeems
/// @dev Routes operations based on vault state (IN_POSITION, IN_ASSET0, IN_ASSET1)
contract DepositWithdrawFacet is Modifiers {
    using SafeERC20 for IERC20;

    // ============ Events ============

    event Deposit(
        address indexed caller,
        address indexed receiver,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );

    event Withdraw(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );

    event CollectFees(address indexed account, uint256 amount0, uint256 amount1);

    // ============ Errors ============

    error InvalidState();
    error ZeroAmount();
    error Unauthorized();
    error InsufficientShares();

    // ============ Deposit ============

    /// @notice Deposit assets and receive shares
    /// @param amount0 Amount of token0 to deposit
    /// @param amount1 Amount of token1 to deposit
    /// @param receiver Address to receive shares
    /// @return sharesOut Shares minted
    function deposit(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) external nonReentrant whenInitialized whenNotPaused requireAllowlisted(receiver) returns (uint256 sharesOut) {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState == VaultState.UNINITIALIZED || s.currentState == VaultState.CLOSED) {
            revert InvalidState();
        }

        if (s.currentState == VaultState.IN_POSITION) {
            sharesOut = _depositInPosition(amount0, amount1, receiver);
        } else if (s.currentState == VaultState.IN_ASSET0) {
            sharesOut = _depositInAsset0(amount0, receiver);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            sharesOut = _depositInAsset1(amount1, receiver);
        }
    }

    /// @notice Mint exact shares by depositing assets
    /// @param sharesToMint Exact shares to mint
    /// @param receiver Address to receive shares
    /// @return amount0 Amount of token0 deposited
    /// @return amount1 Amount of token1 deposited
    function mint(
        uint256 sharesToMint,
        address receiver
    ) external nonReentrant whenInitialized whenNotPaused requireAllowlisted(receiver) returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState == VaultState.UNINITIALIZED || s.currentState == VaultState.CLOSED) {
            revert InvalidState();
        }
        if (sharesToMint == 0) revert ZeroAmount();

        if (s.currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _mintInPosition(sharesToMint, receiver);
        } else if (s.currentState == VaultState.IN_ASSET0) {
            amount0 = _mintInAsset0(sharesToMint, receiver);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            amount1 = _mintInAsset1(sharesToMint, receiver);
        }
    }

    /// @notice Withdraw specific amounts of assets
    /// @param amount0 Amount of token0 to withdraw
    /// @param amount1 Amount of token1 to withdraw
    /// @param receiver Address to receive assets
    /// @param owner Address to burn shares from
    /// @return sharesBurned Shares burned
    function withdraw(
        uint256 amount0,
        uint256 amount1,
        address receiver,
        address owner
    ) external nonReentrant whenInitialized whenNotPaused returns (uint256 sharesBurned) {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState == VaultState.UNINITIALIZED) {
            revert InvalidState();
        }
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();
        if (msg.sender != owner) revert Unauthorized();

        if (s.currentState == VaultState.IN_POSITION) {
            sharesBurned = _withdrawInPosition(amount0, amount1, receiver, owner);
        } else if (s.currentState == VaultState.IN_ASSET0 || s.currentState == VaultState.CLOSED) {
            sharesBurned = _withdrawInAsset0(amount0, receiver, owner);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            sharesBurned = _withdrawInAsset1(amount1, receiver, owner);
        }
    }

    /// @notice Redeem shares for assets
    /// @param sharesToRedeem Shares to redeem
    /// @param receiver Address to receive assets
    /// @param owner Address to burn shares from
    /// @return amount0 Amount of token0 received
    /// @return amount1 Amount of token1 received
    function redeem(
        uint256 sharesToRedeem,
        address receiver,
        address owner
    ) external nonReentrant whenInitialized whenNotPaused returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState == VaultState.UNINITIALIZED) {
            revert InvalidState();
        }
        if (sharesToRedeem == 0) revert ZeroAmount();
        if (msg.sender != owner) revert Unauthorized();

        if (s.currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _redeemInPosition(sharesToRedeem, receiver, owner);
        } else if (s.currentState == VaultState.IN_ASSET0 || s.currentState == VaultState.CLOSED) {
            amount0 = _redeemInAsset0(sharesToRedeem, receiver, owner);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            amount1 = _redeemInAsset1(sharesToRedeem, receiver, owner);
        }
    }

    // ============ Internal: IN_POSITION Deposit/Mint ============

    function _depositInPosition(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) internal returns (uint256 sharesOut) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();

        // Transfer tokens from user
        if (amount0 > 0) IERC20(s.asset0).safeTransferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) IERC20(s.asset1).safeTransferFrom(msg.sender, address(this), amount1);

        // Get current liquidity before
        (, , , , , , , uint128 liquidityBefore, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);

        // Approve position manager
        IERC20(s.asset0).safeApprove(s.positionManager, amount0);
        IERC20(s.asset1).safeApprove(s.positionManager, amount1);

        // Calculate min amounts with slippage
        uint256 slippageBps = LibVault.getDepositSlippageBps(msg.sender);
        uint256 amount0Min = (amount0 * (LibVault.BPS_DENOMINATOR - slippageBps)) / LibVault.BPS_DENOMINATOR;
        uint256 amount1Min = (amount1 * (LibVault.BPS_DENOMINATOR - slippageBps)) / LibVault.BPS_DENOMINATOR;

        // Increase liquidity
        (uint128 liquidityAdded, uint256 used0, uint256 used1) = INonfungiblePositionManager(s.positionManager).increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: s.positionId,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: block.timestamp
            })
        );

        // Reset approvals
        IERC20(s.asset0).safeApprove(s.positionManager, 0);
        IERC20(s.asset1).safeApprove(s.positionManager, 0);

        // Calculate shares
        sharesOut = (uint256(liquidityAdded) * s.totalShares) / uint256(liquidityBefore);

        // Mint shares
        LibVault.mint(receiver, sharesOut);

        emit Deposit(msg.sender, receiver, used0, used1, sharesOut);

        // Return unused tokens
        uint256 refund0 = amount0 - used0;
        uint256 refund1 = amount1 - used1;
        if (refund0 > 0) IERC20(s.asset0).safeTransfer(msg.sender, refund0);
        if (refund1 > 0) IERC20(s.asset1).safeTransfer(msg.sender, refund1);
    }

    function _mintInPosition(
        uint256 sharesToMint,
        address receiver
    ) internal returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();

        (, , , , , , , uint128 liquidityBefore, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);

        // Calculate target liquidity
        uint128 liquidityRequired = uint128((sharesToMint * uint256(liquidityBefore)) / s.totalShares);

        // Get amounts for that liquidity
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();
        (uint256 amount0Needed, uint256 amount1Needed) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            s.tickLower,
            s.tickUpper,
            liquidityRequired
        );

        // Add buffer
        uint256 slippageBps = LibVault.getDepositSlippageBps(msg.sender);
        uint256 amount0WithBuffer = (amount0Needed * (LibVault.BPS_DENOMINATOR + slippageBps)) / LibVault.BPS_DENOMINATOR;
        uint256 amount1WithBuffer = (amount1Needed * (LibVault.BPS_DENOMINATOR + slippageBps)) / LibVault.BPS_DENOMINATOR;

        // Transfer buffered amounts
        if (amount0WithBuffer > 0) IERC20(s.asset0).safeTransferFrom(msg.sender, address(this), amount0WithBuffer);
        if (amount1WithBuffer > 0) IERC20(s.asset1).safeTransferFrom(msg.sender, address(this), amount1WithBuffer);

        // Approve and increase liquidity
        IERC20(s.asset0).safeApprove(s.positionManager, amount0WithBuffer);
        IERC20(s.asset1).safeApprove(s.positionManager, amount1WithBuffer);

        (, uint256 used0, uint256 used1) = INonfungiblePositionManager(s.positionManager).increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: s.positionId,
                amount0Desired: amount0WithBuffer,
                amount1Desired: amount1WithBuffer,
                amount0Min: amount0Needed,
                amount1Min: amount1Needed,
                deadline: block.timestamp
            })
        );

        // Reset approvals
        IERC20(s.asset0).safeApprove(s.positionManager, 0);
        IERC20(s.asset1).safeApprove(s.positionManager, 0);

        // Mint exact shares
        LibVault.mint(receiver, sharesToMint);

        emit Deposit(msg.sender, receiver, used0, used1, sharesToMint);

        // Refund unused
        uint256 refund0 = amount0WithBuffer - used0;
        uint256 refund1 = amount1WithBuffer - used1;
        if (refund0 > 0) IERC20(s.asset0).safeTransfer(msg.sender, refund0);
        if (refund1 > 0) IERC20(s.asset1).safeTransfer(msg.sender, refund1);

        amount0 = used0;
        amount1 = used1;
    }

    // ============ Internal: IN_POSITION Withdraw/Redeem ============

    function _withdrawInPosition(
        uint256 amount0,
        uint256 amount1,
        address receiver,
        address owner
    ) internal returns (uint256 sharesBurned) {
        AppStorage storage s = LibAppStorage.appStorage();

        // Collect and distribute fees
        (uint256 positionFees0, uint256 positionFees1) = LibVault.collectPositionFees();
        LibVault.updateFeeAccumulators(positionFees0, positionFees1);

        // Calculate pending fees
        uint256 ownerShares = s.shares[owner];
        uint256 pendingFee0 = ((s.accFeePerShare0 * ownerShares) / LibVault.ACC_PRECISION) - s.feeDebt0[owner];
        uint256 pendingFee1 = ((s.accFeePerShare1 * ownerShares) / LibVault.ACC_PRECISION) - s.feeDebt1[owner];

        // Calculate liquidity needed
        (, , , , , , , uint128 liquidityBefore, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);

        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(s.tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(s.tickUpper);

        uint128 L0 = amount0 > 0 ? UniswapV3Math.getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0) : 0;
        uint128 L1 = amount1 > 0 ? UniswapV3Math.getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1) : 0;
        uint128 liquidityToWithdraw = L0 > L1 ? L0 : L1;

        // Calculate shares to burn
        sharesBurned = (uint256(liquidityToWithdraw) * s.totalShares) / uint256(liquidityBefore);
        if (ownerShares < sharesBurned) revert InsufficientShares();

        // Decrease liquidity
        uint256 slippageBps = LibVault.getWithdrawSlippageBps(owner);
        uint256 amount0Min = (amount0 * (LibVault.BPS_DENOMINATOR - slippageBps)) / LibVault.BPS_DENOMINATOR;
        uint256 amount1Min = (amount1 * (LibVault.BPS_DENOMINATOR - slippageBps)) / LibVault.BPS_DENOMINATOR;

        (uint256 decreased0, uint256 decreased1) = LibVault.decreaseLiquidity(liquidityToWithdraw, amount0Min, amount1Min);

        // Burn shares
        LibVault.burn(owner, sharesBurned);

        // Transfer assets
        if (pendingFee0 > 0) IERC20(s.asset0).safeTransfer(receiver, pendingFee0);
        if (pendingFee1 > 0) IERC20(s.asset1).safeTransfer(receiver, pendingFee1);
        if (amount0 > 0) IERC20(s.asset0).safeTransfer(receiver, amount0);
        if (amount1 > 0) IERC20(s.asset1).safeTransfer(receiver, amount1);

        // Refund excess
        if (decreased0 > amount0) IERC20(s.asset0).safeTransfer(owner, decreased0 - amount0);
        if (decreased1 > amount1) IERC20(s.asset1).safeTransfer(owner, decreased1 - amount1);

        if (pendingFee0 > 0 || pendingFee1 > 0) {
            emit CollectFees(owner, pendingFee0, pendingFee1);
        }
        emit Withdraw(msg.sender, receiver, owner, amount0, amount1, sharesBurned);
    }

    function _redeemInPosition(
        uint256 sharesToRedeem,
        address receiver,
        address owner
    ) internal returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();

        // Collect and distribute fees
        (uint256 positionFees0, uint256 positionFees1) = LibVault.collectPositionFees();
        LibVault.updateFeeAccumulators(positionFees0, positionFees1);

        // Calculate pending fees
        uint256 ownerShares = s.shares[owner];
        if (ownerShares < sharesToRedeem) revert InsufficientShares();

        uint256 pendingFee0 = ((s.accFeePerShare0 * ownerShares) / LibVault.ACC_PRECISION) - s.feeDebt0[owner];
        uint256 pendingFee1 = ((s.accFeePerShare1 * ownerShares) / LibVault.ACC_PRECISION) - s.feeDebt1[owner];

        // Calculate pro-rata liquidity
        (, , , , , , , uint128 liquidityBefore, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);
        uint128 liquidityToRedeem = uint128((sharesToRedeem * uint256(liquidityBefore)) / s.totalShares);

        // Get expected amounts
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();
        (uint256 expectedAmount0, uint256 expectedAmount1) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            s.tickLower,
            s.tickUpper,
            liquidityToRedeem
        );

        uint256 slippageBps = LibVault.getWithdrawSlippageBps(owner);
        uint256 amount0Min = (expectedAmount0 * (LibVault.BPS_DENOMINATOR - slippageBps)) / LibVault.BPS_DENOMINATOR;
        uint256 amount1Min = (expectedAmount1 * (LibVault.BPS_DENOMINATOR - slippageBps)) / LibVault.BPS_DENOMINATOR;

        (amount0, amount1) = LibVault.decreaseLiquidity(liquidityToRedeem, amount0Min, amount1Min);

        // Burn shares
        LibVault.burn(owner, sharesToRedeem);

        // Transfer assets
        if (pendingFee0 > 0) IERC20(s.asset0).safeTransfer(receiver, pendingFee0);
        if (pendingFee1 > 0) IERC20(s.asset1).safeTransfer(receiver, pendingFee1);
        if (amount0 > 0) IERC20(s.asset0).safeTransfer(receiver, amount0);
        if (amount1 > 0) IERC20(s.asset1).safeTransfer(receiver, amount1);

        if (pendingFee0 > 0 || pendingFee1 > 0) {
            emit CollectFees(owner, pendingFee0, pendingFee1);
        }
        emit Withdraw(msg.sender, receiver, owner, amount0, amount1, sharesToRedeem);
    }

    // ============ Internal: IN_ASSET0 Operations ============

    function _depositInAsset0(uint256 amount0, address receiver) internal returns (uint256 sharesOut) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (amount0 == 0) revert ZeroAmount();

        (uint256 balanceBefore, ) = LibVault.getVaultBalances();
        IERC20(s.asset0).safeTransferFrom(msg.sender, address(this), amount0);
        sharesOut = (amount0 * s.totalShares) / balanceBefore;
        LibVault.mint(receiver, sharesOut);
        emit Deposit(msg.sender, receiver, amount0, 0, sharesOut);
    }

    function _mintInAsset0(uint256 sharesToMint, address receiver) internal returns (uint256 amount0) {
        AppStorage storage s = LibAppStorage.appStorage();
        (uint256 balance, ) = LibVault.getVaultBalances();
        amount0 = (sharesToMint * balance) / s.totalShares;
        IERC20(s.asset0).safeTransferFrom(msg.sender, address(this), amount0);
        LibVault.mint(receiver, sharesToMint);
        emit Deposit(msg.sender, receiver, amount0, 0, sharesToMint);
    }

    function _withdrawInAsset0(uint256 amount0, address receiver, address owner) internal returns (uint256 sharesBurned) {
        AppStorage storage s = LibAppStorage.appStorage();
        (uint256 balance, ) = LibVault.getVaultBalances();
        sharesBurned = (amount0 * s.totalShares) / balance;
        LibVault.burn(owner, sharesBurned);
        IERC20(s.asset0).safeTransfer(receiver, amount0);
        emit Withdraw(msg.sender, receiver, owner, amount0, 0, sharesBurned);
    }

    function _redeemInAsset0(uint256 sharesToRedeem, address receiver, address owner) internal returns (uint256 amount0) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.shares[owner] < sharesToRedeem) revert InsufficientShares();
        (uint256 balance, ) = LibVault.getVaultBalances();
        amount0 = (sharesToRedeem * balance) / s.totalShares;
        LibVault.burn(owner, sharesToRedeem);
        IERC20(s.asset0).safeTransfer(receiver, amount0);
        emit Withdraw(msg.sender, receiver, owner, amount0, 0, sharesToRedeem);
    }

    // ============ Internal: IN_ASSET1 Operations ============

    function _depositInAsset1(uint256 amount1, address receiver) internal returns (uint256 sharesOut) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (amount1 == 0) revert ZeroAmount();

        (, uint256 balanceBefore) = LibVault.getVaultBalances();
        IERC20(s.asset1).safeTransferFrom(msg.sender, address(this), amount1);
        sharesOut = (amount1 * s.totalShares) / balanceBefore;
        LibVault.mint(receiver, sharesOut);
        emit Deposit(msg.sender, receiver, 0, amount1, sharesOut);
    }

    function _mintInAsset1(uint256 sharesToMint, address receiver) internal returns (uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        (, uint256 balance) = LibVault.getVaultBalances();
        amount1 = (sharesToMint * balance) / s.totalShares;
        IERC20(s.asset1).safeTransferFrom(msg.sender, address(this), amount1);
        LibVault.mint(receiver, sharesToMint);
        emit Deposit(msg.sender, receiver, 0, amount1, sharesToMint);
    }

    function _withdrawInAsset1(uint256 amount1, address receiver, address owner) internal returns (uint256 sharesBurned) {
        AppStorage storage s = LibAppStorage.appStorage();
        (, uint256 balance) = LibVault.getVaultBalances();
        sharesBurned = (amount1 * s.totalShares) / balance;
        LibVault.burn(owner, sharesBurned);
        IERC20(s.asset1).safeTransfer(receiver, amount1);
        emit Withdraw(msg.sender, receiver, owner, 0, amount1, sharesBurned);
    }

    function _redeemInAsset1(uint256 sharesToRedeem, address receiver, address owner) internal returns (uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.shares[owner] < sharesToRedeem) revert InsufficientShares();
        (, uint256 balance) = LibVault.getVaultBalances();
        amount1 = (sharesToRedeem * balance) / s.totalShares;
        LibVault.burn(owner, sharesToRedeem);
        IERC20(s.asset1).safeTransfer(receiver, amount1);
        emit Withdraw(msg.sender, receiver, owner, 0, amount1, sharesToRedeem);
    }
}
