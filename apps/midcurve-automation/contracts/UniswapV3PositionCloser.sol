// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * UniswapV3PositionCloser.sol
 *
 * A shared contract for automated Uniswap V3 position closing based on price triggers.
 * One contract deployed per chain, used by all users.
 *
 * Architecture:
 * - 1 shared contract per chain (deployed by Midcurve)
 * - Operator specified per close order (user's automation wallet)
 * - Multiple close orders from multiple users
 *
 * Owner flow (user's EOA):
 * - registerClose(cfg) stores an on-chain close intent (price trigger + slippage policy)
 * - Owner keeps custody of the NFT until execution
 * - Owner must approve this contract on the PositionManager
 *
 * Operator flow (user's automation wallet):
 * - executeClose(closeId, feeRecipient, feeBps) checks:
 *   - order REGISTERED
 *   - caller is the order's operator
 *   - not expired (validUntil)
 *   - price trigger met (pool.slot0.sqrtPriceX96)
 * - then atomically:
 *   - pulls NFT via transferFrom(owner -> this)
 *   - decreases ALL liquidity with amountMins derived on-chain from slippageBps
 *   - collects fees
 *   - applies an operator-chosen fee (0..1%) if feeRecipient != 0x0
 *   - pays remaining amounts to payout
 *   - returns the now-empty NFT to the owner
 *
 * Notes:
 * - ERC20 transfers are done via low-level call to support non-standard tokens (no bool return).
 */

interface IERC20Minimal {
    function transfer(address to, uint256 value) external returns (bool);
}

interface IERC721Minimal {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;

    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IUniswapV3PoolMinimal {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface INonfungiblePositionManagerMinimal is IERC721Minimal {
    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);
}

interface IUniswapV3PositionCloser {
    enum TriggerMode {
        LOWER_ONLY,
        UPPER_ONLY,
        BOTH
    }

    enum CloseStatus {
        NONE,
        REGISTERED,
        EXECUTED,
        CANCELLED
    }

    struct CloseConfig {
        address pool;
        uint256 tokenId;

        uint160 sqrtPriceX96Lower;
        uint160 sqrtPriceX96Upper;
        TriggerMode mode;

        address payout;
        address operator;  // Per-order operator (user's automation wallet)

        uint256 validUntil; // 0 = no expiry
        uint16 slippageBps; // 0..10000
    }

    struct CloseOrder {
        CloseStatus status;
        uint256 tokenId;

        address owner;
        address payout;
        address operator;  // Per-order operator

        address pool;
        uint160 lower;
        uint160 upper;
        TriggerMode mode;

        uint256 validUntil;
        uint16 slippageBps;
    }

    // --- Errors ---
    error NotOwner();
    error NotOperator();

    error ZeroAddress();
    error SlippageBpsOutOfRange(uint16 slippageBps);
    error InvalidBounds();

    error WrongStatus(CloseStatus expected, CloseStatus actual);
    error CloseExpired(uint256 validUntil, uint256 nowTs);

    error PriceConditionNotMet(uint160 currentSqrtPriceX96, uint160 lower, uint160 upper, TriggerMode mode);

    error NftNotOwnedByRecordedOwner(address expectedOwner, address actualOwner);
    error NftNotApproved(address owner, uint256 tokenId);

    error FeeBpsTooHigh(uint16 feeBps, uint16 maxFeeBps);

    error TransferFailed();
    error ExternalCallFailed();

    // --- Events ---
    event CloseRegistered(
        uint256 indexed closeId,
        uint256 indexed tokenId,
        address indexed owner,
        address pool,
        address operator,
        address payout,
        uint160 lower,
        uint160 upper,
        TriggerMode mode,
        uint256 validUntil,
        uint16 slippageBps
    );

    event CloseFeeApplied(
        uint256 indexed closeId,
        address indexed feeRecipient,
        uint16 feeBps,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    event CloseExecuted(
        uint256 indexed closeId,
        uint256 indexed tokenId,
        address indexed owner,
        address payout,
        uint160 executionSqrtPriceX96,
        uint256 amount0Out,
        uint256 amount1Out
    );

    event CloseCancelled(uint256 indexed closeId, uint256 indexed tokenId, address indexed owner);

    event CloseOperatorUpdated(uint256 indexed closeId, address indexed oldOperator, address indexed newOperator);
    event ClosePayoutUpdated(uint256 indexed closeId, address indexed oldPayout, address indexed newPayout);
    event CloseBoundsUpdated(
        uint256 indexed closeId,
        uint160 oldLower,
        uint160 oldUpper,
        TriggerMode oldMode,
        uint160 newLower,
        uint160 newUpper,
        TriggerMode newMode
    );
    event CloseValidUntilUpdated(uint256 indexed closeId, uint256 oldValidUntil, uint256 newValidUntil);
    event CloseSlippageUpdated(uint256 indexed closeId, uint16 oldSlippageBps, uint16 newSlippageBps);

    // --- Actions ---
    function registerClose(CloseConfig calldata cfg) external returns (uint256 closeId);

    function executeClose(uint256 closeId, address feeRecipient, uint16 feeBps) external;

    function cancelClose(uint256 closeId) external;

    function setCloseOperator(uint256 closeId, address newOperator) external;
    function setClosePayout(uint256 closeId, address newPayout) external;

    function setCloseBounds(uint256 closeId, uint160 newLower, uint160 newUpper, TriggerMode newMode) external;

    function setCloseValidUntil(uint256 closeId, uint256 newValidUntil) external;

    function setCloseSlippage(uint256 closeId, uint16 newSlippageBps) external;

    // --- Views ---
    function getCloseOrder(uint256 closeId) external view returns (CloseOrder memory);

    function getCurrentSqrtPriceX96(address pool) external view returns (uint160);

    function canExecuteClose(uint256 closeId) external view returns (bool);

    function positionManager() external view returns (address);

    function nextCloseId() external view returns (uint256);
}

abstract contract ReentrancyGuardMinimal {
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "REENTRANCY");
        _locked = 2;
        _;
        _locked = 1;
    }
}

contract UniswapV3PositionCloser is IUniswapV3PositionCloser, ReentrancyGuardMinimal {
    // 1% global fee cap (operator may choose feeBps within [0..MAX_FEE_BPS] per close execution)
    uint16 public constant MAX_FEE_BPS = 100;

    // Internal storage with interface type for convenience
    INonfungiblePositionManagerMinimal internal immutable _positionManager;

    uint256 public override nextCloseId = 1;
    mapping(uint256 => CloseOrder) internal _closes;

    constructor(address positionManager_) {
        if (positionManager_ == address(0)) revert ZeroAddress();
        _positionManager = INonfungiblePositionManagerMinimal(positionManager_);
    }

    /// @notice Returns the Uniswap V3 NonfungiblePositionManager address
    function positionManager() external view override returns (address) {
        return address(_positionManager);
    }

    // ----------------------------
    // Register / Execute / Cancel
    // ----------------------------

    function registerClose(CloseConfig calldata cfg) external override returns (uint256 closeId) {
        _validateConfig(cfg);

        // Must own the NFT at registration time.
        address owner = _positionManager.ownerOf(cfg.tokenId);
        if (owner != msg.sender) revert NotOwner();

        closeId = nextCloseId++;
        _closes[closeId] = CloseOrder({
            status: CloseStatus.REGISTERED,
            tokenId: cfg.tokenId,
            owner: owner,
            payout: cfg.payout,
            operator: cfg.operator,
            pool: cfg.pool,
            lower: cfg.sqrtPriceX96Lower,
            upper: cfg.sqrtPriceX96Upper,
            mode: cfg.mode,
            validUntil: cfg.validUntil,
            slippageBps: cfg.slippageBps
        });

        emit CloseRegistered(
            closeId,
            cfg.tokenId,
            owner,
            cfg.pool,
            cfg.operator,
            cfg.payout,
            cfg.sqrtPriceX96Lower,
            cfg.sqrtPriceX96Upper,
            cfg.mode,
            cfg.validUntil,
            cfg.slippageBps
        );
    }

    function executeClose(uint256 closeId, address feeRecipient, uint16 feeBps) external override nonReentrant {
        CloseOrder storage o = _closes[closeId];
        if (o.status != CloseStatus.REGISTERED) revert WrongStatus(CloseStatus.REGISTERED, o.status);
        if (msg.sender != o.operator) revert NotOperator();

        if (o.validUntil != 0 && block.timestamp > o.validUntil) {
            revert CloseExpired(o.validUntil, block.timestamp);
        }

        // Global fee cap enforcement (feeRecipient == 0 => fees disabled regardless of feeBps)
        if (feeBps > MAX_FEE_BPS) revert FeeBpsTooHigh(feeBps, MAX_FEE_BPS);

        // 1) Price check
        uint160 current = _getSqrtPriceX96(o.pool);
        if (!_priceConditionMet(current, o.lower, o.upper, o.mode)) {
            revert PriceConditionNotMet(current, o.lower, o.upper, o.mode);
        }

        // 2) Pre-check NFT ownership + approval (clear errors)
        address actualOwner = _positionManager.ownerOf(o.tokenId);
        if (actualOwner != o.owner) revert NftNotOwnedByRecordedOwner(o.owner, actualOwner);

        bool approved = (_positionManager.getApproved(o.tokenId) == address(this))
            || _positionManager.isApprovedForAll(o.owner, address(this));
        if (!approved) revert NftNotApproved(o.owner, o.tokenId);

        // 3) Pull the NFT from the recorded owner (atomic close)
        _positionManager.transferFrom(o.owner, address(this), o.tokenId);

        // 4) Read position data (liquidity, ticks, token0/token1)
        (
            ,
            ,
            address token0,
            address token1,
            ,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            ,
            ,
            ,

        ) = _positionManager.positions(o.tokenId);

        // 5) Compute expected amounts at current price, derive mins from on-chain slippage policy
        uint160 sqrtPriceAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        (uint256 amount0Expected, uint256 amount1Expected) =
            LiquidityAmounts.getAmountsForLiquidity(current, sqrtPriceAX96, sqrtPriceBX96, liquidity);

        uint256 amount0Min = (amount0Expected * (10_000 - uint256(o.slippageBps))) / 10_000;
        uint256 amount1Min = (amount1Expected * (10_000 - uint256(o.slippageBps))) / 10_000;

        // 6) Decrease ALL liquidity with mins (slippage protection)
        INonfungiblePositionManagerMinimal.DecreaseLiquidityParams memory dec = INonfungiblePositionManagerMinimal
            .DecreaseLiquidityParams({
                tokenId: o.tokenId,
                liquidity: liquidity,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: block.timestamp
            });

        _positionManager.decreaseLiquidity(dec);

        // 7) Collect everything to this contract
        INonfungiblePositionManagerMinimal.CollectParams memory col = INonfungiblePositionManagerMinimal.CollectParams({
            tokenId: o.tokenId,
            recipient: address(this),
            amount0Max: type(uint128).max,
            amount1Max: type(uint128).max
        });

        (uint256 col0, uint256 col1) = _positionManager.collect(col);

        // NOTE: collect() returns the TOTAL collected including what decreaseLiquidity added to tokensOwed.
        // Do NOT add dec0/dec1 here - that would double-count!
        uint256 amount0Out = col0;
        uint256 amount1Out = col1;

        // 8) Mark executed before external transfers (reentrancy hygiene)
        o.status = CloseStatus.EXECUTED;

        // 9) Apply optional operator-chosen fee (only if feeRecipient != 0x0)
        uint256 fee0 = 0;
        uint256 fee1 = 0;

        if (feeRecipient != address(0) && feeBps > 0) {
            fee0 = (amount0Out * uint256(feeBps)) / 10_000;
            fee1 = (amount1Out * uint256(feeBps)) / 10_000;

            if (fee0 > 0) _safeErc20Transfer(token0, feeRecipient, fee0);
            if (fee1 > 0) _safeErc20Transfer(token1, feeRecipient, fee1);

            emit CloseFeeApplied(closeId, feeRecipient, feeBps, fee0, fee1);
        }

        uint256 payout0 = amount0Out - fee0;
        uint256 payout1 = amount1Out - fee1;

        // 10) Payout remainder to the configured payout address
        if (payout0 > 0) _safeErc20Transfer(token0, o.payout, payout0);
        if (payout1 > 0) _safeErc20Transfer(token1, o.payout, payout1);

        emit CloseExecuted(closeId, o.tokenId, o.owner, o.payout, current, amount0Out, amount1Out);

        // 11) Return the now-empty NFT to the owner (not to payout)
        _positionManager.transferFrom(address(this), o.owner, o.tokenId);
    }

    function cancelClose(uint256 closeId) external override {
        CloseOrder storage o = _closes[closeId];
        if (o.status != CloseStatus.REGISTERED) revert WrongStatus(CloseStatus.REGISTERED, o.status);
        if (msg.sender != o.owner) revert NotOwner();

        o.status = CloseStatus.CANCELLED;
        emit CloseCancelled(closeId, o.tokenId, o.owner);
    }

    // ----------------------------
    // Owner updates
    // ----------------------------

    function setCloseOperator(uint256 closeId, address newOperator) external override {
        if (newOperator == address(0)) revert ZeroAddress();
        CloseOrder storage o = _closes[closeId];
        if (msg.sender != o.owner) revert NotOwner();
        if (o.status != CloseStatus.REGISTERED) revert WrongStatus(CloseStatus.REGISTERED, o.status);

        address old = o.operator;
        o.operator = newOperator;
        emit CloseOperatorUpdated(closeId, old, newOperator);
    }

    function setClosePayout(uint256 closeId, address newPayout) external override {
        if (newPayout == address(0)) revert ZeroAddress();
        CloseOrder storage o = _closes[closeId];
        if (msg.sender != o.owner) revert NotOwner();
        if (o.status != CloseStatus.REGISTERED) revert WrongStatus(CloseStatus.REGISTERED, o.status);

        address old = o.payout;
        o.payout = newPayout;
        emit ClosePayoutUpdated(closeId, old, newPayout);
    }

    function setCloseBounds(uint256 closeId, uint160 newLower, uint160 newUpper, TriggerMode newMode) external override {
        CloseOrder storage o = _closes[closeId];
        if (msg.sender != o.owner) revert NotOwner();
        if (o.status != CloseStatus.REGISTERED) revert WrongStatus(CloseStatus.REGISTERED, o.status);

        _validateBounds(newLower, newUpper, newMode);

        uint160 oldLower = o.lower;
        uint160 oldUpper = o.upper;
        TriggerMode oldMode = o.mode;

        o.lower = newLower;
        o.upper = newUpper;
        o.mode = newMode;

        emit CloseBoundsUpdated(closeId, oldLower, oldUpper, oldMode, newLower, newUpper, newMode);
    }

    function setCloseValidUntil(uint256 closeId, uint256 newValidUntil) external override {
        CloseOrder storage o = _closes[closeId];
        if (msg.sender != o.owner) revert NotOwner();
        if (o.status != CloseStatus.REGISTERED) revert WrongStatus(CloseStatus.REGISTERED, o.status);

        uint256 old = o.validUntil;
        o.validUntil = newValidUntil;
        emit CloseValidUntilUpdated(closeId, old, newValidUntil);
    }

    function setCloseSlippage(uint256 closeId, uint16 newSlippageBps) external override {
        if (newSlippageBps > 10_000) revert SlippageBpsOutOfRange(newSlippageBps);
        CloseOrder storage o = _closes[closeId];
        if (msg.sender != o.owner) revert NotOwner();
        if (o.status != CloseStatus.REGISTERED) revert WrongStatus(CloseStatus.REGISTERED, o.status);

        uint16 old = o.slippageBps;
        o.slippageBps = newSlippageBps;
        emit CloseSlippageUpdated(closeId, old, newSlippageBps);
    }

    // ----------------------------
    // Views
    // ----------------------------

    function getCloseOrder(uint256 closeId) external view override returns (CloseOrder memory) {
        return _closes[closeId];
    }

    function getCurrentSqrtPriceX96(address pool) external view override returns (uint160) {
        return _getSqrtPriceX96(pool);
    }

    function canExecuteClose(uint256 closeId) external view override returns (bool) {
        CloseOrder storage o = _closes[closeId];
        if (o.status != CloseStatus.REGISTERED) return false;
        if (o.validUntil != 0 && block.timestamp > o.validUntil) return false;

        uint160 current = _getSqrtPriceX96(o.pool);
        return _priceConditionMet(current, o.lower, o.upper, o.mode);
    }

    // ----------------------------
    // Internal helpers
    // ----------------------------

    function _validateConfig(CloseConfig calldata cfg) internal view {
        if (cfg.pool == address(0) || cfg.payout == address(0) || cfg.operator == address(0)) revert ZeroAddress();
        if (cfg.slippageBps > 10_000) revert SlippageBpsOutOfRange(cfg.slippageBps);

        // Optional: reject already-expired at registration (keeps UI sane)
        if (cfg.validUntil != 0 && cfg.validUntil < block.timestamp) revert CloseExpired(cfg.validUntil, block.timestamp);

        _validateBounds(cfg.sqrtPriceX96Lower, cfg.sqrtPriceX96Upper, cfg.mode);
    }

    function _validateBounds(uint160 lower, uint160 upper, TriggerMode mode) internal pure {
        if (mode == TriggerMode.LOWER_ONLY) {
            if (lower == 0) revert InvalidBounds();
        } else if (mode == TriggerMode.UPPER_ONLY) {
            if (upper == 0) revert InvalidBounds();
        } else {
            if (lower == 0 || upper == 0) revert InvalidBounds();
            if (lower >= upper) revert InvalidBounds();
        }
    }

    function _getSqrtPriceX96(address pool) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool).slot0();
    }

    function _priceConditionMet(uint160 current, uint160 lower, uint160 upper, TriggerMode mode)
        internal
        pure
        returns (bool)
    {
        if (mode == TriggerMode.LOWER_ONLY) return current <= lower;
        if (mode == TriggerMode.UPPER_ONLY) return current >= upper;
        return (current <= lower) || (current >= upper);
    }

    function _safeErc20Transfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount));
        if (!ok) revert TransferFailed();
        if (data.length > 0 && !abi.decode(data, (bool))) revert TransferFailed();
    }
}

