// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UniswapV3PositionVault} from "./UniswapV3PositionVault.sol";
import {ParaswapHelper} from "./base/ParaswapHelper.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3PoolMinimal} from "./interfaces/IUniswapV3PoolMinimal.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";
import {UniswapV3Math} from "./libraries/UniswapV3Math.sol";
import {TickMath} from "./libraries/TickMath.sol";

/// @title HedgeVault
/// @notice A dual-asset vault with hedging state machine for liquidity positions
/// @dev Extends UniswapV3PositionVault with hedging functionality (state transitions to be added later)
contract HedgeVault is UniswapV3PositionVault, ParaswapHelper {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum VaultState {
        UNINITIALIZED,
        IN_POSITION,
        IN_ASSET0,
        IN_ASSET1,
        CLOSED
    }

    // ============ Structs ============

    /// @notice Parameters for Paraswap swap execution
    /// @param minBuyAmount Minimum amount of destination token to receive
    /// @param swapCalldata Encoded swap data: abi.encode(augustus, calldata)
    struct SwapSellParams {
        uint256 minBuyAmount;
        bytes swapCalldata;
    }

    // ============ Errors ============

    error InvalidState();

    // ============ Immutables ============

    /// @notice The operator address (can execute vault operations)
    address public immutable operator;

    // ============ State ============

    /// @notice Current state of the vault
    VaultState public currentState;

    /// @notice Upper sqrtPrice trigger (disabled when set to type(uint160).max)
    uint160 public triggerPriceUpper = type(uint160).max;

    /// @notice Lower sqrtPrice trigger (disabled when set to 0)
    uint160 public triggerPriceLower = 0;

    /// @notice Whether the vault is paused
    bool public paused;

    /// @notice Slippage tolerance for exiting position (in basis points, 100 = 1%)
    uint256 public exitPositionSlippageBps = 100;

    /// @notice Slippage tolerance for entering position (in basis points, 100 = 1%)
    uint256 public enterPositionSlippageBps = 100;

    // ============ Modifiers ============

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    modifier onlyManagerOrOperator() {
        if (msg.sender != manager && msg.sender != operator)
            revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Vault paused");
        _;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    constructor(
        address positionManager_,
        uint256 positionId_,
        address operator_,
        address augustusRegistry_,
        string memory name_,
        string memory symbol_
    ) UniswapV3PositionVault(positionManager_, positionId_, name_, symbol_) ParaswapHelper(augustusRegistry_) {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    // ============ Manager Functions ============

    function init(uint256 initialShares) public override {
        if (initialized) revert AlreadyInitialized();

        // Call parent initialization logic
        super.init(initialShares);

        // Set hedging state
        currentState = VaultState.IN_POSITION;
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

    /// @notice Set the slippage tolerance for exiting positions
    /// @param slippageBps Slippage in basis points (100 = 1%, max 1000 = 10%)
    function setExitPositionSlippageBps(uint256 slippageBps) external onlyManager {
        require(slippageBps <= 1000, "Slippage too high");
        exitPositionSlippageBps = slippageBps;
    }

    /// @notice Set the slippage tolerance for entering positions
    /// @param slippageBps Slippage in basis points (100 = 1%, max 1000 = 10%)
    function setEnterPositionSlippageBps(uint256 slippageBps) external onlyManager {
        require(slippageBps <= 1000, "Slippage too high");
        enterPositionSlippageBps = slippageBps;
    }

    // ============ Internal Deposit Helpers (Asset-Only States) ============

    function _depositInAsset0(
        uint256 amount0,
        address receiver
    ) internal returns (uint256 sharesOut) {
        if (amount0 == 0) revert ZeroAmount();

        // Get vault balance before (excluding reserved fees)
        (uint256 balanceBefore, ) = _getVaultBalances();

        // Transfer tokens
        IERC20(_asset0).safeTransferFrom(msg.sender, address(this), amount0);

        // Calculate shares: newShares = amount0 * totalShares / balanceBefore
        sharesOut = (amount0 * totalShares) / balanceBefore;

        // Mint shares to receiver
        _mint(receiver, sharesOut);
    }

    function _depositInAsset1(
        uint256 amount1,
        address receiver
    ) internal returns (uint256 sharesOut) {
        if (amount1 == 0) revert ZeroAmount();

        // Get vault balance before (excluding reserved fees)
        (, uint256 balanceBefore) = _getVaultBalances();

        // Transfer tokens
        IERC20(_asset1).safeTransferFrom(msg.sender, address(this), amount1);

        // Calculate shares: newShares = amount1 * totalShares / balanceBefore
        sharesOut = (amount1 * totalShares) / balanceBefore;

        // Mint shares to receiver
        _mint(receiver, sharesOut);
    }

    // ============ Internal Mint Helpers (Asset-Only States) ============

    function _mintInAsset0(
        uint256 sharesToMint,
        address receiver
    ) internal returns (uint256 amount0) {
        (uint256 balance, ) = _getVaultBalances(); // Excludes reserved fees
        amount0 = (sharesToMint * balance) / totalShares;

        IERC20(_asset0).safeTransferFrom(msg.sender, address(this), amount0);

        _mint(receiver, sharesToMint);
    }

    function _mintInAsset1(
        uint256 sharesToMint,
        address receiver
    ) internal returns (uint256 amount1) {
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        amount1 = (sharesToMint * balance) / totalShares;

        IERC20(_asset1).safeTransferFrom(msg.sender, address(this), amount1);

        _mint(receiver, sharesToMint);
    }

    // ============ Internal Preview Helpers (Asset-Only States) ============

    function _previewDepositInAsset0(
        uint256 amount0
    ) internal view returns (uint256 sharesOut) {
        if (amount0 == 0) return 0;
        (uint256 balance, ) = _getVaultBalances(); // Excludes reserved fees
        if (balance == 0) return 0;
        sharesOut = (amount0 * totalShares) / balance;
    }

    function _previewDepositInAsset1(
        uint256 amount1
    ) internal view returns (uint256 sharesOut) {
        if (amount1 == 0) return 0;
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        if (balance == 0) return 0;
        sharesOut = (amount1 * totalShares) / balance;
    }

    function _previewMintInAsset0(
        uint256 sharesToMint
    ) internal view returns (uint256 amount0) {
        if (sharesToMint == 0 || totalShares == 0) return 0;
        (uint256 balance, ) = _getVaultBalances(); // Excludes reserved fees
        amount0 = (sharesToMint * balance) / totalShares;
    }

    function _previewMintInAsset1(
        uint256 sharesToMint
    ) internal view returns (uint256 amount1) {
        if (sharesToMint == 0 || totalShares == 0) return 0;
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        amount1 = (sharesToMint * balance) / totalShares;
    }

    function _previewWithdrawInAsset0(
        uint256 amount0
    ) internal view returns (uint256 sharesNeeded) {
        if (amount0 == 0 || totalShares == 0) return 0;
        (uint256 balance, ) = _getVaultBalances(); // Excludes reserved fees
        if (balance == 0) return 0;
        sharesNeeded = (amount0 * totalShares) / balance;
    }

    function _previewWithdrawInAsset1(
        uint256 amount1
    ) internal view returns (uint256 sharesNeeded) {
        if (amount1 == 0 || totalShares == 0) return 0;
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        if (balance == 0) return 0;
        sharesNeeded = (amount1 * totalShares) / balance;
    }

    function _previewRedeemInAsset0(
        uint256 sharesToRedeem
    ) internal view returns (uint256 amount0) {
        if (sharesToRedeem == 0 || totalShares == 0) return 0;
        (uint256 balance, ) = _getVaultBalances();
        amount0 = (sharesToRedeem * balance) / totalShares;
    }

    function _previewRedeemInAsset1(
        uint256 sharesToRedeem
    ) internal view returns (uint256 amount1) {
        if (sharesToRedeem == 0 || totalShares == 0) return 0;
        (, uint256 balance) = _getVaultBalances();
        amount1 = (sharesToRedeem * balance) / totalShares;
    }

    // ============ Internal Withdraw Helpers (Asset-Only States) ============

    function _withdrawInAsset0(
        uint256 amount0,
        address receiver,
        address owner
    ) internal returns (uint256 sharesBurned) {
        (uint256 balance, ) = _getVaultBalances(); // Excludes reserved fees
        sharesBurned = (amount0 * totalShares) / balance;

        _burn(owner, sharesBurned);

        IERC20(_asset0).safeTransfer(receiver, amount0);
    }

    function _withdrawInAsset1(
        uint256 amount1,
        address receiver,
        address owner
    ) internal returns (uint256 sharesBurned) {
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        sharesBurned = (amount1 * totalShares) / balance;

        _burn(owner, sharesBurned);

        IERC20(_asset1).safeTransfer(receiver, amount1);
    }

    // ============ Internal Redeem Helpers (Asset-Only States) ============

    function _redeemInAsset0(
        uint256 sharesToRedeem,
        address receiver,
        address owner
    ) internal returns (uint256 amount0) {
        require(shares[owner] >= sharesToRedeem, "Insufficient shares");

        (uint256 balance, ) = _getVaultBalances();
        amount0 = (sharesToRedeem * balance) / totalShares;

        _burn(owner, sharesToRedeem);

        IERC20(_asset0).safeTransfer(receiver, amount0);
    }

    function _redeemInAsset1(
        uint256 sharesToRedeem,
        address receiver,
        address owner
    ) internal returns (uint256 amount1) {
        require(shares[owner] >= sharesToRedeem, "Insufficient shares");

        (, uint256 balance) = _getVaultBalances();
        amount1 = (sharesToRedeem * balance) / totalShares;

        _burn(owner, sharesToRedeem);

        IERC20(_asset1).safeTransfer(receiver, amount1);
    }

    // ============ Conversions (Override with state routing) ============

    function convertToShares(
        uint256 amount0,
        uint256 amount1
    ) external view override returns (uint256 sharesOut) {
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
    ) external view override returns (uint256 amount0, uint256 amount1) {
        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewMintInPosition(sharesToConvert);
        } else if (currentState == VaultState.IN_ASSET0) {
            amount0 = _previewMintInAsset0(sharesToConvert);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _previewMintInAsset1(sharesToConvert);
        }
        // Returns (0,0) for UNINITIALIZED/CLOSED
    }

    // ============ Limits (Override with state routing) ============

    function maxDeposit(
        address
    ) external view override returns (uint256 amount0, uint256 amount1) {
        if (
            currentState == VaultState.UNINITIALIZED ||
            currentState == VaultState.CLOSED
        ) {
            return (0, 0);
        }
        return (type(uint256).max, type(uint256).max);
    }

    function maxMint(
        address
    ) external view override returns (uint256 maxShares) {
        if (
            currentState == VaultState.UNINITIALIZED ||
            currentState == VaultState.CLOSED
        ) {
            return 0;
        }
        return type(uint256).max;
    }

    function maxWithdraw(
        address owner
    ) external view override returns (uint256 amount0, uint256 amount1) {
        if (currentState == VaultState.UNINITIALIZED) {
            return (0, 0);
        }

        uint256 ownerShares = shares[owner];
        if (ownerShares == 0) return (0, 0);

        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewMintInPosition(ownerShares);
        } else if (currentState == VaultState.IN_ASSET0 || currentState == VaultState.CLOSED) {
            amount0 = _previewMintInAsset0(ownerShares);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _previewMintInAsset1(ownerShares);
        }
    }

    function maxRedeem(
        address owner
    ) external view override returns (uint256 maxShares) {
        if (currentState == VaultState.UNINITIALIZED) {
            return 0;
        }
        return shares[owner];
    }

    // ============ Previews (Override with state routing) ============

    function previewDeposit(
        uint256 amount0,
        uint256 amount1
    ) external view override returns (uint256 sharesOut) {
        if (
            currentState == VaultState.UNINITIALIZED ||
            currentState == VaultState.CLOSED
        ) {
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
    ) external view override returns (uint256 amount0, uint256 amount1) {
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
        uint256 amount0,
        uint256 amount1
    ) external view override returns (uint256 sharesNeeded) {
        if (currentState == VaultState.IN_POSITION) {
            sharesNeeded = _previewWithdrawInPosition(amount0, amount1);
        } else if (currentState == VaultState.IN_ASSET0 || currentState == VaultState.CLOSED) {
            sharesNeeded = _previewWithdrawInAsset0(amount0);
        } else if (currentState == VaultState.IN_ASSET1) {
            sharesNeeded = _previewWithdrawInAsset1(amount1);
        }
        // Returns 0 for UNINITIALIZED
    }

    function previewRedeem(
        uint256 sharesToRedeem
    ) external view override returns (uint256 amount0, uint256 amount1) {
        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewRedeemInPosition(sharesToRedeem);
        } else if (currentState == VaultState.IN_ASSET0 || currentState == VaultState.CLOSED) {
            amount0 = _previewRedeemInAsset0(sharesToRedeem);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _previewRedeemInAsset1(sharesToRedeem);
        }
        // Returns (0,0) for UNINITIALIZED
    }

    // ============ Actions (Override with state routing) ============

    function deposit(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) external virtual override nonReentrant whenNotPaused returns (uint256 sharesOut) {
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

    function mint(
        uint256 sharesToMint,
        address receiver
    )
        external
        virtual
        override
        nonReentrant
        whenNotPaused
        returns (uint256 amount0, uint256 amount1)
    {
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

    function withdraw(
        uint256 amount0,
        uint256 amount1,
        address receiver,
        address owner
    )
        external
        virtual
        override
        nonReentrant
        whenNotPaused
        returns (uint256 sharesBurned)
    {
        if (currentState == VaultState.UNINITIALIZED) {
            revert InvalidState();
        }
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();

        // Check approval if caller is not owner
        if (msg.sender != owner) {
            revert Unauthorized();
        }

        if (currentState == VaultState.IN_POSITION) {
            sharesBurned = _withdrawInPosition(
                amount0,
                amount1,
                receiver,
                owner
            );
        } else if (currentState == VaultState.IN_ASSET0 || currentState == VaultState.CLOSED) {
            sharesBurned = _withdrawInAsset0(amount0, receiver, owner);
        } else if (currentState == VaultState.IN_ASSET1) {
            sharesBurned = _withdrawInAsset1(amount1, receiver, owner);
        }
    }

    function redeem(
        uint256 sharesToRedeem,
        address receiver,
        address owner
    )
        external
        virtual
        override
        nonReentrant
        whenNotPaused
        returns (uint256 amount0, uint256 amount1)
    {
        if (currentState == VaultState.UNINITIALIZED) {
            revert InvalidState();
        }
        if (sharesToRedeem == 0) revert ZeroAmount();

        // Check approval if caller is not owner
        if (msg.sender != owner) {
            revert Unauthorized();
        }

        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _redeemInPosition(
                sharesToRedeem,
                receiver,
                owner
            );
        } else if (currentState == VaultState.IN_ASSET0 || currentState == VaultState.CLOSED) {
            amount0 = _redeemInAsset0(sharesToRedeem, receiver, owner);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _redeemInAsset1(sharesToRedeem, receiver, owner);
        }
    }

    // ============ Internal Position Exit Helper ============

    /// @notice Remove all liquidity from the Uniswap V3 position
    /// @dev Collects fees first, then removes all liquidity and collects tokens to vault
    /// @param minAmount0 Minimum amount of token0 to receive (slippage protection)
    /// @param minAmount1 Minimum amount of token1 to receive (slippage protection)
    /// @return amount0 The amount of token0 received
    /// @return amount1 The amount of token1 received
    function _exitPosition(
        uint256 minAmount0,
        uint256 minAmount1
    ) internal returns (uint256 amount0, uint256 amount1) {
        // Collect any pending fees first
        (uint256 fees0, uint256 fees1) = _collectPositionFees();
        _updateFeeAccumulators(fees0, fees1);

        // Get current liquidity
        (, , , , , , , uint128 liquidity, , , , ) = INonfungiblePositionManager(
            positionManager
        ).positions(positionId);

        if (liquidity > 0) {
            (amount0, amount1) = _decreaseLiquidity(
                liquidity,
                minAmount0,
                minAmount1
            );
        }
    }

    // ============ State Transitions ============

    /// @notice Exit to asset0-only state (swap all asset1 to asset0)
    /// @dev Can only be called from IN_POSITION or IN_ASSET1 states
    /// @param swapParams Paraswap swap parameters (minBuyAmount, swapCalldata)
    function exitToAsset0(
        SwapSellParams calldata swapParams
    ) external onlyManagerOrOperator nonReentrant whenNotPaused {
        // Valid transitions: IN_POSITION -> IN_ASSET0, IN_ASSET1 -> IN_ASSET0
        if (
            currentState != VaultState.IN_POSITION &&
            currentState != VaultState.IN_ASSET1
        ) {
            revert InvalidState();
        }

        // If in position, exit the position first
        if (currentState == VaultState.IN_POSITION) {
            // Calculate min amounts with slippage protection
            (uint256 expected0, uint256 expected1) = _getPositionAmounts();
            uint256 minAmount0 = (expected0 * (10000 - exitPositionSlippageBps)) / 10000;
            uint256 minAmount1 = (expected1 * (10000 - exitPositionSlippageBps)) / 10000;
            _exitPosition(minAmount0, minAmount1);
        }

        // Swap all asset1 to asset0
        (, uint256 sellAmount) = _getVaultBalances();
        if (sellAmount > 0) {
            _sellToken(
                _asset1,
                _asset0,
                sellAmount,
                swapParams.minBuyAmount,
                swapParams.swapCalldata
            );
        }

        currentState = VaultState.IN_ASSET0;
    }

    /// @notice Preview the sellAmount (token1) that would be swapped in exitToAsset0
    /// @dev Used by offchain callers to get Paraswap quotes before calling exitToAsset0
    /// @return sellAmount The amount of asset1 that would be sold
    function previewExitToAsset0() external view returns (uint256 sellAmount) {
        // Only valid from IN_POSITION or IN_ASSET1 states
        if (
            currentState != VaultState.IN_POSITION &&
            currentState != VaultState.IN_ASSET1
        ) {
            return 0;
        }

        // Get current vault balance of token1
        (, uint256 vaultBalance1) = _getVaultBalances();

        // If in position, add the amount that would come from exiting the position
        if (currentState == VaultState.IN_POSITION) {
            (, uint256 positionAmount1) = _getPositionAmounts();
            sellAmount = vaultBalance1 + positionAmount1;
        } else {
            // IN_ASSET1 state - just the vault balance
            sellAmount = vaultBalance1;
        }
    }

    /// @notice Exit to asset1-only state (swap all asset0 to asset1)
    /// @dev Can only be called from IN_POSITION or IN_ASSET0 states
    /// @param swapParams Paraswap swap parameters (minBuyAmount, swapCalldata)
    function exitToAsset1(
        SwapSellParams calldata swapParams
    ) external onlyManagerOrOperator nonReentrant whenNotPaused {
        // Valid transitions: IN_POSITION -> IN_ASSET1, IN_ASSET0 -> IN_ASSET1
        if (
            currentState != VaultState.IN_POSITION &&
            currentState != VaultState.IN_ASSET0
        ) {
            revert InvalidState();
        }

        // If in position, exit the position first
        if (currentState == VaultState.IN_POSITION) {
            // Calculate min amounts with slippage protection
            (uint256 expected0, uint256 expected1) = _getPositionAmounts();
            uint256 minAmount0 = (expected0 * (10000 - exitPositionSlippageBps)) / 10000;
            uint256 minAmount1 = (expected1 * (10000 - exitPositionSlippageBps)) / 10000;
            _exitPosition(minAmount0, minAmount1);
        }

        // Swap all asset0 to asset1
        (uint256 sellAmount, ) = _getVaultBalances();
        if (sellAmount > 0) {
            _sellToken(
                _asset0,
                _asset1,
                sellAmount,
                swapParams.minBuyAmount,
                swapParams.swapCalldata
            );
        }

        currentState = VaultState.IN_ASSET1;
    }

    /// @notice Preview the sellAmount (token0) that would be swapped in exitToAsset1
    /// @dev Used by offchain callers to get Paraswap quotes before calling exitToAsset1
    /// @return sellAmount The amount of asset0 that would be sold
    function previewExitToAsset1() external view returns (uint256 sellAmount) {
        // Only valid from IN_POSITION or IN_ASSET0 states
        if (
            currentState != VaultState.IN_POSITION &&
            currentState != VaultState.IN_ASSET0
        ) {
            return 0;
        }

        // Get current vault balance of token0
        (uint256 vaultBalance0, ) = _getVaultBalances();

        // If in position, add the amount that would come from exiting the position
        if (currentState == VaultState.IN_POSITION) {
            (uint256 positionAmount0, ) = _getPositionAmounts();
            sellAmount = vaultBalance0 + positionAmount0;
        } else {
            // IN_ASSET0 state - just the vault balance
            sellAmount = vaultBalance0;
        }
    }

    // ============ Internal Return To Position Helpers ============

    /// @notice Add all available vault balances as liquidity to the position
    /// @dev Calculates the maximum liquidity that fits given both token balances,
    ///      then computes the exact amounts needed for that liquidity
    function _addLiquidityFromBalances() internal {
        (uint256 balance0, uint256 balance1) = _getVaultBalances();
        if (balance0 == 0 && balance1 == 0) return;

        // Get current pool price and tick boundaries
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        // Calculate the maximum liquidity that fits given both balances
        // This takes min(liquidityFromAmount0, liquidityFromAmount1)
        uint128 liquidity = UniswapV3Math.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtRatioAX96,
            sqrtRatioBX96,
            balance0,
            balance1
        );

        if (liquidity == 0) return;

        // Calculate the exact amounts needed for this liquidity
        (uint256 amount0, uint256 amount1) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            tickLower,
            tickUpper,
            liquidity
        );

        if (amount0 == 0 && amount1 == 0) return;

        // Calculate min amounts with slippage protection
        uint256 minAmount0 = (amount0 * (10000 - enterPositionSlippageBps)) / 10000;
        uint256 minAmount1 = (amount1 * (10000 - enterPositionSlippageBps)) / 10000;

        IERC20(_asset0).safeApprove(positionManager, amount0);
        IERC20(_asset1).safeApprove(positionManager, amount1);

        INonfungiblePositionManager(positionManager).increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: positionId,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: minAmount0,
                amount1Min: minAmount1,
                deadline: block.timestamp
            })
        );

        IERC20(_asset0).safeApprove(positionManager, 0);
        IERC20(_asset1).safeApprove(positionManager, 0);
    }

    /// @notice Internal helper to return to position from IN_ASSET0 state
    /// @param swapParams Paraswap swap parameters for token0 -> token1 swap
    function _returnToPositionFromAsset0(
        SwapSellParams calldata swapParams
    ) internal {
        (uint256 balance0, ) = _getVaultBalances();
        if (balance0 == 0) return;

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        uint256 swapAmount = UniswapV3Math.computeIdealSwapAmountSingleSided(
            balance0,
            sqrtPriceX96,
            sqrtRatioAX96,
            sqrtRatioBX96,
            UniswapV3Math.SingleSidedInput.TOKEN0_ONLY
        );

        if (swapAmount > 0) {
            _sellToken(
                _asset0,
                _asset1,
                swapAmount,
                swapParams.minBuyAmount,
                swapParams.swapCalldata
            );
        }

        _addLiquidityFromBalances();
    }

    /// @notice Internal helper to return to position from IN_ASSET1 state
    /// @param swapParams Paraswap swap parameters for token1 -> token0 swap
    function _returnToPositionFromAsset1(
        SwapSellParams calldata swapParams
    ) internal {
        (, uint256 balance1) = _getVaultBalances();
        if (balance1 == 0) return;

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        uint256 swapAmount = UniswapV3Math.computeIdealSwapAmountSingleSided(
            balance1,
            sqrtPriceX96,
            sqrtRatioAX96,
            sqrtRatioBX96,
            UniswapV3Math.SingleSidedInput.TOKEN1_ONLY
        );

        if (swapAmount > 0) {
            _sellToken(
                _asset1,
                _asset0,
                swapAmount,
                swapParams.minBuyAmount,
                swapParams.swapCalldata
            );
        }

        _addLiquidityFromBalances();
    }

    /// @notice Return to position state (swap single asset to optimal ratio and add liquidity)
    /// @dev Can only be called from IN_ASSET0 or IN_ASSET1 states
    /// @param swapParams Paraswap swap parameters (direction determined by current state)
    function returnToPosition(
        SwapSellParams calldata swapParams
    ) external onlyManagerOrOperator nonReentrant whenNotPaused {
        if (currentState == VaultState.IN_ASSET0) {
            _returnToPositionFromAsset0(swapParams);
        } else if (currentState == VaultState.IN_ASSET1) {
            _returnToPositionFromAsset1(swapParams);
        } else {
            revert InvalidState();
        }

        currentState = VaultState.IN_POSITION;
    }

    /// @notice Preview the swap details for returnToPosition
    /// @dev Used by offchain callers to get Paraswap quotes
    /// @return sellToken The token that will be sold (asset0 or asset1)
    /// @return sellAmount The amount that will be sold
    function previewReturnToPosition()
        external
        view
        returns (address sellToken, uint256 sellAmount)
    {
        if (
            currentState != VaultState.IN_ASSET0 &&
            currentState != VaultState.IN_ASSET1
        ) {
            return (address(0), 0);
        }

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        if (currentState == VaultState.IN_ASSET0) {
            (uint256 balance0, ) = _getVaultBalances();
            sellToken = _asset0;
            sellAmount = UniswapV3Math.computeIdealSwapAmountSingleSided(
                balance0,
                sqrtPriceX96,
                sqrtRatioAX96,
                sqrtRatioBX96,
                UniswapV3Math.SingleSidedInput.TOKEN0_ONLY
            );
        } else {
            (, uint256 balance1) = _getVaultBalances();
            sellToken = _asset1;
            sellAmount = UniswapV3Math.computeIdealSwapAmountSingleSided(
                balance1,
                sqrtPriceX96,
                sqrtRatioAX96,
                sqrtRatioBX96,
                UniswapV3Math.SingleSidedInput.TOKEN1_ONLY
            );
        }
    }

    /// @notice Close the vault permanently
    /// @dev Can only be called from IN_ASSET0 state. Sweeps any asset1 dust into fees.
    function closeVault() external onlyManager nonReentrant {
        if (currentState != VaultState.IN_ASSET0) {
            revert InvalidState();
        }

        // Check for any asset1 dust (swap residue) and add to fees
        (, uint256 dust1) = _getVaultBalances();
        if (dust1 > 0) {
            _updateFeeAccumulators(0, dust1);
        }

        currentState = VaultState.CLOSED;
    }
}
