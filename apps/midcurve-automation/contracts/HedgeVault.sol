// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UniswapV3PositionVault} from "./UniswapV3PositionVault.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";

/// @title HedgeVault
/// @notice A dual-asset vault with hedging state machine for liquidity positions
/// @dev Extends UniswapV3PositionVault with hedging functionality (state transitions to be added later)
contract HedgeVault is UniswapV3PositionVault {
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

    // ============ Modifiers ============

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    modifier onlyManagerOrOperator() {
        if (msg.sender != manager && msg.sender != operator) revert Unauthorized();
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
        address operator_
    ) UniswapV3PositionVault(positionManager_, positionId_) {
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

    // ============ Internal Deposit Helpers (Asset-Only States) ============

    function _depositInAsset0(uint256 amount0, address receiver) internal returns (uint256 sharesOut) {
        if (amount0 == 0) revert ZeroAmount();

        // Get vault balance before (excluding reserved fees)
        (uint256 balanceBefore,) = _getVaultBalances();

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

        // Get vault balance before (excluding reserved fees)
        (, uint256 balanceBefore) = _getVaultBalances();

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

    // ============ Internal Mint Helpers (Asset-Only States) ============

    function _mintInAsset0(uint256 sharesToMint, address receiver) internal returns (uint256 amount0) {
        (uint256 balance,) = _getVaultBalances(); // Excludes reserved fees
        amount0 = sharesToMint * balance / totalShares;

        IERC20(_asset0).safeTransferFrom(msg.sender, address(this), amount0);

        totalShares += sharesToMint;
        shares[receiver] += sharesToMint;
        feeDebt0[receiver] += accFeePerShare0 * sharesToMint / ACC_PRECISION;
        feeDebt1[receiver] += accFeePerShare1 * sharesToMint / ACC_PRECISION;
    }

    function _mintInAsset1(uint256 sharesToMint, address receiver) internal returns (uint256 amount1) {
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        amount1 = sharesToMint * balance / totalShares;

        IERC20(_asset1).safeTransferFrom(msg.sender, address(this), amount1);

        totalShares += sharesToMint;
        shares[receiver] += sharesToMint;
        feeDebt0[receiver] += accFeePerShare0 * sharesToMint / ACC_PRECISION;
        feeDebt1[receiver] += accFeePerShare1 * sharesToMint / ACC_PRECISION;
    }

    // ============ Internal Preview Helpers (Asset-Only States) ============

    function _previewDepositInAsset0(uint256 amount0) internal view returns (uint256 sharesOut) {
        if (amount0 == 0) return 0;
        (uint256 balance,) = _getVaultBalances(); // Excludes reserved fees
        if (balance == 0) return 0;
        sharesOut = amount0 * totalShares / balance;
    }

    function _previewDepositInAsset1(uint256 amount1) internal view returns (uint256 sharesOut) {
        if (amount1 == 0) return 0;
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        if (balance == 0) return 0;
        sharesOut = amount1 * totalShares / balance;
    }

    function _previewMintInAsset0(uint256 sharesToMint) internal view returns (uint256 amount0) {
        if (sharesToMint == 0 || totalShares == 0) return 0;
        (uint256 balance,) = _getVaultBalances(); // Excludes reserved fees
        amount0 = sharesToMint * balance / totalShares;
    }

    function _previewMintInAsset1(uint256 sharesToMint) internal view returns (uint256 amount1) {
        if (sharesToMint == 0 || totalShares == 0) return 0;
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        amount1 = sharesToMint * balance / totalShares;
    }

    function _previewWithdrawInAsset0(uint256 amount0) internal view returns (uint256 sharesNeeded) {
        if (amount0 == 0 || totalShares == 0) return 0;
        (uint256 balance,) = _getVaultBalances(); // Excludes reserved fees
        if (balance == 0) return 0;
        sharesNeeded = amount0 * totalShares / balance;
    }

    function _previewWithdrawInAsset1(uint256 amount1) internal view returns (uint256 sharesNeeded) {
        if (amount1 == 0 || totalShares == 0) return 0;
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        if (balance == 0) return 0;
        sharesNeeded = amount1 * totalShares / balance;
    }

    function _previewRedeemInAsset0(uint256 sharesToRedeem) internal view returns (uint256 amount0) {
        if (sharesToRedeem == 0 || totalShares == 0) return 0;
        (uint256 balance,) = _getVaultBalances();
        amount0 = sharesToRedeem * balance / totalShares;
    }

    function _previewRedeemInAsset1(uint256 sharesToRedeem) internal view returns (uint256 amount1) {
        if (sharesToRedeem == 0 || totalShares == 0) return 0;
        (, uint256 balance) = _getVaultBalances();
        amount1 = sharesToRedeem * balance / totalShares;
    }

    // ============ Internal Withdraw Helpers (Asset-Only States) ============

    function _withdrawInAsset0(uint256 amount0, address receiver, address owner) internal returns (uint256 sharesBurned) {
        (uint256 balance,) = _getVaultBalances(); // Excludes reserved fees
        sharesBurned = amount0 * totalShares / balance;

        require(shares[owner] >= sharesBurned, "Insufficient shares");

        shares[owner] -= sharesBurned;
        totalShares -= sharesBurned;

        IERC20(_asset0).safeTransfer(receiver, amount0);
    }

    function _withdrawInAsset1(uint256 amount1, address receiver, address owner) internal returns (uint256 sharesBurned) {
        (, uint256 balance) = _getVaultBalances(); // Excludes reserved fees
        sharesBurned = amount1 * totalShares / balance;

        require(shares[owner] >= sharesBurned, "Insufficient shares");

        shares[owner] -= sharesBurned;
        totalShares -= sharesBurned;

        IERC20(_asset1).safeTransfer(receiver, amount1);
    }

    // ============ Internal Redeem Helpers (Asset-Only States) ============

    function _redeemInAsset0(uint256 sharesToRedeem, address receiver, address owner) internal returns (uint256 amount0) {
        require(shares[owner] >= sharesToRedeem, "Insufficient shares");

        (uint256 balance,) = _getVaultBalances();
        amount0 = sharesToRedeem * balance / totalShares;

        shares[owner] -= sharesToRedeem;
        totalShares -= sharesToRedeem;

        IERC20(_asset0).safeTransfer(receiver, amount0);
    }

    function _redeemInAsset1(uint256 sharesToRedeem, address receiver, address owner) internal returns (uint256 amount1) {
        require(shares[owner] >= sharesToRedeem, "Insufficient shares");

        (, uint256 balance) = _getVaultBalances();
        amount1 = sharesToRedeem * balance / totalShares;

        shares[owner] -= sharesToRedeem;
        totalShares -= sharesToRedeem;

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
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            return (0, 0);
        }
        return (type(uint256).max, type(uint256).max);
    }

    function maxMint(address) external view override returns (uint256 maxShares) {
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            return 0;
        }
        return type(uint256).max;
    }

    function maxWithdraw(
        address owner
    ) external view override returns (uint256 amount0, uint256 amount1) {
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

    function maxRedeem(address owner) external view override returns (uint256 maxShares) {
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            return 0;
        }
        return shares[owner];
    }

    // ============ Previews (Override with state routing) ============

    function previewDeposit(
        uint256 amount0,
        uint256 amount1
    ) external view override returns (uint256 sharesOut) {
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
        } else if (currentState == VaultState.IN_ASSET0) {
            sharesNeeded = _previewWithdrawInAsset0(amount0);
        } else if (currentState == VaultState.IN_ASSET1) {
            sharesNeeded = _previewWithdrawInAsset1(amount1);
        }
        // Returns 0 for UNINITIALIZED/CLOSED
    }

    function previewRedeem(
        uint256 sharesToRedeem
    ) external view override returns (uint256 amount0, uint256 amount1) {
        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _previewRedeemInPosition(sharesToRedeem);
        } else if (currentState == VaultState.IN_ASSET0) {
            amount0 = _previewRedeemInAsset0(sharesToRedeem);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _previewRedeemInAsset1(sharesToRedeem);
        }
        // Returns (0,0) for UNINITIALIZED/CLOSED
    }

    // ============ Actions (Override with state routing) ============

    function deposit(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) external override nonReentrant whenNotPaused returns (uint256 sharesOut) {
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
    ) external override nonReentrant whenNotPaused returns (uint256 amount0, uint256 amount1) {
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
        uint256 amount0,
        uint256 amount1,
        address receiver,
        address owner
    ) external override nonReentrant whenNotPaused returns (uint256 sharesBurned) {
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            revert InvalidState();
        }
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();

        // Check approval if caller is not owner
        if (msg.sender != owner) {
            revert Unauthorized();
        }

        if (currentState == VaultState.IN_POSITION) {
            sharesBurned = _withdrawInPosition(amount0, amount1, receiver, owner);
        } else if (currentState == VaultState.IN_ASSET0) {
            sharesBurned = _withdrawInAsset0(amount0, receiver, owner);
        } else if (currentState == VaultState.IN_ASSET1) {
            sharesBurned = _withdrawInAsset1(amount1, receiver, owner);
        }
    }

    function redeem(
        uint256 sharesToRedeem,
        address receiver,
        address owner
    ) external override nonReentrant whenNotPaused returns (uint256 amount0, uint256 amount1) {
        if (currentState == VaultState.UNINITIALIZED || currentState == VaultState.CLOSED) {
            revert InvalidState();
        }
        if (sharesToRedeem == 0) revert ZeroAmount();

        // Check approval if caller is not owner
        if (msg.sender != owner) {
            revert Unauthorized();
        }

        if (currentState == VaultState.IN_POSITION) {
            (amount0, amount1) = _redeemInPosition(sharesToRedeem, receiver, owner);
        } else if (currentState == VaultState.IN_ASSET0) {
            amount0 = _redeemInAsset0(sharesToRedeem, receiver, owner);
        } else if (currentState == VaultState.IN_ASSET1) {
            amount1 = _redeemInAsset1(sharesToRedeem, receiver, owner);
        }
    }

    // NOTE: State transition functions (exitToAsset0, exitToAsset1, returnToPosition, closeVault)
    // will be added later as they require special swap handling.
}
