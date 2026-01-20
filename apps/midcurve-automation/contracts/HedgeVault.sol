// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IHedgeVault.sol";
import "./interfaces/IParaswap.sol";
import "./interfaces/IERC20Minimal.sol";
import "./interfaces/IERC721Minimal.sol";
import "./interfaces/IUniswapV3PoolMinimal.sol";
import "./interfaces/IUniswapV3Factory.sol";
import "./interfaces/INonfungiblePositionManagerMinimal.sol";
import "./libraries/FullMath.sol";
import "./libraries/TickMath.sol";
import "./libraries/UniswapV3Math.sol";
import "./base/ERC4626Base.sol";
import "./base/ReentrancyGuard.sol";
import "./base/AllowlistBase.sol";
import "./base/Multicall.sol";
import "./base/ParaswapBase.sol";
import "./base/TwapOracleBase.sol";

/**
 * @title HedgeVault
 * @notice ERC-4626 vault managing a single Uniswap V3 LP position with automated SIL/TIP triggers
 * @dev Implements stop-loss (SIL) and take-profit (TIP) automation for concentrated liquidity positions
 *
 * Architecture:
 * - One vault per LP position (not shared like UniswapV3PositionCloser)
 * - Quote token = ERC-4626 asset() = token used for deposits/withdrawals/NAV
 * - Base token = the other pool token = price exposure
 * - Operator = automation wallet that executes triggers
 *
 * State Machine:
 * - UNINITIALIZED → init(tokenId) → IN_POSITION
 * - IN_POSITION → executeSil() → OUT_OF_POSITION_QUOTE
 * - IN_POSITION → executeTip() → OUT_OF_POSITION_BASE
 * - OUT_OF_POSITION_* → executeReopen() → IN_POSITION
 * - Any state → loss cap breached → DEAD
 */
