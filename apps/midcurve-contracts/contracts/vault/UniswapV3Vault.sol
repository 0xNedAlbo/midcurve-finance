// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INonfungiblePositionManagerMinimal} from "../position-closer/interfaces/INonfungiblePositionManagerMinimal.sol";
import {IUniswapV3PoolMinimal} from "../position-closer/interfaces/IUniswapV3PoolMinimal.sol";
import {LiquidityAmounts} from "../position-closer/libraries/LiquidityAmounts.sol";
import {TickMath} from "../position-closer/libraries/TickMath.sol";

/// @title UniswapV3Vault
/// @notice Wraps a single Uniswap V3 NFT position into fungible ERC-20 shares.
/// @dev Deployed as an EIP-1167 clone via UniswapV3VaultFactory.
///      Shares represent proportional claims on the vault's total liquidity L.
///      Invariant: totalSupply == L (so shares == deltaL at all times).
///      Fee tracking uses the Synthetix accumulator pattern.
contract UniswapV3Vault is ERC20 {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private constant FEE_PRECISION = 1e18;

    // ============ Clone-initialized storage ============

    bool private _initialized;
    uint256 private _reentrancyStatus;

    string private _vaultName;
    string private _vaultSymbol;
    uint8 private _vaultDecimals;

    INonfungiblePositionManagerMinimal public positionManager;
    uint256 public tokenId;
    address public token0;
    address public token1;
    address public pool;
    int24 private _tickLower;
    int24 private _tickUpper;

    // ============ Fee accumulator (Synthetix pattern) ============

    uint256 public feePerShare0;
    uint256 public feePerShare1;

    mapping(address => uint256) public feeDebt0;
    mapping(address => uint256) public feeDebt1;

    /// @dev Pending (settled but not yet transferred) fees per user.
    ///      Accumulated in _beforeTokenTransfer so fees survive balance changes.
    mapping(address => uint256) private _pendingFees0;
    mapping(address => uint256) private _pendingFees1;

    // ============ Modifiers ============

    modifier initializer() {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert Reentrancy();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    modifier whenInitialized() {
        if (!_initialized) revert NotInitialized();
        _;
    }

    // ============ Errors ============

    error AlreadyInitialized();
    error NotInitialized();
    error Reentrancy();
    error NFTNotReceived();
    error ZeroShares();
    error InsufficientBalance();

    // ============ Events ============

    event VaultInitialized(
        address indexed positionManager,
        uint256 indexed tokenId,
        address indexed initialShareRecipient,
        uint128 initialLiquidity
    );

    event Minted(address indexed to, uint256 shares, uint128 deltaL, uint256 amount0, uint256 amount1);
    event Burned(address indexed from, uint256 shares, uint128 deltaL, uint256 amount0, uint256 amount1);
    event FeesCollected(address indexed user, uint256 fee0, uint256 fee1);

    // ============ Constructor (implementation contract only — clones skip this) ============

    constructor() ERC20("", "") {}

    // ============ Initialization ============

    /// @notice Initialize the vault clone. NFT must already be transferred to this contract.
    /// @param positionManager_ Uniswap V3 NonfungiblePositionManager
    /// @param tokenId_ NFT token ID (must be owned by this contract)
    /// @param name_ ERC-20 token name
    /// @param symbol_ ERC-20 token symbol
    /// @param decimals_ ERC-20 decimals
    /// @param initialShareRecipient_ Receives initial shares equal to current liquidity
    function initialize(
        address positionManager_,
        uint256 tokenId_,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address initialShareRecipient_
    ) external virtual initializer {
        _initializeVault(positionManager_, tokenId_, name_, symbol_, decimals_, initialShareRecipient_);
    }

    function _initializeVault(
        address positionManager_,
        uint256 tokenId_,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address initialShareRecipient_
    ) internal {
        _reentrancyStatus = _NOT_ENTERED;

        _vaultName = name_;
        _vaultSymbol = symbol_;
        _vaultDecimals = decimals_;

        positionManager = INonfungiblePositionManagerMinimal(positionManager_);
        tokenId = tokenId_;

        // Verify we own the NFT
        if (positionManager.ownerOf(tokenId_) != address(this)) revert NFTNotReceived();

        // Read position data
        (,, address t0, address t1, uint24 fee, int24 tl, int24 tu, uint128 liquidity,,,,) =
            positionManager.positions(tokenId_);

        token0 = t0;
        token1 = t1;
        _tickLower = tl;
        _tickUpper = tu;

        // Resolve pool address via Uniswap V3 Factory.getPool()
        (bool success, bytes memory data) =
            positionManager_.staticcall(abi.encodeWithSignature("factory()"));
        require(success && data.length >= 32, "factory() failed");
        address uniFactory = abi.decode(data, (address));

        (success, data) =
            uniFactory.staticcall(abi.encodeWithSignature("getPool(address,address,uint24)", t0, t1, fee));
        require(success && data.length >= 32, "getPool() failed");
        pool = abi.decode(data, (address));

        // Mint initial shares == liquidity
        if (liquidity > 0) {
            _mint(initialShareRecipient_, uint256(liquidity));
        }

        emit VaultInitialized(positionManager_, tokenId_, initialShareRecipient_, liquidity);
    }

    // ============ ERC-20 metadata overrides ============

    function name() public view override returns (string memory) {
        return _vaultName;
    }

    function symbol() public view override returns (string memory) {
        return _vaultSymbol;
    }

    function decimals() public view override returns (uint8) {
        return _vaultDecimals;
    }

    // ============ Core functions ============

    /// @notice Mint new shares by adding proportional liquidity.
    /// @dev Since totalSupply == L (invariant), minted shares == addedLiquidity.
    ///      Token amounts for deltaL are computed by the NFPM from the provided amounts.
    /// @param minShares Minimum shares the caller expects (slippage protection, 0 to skip)
    /// @param maxAmount0 Maximum token0 the caller is willing to provide
    /// @param maxAmount1 Maximum token1 the caller is willing to provide
    function mint(uint256 minShares, uint256 maxAmount0, uint256 maxAmount1)
        external
        whenInitialized
        nonReentrant
    {
        _collectAndUpdateAccumulator();

        // Pull max amounts from caller
        IERC20(token0).safeTransferFrom(msg.sender, address(this), maxAmount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), maxAmount1);

        // Approve position manager
        IERC20(token0).forceApprove(address(positionManager), maxAmount0);
        IERC20(token1).forceApprove(address(positionManager), maxAmount1);

        // Add liquidity — NFPM computes max liquidity from desired amounts
        (uint128 addedLiquidity, uint256 amount0, uint256 amount1) = positionManager.increaseLiquidity(
            INonfungiblePositionManagerMinimal.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: maxAmount0,
                amount1Desired: maxAmount1,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            })
        );

        require(addedLiquidity > 0, "No liquidity added");
        require(uint256(addedLiquidity) >= minShares, "Slippage: insufficient shares");

        // Clear remaining approvals
        IERC20(token0).forceApprove(address(positionManager), 0);
        IERC20(token1).forceApprove(address(positionManager), 0);

        // Return dust (maxAmount - consumed) — NOT a balance sweep
        uint256 dust0 = maxAmount0 - amount0;
        uint256 dust1 = maxAmount1 - amount1;
        if (dust0 > 0) IERC20(token0).safeTransfer(msg.sender, dust0);
        if (dust1 > 0) IERC20(token1).safeTransfer(msg.sender, dust1);

        // Mint shares == addedLiquidity to preserve the totalSupply == L invariant
        _mint(msg.sender, uint256(addedLiquidity));

        emit Minted(msg.sender, uint256(addedLiquidity), addedLiquidity, amount0, amount1);
    }

    /// @notice Burn shares and withdraw proportional liquidity + settle fees.
    /// @param shares Number of shares to burn
    /// @param minAmount0 Minimum token0 expected (slippage protection)
    /// @param minAmount1 Minimum token1 expected (slippage protection)
    function burn(uint256 shares, uint256 minAmount0, uint256 minAmount1)
        external
        whenInitialized
        nonReentrant
    {
        if (shares == 0) revert ZeroShares();
        if (balanceOf(msg.sender) < shares) revert InsufficientBalance();

        // Collect outstanding fees and update accumulators
        _collectAndUpdateAccumulator();

        // shares == deltaL by invariant
        uint128 deltaL = uint128(shares);

        // Decrease liquidity — principal goes to tokensOwed on the NFT
        positionManager.decreaseLiquidity(
            INonfungiblePositionManagerMinimal.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: deltaL,
                amount0Min: minAmount0,
                amount1Min: minAmount1,
                deadline: block.timestamp
            })
        );

        // Collect the withdrawn principal to the caller.
        // This collect() returns exclusively principal — not fees. Fees were already
        // drained by _collectAndUpdateAccumulator() above (which zeroed tokensOwed),
        // and no new fees can accrue within the same transaction since no swaps have
        // crossed the position's tick range between the two collect() calls.
        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManagerMinimal.CollectParams({
                tokenId: tokenId,
                recipient: msg.sender,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // Burn shares — _beforeTokenTransfer settles fees into _pendingFees
        _burn(msg.sender, shares);

        // Transfer settled fees to the caller
        _transferPendingFees(msg.sender);

        emit Burned(msg.sender, shares, deltaL, amount0, amount1);
    }

    /// @notice Claim accumulated fee entitlement without affecting shares or liquidity.
    function collectFees() external whenInitialized nonReentrant {
        _collectAndUpdateAccumulator();
        _settleFees(msg.sender);
        _transferPendingFees(msg.sender);
    }

    // ============ View functions ============

    /// @notice Lower tick bound of the underlying position
    function tickLower() external view returns (int24) {
        return _tickLower;
    }

    /// @notice Upper tick bound of the underlying position
    function tickUpper() external view returns (int24) {
        return _tickUpper;
    }

    /// @notice Returns the full claimable fee amounts for a user.
    /// @dev Computes all four fee components:
    ///      1. Pending (settled, not yet transferred)
    ///      2. Accumulated since last settlement (accumulator delta)
    ///      3. Snapshotted in NFPM but not yet harvested (tokensOwed, pro-rata)
    ///      4. Unsnapshotted fees still in pool (feeGrowthInside reconstruction, pro-rata)
    function claimableFees(address user) external view returns (uint256 fee0, uint256 fee1) {
        uint256 balance = balanceOf(user);
        uint256 supply = totalSupply();

        // Components 1+2: pending + accumulator delta
        fee0 = _pendingFees0[user] + (feePerShare0 - feeDebt0[user]) * balance / FEE_PRECISION;
        fee1 = _pendingFees1[user] + (feePerShare1 - feeDebt1[user]) * balance / FEE_PRECISION;

        if (supply == 0) return (fee0, fee1);

        // Read NFPM position state
        (,,,,,,,uint128 L_total,
         uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
         uint128 owed0, uint128 owed1) = positionManager.positions(tokenId);

        // Component 3: tokensOwed snapshotted in NFPM, scaled by user's share
        fee0 += uint256(owed0) * balance / supply;
        fee1 += uint256(owed1) * balance / supply;

        // Component 4: unsnapshotted fees still in pool
        if (L_total > 0) {
            (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(pool).slot0();

            uint256 feeGrowthGlobal0 = IUniswapV3PoolMinimal(pool).feeGrowthGlobal0X128();
            uint256 feeGrowthGlobal1 = IUniswapV3PoolMinimal(pool).feeGrowthGlobal1X128();

            (,, uint256 feeGrowthOutsideLower0, uint256 feeGrowthOutsideLower1,,,,)
                = IUniswapV3PoolMinimal(pool).ticks(_tickLower);
            (,, uint256 feeGrowthOutsideUpper0, uint256 feeGrowthOutsideUpper1,,,,)
                = IUniswapV3PoolMinimal(pool).ticks(_tickUpper);

            // Reconstruct feeGrowthInside using unchecked arithmetic (uint256 overflow semantics)
            unchecked {
                uint256 below0 = currentTick >= _tickLower
                    ? feeGrowthOutsideLower0
                    : feeGrowthGlobal0 - feeGrowthOutsideLower0;
                uint256 below1 = currentTick >= _tickLower
                    ? feeGrowthOutsideLower1
                    : feeGrowthGlobal1 - feeGrowthOutsideLower1;

                uint256 above0 = currentTick < _tickUpper
                    ? feeGrowthOutsideUpper0
                    : feeGrowthGlobal0 - feeGrowthOutsideUpper0;
                uint256 above1 = currentTick < _tickUpper
                    ? feeGrowthOutsideUpper1
                    : feeGrowthGlobal1 - feeGrowthOutsideUpper1;

                uint256 inside0 = feeGrowthGlobal0 - below0 - above0;
                uint256 inside1 = feeGrowthGlobal1 - below1 - above1;

                // Unsnapshotted fees: (delta × L_total × balance) / Q128 / supply
                uint256 Q128 = 1 << 128;
                fee0 += (inside0 - feeGrowthInside0LastX128) * uint256(L_total) * balance / Q128 / supply;
                fee1 += (inside1 - feeGrowthInside1LastX128) * uint256(L_total) * balance / Q128 / supply;
            }
        }
    }

    // NOTE: quoteBurn and quoteMint are intentionally identical. This is not a bug —
    // it follows from the shares == deltaL invariant (totalSupply always equals L).
    // Both directions convert the same number of shares to the same liquidity delta,
    // which maps to the same token amounts at a given price.

    /// @notice Quote the token amounts for burning a given number of shares
    function quoteBurn(uint256 shares) external view returns (uint256 amount0, uint256 amount1, uint128 deltaL) {
        uint256 supply = totalSupply();
        if (supply == 0) return (0, 0, 0);

        deltaL = uint128(shares);

        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(_tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(_tickUpper);

        (amount0, amount1) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, deltaL);
    }

    /// @notice Quote the token amounts required to mint a given number of shares
    function quoteMint(uint256 shares) external view returns (uint256 amount0, uint256 amount1, uint128 deltaL) {
        uint256 supply = totalSupply();
        if (supply == 0) return (0, 0, 0);

        deltaL = uint128(shares);

        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(_tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(_tickUpper);

        (amount0, amount1) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, deltaL);
    }

    // ============ Fee accumulator internals ============

    /// @dev Collect all outstanding fees from the NFT and update the global accumulators.
    ///      collect() returns exclusively accumulated fees — principal stays in the pool.
    function _collectAndUpdateAccumulator() internal {
        (uint256 collected0, uint256 collected1) = positionManager.collect(
            INonfungiblePositionManagerMinimal.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        uint256 supply = totalSupply();
        if (supply > 0) {
            if (collected0 > 0) feePerShare0 += collected0 * FEE_PRECISION / supply;
            if (collected1 > 0) feePerShare1 += collected1 * FEE_PRECISION / supply;
        }
    }

    /// @dev Settle (compute and store) pending fees for a user based on current accumulator
    function _settleFees(address user) internal {
        uint256 balance = balanceOf(user);
        if (balance > 0) {
            _pendingFees0[user] += (feePerShare0 - feeDebt0[user]) * balance / FEE_PRECISION;
            _pendingFees1[user] += (feePerShare1 - feeDebt1[user]) * balance / FEE_PRECISION;
        }
        feeDebt0[user] = feePerShare0;
        feeDebt1[user] = feePerShare1;
    }

    /// @dev Transfer all pending fees to the user and reset
    function _transferPendingFees(address user) internal {
        uint256 pending0 = _pendingFees0[user];
        uint256 pending1 = _pendingFees1[user];

        if (pending0 > 0) {
            _pendingFees0[user] = 0;
            IERC20(token0).safeTransfer(user, pending0);
        }
        if (pending1 > 0) {
            _pendingFees1[user] = 0;
            IERC20(token1).safeTransfer(user, pending1);
        }

        if (pending0 > 0 || pending1 > 0) {
            emit FeesCollected(user, pending0, pending1);
        }
    }

    // ============ Transfer hooks ============

    /// @dev Collect outstanding NFPM fees and settle for both parties before any balance change.
    ///      Called on every transfer, mint, and burn. When called from mint()/burn() the
    ///      accumulator was already updated (the second collect returns 0 — harmless).
    function _beforeTokenTransfer(address from, address to, uint256 /* amount */ ) internal virtual override {
        if (_initialized) _collectAndUpdateAccumulator();
        if (from != address(0)) _settleFees(from);
        if (to != address(0)) _settleFees(to);
        _checkTransferAllowed(from, to);
    }

    /// @dev Override point for derived contracts to restrict transfers.
    function _checkTransferAllowed(address, /* from */ address /* to */ ) internal virtual {}
}