/*//////////////////////////////////////////////////////////////
                            Uniswap Math
//////////////////////////////////////////////////////////////*/

library TickMath {
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = -MIN_TICK;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    error TickOutOfRange();

    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        unchecked {
            if (tick < MIN_TICK || tick > MAX_TICK) revert TickOutOfRange();

            uint256 absTick = tick < 0 ? uint256(uint24(-tick)) : uint256(uint24(tick));
            uint256 ratio =
                absTick & 0x1 != 0 ? 0xfffcb933bd6fad37aa2d162d1a594001 : 0x100000000000000000000000000000000;
            if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
            if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
            if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
            if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
            if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
            if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
            if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
            if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
            if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
            if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
            if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
            if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
            if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
            if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
            if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
            if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
            if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
            if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
            if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

            if (tick > 0) ratio = type(uint256).max / ratio;

            sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
        }
    }
}

library LiquidityAmounts {
    function getAmountsForLiquidity(
        uint160 sqrtRatioX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        unchecked {
            if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

            if (sqrtRatioX96 <= sqrtRatioAX96) {
                amount0 = getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
            } else if (sqrtRatioX96 < sqrtRatioBX96) {
                amount0 = getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity);
                amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity);
            } else {
                amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
            }
        }
    }

    function getAmount0ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity)
        internal
        pure
        returns (uint256 amount0)
    {
        unchecked {
            if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
            uint256 intermediate = (uint256(liquidity) << 96) / sqrtRatioAX96;
            amount0 = (intermediate * (sqrtRatioBX96 - sqrtRatioAX96)) / sqrtRatioBX96;
        }
    }

    function getAmount1ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity)
        internal
        pure
        returns (uint256 amount1)
    {
        unchecked {
            if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
            amount1 = (uint256(liquidity) * (sqrtRatioBX96 - sqrtRatioAX96)) / (1 << 96);
        }
    }
}