contract HedgeVault is IHedgeVault, ERC4626Base, ReentrancyGuard, AllowlistBase, Multicall, ParaswapBase, TwapOracleBase {
    // ============ Immutables ============

    INonfungiblePositionManagerMinimal public immutable positionManager;
    IUniswapV3Factory public immutable uniswapV3Factory;

    address public immutable override operator;
    address public immutable override manager;  // Deployer with admin powers
    uint16 public immutable override lossCapBps;
    uint256 public immutable override reopenCooldownBlocks;

    // ============ State Variables ============

    State public override state;

    // Mutable trigger thresholds (manager can update)
    uint160 public override silSqrtPriceX96;
    uint160 public override tipSqrtPriceX96;

    // Pause state (automation disabled when true)
    bool public override isPaused;

    // Position info (set at init, mutable for resume)
    address public override baseToken;
    address public override pool;
    bool public override token0IsQuote;
    int24 public override tickLower;
    int24 public override tickUpper;

    // Current position
    uint256 public override currentTokenId;
    uint256[] private _tokenIdHistory;

    // Accounting
    uint256 public override lastCloseBlock;
    uint256 public override pendingAssets;

    // Fee accumulators (scaled by 1e18 for precision) - Quote only
    uint256 public override accQuoteFeesPerShare;

    // Total unclaimed Quote fees held by contract
    uint256 public override totalUnclaimedQuoteFees;

    // Per-user fee debt (for calculating pending fees)
    mapping(address => uint256) public userQuoteFeeDebt;

    // Transient storage for swap callback
    address private _expectedSwapPool;

    // ============ Constructor ============

    constructor(
        address positionManager_,
        address augustusRegistry_,
        address quoteToken_,
        address operator_,
        uint16 lossCapBps_,
        uint256 reopenCooldownBlocks_,
        string memory name_,
        string memory symbol_
    ) ERC4626Base(quoteToken_, name_, symbol_) ParaswapBase(augustusRegistry_) {
        if (positionManager_ == address(0)) revert ZeroAddress();
        if (augustusRegistry_ == address(0)) revert ZeroAddress();
        if (operator_ == address(0)) revert ZeroAddress();
        if (quoteToken_ == address(0)) revert ZeroAddress();

        positionManager = INonfungiblePositionManagerMinimal(positionManager_);
        uniswapV3Factory = IUniswapV3Factory(positionManager.factory());
        operator = operator_;
        manager = msg.sender;  // Deployer becomes manager
        lossCapBps = lossCapBps_;
        reopenCooldownBlocks = reopenCooldownBlocks_;
        _allowlistEnabled = true;  // Allowlist enabled by default

        // Manager is always on allowlist
        _allowlist[msg.sender] = true;

        // SIL/TIP start at 0 (disabled state for normal direction)
        // Manager must call setSil()/setTip() after init() to configure triggers
        state = State.UNINITIALIZED;
    }

    // ============ Modifiers ============

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    modifier onlyManagerOrOperator() {
        if (msg.sender != manager && msg.sender != operator) revert NotManagerOrOperator();
        _;
    }

    modifier whenNotPaused() {
        if (isPaused) revert VaultPausedError();
        _;
    }

    modifier whenInitialized() {
        if (state == State.UNINITIALIZED) revert NotInitialized();
        _;
    }

    // ============ Initialization ============

    /// @inheritdoc IHedgeVault
    function init(uint256 tokenId) external override onlyManager nonReentrant {
        if (state != State.UNINITIALIZED) revert AlreadyInitialized();

        // Transfer NFT to vault and set all position state
        _transferPositionNft(tokenId);

        // Set SIL/TIP to correct disabled values for this direction
        if (token0IsQuote) {
            // Inverted: SIL triggers when currentPrice >= sil, so max disables it
            // Inverted: TIP triggers when currentPrice <= tip, so 0 disables it
            silSqrtPriceX96 = type(uint160).max;
            tipSqrtPriceX96 = 0;
        } else {
            // Normal: SIL triggers when currentPrice <= sil, so 0 disables it
            // Normal: TIP triggers when currentPrice >= tip, so max disables it
            silSqrtPriceX96 = 0;
            tipSqrtPriceX96 = type(uint160).max;
        }

        // Transition to IN_POSITION
        state = State.IN_POSITION;

        // Calculate initial NAV
        uint256 initialNav = _calculateNav();

        // Mint shares to manager (deployer)
        _mint(manager, initialNav);

        emit Initialized(tokenId, pool, tickLower, tickUpper, token0IsQuote);
    }

    // ============ ERC-4626 Core ============

    function totalAssets() public view override(ERC4626Base, IHedgeVault) returns (uint256) {
        if (state == State.UNINITIALIZED) return 0;
        return _calculateNav() + pendingAssets;
    }

    function deposit(uint256 assets, address receiver) public nonReentrant whenInitialized returns (uint256 shares) {
        if (state == State.DEAD) revert VaultIsDead();

        // Check allowlist if enabled (receiver must be allowlisted to receive shares)
        _requireAllowlisted(receiver);

        shares = previewDeposit(assets);
        if (shares == 0) revert ZeroShares();

        // Transfer Quote tokens from sender
        _safeTransferFrom(asset, msg.sender, address(this), assets);

        // Track as pending (will be allocated by manager/operator)
        pendingAssets += assets;

        // Mint shares
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public nonReentrant whenInitialized returns (uint256 assets) {
        if (state == State.DEAD) revert VaultIsDead();

        // Check allowlist if enabled (receiver must be allowlisted to receive shares)
        _requireAllowlisted(receiver);

        assets = previewMint(shares);

        // Transfer Quote tokens from sender
        _safeTransferFrom(asset, msg.sender, address(this), assets);

        // Track as pending (will be allocated by manager/operator)
        pendingAssets += assets;

        // Mint shares
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) public nonReentrant whenInitialized returns (uint256 shares) {
        shares = previewWithdraw(assets);

        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender];
            if (allowed != type(uint256).max) {
                allowance[owner][msg.sender] = allowed - shares;
            }
        }

        // Calculate pending fees BEFORE burning shares
        uint256 pendingQuote = _pendingQuoteFees(owner);

        _burn(owner, shares);

        // Update fee debt for remaining balance
        userQuoteFeeDebt[owner] = (balanceOf[owner] * accQuoteFeesPerShare) / 1e18;

        // Handle withdrawal based on state
        _processWithdrawal(assets, receiver);

        // Transfer pending fees (Quote only)
        if (pendingQuote > 0) {
            totalUnclaimedQuoteFees -= pendingQuote;
            _safeTransfer(asset, receiver, pendingQuote);
            emit FeesClaimed(owner, receiver, pendingQuote);
        }

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) public nonReentrant whenInitialized returns (uint256 assets) {
        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender];
            if (allowed != type(uint256).max) {
                allowance[owner][msg.sender] = allowed - shares;
            }
        }

        assets = previewRedeem(shares);

        // Calculate pending fees BEFORE burning shares
        uint256 pendingQuote = _pendingQuoteFees(owner);

        _burn(owner, shares);

        // Update fee debt for remaining balance
        userQuoteFeeDebt[owner] = (balanceOf[owner] * accQuoteFeesPerShare) / 1e18;

        // Handle withdrawal based on state
        _processWithdrawal(assets, receiver);

        // Transfer pending fees (Quote only)
        if (pendingQuote > 0) {
            totalUnclaimedQuoteFees -= pendingQuote;
            _safeTransfer(asset, receiver, pendingQuote);
            emit FeesClaimed(owner, receiver, pendingQuote);
        }

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    // ============ Transfer Override ============

    function _transfer(address from, address to, uint256 amount) internal override {
        // Check allowlist if enabled (recipient must be allowlisted to receive shares)
        _requireAllowlisted(to);

        // Calculate pending fees for sender BEFORE transfer
        uint256 senderPendingQuote = _pendingQuoteFees(from);

        // Execute transfer
        super._transfer(from, to, amount);

        // Sender keeps their pending fees (adjust debt so pending stays the same)
        userQuoteFeeDebt[from] = (balanceOf[from] * accQuoteFeesPerShare / 1e18) - senderPendingQuote;

        // Receiver starts fresh (no historical fees for transferred shares)
        userQuoteFeeDebt[to] = (balanceOf[to] * accQuoteFeesPerShare) / 1e18;
    }

    function _mint(address to, uint256 amount) internal override {
        super._mint(to, amount);

        // Set fee debt so new minter has 0 pending fees for new shares
        userQuoteFeeDebt[to] = (balanceOf[to] * accQuoteFeesPerShare) / 1e18;
    }

    // ============ Operator Actions ============

    function executeSil(uint256 minQuoteAmount, bytes calldata swapData) external override onlyOperator whenNotPaused nonReentrant {
        if (state != State.IN_POSITION) {
            revert InvalidState(state, State.IN_POSITION);
        }

        // Verify SIL trigger condition
        uint160 currentPrice = _getCurrentSqrtPriceX96();
        if (!_isSilTriggered(currentPrice)) {
            revert SilNotTriggered(currentPrice, silSqrtPriceX96, token0IsQuote);
        }

        // Close position (withdraw liquidity + collect principal)
        _closePosition();

        // Get base token balance and swap Base → Quote
        uint256 baseBalance = IERC20Minimal(baseToken).balanceOf(address(this));
        uint256 quoteReceived = _sellToken(baseToken, asset, baseBalance, minQuoteAmount, swapData);

        // Transition state
        state = State.OUT_OF_POSITION_QUOTE;
        lastCloseBlock = block.number;

        emit PositionClosed(currentTokenId, state);
        emit SilTriggered(currentPrice, quoteReceived);

        currentTokenId = 0;
    }

    function executeTip(uint256 minBaseAmount, bytes calldata swapData) external override onlyOperator whenNotPaused nonReentrant {
        if (state != State.IN_POSITION) {
            revert InvalidState(state, State.IN_POSITION);
        }

        // Verify TIP trigger condition
        uint160 currentPrice = _getCurrentSqrtPriceX96();
        if (!_isTipTriggered(currentPrice)) {
            revert TipNotTriggered(currentPrice, tipSqrtPriceX96, token0IsQuote);
        }

        // Close position (withdraw liquidity + collect principal)
        _closePosition();

        // Get quote token balance and swap Quote → Base
        uint256 quoteBalance = IERC20Minimal(asset).balanceOf(address(this));
        uint256 baseReceived = _sellToken(asset, baseToken, quoteBalance, minBaseAmount, swapData);

        // Transition state
        state = State.OUT_OF_POSITION_BASE;
        lastCloseBlock = block.number;

        emit PositionClosed(currentTokenId, state);
        emit TipTriggered(currentPrice, baseReceived);

        currentTokenId = 0;
    }

    /// @inheritdoc IHedgeVault
    function reopenFromQuote(
        uint256 exactBaseAmount,
        uint256 maxQuoteAmount,
        bytes calldata swapData
    ) external override onlyOperator whenNotPaused nonReentrant {
        if (state != State.OUT_OF_POSITION_QUOTE) {
            revert InvalidState(state, State.OUT_OF_POSITION_QUOTE);
        }

        // Check cooldown
        uint256 requiredBlock = lastCloseBlock + reopenCooldownBlocks;
        if (block.number < requiredBlock) {
            revert CooldownNotExpired(block.number, requiredBlock);
        }

        // Check price is in range
        uint160 currentPrice = _getCurrentSqrtPriceX96();
        if (!_isPriceInRange(currentPrice)) {
            revert PriceNotInRange(currentPrice, silSqrtPriceX96, tipSqrtPriceX96);
        }

        // Buy exact base amount using quote tokens
        _buyToken(baseToken, asset, exactBaseAmount, maxQuoteAmount, swapData);

        // Mint new LP position
        (uint256 newTokenId, uint128 liquidity) = _mintPosition();

        // Calculate leftover quote (not used in LP)
        uint256 leftoverQuote = IERC20Minimal(asset).balanceOf(address(this));

        // Add leftover quote to fee accumulator (if any)
        if (leftoverQuote > 0 && totalSupply > 0) {
            accQuoteFeesPerShare += (leftoverQuote * 1e18) / totalSupply;
            totalUnclaimedQuoteFees += leftoverQuote;
        }

        // Update state
        currentTokenId = newTokenId;
        _tokenIdHistory.push(newTokenId);
        state = State.IN_POSITION;

        emit Reopened(newTokenId, liquidity);
    }

    /// @inheritdoc IHedgeVault
    function reopenFromBase(
        uint256 exactQuoteAmount,
        uint256 maxBaseAmount,
        bytes calldata swapData
    ) external override onlyOperator whenNotPaused nonReentrant {
        if (state != State.OUT_OF_POSITION_BASE) {
            revert InvalidState(state, State.OUT_OF_POSITION_BASE);
        }

        // Check cooldown
        uint256 requiredBlock = lastCloseBlock + reopenCooldownBlocks;
        if (block.number < requiredBlock) {
            revert CooldownNotExpired(block.number, requiredBlock);
        }

        // Check price is in range
        uint160 currentPrice = _getCurrentSqrtPriceX96();
        if (!_isPriceInRange(currentPrice)) {
            revert PriceNotInRange(currentPrice, silSqrtPriceX96, tipSqrtPriceX96);
        }

        // Buy exact quote amount using base tokens
        _buyToken(asset, baseToken, exactQuoteAmount, maxBaseAmount, swapData);

        // Mint new LP position
        (uint256 newTokenId, uint128 liquidity) = _mintPosition();

        // Calculate leftover base (not used in LP)
        uint256 leftoverBase = IERC20Minimal(baseToken).balanceOf(address(this));

        // Swap leftover base to quote via pool and add to fee accumulator
        if (leftoverBase > 0) {
            uint256 quoteDumped = _swapViaPool(baseToken, leftoverBase);
            if (quoteDumped > 0 && totalSupply > 0) {
                accQuoteFeesPerShare += (quoteDumped * 1e18) / totalSupply;
                totalUnclaimedQuoteFees += quoteDumped;
            }
        }

        // Update state
        currentTokenId = newTokenId;
        _tokenIdHistory.push(newTokenId);
        state = State.IN_POSITION;

        emit Reopened(newTokenId, liquidity);
    }

    // ============ View Functions ============

    function tokenIdHistory() external view override returns (uint256[] memory) {
        return _tokenIdHistory;
    }

    function positionCount() external view override returns (uint256) {
        return _tokenIdHistory.length;
    }

    /// @inheritdoc IHedgeVault
    function silEnabled() public view override returns (bool) {
        return _isSilEnabled();
    }

    /// @inheritdoc IHedgeVault
    function tipEnabled() public view override returns (bool) {
        return _isTipEnabled();
    }

    function canExecuteSil() external view override returns (bool) {
        if (state != State.IN_POSITION) return false;
        return _isSilTriggered(_getCurrentSqrtPriceX96());
    }

    function canExecuteTip() external view override returns (bool) {
        if (state != State.IN_POSITION) return false;
        return _isTipTriggered(_getCurrentSqrtPriceX96());
    }

    function canReopenFromQuote() external view override returns (bool) {
        if (state != State.OUT_OF_POSITION_QUOTE) {
            return false;
        }
        if (block.number < lastCloseBlock + reopenCooldownBlocks) {
            return false;
        }
        return _isPriceInRange(_getCurrentSqrtPriceX96());
    }

    function canReopenFromBase() external view override returns (bool) {
        if (state != State.OUT_OF_POSITION_BASE) {
            return false;
        }
        if (block.number < lastCloseBlock + reopenCooldownBlocks) {
            return false;
        }
        return _isPriceInRange(_getCurrentSqrtPriceX96());
    }

    // ============ Manager Actions - Triggers ============

    /// @inheritdoc IHedgeVault
    function setSil(uint160 newSilSqrtPriceX96) external override onlyManager {
        if (state == State.UNINITIALIZED) revert NotInitialized();
        if (state == State.DEAD) revert VaultIsDead();

        // Revert if trying to set disabled value (must use disableSil())
        if (newSilSqrtPriceX96 == 0 || newSilSqrtPriceX96 == type(uint160).max) {
            revert TriggerValueDisabled();
        }

        silSqrtPriceX96 = newSilSqrtPriceX96;
        emit SilTipUpdated(silSqrtPriceX96, tipSqrtPriceX96);
    }

    /// @inheritdoc IHedgeVault
    function setTip(uint160 newTipSqrtPriceX96) external override onlyManager {
        if (state == State.UNINITIALIZED) revert NotInitialized();
        if (state == State.DEAD) revert VaultIsDead();

        // Revert if trying to set disabled value (must use disableTip())
        if (newTipSqrtPriceX96 == 0 || newTipSqrtPriceX96 == type(uint160).max) {
            revert TriggerValueDisabled();
        }

        tipSqrtPriceX96 = newTipSqrtPriceX96;
        emit SilTipUpdated(silSqrtPriceX96, tipSqrtPriceX96);
    }

    /// @inheritdoc IHedgeVault
    function disableSil() external override onlyManager {
        if (state == State.UNINITIALIZED) revert NotInitialized();
        if (state == State.DEAD) revert VaultIsDead();

        // Set to value that can never trigger based on direction
        if (token0IsQuote) {
            // Inverted: SIL triggers when currentPrice >= sil
            // Set to max so currentPrice can never be >= max
            silSqrtPriceX96 = type(uint160).max;
        } else {
            // Normal: SIL triggers when currentPrice <= sil
            // Set to 0 so currentPrice can never be <= 0
            silSqrtPriceX96 = 0;
        }

        emit SilTipUpdated(silSqrtPriceX96, tipSqrtPriceX96);
    }

    /// @inheritdoc IHedgeVault
    function disableTip() external override onlyManager {
        if (state == State.UNINITIALIZED) revert NotInitialized();
        if (state == State.DEAD) revert VaultIsDead();

        // Set to value that can never trigger based on direction
        if (token0IsQuote) {
            // Inverted: TIP triggers when currentPrice <= tip
            // Set to 0 so currentPrice can never be <= 0
            tipSqrtPriceX96 = 0;
        } else {
            // Normal: TIP triggers when currentPrice >= tip
            // Set to max so currentPrice can never be >= max
            tipSqrtPriceX96 = type(uint160).max;
        }

        emit SilTipUpdated(silSqrtPriceX96, tipSqrtPriceX96);
    }

    /// @inheritdoc IHedgeVault
    // TODO: Refactor to accept minQuoteAmount parameter for sandwich attack protection
    function pause(bytes calldata swapData) external override onlyManager nonReentrant {
        if (state != State.IN_POSITION) {
            revert InvalidState(state, State.IN_POSITION);
        }

        // Close position (withdraw liquidity + collect principal)
        _closePosition();

        // Swap Base → Quote
        // TODO: Add minQuoteAmount parameter to function signature for proper protection
        uint256 baseBalance = IERC20Minimal(baseToken).balanceOf(address(this));
        if (baseBalance > 0 && swapData.length > 0) {
            _sellToken(baseToken, asset, baseBalance, 0, swapData);
        }

        // Transition state
        state = State.OUT_OF_POSITION_QUOTE;
        lastCloseBlock = block.number;
        isPaused = true;

        emit PositionClosed(currentTokenId, state);
        emit VaultPaused();

        currentTokenId = 0;
    }

    /// @inheritdoc IHedgeVault
    // TODO: Refactor to use explicit _sellToken()/_buyToken() with min/max parameters
    function resume(int24 newTickLower, int24 newTickUpper, bytes calldata swapData) external override onlyManager nonReentrant {
        if (state != State.OUT_OF_POSITION_QUOTE && state != State.OUT_OF_POSITION_BASE) {
            revert InvalidState(state, State.OUT_OF_POSITION_QUOTE);
        }
        if (!isPaused) revert VaultNotPausedError();
        if (newTickLower >= newTickUpper) revert InvalidTickRange();

        // Update tick range
        tickLower = newTickLower;
        tickUpper = newTickUpper;

        // Clear paused flag
        isPaused = false;

        // Check current price vs SIL/TIP to determine action
        uint160 currentPrice = _getCurrentSqrtPriceX96();

        if (_isSilTriggered(currentPrice)) {
            // Price < SIL (actual) - stay in Quote
            // Already in OUT_OF_POSITION_QUOTE, nothing to do
            emit VaultResumed(newTickLower, newTickUpper);
            return;
        }

        if (_isTipTriggered(currentPrice)) {
            // Price > TIP (actual) - swap to Base
            // TODO: Add minBaseAmount parameter for proper protection
            uint256 quoteBalance = IERC20Minimal(asset).balanceOf(address(this));
            if (quoteBalance > 0 && swapData.length > 0) {
                _sellToken(asset, baseToken, quoteBalance, 0, swapData);
            }
            state = State.OUT_OF_POSITION_BASE;
            emit VaultResumed(newTickLower, newTickUpper);
            return;
        }

        // Price is in range - open LP position
        // TODO: Refactor to use _buyToken() with proper exact amounts
        // For now, use the swap to get base tokens, then mint position
        if (swapData.length > 0) {
            // Decode and execute swap to get base tokens for LP
            (address augustus, bytes memory swapCalldata) = abi.decode(swapData, (address, bytes));
            if (augustusRegistry.isValidAugustus(augustus)) {
                uint256 quoteBalance = IERC20Minimal(asset).balanceOf(address(this));
                address spender = IAugustus(augustus).getTokenTransferProxy();
                _safeApprove(asset, spender, quoteBalance);
                augustus.call(swapCalldata);
                _safeApprove(asset, spender, 0);
                // Continue even if swap fails - will mint with available balances
            }
        }
        (uint256 newTokenId, uint128 liquidity) = _mintPosition();

        // Update state
        currentTokenId = newTokenId;
        _tokenIdHistory.push(newTokenId);
        state = State.IN_POSITION;

        emit VaultResumed(newTickLower, newTickUpper);
        emit Reopened(newTokenId, liquidity);
    }

    // ============ AllowlistBase Hook ============

    /// @dev Access control hook for allowlist management - only manager when not DEAD
    function _checkAllowlistAccess() internal view override {
        if (msg.sender != manager) revert NotManager();
        if (state == State.DEAD) revert VaultIsDead();
    }

    // ============ Manager/Operator Actions - Oracle ============

    /// @inheritdoc IHedgeVault
    function setOraclePoolForPair(
        address tokenA,
        address tokenB,
        uint24 fee,
        uint32 windowSeconds,
        uint128 minOracleLiquidity,
        uint16 alphaBps
    ) external override onlyManagerOrOperator {
        _setOraclePoolForPair(tokenA, tokenB, fee, windowSeconds, minOracleLiquidity, alphaBps);
    }

    /// @inheritdoc IHedgeVault
    function setMaxPriceDeviation(uint16 newMaxDeviationBps) external override onlyManager {
        _setMaxPriceDeviation(newMaxDeviationBps);
    }

    // ============ Manager/Operator Actions - Asset Allocation ============

    /// @inheritdoc IHedgeVault
    function allocatePendingAssets(
        uint256 minAmountIn,
        bytes calldata swapData
    ) external override onlyManagerOrOperator nonReentrant {
        if (state == State.DEAD) revert VaultIsDead();

        uint256 amount = pendingAssets;
        if (amount == 0) revert ZeroAmount();

        // Clear pending before allocation (reentrancy protection)
        pendingAssets = 0;

        uint256 baseReceived;
        uint128 liquidityAdded;

        if (state == State.IN_POSITION) {
            // Swap portion to base and increase liquidity
            // Note: baseRefund/quoteRefund currently ignored - skeleton doesn't do swaps yet
            (liquidityAdded, , ) = _allocateToPosition(amount, minAmountIn, swapData);
        } else if (state == State.OUT_OF_POSITION_BASE) {
            // Swap all quote → base
            baseReceived = _sellToken(asset, baseToken, amount, minAmountIn, swapData);
        }
        // OUT_OF_POSITION_QUOTE: no action needed (already holding quote)

        emit PendingAssetsAllocated(amount, state, baseReceived, liquidityAdded);
    }

    // ============ Fee Collection ============

    /// @inheritdoc IHedgeVault
    /// @dev Collect fees from NFT position and swap Base to Quote. Manager/Operator only.
    function collectFeesFromPosition(uint256 minQuoteAmount, bytes calldata swapData) external override onlyManagerOrOperator nonReentrant {
        if (state != State.IN_POSITION) {
            revert InvalidState(state, State.IN_POSITION);
        }
        if (currentTokenId == 0 || totalSupply == 0) return;

        // Collect fees from NFT (only tokensOwed, not liquidity)
        (uint256 collected0, uint256 collected1) = positionManager.collect(
            INonfungiblePositionManagerMinimal.CollectParams({
                tokenId: currentTokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        if (collected0 == 0 && collected1 == 0) return;

        // Separate into quote and base based on token ordering
        uint256 quoteFees;
        uint256 baseFees;
        if (token0IsQuote) {
            quoteFees = collected0;
            baseFees = collected1;
        } else {
            quoteFees = collected1;
            baseFees = collected0;
        }

        // Swap Base fees → Quote (if swapData provided and baseFees > 0)
        uint256 baseSwapped = 0;
        if (baseFees > 0 && swapData.length > 0) {
            uint256 quoteFromBase = _sellToken(baseToken, asset, baseFees, minQuoteAmount, swapData);
            baseSwapped = baseFees;
            quoteFees += quoteFromBase;
        }

        // Update accumulators (Quote only)
        if (quoteFees > 0) {
            accQuoteFeesPerShare += (quoteFees * 1e18) / totalSupply;
            totalUnclaimedQuoteFees += quoteFees;
        }

        emit FeesCollected(quoteFees, baseSwapped);
    }

    /// @inheritdoc IHedgeVault
    /// @dev Claim accumulated Quote fees. Shareholders only. Does NOT harvest from NFT.
    function collect(address receiver) external override nonReentrant whenInitialized returns (uint256 quoteAmount) {
        // Calculate pending fees for caller
        uint256 shares = balanceOf[msg.sender];
        quoteAmount = _pendingQuoteFees(msg.sender);

        if (quoteAmount == 0) revert NoFeesToClaim();

        // Update fee debt
        userQuoteFeeDebt[msg.sender] = (shares * accQuoteFeesPerShare) / 1e18;

        // Transfer Quote fees
        totalUnclaimedQuoteFees -= quoteAmount;
        _safeTransfer(asset, receiver, quoteAmount);

        emit FeesClaimed(msg.sender, receiver, quoteAmount);
    }

    /// @inheritdoc IHedgeVault
    function pendingFees(address user) external view override returns (uint256 pendingQuote) {
        pendingQuote = _pendingQuoteFees(user);
    }

    // ============ Internal - Fee Logic ============

    function _pendingQuoteFees(address user) internal view returns (uint256) {
        uint256 shares = balanceOf[user];
        if (shares == 0) return 0;
        uint256 accumulated = (shares * accQuoteFeesPerShare) / 1e18;
        uint256 debt = userQuoteFeeDebt[user];
        return accumulated > debt ? accumulated - debt : 0;
    }

    // ============ TwapOracleBase Hook ============

    /// @dev Returns token info needed for oracle operations
    function _getOracleTokenInfo() internal view override returns (
        address quoteToken,
        address baseToken_,
        bool token0IsQuote_,
        IUniswapV3Factory factory,
        address positionPool
    ) {
        return (asset, baseToken, token0IsQuote, uniswapV3Factory, pool);
    }

    // ============ Internal - Trigger Logic ============

    /// @dev Check if SIL trigger is enabled (not set to disabled value)
    function _isSilEnabled() internal view returns (bool) {
        if (token0IsQuote) {
            // Inverted: disabled when sil == type(uint160).max
            return silSqrtPriceX96 != type(uint160).max;
        } else {
            // Normal: disabled when sil == 0
            return silSqrtPriceX96 != 0;
        }
    }

    /// @dev Check if TIP trigger is enabled (not set to disabled value)
    function _isTipEnabled() internal view returns (bool) {
        if (token0IsQuote) {
            // Inverted: disabled when tip == 0
            return tipSqrtPriceX96 != 0;
        } else {
            // Normal: disabled when tip == type(uint160).max
            return tipSqrtPriceX96 != type(uint160).max;
        }
    }

    function _isSilTriggered(uint160 currentPrice) internal view returns (bool) {
        if (!_isSilEnabled()) return false;

        if (token0IsQuote) {
            // sqrtPrice UP = actual price DOWN = SIL triggered
            return currentPrice >= silSqrtPriceX96;
        } else {
            // sqrtPrice DOWN = actual price DOWN = SIL triggered
            return currentPrice <= silSqrtPriceX96;
        }
    }

    function _isTipTriggered(uint160 currentPrice) internal view returns (bool) {
        if (!_isTipEnabled()) return false;

        if (token0IsQuote) {
            // sqrtPrice DOWN = actual price UP = TIP triggered
            return currentPrice <= tipSqrtPriceX96;
        } else {
            // sqrtPrice UP = actual price UP = TIP triggered
            return currentPrice >= tipSqrtPriceX96;
        }
    }

    function _isPriceInRange(uint160 currentPrice) internal view returns (bool) {
        if (token0IsQuote) {
            // Inverted: SIL sqrtPrice > TIP sqrtPrice
            return currentPrice < silSqrtPriceX96 && currentPrice > tipSqrtPriceX96;
        } else {
            // Normal: SIL sqrtPrice < TIP sqrtPrice
            return currentPrice > silSqrtPriceX96 && currentPrice < tipSqrtPriceX96;
        }
    }

    // ============ Internal - Position Management ============

    /// @dev Transfer NFT to vault, validate it, and set all position state
    /// @param tokenId The NFT position ID to transfer
    function _transferPositionNft(uint256 tokenId) internal {
        // Read position data from NFT
        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower_,
            int24 tickUpper_,
            ,  // liquidity - not needed here
            ,
            ,
            ,

        ) = positionManager.positions(tokenId);

        // Validate position contains vault's quote token
        if (token0 != asset && token1 != asset) {
            revert IncompatiblePosition(token0, token1, asset);
        }

        // Determine Quote/Base based on vault asset
        if (token0 == asset) {
            token0IsQuote = true;
            baseToken = token1;
        } else {
            // token1 == asset (guaranteed by validation above)
            token0IsQuote = false;
            baseToken = token0;
        }

        // Store position parameters
        tickLower = tickLower_;
        tickUpper = tickUpper_;

        // Derive and store pool address
        pool = _computePoolAddress(token0, token1, fee);

        // Store token ID
        currentTokenId = tokenId;
        _tokenIdHistory.push(tokenId);

        // Transfer NFT from caller to vault
        positionManager.transferFrom(msg.sender, address(this), tokenId);
    }

    function _closePosition() internal {
        uint256 tokenId = currentTokenId;

        // Get position liquidity
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidity,
            ,
            ,
            ,

        ) = positionManager.positions(tokenId);

        // Decrease all liquidity
        if (liquidity > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManagerMinimal.DecreaseLiquidityParams({
                    tokenId: tokenId,
                    liquidity: liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );
        }

        // Collect all tokens + fees
        positionManager.collect(
            INonfungiblePositionManagerMinimal.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
    }

    function _mintPosition() internal returns (uint256 tokenId, uint128 liquidity) {
        address token0 = token0IsQuote ? asset : baseToken;
        address token1 = token0IsQuote ? baseToken : asset;

        uint256 amount0 = IERC20Minimal(token0).balanceOf(address(this));
        uint256 amount1 = IERC20Minimal(token1).balanceOf(address(this));

        // Approve position manager
        _safeApprove(token0, address(positionManager), amount0);
        _safeApprove(token1, address(positionManager), amount1);

        // Get pool fee
        uint24 fee = IUniswapV3PoolMinimal(pool).fee();

        // Mint position
        (tokenId, liquidity, , ) = positionManager.mint(
            INonfungiblePositionManagerMinimal.MintParams({
                token0: token0,
                token1: token1,
                fee: fee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        // Reset approvals
        _safeApprove(token0, address(positionManager), 0);
        _safeApprove(token1, address(positionManager), 0);
    }

    /// @dev Allocate exactly `quoteAmount` (already held by the vault) into an existing Uniswap V3 position.
    ///      Swap is modeled as **exact-out**: we request a target `baseOut`, and cap quote spent by `maxQuoteIn`.
    ///
    ///      This skeleton:
    ///      - DOES NOT use vault balances as "available amounts" (fees may be mixed in).
    ///      - Treats `quoteAmount` as the full budget for *this* allocation.
    ///      - Computes an *ideal* split at current pool price to derive:
    ///          (a) maxQuoteIn to swap
    ///          (b) target baseOut to buy (exact-out)
    ///      - After swap (omitted), uses actual deltas (quoteSpent, baseReceived) to compute max addable liquidity,
    ///        calls `increaseLiquidity`, and returns leftovers as refunds (baseRefund, quoteRefund).
    ///
    /// @param quoteAmount FULL budget to allocate (swap + add liquidity)
    /// @param minAmountIn Minimum base tokens to receive from swap (slippage protection)
    /// @param swapData Paraswap calldata for quote → base swap
    /// @return liquidityAdded Amount of liquidity added to position
    /// @return baseRefund Unused base tokens returned to caller
    /// @return quoteRefund Unused quote tokens returned to caller
    function _allocateToPosition(
        uint256 quoteAmount,
        uint256 minAmountIn,
        bytes calldata swapData
    ) internal returns (uint128 liquidityAdded, uint256 baseRefund, uint256 quoteRefund) {
        // Early return if nothing to allocate
        if (quoteAmount == 0) {
            return (0, 0, 0);
        }

        // Determine token addresses
        address token0 = token0IsQuote ? asset : baseToken;
        address token1 = token0IsQuote ? baseToken : asset;

        // -------------------------
        // 1) Read pool price + bounds
        // -------------------------
        (uint160 sqrtRatioX96, , , , , , ) = IUniswapV3PoolMinimal(pool).slot0();

        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        // -------------------------
        // 2) Compute ideal maxQuoteIn and targetBaseOut (EXACT-OUT swap intent)
        // -------------------------
        // maxQuoteInIdeal = how much of quoteAmount we are willing to spend in the swap (cap).
        // baseOutTargetIdeal = how much base we try to buy for that cap, under constant-price assumption.
        uint256 maxQuoteInIdeal;
        uint256 baseOutTargetIdeal;

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            // Below range: position is token0-only
            // If quote is token0 -> no swap
            // If quote is token1 -> we need token0 => swap (ideally) all quote into token0
            maxQuoteInIdeal = token0IsQuote ? 0 : quoteAmount;
            baseOutTargetIdeal = UniswapV3Math.quoteToBaseAtPrice(maxQuoteInIdeal, sqrtRatioX96, token0IsQuote);

        } else if (sqrtRatioX96 >= sqrtRatioBX96) {
            // Above range: position is token1-only
            // If quote is token1 -> no swap
            // If quote is token0 -> we need token1 => swap all quote into token1
            maxQuoteInIdeal = token0IsQuote ? quoteAmount : 0;
            baseOutTargetIdeal = UniswapV3Math.quoteToBaseAtPrice(maxQuoteInIdeal, sqrtRatioX96, token0IsQuote);

        } else {
            // In-range: compute ideal swap cap to get roughly balanced amounts
            maxQuoteInIdeal = UniswapV3Math.computeIdealInRangeSwapQuote(
                quoteAmount,
                sqrtRatioX96,
                sqrtRatioAX96,
                sqrtRatioBX96,
                token0IsQuote
            );

            // For exact-out, we also need a target base-out.
            // We approximate baseOutTarget from constant-price conversion.
            baseOutTargetIdeal = UniswapV3Math.quoteToBaseAtPrice(maxQuoteInIdeal, sqrtRatioX96, token0IsQuote);
        }

        // -------------------------
        // 3) Execute swap EXACT-OUT + measure deltas
        // -------------------------
        // quoteAmount is already in the vault and includes *only* what should be allocated.
        // Therefore, the swap + mint must be constrained to this budget, not to global vault balances.
        //
        // We compute what actually happened via balance deltas after the swap.
        uint256 quoteSpent;
        uint256 baseReceived;

        if (swapData.length > 0 && maxQuoteInIdeal > 0) {
            // Execute swap and measure actual amounts via balance deltas
            uint256 quoteBefore = IERC20Minimal(asset).balanceOf(address(this));
            uint256 baseBefore = IERC20Minimal(baseToken).balanceOf(address(this));

            _sellToken(asset, baseToken, maxQuoteInIdeal, minAmountIn, swapData);

            uint256 quoteAfter = IERC20Minimal(asset).balanceOf(address(this));
            uint256 baseAfter = IERC20Minimal(baseToken).balanceOf(address(this));

            quoteSpent = quoteBefore - quoteAfter;
            baseReceived = baseAfter - baseBefore;
        } else {
            // No swap needed
            quoteSpent = 0;
            baseReceived = 0;
        }

        // Silence unused variable warning for skeleton
        baseOutTargetIdeal;

        // Budget remainder after swap:
        // - For exact-out, quoteSpent should be <= maxQuoteInIdeal (and <= quoteAmount).
        // - If the swap spends LESS than the cap, quoteLeft increases, which is fine;
        //   the LiquidityAmounts step will take the min side and refund leftovers.
        uint256 quoteLeft = quoteAmount - quoteSpent;

        // -------------------------
        // 4) Map budget-derived amounts into token0/token1 for Liquidity math
        // -------------------------
        // token0IsQuote:
        // - true  => quote=token0, base=token1
        // - false => quote=token1, base=token0
        uint256 amount0Avail;
        uint256 amount1Avail;

        if (token0IsQuote) {
            amount0Avail = quoteLeft;    // token0
            amount1Avail = baseReceived; // token1
        } else {
            amount0Avail = baseReceived; // token0
            amount1Avail = quoteLeft;    // token1
        }

        // -------------------------
        // 5) Compute max-addable liquidity (and corresponding used amounts)
        // -------------------------
        uint256 amount0Desired;
        uint256 amount1Desired;

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            // token0-only
            amount0Desired = amount0Avail;
            amount1Desired = 0;

        } else if (sqrtRatioX96 >= sqrtRatioBX96) {
            // token1-only
            amount0Desired = 0;
            amount1Desired = amount1Avail;

        } else {
            uint128 L0 = UniswapV3Math.getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0Avail);
            uint128 L1 = UniswapV3Math.getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1Avail);
            uint128 L = L0 < L1 ? L0 : L1;

            amount0Desired = UniswapV3Math.getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, L);
            amount1Desired = UniswapV3Math.getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, L);
        }

        // Early return if nothing to add
        if (amount0Desired == 0 && amount1Desired == 0) {
            if (token0IsQuote) {
                quoteRefund = amount0Avail;
                baseRefund = amount1Avail;
            } else {
                quoteRefund = amount1Avail;
                baseRefund = amount0Avail;
            }
            return (0, baseRefund, quoteRefund);
        }

        // -------------------------
        // 6) increaseLiquidity
        // -------------------------
        _safeApprove(token0, address(positionManager), amount0Desired);
        _safeApprove(token1, address(positionManager), amount1Desired);

        uint256 amount0Consumed;
        uint256 amount1Consumed;
        (liquidityAdded, amount0Consumed, amount1Consumed) = positionManager.increaseLiquidity(
            INonfungiblePositionManagerMinimal.IncreaseLiquidityParams({
                tokenId: currentTokenId,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            })
        );

        _safeApprove(token0, address(positionManager), 0);
        _safeApprove(token1, address(positionManager), 0);

        // -------------------------
        // 7) Compute refunds relative to the BUDGET amounts (not global vault balances)
        // -------------------------
        uint256 refund0 = amount0Avail > amount0Consumed ? (amount0Avail - amount0Consumed) : 0;
        uint256 refund1 = amount1Avail > amount1Consumed ? (amount1Avail - amount1Consumed) : 0;

        if (token0IsQuote) {
            quoteRefund = refund0; // token0
            baseRefund = refund1;  // token1
        } else {
            quoteRefund = refund1; // token1
            baseRefund = refund0;  // token0
        }

        // NOTE:
        // Whether you transfer refunds out or keep them internally is vault-accounting specific.
        // Here we just return them.
    }

    // ============ Internal - Swap Hooks (ParaswapBase) ============

    /// @dev Post-swap hook to validate price against TWAP
    function _afterSwap(
        address,
        address buyToken,
        uint256 sellAmount,
        uint256 buyAmount
    ) internal override {
        bool isBuyingBase = buyToken == baseToken;
        _validatePriceAgainstTwap(sellAmount, buyAmount, isBuyingBase);
    }

    // ============ Internal - Pool Swap ============

    /// @notice Swap tokens directly through the position pool (for leftover handling)
    /// @param sellToken Token to sell
    /// @param sellAmount Amount to sell
    /// @return amountReceived Amount of other token received
    function _swapViaPool(
        address sellToken,
        uint256 sellAmount
    ) internal returns (uint256 amountReceived) {
        if (sellAmount == 0) return 0;

        // Determine swap direction
        bool zeroForOne = sellToken == IUniswapV3PoolMinimal(pool).token0();
        address buyToken = zeroForOne ? IUniswapV3PoolMinimal(pool).token1() : IUniswapV3PoolMinimal(pool).token0();

        // Record balance before
        uint256 buyBalanceBefore = IERC20Minimal(buyToken).balanceOf(address(this));

        // Set expected pool for callback validation
        _expectedSwapPool = pool;

        // Execute swap via pool
        // Negative amountSpecified = exact input swap
        IUniswapV3PoolMinimal(pool).swap(
            address(this),
            zeroForOne,
            int256(sellAmount),
            zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341, // Min/max sqrt price
            abi.encode(sellToken)
        );

        // Clear expected pool
        _expectedSwapPool = address(0);

        // Calculate amount received
        amountReceived = IERC20Minimal(buyToken).balanceOf(address(this)) - buyBalanceBefore;
    }

    /// @notice Uniswap V3 swap callback
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        // Validate caller is the expected pool
        if (msg.sender != _expectedSwapPool) revert InvalidSwapDirection();

        // Decode the token we need to pay
        address tokenToPay = abi.decode(data, (address));

        // Pay the required amount
        uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        _safeTransfer(tokenToPay, msg.sender, amountToPay);
    }

    // ============ Internal - Withdrawal ============

    function _processWithdrawal(uint256 assets, address receiver) internal {
        if (state == State.IN_POSITION) {
            // TODO: Remove pro-rata liquidity, swap to Quote, send to receiver
            // For now, just send Quote if available
            _safeTransfer(asset, receiver, assets);
        } else if (state == State.OUT_OF_POSITION_QUOTE || state == State.DEAD) {
            // Just send Quote tokens
            _safeTransfer(asset, receiver, assets);
        } else if (state == State.OUT_OF_POSITION_BASE) {
            // TODO: Swap Base to Quote and send
            // For now, revert - withdrawals from BASE state need swap
            revert InvalidState(state, State.OUT_OF_POSITION_QUOTE);
        }
    }

    // ============ Internal - NAV Calculation ============

    function _calculateNav() internal view returns (uint256) {
        if (state == State.UNINITIALIZED) return 0;

        if (state == State.OUT_OF_POSITION_QUOTE || state == State.DEAD) {
            // Quote balance minus unclaimed quote fees (fees belong to shareholders, not NAV)
            uint256 balance = IERC20Minimal(asset).balanceOf(address(this));
            return balance > totalUnclaimedQuoteFees ? balance - totalUnclaimedQuoteFees : 0;
        }

        if (state == State.OUT_OF_POSITION_BASE) {
            // All Base balance is principal (no Base fees accumulated), converted to Quote value
            uint256 baseBalance = IERC20Minimal(baseToken).balanceOf(address(this));
            return _convertBaseToQuote(baseBalance);
        }

        // IN_POSITION: Calculate position value (excludes tokensOwed which are fees)
        return _calculatePositionValue();
    }

    function _calculatePositionValue() internal view returns (uint256) {
        uint256 tokenId = currentTokenId;
        if (tokenId == 0) return 0;

        // Get position data (tokensOwed excluded - fees tracked separately via accQuoteFeesPerShare)
        (
            ,
            ,
            ,
            ,
            ,
            int24 tickLower_,
            int24 tickUpper_,
            uint128 liquidity,
            ,
            ,
            ,  // tokensOwed0 - excluded (fees)
               // tokensOwed1 - excluded (fees)
        ) = positionManager.positions(tokenId);

        // Get current price
        uint160 sqrtPriceX96 = _getCurrentSqrtPriceX96();

        // Calculate principal value from liquidity (excludes uncollected fees)
        (uint256 amount0, uint256 amount1) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            tickLower_,
            tickUpper_,
            liquidity
        );

        // Convert to Quote value
        if (token0IsQuote) {
            // token0 is Quote, token1 is Base
            return amount0 + _convertBaseToQuote(amount1);
        } else {
            // token1 is Quote, token0 is Base
            return amount1 + _convertBaseToQuote(amount0);
        }
    }

    function _convertBaseToQuote(uint256 baseAmount) internal view returns (uint256) {
        if (baseAmount == 0) return 0;

        // Prefer TWAP if configured (more manipulation-resistant)
        uint256 twapPrice = _getTwapPriceQuotePerBase1e18();
        if (twapPrice > 0) {
            // quoteAmount = baseAmount * (quote/base) where twapPrice is (quote/base) scaled by 1e18
            return FullMath.mulDiv(baseAmount, twapPrice, 1e18);
        }

        // Spot fallback (Uniswap V3 math, overflow-safe)
        // sqrtPriceX96 = sqrt(token1/token0) * 2^96
        uint160 sqrtPriceX96 = _getCurrentSqrtPriceX96();

        // We want quoteAmountRaw given baseAmountRaw, respecting pool token ordering.
        // token0IsQuote:
        //   token0 = quote, token1 = base, so token1/token0 = base/quote => quote/base = 1/(base/quote)
        // !token0IsQuote:
        //   token0 = base,  token1 = quote, so token1/token0 = quote/base => quote/base directly
        if (token0IsQuote) {
            // quote/base = (2^192) / (sqrtPriceX96^2)
            // quoteAmount = baseAmount * quote/base
            // = baseAmount * 2^192 / sqrtPriceX96^2
            //
            // Compute sqrtPriceX96^2 / 2^192 as a Q0 rational via FullMath without overflow:
            // quoteAmount = FullMath.mulDiv(baseAmount, 2^192, sqrtPriceX96^2)
            // But sqrtPriceX96^2 may overflow 256; avoid squaring directly:
            //
            // Use: baseAmount * 2^192 / (sqrtPrice^2)
            //     = baseAmount * 2^96 / sqrtPrice  * 2^96 / sqrtPrice
            // Do it in two mulDiv steps to avoid overflow.
            uint256 q = FullMath.mulDiv(baseAmount, uint256(1) << 96, uint256(sqrtPriceX96));
            return FullMath.mulDiv(q, uint256(1) << 96, uint256(sqrtPriceX96));
        } else {
            // quote/base = sqrtPriceX96^2 / 2^192
            // quoteAmount = baseAmount * sqrtPriceX96^2 / 2^192
            //
            // Avoid squaring directly by splitting:
            // baseAmount * sqrtPrice^2 / 2^192
            // = baseAmount * sqrtPrice / 2^96 * sqrtPrice / 2^96
            uint256 q = FullMath.mulDiv(baseAmount, uint256(sqrtPriceX96), uint256(1) << 96);
            return FullMath.mulDiv(q, uint256(sqrtPriceX96), uint256(1) << 96);
        }
    }

    // ============ Internal - Uniswap Math ============

    function _getCurrentSqrtPriceX96() internal view returns (uint160) {
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool).slot0();
        return sqrtPriceX96;
    }

    // ============ Internal - Pool Address ============

    function _computePoolAddress(address token0, address token1, uint24 fee) internal view returns (address) {
        // Uniswap V3 pool init code hash (same across all chains for official Uniswap V3)
        bytes32 POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;

        // Ensure token0 < token1
        if (token0 > token1) {
            (token0, token1) = (token1, token0);
        }

        bytes32 salt = keccak256(abi.encode(token0, token1, fee));

        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(uniswapV3Factory),
            salt,
            POOL_INIT_CODE_HASH
        )))));
    }

    // ============ Internal - Safe Transfers ============

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal override {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "APPROVE_FAILED");
    }
}
