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
import {AllowlistBase} from "./base/AllowlistBase.sol";

/// @title HedgeVault
/// @notice A dual-asset vault for hedged liquidity positions
contract HedgeVault is ITokenPairVault, AllowlistBase {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum VaultState {
        UNINITIALIZED,
        IN_POSITION,
        IN_ASSET0,
        IN_ASSET1,
        CLOSED
    }

    // ============ Errors ============

    error ZeroAddress();
    error Unauthorized();
    error EmptyPosition();
    error InvalidState();
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

    /// @notice The operator address (can execute vault operations)
    address public immutable operator;

    /// @notice The manager address (deployer, has admin rights)
    address public immutable manager;

    // ============ Constants ============

    /// @notice Precision for fee per share calculations
    uint256 private constant ACC_PRECISION = 1e18;

    /// @notice Basis points denominator (100% = 10000)
    uint256 private constant BPS_DENOMINATOR = 10000;

    // ============ State ============

    /// @notice Current state of the vault
    VaultState public currentState;

    /// @notice The Uniswap V3 position NFT ID
    uint256 public positionId;

    /// @notice Lower tick of the position range
    int24 public tickLower;

    /// @notice Upper tick of the position range
    int24 public tickUpper;

    /// @notice Upper sqrtPrice trigger (disabled when set to type(uint160).max)
    uint160 public triggerPriceUpper = type(uint160).max;

    /// @notice Lower sqrtPrice trigger (disabled when set to 0)
    uint160 public triggerPriceLower = 0;

    /// @notice Whether the vault is paused
    bool public paused;

    /// @notice Slippage tolerance for deposits in basis points (default 1% = 100)
    uint256 public depositSlippageBps = 100;

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

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert Unauthorized();
        _;
    }

    modifier onlyManagerOrOperator() {
        if (msg.sender != manager && msg.sender != operator) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    constructor(address positionManager_, uint256 positionId_, address operator_) {
        if (positionManager_ == address(0)) revert ZeroAddress();
        if (operator_ == address(0)) revert ZeroAddress();

        positionManager = positionManager_;
        positionId = positionId_;
        operator = operator_;
        manager = msg.sender;

        INonfungiblePositionManager pm = INonfungiblePositionManager(positionManager_);

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

        address pool_ = IUniswapV3Factory(factory_).getPool(token0, token1, fee);
        if (pool_ == address(0)) revert ZeroAddress();
        pool = pool_;

        // Initialize allowlist: enabled with manager allowlisted
        _allowlistEnabled = true;
        _allowlist[msg.sender] = true;
    }

    // ============ Asset Getters ============

    function asset0() external view returns (address) {
        return _asset0;
    }

    function asset1() external view returns (address) {
        return _asset1;
    }

    // ============ Manager Functions ============

    function init(uint256 initialShares) external onlyManager {
        if (initialShares == 0) revert ZeroAmount();
        (uint256 amount0, uint256 amount1) = _getPositionAmounts();
        if (amount0 == 0 && amount1 == 0) revert EmptyPosition();

        INonfungiblePositionManager(positionManager).transferFrom(msg.sender, address(this), positionId);
        currentState = VaultState.IN_POSITION;

        totalShares = initialShares;
        shares[msg.sender] = initialShares;
        feeDebt0[msg.sender] = 0;
        feeDebt1[msg.sender] = 0;
    }

    function setTriggerPriceUpper(uint160 price) external onlyManager {
        triggerPriceUpper = price;
    }

    function setTriggerPriceLower(uint160 price) external onlyManager {
        triggerPriceLower = price;
    }

    function setPaused(bool _paused) external onlyManager {
        paused = _paused;
    }

    function setDepositSlippageBps(uint256 _depositSlippageBps) external onlyManager {
        require(_depositSlippageBps <= BPS_DENOMINATOR, "Invalid slippage");
        depositSlippageBps = _depositSlippageBps;
    }

    // ============ Allowlist Management ============

    function allowlistEnabled() external view returns (bool) {
        return _isAllowlistEnabled();
    }

    function isAllowlisted(address account) external view returns (bool) {
        return _isAllowlisted(account);
    }

    function setAllowlistEnabled(bool enabled) external onlyManager {
        _setAllowlistEnabled(enabled);
    }

    function addToAllowlist(address[] calldata accounts) external onlyManager {
        _addToAllowlist(accounts);
    }

    function removeFromAllowlist(address[] calldata accounts) external onlyManager {
        _removeFromAllowlist(accounts);
    }

    // ============ Fee Collection ============

    /// @notice View pending fees for an account
    /// @param account The account to check
    /// @return pending0 Pending token0 fees
    /// @return pending1 Pending token1 fees
    function pendingFees(address account) external view returns (uint256 pending0, uint256 pending1) {
        uint256 userShares = shares[account];
        if (userShares > 0) {
            pending0 = (accFeePerShare0 * userShares / ACC_PRECISION) - feeDebt0[account];
            pending1 = (accFeePerShare1 * userShares / ACC_PRECISION) - feeDebt1[account];
        }
    }

    /// @notice Collect fees for the caller
    /// @return collected0 Amount of token0 fees collected
    /// @return collected1 Amount of token1 fees collected
    function collectFees() external returns (uint256 collected0, uint256 collected1) {
        _requireAllowlisted(msg.sender);

        uint256 userShares = shares[msg.sender];
        require(userShares > 0, "No shares");

        // Collect position fees to vault
        (uint256 positionFees0, uint256 positionFees1) = _collectPositionFees();

        // Update fee accumulators
        _updateFeeAccumulators(positionFees0, positionFees1);

        // Calculate user's pending fees
        collected0 = (accFeePerShare0 * userShares / ACC_PRECISION) - feeDebt0[msg.sender];
        collected1 = (accFeePerShare1 * userShares / ACC_PRECISION) - feeDebt1[msg.sender];

        // Update user's fee debt
        feeDebt0[msg.sender] = accFeePerShare0 * userShares / ACC_PRECISION;
        feeDebt1[msg.sender] = accFeePerShare1 * userShares / ACC_PRECISION;

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

    function _getPositionAmounts() internal view returns (uint256 amount0, uint256 amount1) {
        // Get liquidity from position (may fail if position was burned)
        try INonfungiblePositionManager(positionManager).positions(positionId) returns (
            uint96, address, address, address, uint24, int24, int24, uint128 liquidity, uint256, uint256, uint128, uint128
        ) {
            // Calculate amounts in position if liquidity exists
            if (liquidity > 0) {
                (uint160 sqrtPriceX96,,,,,, ) = IUniswapV3PoolMinimal(pool).slot0();
                (amount0, amount1) = UniswapV3Math.getAmountsForLiquidity(
                    sqrtPriceX96,
                    tickLower,
                    tickUpper,
                    liquidity
                );
            }
        } catch {}
    }

    function _getVaultBalances() internal view returns (uint256 balance0, uint256 balance1) {
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

    function _collectPositionFees() internal returns (uint256 collected0, uint256 collected1) {
        (collected0, collected1) = INonfungiblePositionManager(positionManager).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
    }

    function _updateFeeAccumulators(uint256 collected0, uint256 collected1) internal {
        if (totalShares > 0) {
            accFeePerShare0 += (collected0 * ACC_PRECISION) / totalShares;
            accFeePerShare1 += (collected1 * ACC_PRECISION) / totalShares;
        }
    }

    // ============ Internal Deposit Helpers ============

    function _depositInPosition(uint256 amount0, uint256 amount1, address receiver) internal returns (uint256 sharesOut) {
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();

        // Transfer tokens from user
        if (amount0 > 0) IERC20(_asset0).safeTransferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) IERC20(_asset1).safeTransferFrom(msg.sender, address(this), amount1);

        // Get current liquidity before
        (,,,,,,, uint128 liquidityBefore,,,,) = INonfungiblePositionManager(positionManager).positions(positionId);

        // Approve position manager
        IERC20(_asset0).safeApprove(positionManager, amount0);
        IERC20(_asset1).safeApprove(positionManager, amount1);

        // Calculate min amounts with slippage
        uint256 amount0Min = amount0 * (BPS_DENOMINATOR - depositSlippageBps) / BPS_DENOMINATOR;
        uint256 amount1Min = amount1 * (BPS_DENOMINATOR - depositSlippageBps) / BPS_DENOMINATOR;

        // Increase liquidity
        (uint128 liquidityAdded, uint256 used0, uint256 used1) = INonfungiblePositionManager(positionManager).increaseLiquidity(
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
        sharesOut = uint256(liquidityAdded) * totalShares / uint256(liquidityBefore);

        // Update share accounting
        totalShares += sharesOut;
        shares[receiver] += sharesOut;

        // Add fee debt for new shares (preserves pending fees from existing shares)
        feeDebt0[receiver] += accFeePerShare0 * sharesOut / ACC_PRECISION;
        feeDebt1[receiver] += accFeePerShare1 * sharesOut / ACC_PRECISION;

        // Return unused tokens
        uint256 refund0 = amount0 - used0;
        uint256 refund1 = amount1 - used1;
        if (refund0 > 0) IERC20(_asset0).safeTransfer(msg.sender, refund0);
        if (refund1 > 0) IERC20(_asset1).safeTransfer(msg.sender, refund1);
    }

    function _depositInAsset0(uint256 amount0, address receiver) internal returns (uint256 sharesOut) {
        if (amount0 == 0) revert ZeroAmount();

        // Get vault balance before
        uint256 balanceBefore = IERC20(_asset0).balanceOf(address(this));

        // Transfer tokens
        IERC20(_asset0).safeTransferFrom(msg.sender, address(this), amount0);

        // Calculate shares: newShares = amount0 * totalShares / balanceBefore
        sharesOut = amount0 * totalShares / balanceBefore;

        // Update share accounting
        totalShares += sharesOut;
        shares[receiver] += sharesOut;

        // Add fee debt for new shares (preserves pending fees from existing shares)
        feeDebt0[receiver] += accFeePerShare0 * sharesOut / ACC_PRECISION;
        feeDebt1[receiver] += accFeePerShare1 * sharesOut / ACC_PRECISION;
    }

    function _depositInAsset1(uint256 amount1, address receiver) internal returns (uint256 sharesOut) {
        if (amount1 == 0) revert ZeroAmount();

        // Get vault balance before
        uint256 balanceBefore = IERC20(_asset1).balanceOf(address(this));

        // Transfer tokens
        IERC20(_asset1).safeTransferFrom(msg.sender, address(this), amount1);

        // Calculate shares: newShares = amount1 * totalShares / balanceBefore
        sharesOut = amount1 * totalShares / balanceBefore;

        // Update share accounting
        totalShares += sharesOut;
        shares[receiver] += sharesOut;

        // Add fee debt for new shares
        feeDebt0[receiver] += accFeePerShare0 * sharesOut / ACC_PRECISION;
        feeDebt1[receiver] += accFeePerShare1 * sharesOut / ACC_PRECISION;
    }

    // ============ Internal Mint Helpers ============

    function _mintInPosition(uint256 sharesToMint, address receiver) internal returns (uint256 amount0, uint256 amount1) {
        (,,,,,,, uint128 liquidityBefore,,,,) = INonfungiblePositionManager(positionManager).positions(positionId);

        // Calculate target liquidity for exact shares
        uint128 liquidityRequired = uint128(sharesToMint * uint256(liquidityBefore) / totalShares);

        // Get amounts for that liquidity
        (uint160 sqrtPriceX96,,,,,, ) = IUniswapV3PoolMinimal(pool).slot0();
        (uint256 amount0Needed, uint256 amount1Needed) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            tickLower,
            tickUpper,
            liquidityRequired
        );

        // Add buffer for rounding (use depositSlippageBps)
        uint256 amount0WithBuffer = amount0Needed * (BPS_DENOMINATOR + depositSlippageBps) / BPS_DENOMINATOR;
        uint256 amount1WithBuffer = amount1Needed * (BPS_DENOMINATOR + depositSlippageBps) / BPS_DENOMINATOR;

        // Transfer buffered amounts
        if (amount0WithBuffer > 0) IERC20(_asset0).safeTransferFrom(msg.sender, address(this), amount0WithBuffer);
        if (amount1WithBuffer > 0) IERC20(_asset1).safeTransferFrom(msg.sender, address(this), amount1WithBuffer);

        // Approve and increase liquidity
        IERC20(_asset0).safeApprove(positionManager, amount0WithBuffer);
        IERC20(_asset1).safeApprove(positionManager, amount1WithBuffer);

        (, uint256 used0, uint256 used1) = INonfungiblePositionManager(positionManager).increaseLiquidity(
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
        feeDebt0[receiver] += accFeePerShare0 * sharesToMint / ACC_PRECISION;
        feeDebt1[receiver] += accFeePerShare1 * sharesToMint / ACC_PRECISION;

        // Refund unused
        uint256 refund0 = amount0WithBuffer - used0;
        uint256 refund1 = amount1WithBuffer - used1;
        if (refund0 > 0) IERC20(_asset0).safeTransfer(msg.sender, refund0);
        if (refund1 > 0) IERC20(_asset1).safeTransfer(msg.sender, refund1);

        amount0 = used0;
        amount1 = used1;
    }

    function _mintInAsset0(uint256 sharesToMint, address receiver) internal returns (uint256 amount0) {
        uint256 balance = IERC20(_asset0).balanceOf(address(this));
        amount0 = sharesToMint * balance / totalShares;

        IERC20(_asset0).safeTransferFrom(msg.sender, address(this), amount0);

        totalShares += sharesToMint;
        shares[receiver] += sharesToMint;
        feeDebt0[receiver] += accFeePerShare0 * sharesToMint / ACC_PRECISION;
        feeDebt1[receiver] += accFeePerShare1 * sharesToMint / ACC_PRECISION;
    }

    function _mintInAsset1(uint256 sharesToMint, address receiver) internal returns (uint256 amount1) {
        uint256 balance = IERC20(_asset1).balanceOf(address(this));
        amount1 = sharesToMint * balance / totalShares;

        IERC20(_asset1).safeTransferFrom(msg.sender, address(this), amount1);

        totalShares += sharesToMint;
        shares[receiver] += sharesToMint;
        feeDebt0[receiver] += accFeePerShare0 * sharesToMint / ACC_PRECISION;
        feeDebt1[receiver] += accFeePerShare1 * sharesToMint / ACC_PRECISION;
    }

    // ============ Internal Preview Helpers ============

    function _previewDepositInPosition(uint256 amount0, uint256 amount1) internal view returns (uint256 sharesOut) {
        if (amount0 == 0 && amount1 == 0) return 0;

        // Get current pool price
        (uint160 sqrtPriceX96,,,,,, ) = IUniswapV3PoolMinimal(pool).slot0();

        // Get current position liquidity
        (,,,,,,, uint128 liquidityBefore,,,,) = INonfungiblePositionManager(positionManager).positions(positionId);
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
        sharesOut = uint256(expectedLiquidity) * totalShares / uint256(liquidityBefore);
    }

    function _previewDepositInAsset0(uint256 amount0) internal view returns (uint256 sharesOut) {
        if (amount0 == 0) return 0;
        uint256 balance = IERC20(_asset0).balanceOf(address(this));
        if (balance == 0) return 0;
        sharesOut = amount0 * totalShares / balance;
    }

    function _previewDepositInAsset1(uint256 amount1) internal view returns (uint256 sharesOut) {
        if (amount1 == 0) return 0;
        uint256 balance = IERC20(_asset1).balanceOf(address(this));
        if (balance == 0) return 0;
        sharesOut = amount1 * totalShares / balance;
    }

    // ============ Internal Preview Mint Helpers ============

    function _previewMintInPosition(uint256 sharesToMint) internal view returns (uint256 amount0, uint256 amount1) {
        if (sharesToMint == 0 || totalShares == 0) return (0, 0);

        (uint160 sqrtPriceX96,,,,,, ) = IUniswapV3PoolMinimal(pool).slot0();
        (,,,,,,, uint128 liquidityBefore,,,,) = INonfungiblePositionManager(positionManager).positions(positionId);
        if (liquidityBefore == 0) return (0, 0);

        uint128 liquidityRequired = uint128(sharesToMint * uint256(liquidityBefore) / totalShares);

        (amount0, amount1) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            tickLower,
            tickUpper,
            liquidityRequired
        );
    }

    function _previewMintInAsset0(uint256 sharesToMint) internal view returns (uint256 amount0) {
        if (sharesToMint == 0 || totalShares == 0) return 0;
        uint256 balance = IERC20(_asset0).balanceOf(address(this));
        amount0 = sharesToMint * balance / totalShares;
    }

    function _previewMintInAsset1(uint256 sharesToMint) internal view returns (uint256 amount1) {
        if (sharesToMint == 0 || totalShares == 0) return 0;
        uint256 balance = IERC20(_asset1).balanceOf(address(this));
        amount1 = sharesToMint * balance / totalShares;
    }

    function convertToShares(
        uint256 amount0,
        uint256 amount1
    ) external view returns (uint256 sharesOut) {
        if (currentState == VaultState.IN_POSITION) {
            sharesOut = _previewDepositInPosition(amount0, amount1);
        } else if (currentState == VaultState.IN_ASSET0) {
            sharesOut = _previewDepositInAsset0(amount0);
        } else if (currentState == VaultState.IN_ASSET1) {
            sharesOut = _previewDepositInAsset1(amount1);
        }
        // Returns 0 for UNINITIALIZED/CLOSED
    }

    function convertToAssets(
        uint256 sharesToConvert
    ) external view returns (uint256 amount0, uint256 amount1) {
        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewMintInPosition(sharesToConvert);
        } else if (currentState == VaultState.IN_ASSET0) {
            amount0 = _previewMintInAsset0(sharesToConvert);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _previewMintInAsset1(sharesToConvert);
        }
        // Returns (0,0) for UNINITIALIZED/CLOSED
    }

    // ============ Limits ============

    function maxDeposit(
        address
    ) external view returns (uint256 amount0, uint256 amount1) {
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            return (0, 0);
        }
        return (type(uint256).max, type(uint256).max);
    }

    function maxMint(address) external view returns (uint256 maxShares) {
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            return 0;
        }
        return type(uint256).max;
    }

    function maxWithdraw(
        address owner
    ) external view returns (uint256 amount0, uint256 amount1) {
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            return (0, 0);
        }

        uint256 ownerShares = shares[owner];
        if (ownerShares == 0) return (0, 0);

        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewMintInPosition(ownerShares);
        } else if (currentState == VaultState.IN_ASSET0) {
            amount0 = _previewMintInAsset0(ownerShares);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _previewMintInAsset1(ownerShares);
        }
    }

    function maxRedeem(address owner) external view returns (uint256 maxShares) {
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            return 0;
        }
        return shares[owner];
    }

    // ============ Previews ============

    function previewDeposit(
        uint256 amount0,
        uint256 amount1
    ) external view returns (uint256 sharesOut) {
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            return 0;
        }

        if (currentState == VaultState.IN_POSITION) {
            sharesOut = _previewDepositInPosition(amount0, amount1);
        } else if (currentState == VaultState.IN_ASSET0) {
            sharesOut = _previewDepositInAsset0(amount0);
        } else if (currentState == VaultState.IN_ASSET1) {
            sharesOut = _previewDepositInAsset1(amount1);
        }
    }

    function previewMint(
        uint256 sharesToMint
    ) external view returns (uint256 amount0, uint256 amount1) {
        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewMintInPosition(sharesToMint);
        } else if (currentState == VaultState.IN_ASSET0) {
            amount0 = _previewMintInAsset0(sharesToMint);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _previewMintInAsset1(sharesToMint);
        }
        // Returns (0,0) for UNINITIALIZED/CLOSED
    }

    function previewWithdraw(
        uint256,
        uint256
    ) external view returns (uint256 shares) {
        revert("not implemented yet");
    }

    function previewRedeem(
        uint256
    ) external view returns (uint256 amount0, uint256 amount1) {
        revert("not implemented yet");
    }

    // ============ Actions ============

    function deposit(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) external returns (uint256 sharesOut) {
        _requireAllowlisted(msg.sender);

        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
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

    function mint(
        uint256 sharesToMint,
        address receiver
    ) external returns (uint256 amount0, uint256 amount1) {
        _requireAllowlisted(msg.sender);

        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
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

    function withdraw(
        uint256,
        uint256,
        address,
        address
    ) external returns (uint256 shares) {
        revert("not implemented yet");
    }

    function redeem(
        uint256,
        address,
        address
    ) external returns (uint256 amount0, uint256 amount1) {
        revert("not implemented yet");
    }
}
