// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IMultiTokenVault, MintParams, BurnParams} from "./interfaces/IMultiTokenVault.sol";
import {INonfungiblePositionManagerMinimal} from "../position-closer/interfaces/INonfungiblePositionManagerMinimal.sol";
import {IUniswapV3PoolMinimal} from "../position-closer/interfaces/IUniswapV3PoolMinimal.sol";
import {LiquidityAmounts} from "../position-closer/libraries/LiquidityAmounts.sol";
import {TickMath} from "../position-closer/libraries/TickMath.sol";

/// @title UniswapV3Vault
/// @notice Wraps a single Uniswap V3 NFT position into fungible ERC-20 shares.
/// @dev Deployed as an EIP-1167 clone via UniswapV3VaultFactory.
///      Implements {IMultiTokenVault} with tokenCount() == 2 (token0, token1).
///      Shares represent proportional claims on the vault's total liquidity L.
///      Invariant: totalSupply == L (so shares == deltaL at all times).
///      Fee tracking uses the Synthetix accumulator pattern.
contract UniswapV3Vault is ERC20, IMultiTokenVault {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private constant FEE_PRECISION = 1e18;
    bytes32 public constant VAULT_TYPE = keccak256("uniswap-v3-concentrated-liquidity");

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

    address private _operator;

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
        _;                   // function body runs with _initialized = false
        _initialized = true; // set AFTER body — keeps accumulator silent during init mint
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

    modifier onlyOperator() {
        if (msg.sender != _operator) revert NotOperator();
        _;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _;
    }

    // ============ Errors ============

    error AlreadyInitialized();
    error NotInitialized();
    error Reentrancy();
    error NFTNotReceived();
    error ZeroShares();
    error InsufficientBalance();
    error InvalidTokenCount();
    error NotOperator();
    error DeadlineExpired();
    error UnsupportedTendOperation();
    error InvalidTokenIndex();

    // ============ Events ============

    event VaultInitialized(
        address indexed positionManager,
        uint256 indexed tokenId,
        address indexed initialShareRecipient,
        uint128 initialLiquidity
    );

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
    /// @param operator_ Address authorized to call tend() and setOperator()
    function initialize(
        address positionManager_,
        uint256 tokenId_,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address initialShareRecipient_,
        address operator_
    ) external virtual initializer {
        _initializeVault(positionManager_, tokenId_, name_, symbol_, decimals_, initialShareRecipient_, operator_);
    }

    function _initializeVault(
        address positionManager_,
        uint256 tokenId_,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address initialShareRecipient_,
        address operator_
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

        // Set operator
        _operator = operator_;
        emit OperatorUpdated(address(0), operator_);

        // Mint initial shares first. The initializer modifier keeps _initialized = false
        // during this call, so _beforeTokenTransfer skips _collectAndUpdateAccumulator().
        // _settleFees runs but balance = 0, keeping feeDebt at 0.
        if (liquidity > 0) {
            _mint(initialShareRecipient_, uint256(liquidity));
        }

        // Now totalSupply > 0. Collect any outstanding NFPM fees into the vault and
        // distribute them via the accumulator. Because feeDebt[initialShareRecipient_]
        // is still 0, the full fee amount becomes claimable through collectYield().
        _collectAndUpdateAccumulator();

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

    // ============ IMultiTokenVault — Identification ============

    /// @inheritdoc IMultiTokenVault
    function vaultType() external pure returns (bytes32) {
        return VAULT_TYPE;
    }

    // ============ IMultiTokenVault — Token set ============

    /// @inheritdoc IMultiTokenVault
    function tokenCount() external pure returns (uint256) {
        return 2;
    }

    /// @inheritdoc IMultiTokenVault
    function tokens(uint256 index) external view returns (address) {
        if (index == 0) return token0;
        if (index == 1) return token1;
        revert InvalidTokenIndex();
    }

    // ============ IMultiTokenVault — Operator ============

    /// @inheritdoc IMultiTokenVault
    function operator() external view returns (address) {
        return _operator;
    }

    /// @inheritdoc IMultiTokenVault
    function setOperator(address newOperator) external onlyOperator {
        address prev = _operator;
        _operator = newOperator;
        emit OperatorUpdated(prev, newOperator);
    }

    /// @inheritdoc IMultiTokenVault
    /// @dev No operations are supported for this vault type. Always reverts.
    function tend(bytes32, bytes calldata) external onlyOperator returns (bytes memory) {
        _reentrancyStatus = _reentrancyStatus; // solc: prevent "can be restricted to view" (2018)
        revert UnsupportedTendOperation();
    }

    // ============ IMultiTokenVault — Core functions ============

    /// @inheritdoc IMultiTokenVault
    function mint(uint256 minShares, MintParams calldata params)
        external
        whenInitialized
        nonReentrant
        checkDeadline(params.deadline)
        returns (uint256 shares, uint256[] memory tokenAmounts)
    {
        if (params.maxAmounts.length != 2) revert InvalidTokenCount();
        if (params.minAmounts.length != 2) revert InvalidTokenCount();

        _collectAndUpdateAccumulator();

        uint256 maxAmount0 = params.maxAmounts[0];
        uint256 maxAmount1 = params.maxAmounts[1];

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
                amount0Min: params.minAmounts[0],
                amount1Min: params.minAmounts[1],
                deadline: params.deadline
            })
        );

        require(addedLiquidity > 0, "No liquidity added");

        shares = uint256(addedLiquidity);
        require(shares >= minShares, "Slippage: insufficient shares");

        // Clear remaining approvals
        IERC20(token0).forceApprove(address(positionManager), 0);
        IERC20(token1).forceApprove(address(positionManager), 0);

        // Return dust (maxAmount - consumed) to the caller (token provider)
        uint256 dust0 = maxAmount0 - amount0;
        uint256 dust1 = maxAmount1 - amount1;
        if (dust0 > 0) IERC20(token0).safeTransfer(msg.sender, dust0);
        if (dust1 > 0) IERC20(token1).safeTransfer(msg.sender, dust1);

        // Mint shares to recipient (may differ from msg.sender)
        _mint(params.recipient, shares);

        tokenAmounts = new uint256[](2);
        tokenAmounts[0] = amount0;
        tokenAmounts[1] = amount1;

        emit Minted(msg.sender, params.recipient, shares, tokenAmounts);
    }

    /// @inheritdoc IMultiTokenVault
    function burn(uint256 shares, BurnParams calldata params)
        external
        whenInitialized
        nonReentrant
        checkDeadline(params.deadline)
        returns (uint256[] memory tokenAmounts)
    {
        if (params.minAmounts.length != 2) revert InvalidTokenCount();
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
                amount0Min: params.minAmounts[0],
                amount1Min: params.minAmounts[1],
                deadline: params.deadline
            })
        );

        // Collect the withdrawn principal to the recipient.
        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManagerMinimal.CollectParams({
                tokenId: tokenId,
                recipient: params.recipient,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // Burn shares — _beforeTokenTransfer settles fees into _pendingFees
        _burn(msg.sender, shares);

        // Transfer settled fees to the recipient
        _transferPendingFees(msg.sender, params.recipient);

        tokenAmounts = new uint256[](2);
        tokenAmounts[0] = amount0;
        tokenAmounts[1] = amount1;

        emit Burned(msg.sender, params.recipient, shares, tokenAmounts);
    }

    /// @inheritdoc IMultiTokenVault
    function collectYield(address recipient)
        external
        whenInitialized
        nonReentrant
        returns (uint256[] memory tokenAmounts)
    {
        _collectAndUpdateAccumulator();
        _settleFees(msg.sender);
        tokenAmounts = _transferPendingFees(msg.sender, recipient);
    }

    // ============ IMultiTokenVault — View functions ============

    /// @notice Lower tick bound of the underlying position
    function tickLower() external view returns (int24) {
        return _tickLower;
    }

    /// @notice Upper tick bound of the underlying position
    function tickUpper() external view returns (int24) {
        return _tickUpper;
    }

    /// @inheritdoc IMultiTokenVault
    function claimableYield(address user) external view returns (uint256[] memory tokenAmounts) {
        tokenAmounts = new uint256[](2);

        uint256 balance = balanceOf(user);
        uint256 supply = totalSupply();

        // Components 1+2: pending + accumulator delta
        tokenAmounts[0] = _pendingFees0[user] + (feePerShare0 - feeDebt0[user]) * balance / FEE_PRECISION;
        tokenAmounts[1] = _pendingFees1[user] + (feePerShare1 - feeDebt1[user]) * balance / FEE_PRECISION;

        if (supply == 0) return tokenAmounts;

        // Read NFPM position state
        (,,,,,,,uint128 L_total,
         uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
         uint128 owed0, uint128 owed1) = positionManager.positions(tokenId);

        // Component 3: tokensOwed snapshotted in NFPM, scaled by user's share
        tokenAmounts[0] += uint256(owed0) * balance / supply;
        tokenAmounts[1] += uint256(owed1) * balance / supply;

        // Component 4: unsnapshotted fees still in pool
        if (L_total > 0) {
            (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(pool).slot0();

            uint256 feeGrowthGlobal0 = IUniswapV3PoolMinimal(pool).feeGrowthGlobal0X128();
            uint256 feeGrowthGlobal1 = IUniswapV3PoolMinimal(pool).feeGrowthGlobal1X128();

            (,, uint256 feeGrowthOutsideLower0, uint256 feeGrowthOutsideLower1,,,,)
                = IUniswapV3PoolMinimal(pool).ticks(_tickLower);
            (,, uint256 feeGrowthOutsideUpper0, uint256 feeGrowthOutsideUpper1,,,,)
                = IUniswapV3PoolMinimal(pool).ticks(_tickUpper);

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

                uint256 Q128 = 1 << 128;
                tokenAmounts[0] += (inside0 - feeGrowthInside0LastX128) * uint256(L_total) * balance / Q128 / supply;
                tokenAmounts[1] += (inside1 - feeGrowthInside1LastX128) * uint256(L_total) * balance / Q128 / supply;
            }
        }
    }

    // SafeCast in totalAssets/principalOf is a defensive guard only — Uniswap V3 caps
    // liquidity at uint128.max, so totalSupply (== L) should never exceed that in practice.

    /// @inheritdoc IMultiTokenVault
    function totalAssets() external view returns (uint256[] memory tokenAmounts) {
        tokenAmounts = new uint256[](2);
        uint256 supply = totalSupply();
        if (supply == 0) return tokenAmounts;

        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(_tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(_tickUpper);

        (tokenAmounts[0], tokenAmounts[1]) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, SafeCast.toUint128(supply));
    }

    /// @inheritdoc IMultiTokenVault
    function principalOf(address user) external view returns (uint256[] memory tokenAmounts) {
        tokenAmounts = new uint256[](2);
        uint256 balance = balanceOf(user);
        if (balance == 0) return tokenAmounts;

        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(_tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(_tickUpper);

        (tokenAmounts[0], tokenAmounts[1]) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, SafeCast.toUint128(balance));
    }

    // NOTE: quoteBurn and quoteMint are intentionally identical. This is not a bug —
    // it follows from the shares == deltaL invariant (totalSupply always equals L).
    // Both directions convert the same number of shares to the same liquidity delta,
    // which maps to the same token amounts at a given price.

    /// @inheritdoc IMultiTokenVault
    function quoteBurn(uint256 shares) external view returns (uint256[] memory tokenAmounts) {
        tokenAmounts = new uint256[](2);
        uint256 supply = totalSupply();
        if (supply == 0) return tokenAmounts;

        uint128 deltaL = uint128(shares);

        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(_tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(_tickUpper);

        (tokenAmounts[0], tokenAmounts[1]) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, deltaL);
    }

    /// @inheritdoc IMultiTokenVault
    function quoteMint(uint256 shares) external view returns (uint256[] memory tokenAmounts) {
        tokenAmounts = new uint256[](2);
        uint256 supply = totalSupply();
        if (supply == 0) return tokenAmounts;

        uint128 deltaL = uint128(shares);

        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(_tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(_tickUpper);

        (tokenAmounts[0], tokenAmounts[1]) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, deltaL);
    }

    // ============ Fee accumulator internals ============

    /// @dev Collect all outstanding fees from the NFT and update the global accumulators.
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

    /// @dev Transfer all pending fees to a recipient and reset the user's pending balances.
    /// @param user The user whose pending fees to transfer.
    /// @param recipient The address that receives the fee tokens.
    /// @return tokenAmounts The amounts transferred [token0, token1].
    function _transferPendingFees(address user, address recipient)
        internal
        returns (uint256[] memory tokenAmounts)
    {
        tokenAmounts = new uint256[](2);

        uint256 pending0 = _pendingFees0[user];
        uint256 pending1 = _pendingFees1[user];

        if (pending0 > 0) {
            _pendingFees0[user] = 0;
            IERC20(token0).safeTransfer(recipient, pending0);
        }
        if (pending1 > 0) {
            _pendingFees1[user] = 0;
            IERC20(token1).safeTransfer(recipient, pending1);
        }

        tokenAmounts[0] = pending0;
        tokenAmounts[1] = pending1;

        if (pending0 > 0 || pending1 > 0) {
            emit YieldCollected(user, recipient, tokenAmounts);
        }
    }

    // ============ Transfer hooks ============

    /// @dev Collect outstanding NFPM fees and settle for both parties before any balance change.
    function _beforeTokenTransfer(address from, address to, uint256 /* amount */ ) internal virtual override {
        if (_initialized) _collectAndUpdateAccumulator();
        if (from != address(0)) _settleFees(from);
        if (to != address(0)) _settleFees(to);
        _checkTransferAllowed(from, to);
    }

    /// @dev Override point for derived contracts to restrict transfers.
    function _checkTransferAllowed(address, /* from */ address /* to */ ) internal virtual {}
}
