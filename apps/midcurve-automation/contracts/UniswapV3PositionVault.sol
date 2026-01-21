// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITokenPairVault} from "./interfaces/ITokenPairVault.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3Factory} from "./interfaces/IUniswapV3Factory.sol";
import {IUniswapV3PoolMinimal} from "./interfaces/IUniswapV3PoolMinimal.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {UniswapV3Math} from "./libraries/UniswapV3Math.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";
import {ReentrancyGuard} from "./base/ReentrancyGuard.sol";

/// @title UniswapV3PositionVault
/// @notice A dual-asset vault managing a single Uniswap V3 position
/// @dev Base vault contract - always operates with liquidity in position
contract UniswapV3PositionVault is ITokenPairVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Errors ============

    error ZeroAddress();
    error Unauthorized();
    error EmptyPosition();
    error NotInitialized();
    error AlreadyInitialized();
    error ZeroAmount();

    // ============ Immutables ============

    /// @notice The Uniswap V3 NonfungiblePositionManager address
    address public immutable positionManager;

    /// @notice The Uniswap V3 Factory address
    address public immutable uniswapFactory;

    /// @notice The first token of the pair (token0 from position)
    address internal immutable _asset0;

    /// @notice The second token of the pair (token1 from position)
    address internal immutable _asset1;

    /// @notice The Uniswap V3 pool address
    address public immutable pool;

    /// @notice The manager address (deployer, has admin rights)
    address public immutable manager;

    // ============ Constants ============

    /// @notice Precision for fee per share calculations
    uint256 internal constant ACC_PRECISION = 1e18;

    /// @notice Basis points denominator (100% = 10000)
    uint256 internal constant BPS_DENOMINATOR = 10000;

    // ============ State ============

    /// @notice Whether the vault has been initialized
    bool public initialized;

    /// @notice The Uniswap V3 position NFT ID
    uint256 public positionId;

    /// @notice Lower tick of the position range
    int24 public tickLower;

    /// @notice Upper tick of the position range
    int24 public tickUpper;

    /// @notice Default slippage tolerance for deposits in basis points (1% = 100)
    uint256 public constant DEFAULT_DEPOSIT_SLIPPAGE_BPS = 100;

    /// @notice Default slippage tolerance for withdrawals in basis points (1% = 100)
    uint256 public constant DEFAULT_WITHDRAW_SLIPPAGE_BPS = 100;

    /// @notice Per-shareholder deposit slippage tolerance in basis points
    /// @dev 0 means use default, any other value is the custom slippage
    mapping(address => uint256) internal _shareholderDepositSlippageBps;

    /// @notice Per-shareholder withdrawal slippage tolerance in basis points
    /// @dev 0 means use default, any other value is the custom slippage
    mapping(address => uint256) internal _shareholderWithdrawSlippageBps;

    // ============ Share Tracking ============

    /// @notice Total shares issued
    uint256 public totalShares;

    /// @notice Shares per account
    mapping(address => uint256) public shares;

    // ============ Fee Tracking ============

    /// @notice Accumulated fee per share for token0 (scaled by ACC_PRECISION)
    uint256 public accFeePerShare0;

    /// @notice Accumulated fee per share for token1 (scaled by ACC_PRECISION)
    uint256 public accFeePerShare1;

    /// @notice Fee debt for token0 per account (scaled by ACC_PRECISION)
    mapping(address => uint256) public feeDebt0;

    /// @notice Fee debt for token1 per account (scaled by ACC_PRECISION)
    mapping(address => uint256) public feeDebt1;

    // ============ Modifiers ============

    modifier whenInitialized() {
        if (!initialized) revert NotInitialized();
        _;
    }

    // ============ Constructor ============

    constructor(address positionManager_, uint256 positionId_) {
        if (positionManager_ == address(0)) revert ZeroAddress();

        positionManager = positionManager_;
        positionId = positionId_;
        manager = msg.sender;

        INonfungiblePositionManager pm = INonfungiblePositionManager(
            positionManager_
        );

        address factory_ = pm.factory();
        if (factory_ == address(0)) revert ZeroAddress();
        uniswapFactory = factory_;

        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower_,
            int24 tickUpper_,
            ,
            ,
            ,
            ,

        ) = pm.positions(positionId_);

        _asset0 = token0;
        _asset1 = token1;
        tickLower = tickLower_;
        tickUpper = tickUpper_;

        address pool_ = IUniswapV3Factory(factory_).getPool(
            token0,
            token1,
            fee
        );
        if (pool_ == address(0)) revert ZeroAddress();
        pool = pool_;
    }

    // ============ Asset Getters ============

    function asset0() external view returns (address) {
        return _asset0;
    }

    function asset1() external view returns (address) {
        return _asset1;
    }

    // ============ Manager Functions ============

    function init(uint256 initialShares) public virtual {
        if (initialized) revert AlreadyInitialized();
        if (initialShares == 0) revert ZeroAmount();
        (uint256 amount0, uint256 amount1) = _getPositionAmounts();
        if (amount0 == 0 && amount1 == 0) revert EmptyPosition();

        INonfungiblePositionManager(positionManager).transferFrom(
            msg.sender,
            address(this),
            positionId
        );
        initialized = true;

        totalShares = initialShares;
        shares[msg.sender] = initialShares;
        feeDebt0[msg.sender] = 0;
        feeDebt1[msg.sender] = 0;
    }

    /// @notice Get the deposit slippage for a shareholder
    /// @param shareholder Address to check
    /// @return slippageBps The effective slippage in basis points
    function getDepositSlippageBps(
        address shareholder
    ) public view returns (uint256 slippageBps) {
        slippageBps = _shareholderDepositSlippageBps[shareholder];
        if (slippageBps == 0) {
            slippageBps = DEFAULT_DEPOSIT_SLIPPAGE_BPS;
        }
    }

    /// @notice Set your deposit slippage tolerance
    /// @param slippageBps Slippage in basis points (1-10000), or 0 to use default
    function setDepositSlippage(uint256 slippageBps) external {
        require(slippageBps <= BPS_DENOMINATOR, "Invalid slippage");
        _shareholderDepositSlippageBps[msg.sender] = slippageBps;
    }

    /// @notice Get the withdrawal slippage for a shareholder
    /// @param shareholder Address to check
    /// @return slippageBps The effective slippage in basis points
    function getWithdrawSlippageBps(
        address shareholder
    ) public view returns (uint256 slippageBps) {
        slippageBps = _shareholderWithdrawSlippageBps[shareholder];
        if (slippageBps == 0) {
            slippageBps = DEFAULT_WITHDRAW_SLIPPAGE_BPS;
        }
    }

    /// @notice Set your withdrawal slippage tolerance
    /// @param slippageBps Slippage in basis points (1-10000), or 0 to use default
    function setWithdrawSlippage(uint256 slippageBps) external {
        require(slippageBps <= BPS_DENOMINATOR, "Invalid slippage");
        _shareholderWithdrawSlippageBps[msg.sender] = slippageBps;
    }

    // ============ Fee Collection ============

    /// @notice View pending fees for an account
    /// @param account The account to check
    /// @return pending0 Pending token0 fees
    /// @return pending1 Pending token1 fees
    function pendingFees(
        address account
    ) external view returns (uint256 pending0, uint256 pending1) {
        uint256 userShares = shares[account];
        if (userShares > 0) {
            pending0 =
                ((accFeePerShare0 * userShares) / ACC_PRECISION) -
                feeDebt0[account];
            pending1 =
                ((accFeePerShare1 * userShares) / ACC_PRECISION) -
                feeDebt1[account];
        }
    }

    /// @notice Collect fees for the caller
    /// @return collected0 Amount of token0 fees collected
    /// @return collected1 Amount of token1 fees collected
    function collectFees()
        external
        virtual
        nonReentrant
        returns (uint256 collected0, uint256 collected1)
    {
        uint256 userShares = shares[msg.sender];
        require(userShares > 0, "No shares");

        // Collect position fees to vault
        (uint256 positionFees0, uint256 positionFees1) = _collectPositionFees();

        // Update fee accumulators
        _updateFeeAccumulators(positionFees0, positionFees1);

        // Calculate user's pending fees
        collected0 =
            ((accFeePerShare0 * userShares) / ACC_PRECISION) -
            feeDebt0[msg.sender];
        collected1 =
            ((accFeePerShare1 * userShares) / ACC_PRECISION) -
            feeDebt1[msg.sender];

        // Update user's fee debt
        feeDebt0[msg.sender] = (accFeePerShare0 * userShares) / ACC_PRECISION;
        feeDebt1[msg.sender] = (accFeePerShare1 * userShares) / ACC_PRECISION;

        // Transfer fees to user
        if (collected0 > 0) {
            IERC20(_asset0).safeTransfer(msg.sender, collected0);
        }
        if (collected1 > 0) {
            IERC20(_asset1).safeTransfer(msg.sender, collected1);
        }
    }

    // ============ Accounting ============

    function totalAssets()
        external
        view
        returns (uint256 amount0, uint256 amount1)
    {
        (amount0, amount1) = _getPositionAmounts();
        (uint256 balance0, uint256 balance1) = _getVaultBalances();
        amount0 += balance0;
        amount1 += balance1;
    }

    function _getPositionAmounts()
        internal
        view
        returns (uint256 amount0, uint256 amount1)
    {
        // Get liquidity from position (may fail if position was burned)
        try
            INonfungiblePositionManager(positionManager).positions(positionId)
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
            // Calculate amounts in position if liquidity exists
            if (liquidity > 0) {
                (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool)
                    .slot0();
                (amount0, amount1) = UniswapV3Math.getAmountsForLiquidity(
                    sqrtPriceX96,
                    tickLower,
                    tickUpper,
                    liquidity
                );
            }
        } catch {}
    }

    function _getVaultBalances()
        internal
        view
        returns (uint256 balance0, uint256 balance1)
    {
        balance0 = IERC20(_asset0).balanceOf(address(this));
        balance1 = IERC20(_asset1).balanceOf(address(this));

        // Subtract fees reserved for shareholders
        uint256 reservedFees0 = (accFeePerShare0 * totalShares) / ACC_PRECISION;
        uint256 reservedFees1 = (accFeePerShare1 * totalShares) / ACC_PRECISION;

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

    function _collectPositionFees()
        internal
        returns (uint256 collected0, uint256 collected1)
    {
        (collected0, collected1) = INonfungiblePositionManager(positionManager)
            .collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId: positionId,
                    recipient: address(this),
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );
    }

    function _updateFeeAccumulators(
        uint256 collected0,
        uint256 collected1
    ) internal {
        if (totalShares > 0) {
            accFeePerShare0 += (collected0 * ACC_PRECISION) / totalShares;
            accFeePerShare1 += (collected1 * ACC_PRECISION) / totalShares;
        }
    }

    // ============ Internal Deposit Helper ============

    function _depositInPosition(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) internal returns (uint256 sharesOut) {
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();

        // Transfer tokens from user
        if (amount0 > 0)
            IERC20(_asset0).safeTransferFrom(
                msg.sender,
                address(this),
                amount0
            );
        if (amount1 > 0)
            IERC20(_asset1).safeTransferFrom(
                msg.sender,
                address(this),
                amount1
            );

        // Get current liquidity before
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidityBefore,
            ,
            ,
            ,

        ) = INonfungiblePositionManager(positionManager).positions(positionId);

        // Approve position manager
        IERC20(_asset0).safeApprove(positionManager, amount0);
        IERC20(_asset1).safeApprove(positionManager, amount1);

        // Calculate min amounts with slippage (use depositor's slippage setting)
        uint256 slippageBps = getDepositSlippageBps(msg.sender);
        uint256 amount0Min = (amount0 * (BPS_DENOMINATOR - slippageBps)) /
            BPS_DENOMINATOR;
        uint256 amount1Min = (amount1 * (BPS_DENOMINATOR - slippageBps)) /
            BPS_DENOMINATOR;

        // Increase liquidity
        (
            uint128 liquidityAdded,
            uint256 used0,
            uint256 used1
        ) = INonfungiblePositionManager(positionManager).increaseLiquidity(
                INonfungiblePositionManager.IncreaseLiquidityParams({
                    tokenId: positionId,
                    amount0Desired: amount0,
                    amount1Desired: amount1,
                    amount0Min: amount0Min,
                    amount1Min: amount1Min,
                    deadline: block.timestamp
                })
            );

        // Reset approvals
        IERC20(_asset0).safeApprove(positionManager, 0);
        IERC20(_asset1).safeApprove(positionManager, 0);

        // Calculate shares: newShares = liquidityAdded * totalShares / liquidityBefore
        sharesOut =
            (uint256(liquidityAdded) * totalShares) /
            uint256(liquidityBefore);

        // Update share accounting
        totalShares += sharesOut;
        shares[receiver] += sharesOut;

        // Add fee debt for new shares (preserves pending fees from existing shares)
        feeDebt0[receiver] += (accFeePerShare0 * sharesOut) / ACC_PRECISION;
        feeDebt1[receiver] += (accFeePerShare1 * sharesOut) / ACC_PRECISION;

        // Return unused tokens
        uint256 refund0 = amount0 - used0;
        uint256 refund1 = amount1 - used1;
        if (refund0 > 0) IERC20(_asset0).safeTransfer(msg.sender, refund0);
        if (refund1 > 0) IERC20(_asset1).safeTransfer(msg.sender, refund1);
    }

    // ============ Internal Mint Helper ============

    function _mintInPosition(
        uint256 sharesToMint,
        address receiver
    ) internal returns (uint256 amount0, uint256 amount1) {
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidityBefore,
            ,
            ,
            ,

        ) = INonfungiblePositionManager(positionManager).positions(positionId);

        // Calculate target liquidity for exact shares
        uint128 liquidityRequired = uint128(
            (sharesToMint * uint256(liquidityBefore)) / totalShares
        );

        // Get amounts for that liquidity
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool)
            .slot0();
        (uint256 amount0Needed, uint256 amount1Needed) = UniswapV3Math
            .getAmountsForLiquidity(
                sqrtPriceX96,
                tickLower,
                tickUpper,
                liquidityRequired
            );

        // Add buffer for rounding (use depositor's slippage setting)
        uint256 slippageBps = getDepositSlippageBps(msg.sender);
        uint256 amount0WithBuffer = (amount0Needed *
            (BPS_DENOMINATOR + slippageBps)) / BPS_DENOMINATOR;
        uint256 amount1WithBuffer = (amount1Needed *
            (BPS_DENOMINATOR + slippageBps)) / BPS_DENOMINATOR;

        // Transfer buffered amounts
        if (amount0WithBuffer > 0)
            IERC20(_asset0).safeTransferFrom(
                msg.sender,
                address(this),
                amount0WithBuffer
            );
        if (amount1WithBuffer > 0)
            IERC20(_asset1).safeTransferFrom(
                msg.sender,
                address(this),
                amount1WithBuffer
            );

        // Approve and increase liquidity
        IERC20(_asset0).safeApprove(positionManager, amount0WithBuffer);
        IERC20(_asset1).safeApprove(positionManager, amount1WithBuffer);

        (, uint256 used0, uint256 used1) = INonfungiblePositionManager(
            positionManager
        ).increaseLiquidity(
                INonfungiblePositionManager.IncreaseLiquidityParams({
                    tokenId: positionId,
                    amount0Desired: amount0WithBuffer,
                    amount1Desired: amount1WithBuffer,
                    amount0Min: amount0Needed,
                    amount1Min: amount1Needed,
                    deadline: block.timestamp
                })
            );

        // Reset approvals
        IERC20(_asset0).safeApprove(positionManager, 0);
        IERC20(_asset1).safeApprove(positionManager, 0);

        // Issue exact requested shares
        totalShares += sharesToMint;
        shares[receiver] += sharesToMint;
        feeDebt0[receiver] += (accFeePerShare0 * sharesToMint) / ACC_PRECISION;
        feeDebt1[receiver] += (accFeePerShare1 * sharesToMint) / ACC_PRECISION;

        // Refund unused
        uint256 refund0 = amount0WithBuffer - used0;
        uint256 refund1 = amount1WithBuffer - used1;
        if (refund0 > 0) IERC20(_asset0).safeTransfer(msg.sender, refund0);
        if (refund1 > 0) IERC20(_asset1).safeTransfer(msg.sender, refund1);

        amount0 = used0;
        amount1 = used1;
    }

    // ============ Internal Preview Helpers ============

    function _previewDepositInPosition(
        uint256 amount0,
        uint256 amount1
    ) internal view returns (uint256 sharesOut) {
        if (amount0 == 0 && amount1 == 0) return 0;

        // Get current pool price
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool)
            .slot0();

        // Get current position liquidity
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidityBefore,
            ,
            ,
            ,

        ) = INonfungiblePositionManager(positionManager).positions(positionId);
        if (liquidityBefore == 0) return 0;

        // Estimate liquidity that would be added
        uint128 expectedLiquidity = UniswapV3Math.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(tickLower),
            TickMath.getSqrtRatioAtTick(tickUpper),
            amount0,
            amount1
        );

        // Calculate shares
        sharesOut =
            (uint256(expectedLiquidity) * totalShares) /
            uint256(liquidityBefore);
    }

    function _previewMintInPosition(
        uint256 sharesToMint
    ) internal view returns (uint256 amount0, uint256 amount1) {
        if (sharesToMint == 0 || totalShares == 0) return (0, 0);

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool)
            .slot0();
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidityBefore,
            ,
            ,
            ,

        ) = INonfungiblePositionManager(positionManager).positions(positionId);
        if (liquidityBefore == 0) return (0, 0);

        uint128 liquidityRequired = uint128(
            (sharesToMint * uint256(liquidityBefore)) / totalShares
        );

        (amount0, amount1) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            tickLower,
            tickUpper,
            liquidityRequired
        );
    }

    function _previewWithdrawInPosition(
        uint256 amount0,
        uint256 amount1
    ) internal view returns (uint256 sharesNeeded) {
        if (amount0 == 0 && amount1 == 0) return 0;

        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidityBefore,
            ,
            ,
            ,

        ) = INonfungiblePositionManager(positionManager).positions(positionId);
        if (liquidityBefore == 0 || totalShares == 0) return 0;

        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        // Calculate liquidity for each asset
        uint128 L0 = amount0 > 0
            ? UniswapV3Math.getLiquidityForAmount0(
                sqrtRatioAX96,
                sqrtRatioBX96,
                amount0
            )
            : 0;
        uint128 L1 = amount1 > 0
            ? UniswapV3Math.getLiquidityForAmount1(
                sqrtRatioAX96,
                sqrtRatioBX96,
                amount1
            )
            : 0;

        // Take max
        uint128 liquidityNeeded = L0 > L1 ? L0 : L1;

        // Convert liquidity to shares
        sharesNeeded =
            (uint256(liquidityNeeded) * totalShares) /
            uint256(liquidityBefore);
    }

    function _previewRedeemInPosition(
        uint256 sharesToRedeem
    ) internal view returns (uint256 amount0, uint256 amount1) {
        if (sharesToRedeem == 0 || totalShares == 0) return (0, 0);

        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidityBefore,
            ,
            ,
            ,

        ) = INonfungiblePositionManager(positionManager).positions(positionId);
        if (liquidityBefore == 0) return (0, 0);

        // Calculate pro-rata liquidity
        uint128 liquidityToRedeem = uint128(
            (sharesToRedeem * uint256(liquidityBefore)) / totalShares
        );

        // Get amounts for that liquidity
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool)
            .slot0();
        (amount0, amount1) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            tickLower,
            tickUpper,
            liquidityToRedeem
        );
    }

    // ============ Internal Withdraw Helper ============

    function _withdrawInPosition(
        uint256 amount0,
        uint256 amount1,
        address receiver,
        address owner
    ) internal returns (uint256 sharesBurned) {
        // ===== STEP 1: Collect and distribute fees BEFORE burning shares =====
        // This ensures remaining shareholders don't lose their accumulated fee share
        (uint256 positionFees0, uint256 positionFees1) = _collectPositionFees();
        _updateFeeAccumulators(positionFees0, positionFees1);

        // ===== STEP 2: Calculate and pay out pending fees for owner =====
        uint256 ownerShares = shares[owner];
        uint256 pendingFee0 = ((accFeePerShare0 * ownerShares) /
            ACC_PRECISION) - feeDebt0[owner];
        uint256 pendingFee1 = ((accFeePerShare1 * ownerShares) /
            ACC_PRECISION) - feeDebt1[owner];

        // ===== STEP 3: Calculate liquidity needed =====
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidityBefore,
            ,
            ,
            ,

        ) = INonfungiblePositionManager(positionManager).positions(positionId);

        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        uint128 L0 = amount0 > 0
            ? UniswapV3Math.getLiquidityForAmount0(
                sqrtRatioAX96,
                sqrtRatioBX96,
                amount0
            )
            : 0;
        uint128 L1 = amount1 > 0
            ? UniswapV3Math.getLiquidityForAmount1(
                sqrtRatioAX96,
                sqrtRatioBX96,
                amount1
            )
            : 0;
        uint128 liquidityToWithdraw = L0 > L1 ? L0 : L1;

        // Calculate shares to burn
        sharesBurned =
            (uint256(liquidityToWithdraw) * totalShares) /
            uint256(liquidityBefore);

        // Verify owner has enough shares
        require(ownerShares >= sharesBurned, "Insufficient shares");

        // ===== STEP 4: Decrease liquidity =====
        uint256 slippageBps = getWithdrawSlippageBps(owner);
        uint256 amount0Min = (amount0 * (BPS_DENOMINATOR - slippageBps)) /
            BPS_DENOMINATOR;
        uint256 amount1Min = (amount1 * (BPS_DENOMINATOR - slippageBps)) /
            BPS_DENOMINATOR;

        (uint256 decreased0, uint256 decreased1) = INonfungiblePositionManager(
            positionManager
        ).decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: positionId,
                    liquidity: liquidityToWithdraw,
                    amount0Min: amount0Min,
                    amount1Min: amount1Min,
                    deadline: block.timestamp
                })
            );

        // Collect withdrawn liquidity tokens
        INonfungiblePositionManager(positionManager).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: uint128(decreased0),
                amount1Max: uint128(decreased1)
            })
        );

        // ===== STEP 5: Burn shares and update fee debt =====
        shares[owner] -= sharesBurned;
        totalShares -= sharesBurned;
        // Update fee debt: reset to match remaining shares
        feeDebt0[owner] = (accFeePerShare0 * shares[owner]) / ACC_PRECISION;
        feeDebt1[owner] = (accFeePerShare1 * shares[owner]) / ACC_PRECISION;

        // ===== STEP 6: Transfer assets =====
        // Transfer pending fees to receiver
        if (pendingFee0 > 0)
            IERC20(_asset0).safeTransfer(receiver, pendingFee0);
        if (pendingFee1 > 0)
            IERC20(_asset1).safeTransfer(receiver, pendingFee1);

        // Transfer requested principal amounts to receiver
        if (amount0 > 0) IERC20(_asset0).safeTransfer(receiver, amount0);
        if (amount1 > 0) IERC20(_asset1).safeTransfer(receiver, amount1);

        // Refund excess principal (decreased - requested) to owner
        if (decreased0 > amount0)
            IERC20(_asset0).safeTransfer(owner, decreased0 - amount0);
        if (decreased1 > amount1)
            IERC20(_asset1).safeTransfer(owner, decreased1 - amount1);
    }

    // ============ Internal Redeem Helper ============

    function _redeemInPosition(
        uint256 sharesToRedeem,
        address receiver,
        address owner
    ) internal returns (uint256 amount0, uint256 amount1) {
        // ===== STEP 1: Collect and distribute fees BEFORE burning shares =====
        (uint256 positionFees0, uint256 positionFees1) = _collectPositionFees();
        _updateFeeAccumulators(positionFees0, positionFees1);

        // ===== STEP 2: Calculate and pay out pending fees for owner =====
        uint256 ownerShares = shares[owner];
        require(ownerShares >= sharesToRedeem, "Insufficient shares");

        uint256 pendingFee0 = ((accFeePerShare0 * ownerShares) /
            ACC_PRECISION) - feeDebt0[owner];
        uint256 pendingFee1 = ((accFeePerShare1 * ownerShares) /
            ACC_PRECISION) - feeDebt1[owner];

        // ===== STEP 3: Calculate pro-rata liquidity =====
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidityBefore,
            ,
            ,
            ,

        ) = INonfungiblePositionManager(positionManager).positions(positionId);
        uint128 liquidityToRedeem = uint128(
            (sharesToRedeem * uint256(liquidityBefore)) / totalShares
        );

        // ===== STEP 4: Decrease liquidity =====
        // Get expected amounts for slippage calculation
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool)
            .slot0();
        (uint256 expectedAmount0, uint256 expectedAmount1) = UniswapV3Math
            .getAmountsForLiquidity(
                sqrtPriceX96,
                tickLower,
                tickUpper,
                liquidityToRedeem
            );

        uint256 slippageBps = getWithdrawSlippageBps(owner);
        uint256 amount0Min = (expectedAmount0 *
            (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR;
        uint256 amount1Min = (expectedAmount1 *
            (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR;

        (amount0, amount1) = INonfungiblePositionManager(positionManager)
            .decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: positionId,
                    liquidity: liquidityToRedeem,
                    amount0Min: amount0Min,
                    amount1Min: amount1Min,
                    deadline: block.timestamp
                })
            );

        // Collect tokens
        INonfungiblePositionManager(positionManager).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: uint128(amount0),
                amount1Max: uint128(amount1)
            })
        );

        // ===== STEP 5: Burn shares and update fee debt =====
        shares[owner] -= sharesToRedeem;
        totalShares -= sharesToRedeem;
        feeDebt0[owner] = (accFeePerShare0 * shares[owner]) / ACC_PRECISION;
        feeDebt1[owner] = (accFeePerShare1 * shares[owner]) / ACC_PRECISION;

        // ===== STEP 6: Transfer assets =====
        // Transfer pending fees to receiver
        if (pendingFee0 > 0)
            IERC20(_asset0).safeTransfer(receiver, pendingFee0);
        if (pendingFee1 > 0)
            IERC20(_asset1).safeTransfer(receiver, pendingFee1);

        // Transfer redeemed amounts to receiver
        if (amount0 > 0) IERC20(_asset0).safeTransfer(receiver, amount0);
        if (amount1 > 0) IERC20(_asset1).safeTransfer(receiver, amount1);
    }

    // ============ Conversions ============

    function convertToShares(
        uint256 amount0,
        uint256 amount1
    ) external view virtual returns (uint256 sharesOut) {
        if (!initialized) return 0;
        sharesOut = _previewDepositInPosition(amount0, amount1);
    }

    function convertToAssets(
        uint256 sharesToConvert
    ) external view virtual returns (uint256 amount0, uint256 amount1) {
        if (!initialized) return (0, 0);
        (amount0, amount1) = _previewMintInPosition(sharesToConvert);
    }

    // ============ Limits ============

    function maxDeposit(
        address
    ) external view virtual returns (uint256 amount0, uint256 amount1) {
        if (!initialized) {
            return (0, 0);
        }
        return (type(uint256).max, type(uint256).max);
    }

    function maxMint(
        address
    ) external view virtual returns (uint256 maxShares) {
        if (!initialized) {
            return 0;
        }
        return type(uint256).max;
    }

    function maxWithdraw(
        address owner
    ) external view virtual returns (uint256 amount0, uint256 amount1) {
        if (!initialized) {
            return (0, 0);
        }

        uint256 ownerShares = shares[owner];
        if (ownerShares == 0) return (0, 0);

        (amount0, amount1) = _previewMintInPosition(ownerShares);
    }

    function maxRedeem(
        address owner
    ) external view virtual returns (uint256 maxShares) {
        if (!initialized) {
            return 0;
        }
        return shares[owner];
    }

    // ============ Previews ============

    function previewDeposit(
        uint256 amount0,
        uint256 amount1
    ) external view virtual returns (uint256 sharesOut) {
        if (!initialized) {
            return 0;
        }
        sharesOut = _previewDepositInPosition(amount0, amount1);
    }

    function previewMint(
        uint256 sharesToMint
    ) external view virtual returns (uint256 amount0, uint256 amount1) {
        if (!initialized) return (0, 0);
        (amount0, amount1) = _previewMintInPosition(sharesToMint);
    }

    function previewWithdraw(
        uint256 amount0,
        uint256 amount1
    ) external view virtual returns (uint256 sharesNeeded) {
        if (!initialized) return 0;
        sharesNeeded = _previewWithdrawInPosition(amount0, amount1);
    }

    function previewRedeem(
        uint256 sharesToRedeem
    ) external view virtual returns (uint256 amount0, uint256 amount1) {
        if (!initialized) return (0, 0);
        (amount0, amount1) = _previewRedeemInPosition(sharesToRedeem);
    }

    // ============ Actions ============

    function deposit(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) external virtual nonReentrant whenInitialized returns (uint256 sharesOut) {
        sharesOut = _depositInPosition(amount0, amount1, receiver);
    }

    function mint(
        uint256 sharesToMint,
        address receiver
    )
        external
        virtual
        nonReentrant
        whenInitialized
        returns (uint256 amount0, uint256 amount1)
    {
        if (sharesToMint == 0) revert ZeroAmount();
        (amount0, amount1) = _mintInPosition(sharesToMint, receiver);
    }

    function withdraw(
        uint256 amount0,
        uint256 amount1,
        address receiver,
        address owner
    ) external virtual nonReentrant whenInitialized returns (uint256 sharesBurned) {
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();

        // Check approval if caller is not owner
        if (msg.sender != owner) {
            revert Unauthorized();
        }

        sharesBurned = _withdrawInPosition(amount0, amount1, receiver, owner);
    }

    function redeem(
        uint256 sharesToRedeem,
        address receiver,
        address owner
    )
        external
        virtual
        nonReentrant
        whenInitialized
        returns (uint256 amount0, uint256 amount1)
    {
        if (sharesToRedeem == 0) revert ZeroAmount();

        // Check approval if caller is not owner
        if (msg.sender != owner) {
            revert Unauthorized();
        }

        (amount0, amount1) = _redeemInPosition(sharesToRedeem, receiver, owner);
    }
}
