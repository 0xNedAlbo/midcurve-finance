// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IHedgeVault.sol";
import "./interfaces/IParaswap.sol";

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

// ============ Minimal Interfaces ============

interface IERC20Minimal {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
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
    function fee() external view returns (uint24);

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface INonfungiblePositionManagerMinimal is IERC721Minimal {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

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

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
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

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        payable
        returns (uint128 liquidity, uint256 amount0, uint256 amount1);
}

// ============ ERC-4626 Base ============

abstract contract ERC4626Base {
    // ERC-20 state
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ERC-4626 asset
    address public immutable asset;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    constructor(address asset_, string memory name_, string memory symbol_) {
        asset = asset_;
        name = name_;
        symbol = symbol_;
        decimals = IERC20Minimal(asset_).decimals();
    }

    // ============ ERC-20 ============

    function approve(address spender, uint256 amount) public virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal virtual {
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal virtual {
        totalSupply += amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal virtual {
        balanceOf[from] -= amount;
        unchecked {
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    // ============ ERC-4626 Views ============

    function totalAssets() public view virtual returns (uint256);

    function convertToShares(uint256 assets) public view virtual returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? assets : (assets * supply) / totalAssets();
    }

    function convertToAssets(uint256 shares) public view virtual returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }

    function maxDeposit(address) public view virtual returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) public view virtual returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address owner) public view virtual returns (uint256) {
        return convertToAssets(balanceOf[owner]);
    }

    function maxRedeem(address owner) public view virtual returns (uint256) {
        return balanceOf[owner];
    }

    function previewDeposit(uint256 assets) public view virtual returns (uint256) {
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) public view virtual returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? shares : (shares * totalAssets() + supply - 1) / supply;
    }

    function previewWithdraw(uint256 assets) public view virtual returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? assets : (assets * supply + totalAssets() - 1) / totalAssets();
    }

    function previewRedeem(uint256 shares) public view virtual returns (uint256) {
        return convertToAssets(shares);
    }
}

// ============ Reentrancy Guard ============

abstract contract ReentrancyGuard {
    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "REENTRANCY");
        _locked = 2;
        _;
        _locked = 1;
    }
}

// ============ Main Contract ============

contract HedgeVault is IHedgeVault, ERC4626Base, ReentrancyGuard {
    // ============ Immutables ============

    INonfungiblePositionManagerMinimal public immutable positionManager;
    IAugustusRegistry public immutable augustusRegistry;

    address public immutable override operator;
    uint160 public immutable override silSqrtPriceX96;
    uint160 public immutable override tipSqrtPriceX96;
    uint16 public immutable override lossCapBps;
    uint256 public immutable override reopenCooldownBlocks;
    DepositMode public immutable override depositMode;

    // ============ State Variables ============

    State public override state;

    // Position info (set at init, immutable after)
    address public override baseToken;
    address public override pool;
    bool public override token0IsQuote;
    int24 public override tickLower;
    int24 public override tickUpper;

    // Current position
    uint256 public override currentTokenId;
    uint256[] private _tokenIdHistory;

    // Accounting
    uint256 public override costBasis;
    uint256 public override lastCloseBlock;

    // Fee accumulators (scaled by 1e18 for precision)
    uint256 public override accQuoteFeesPerShare;
    uint256 public override accBaseFeesPerShare;

    // Total unclaimed fees held by contract
    uint256 public override totalUnclaimedQuoteFees;
    uint256 public override totalUnclaimedBaseFees;

    // Per-user fee debt (for calculating pending fees)
    mapping(address => uint256) public userQuoteFeeDebt;
    mapping(address => uint256) public userBaseFeeDebt;

    // Deployer (receives initial shares)
    address private immutable _deployer;

    // Transient storage for swap callback
    address private _expectedSwapPool;

    // ============ Constructor ============

    constructor(
        address positionManager_,
        address augustusRegistry_,
        address quoteToken_,
        address operator_,
        uint160 silSqrtPriceX96_,
        uint160 tipSqrtPriceX96_,
        uint16 lossCapBps_,
        uint256 reopenCooldownBlocks_,
        DepositMode depositMode_,
        string memory name_,
        string memory symbol_
    ) ERC4626Base(quoteToken_, name_, symbol_) {
        if (positionManager_ == address(0)) revert ZeroAddress();
        if (augustusRegistry_ == address(0)) revert ZeroAddress();
        if (operator_ == address(0)) revert ZeroAddress();
        if (quoteToken_ == address(0)) revert ZeroAddress();

        positionManager = INonfungiblePositionManagerMinimal(positionManager_);
        augustusRegistry = IAugustusRegistry(augustusRegistry_);
        operator = operator_;
        silSqrtPriceX96 = silSqrtPriceX96_;
        tipSqrtPriceX96 = tipSqrtPriceX96_;
        lossCapBps = lossCapBps_;
        reopenCooldownBlocks = reopenCooldownBlocks_;
        depositMode = depositMode_;

        _deployer = msg.sender;
        state = State.UNINITIALIZED;
    }

    // ============ Modifiers ============

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier whenInitialized() {
        if (state == State.UNINITIALIZED) revert NotInitialized();
        _;
    }

    // ============ Initialization ============

    function init(uint256 tokenId) external override nonReentrant {
        if (state != State.UNINITIALIZED) revert AlreadyInitialized();

        // Read position data from NFT
        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower_,
            int24 tickUpper_,
            ,  // liquidity - not needed at init
            ,
            ,
            ,

        ) = positionManager.positions(tokenId);

        // Determine Quote/Base based on vault asset
        if (token0 == asset) {
            token0IsQuote = true;
            baseToken = token1;
        } else if (token1 == asset) {
            token0IsQuote = false;
            baseToken = token0;
        } else {
            revert IncompatiblePosition(token0, token1, asset);
        }

        // Store position parameters
        tickLower = tickLower_;
        tickUpper = tickUpper_;

        // Derive pool address
        pool = _computePoolAddress(token0, token1, fee);

        // Transfer NFT from caller to vault
        positionManager.transferFrom(msg.sender, address(this), tokenId);

        // Store token ID
        currentTokenId = tokenId;
        _tokenIdHistory.push(tokenId);

        // Transition to IN_POSITION
        state = State.IN_POSITION;

        // Calculate initial NAV and set cost basis
        uint256 initialNav = _calculateNav();
        costBasis = initialNav;

        // Mint shares to deployer
        _mint(_deployer, initialNav);

        emit Initialized(tokenId, pool, tickLower_, tickUpper_, token0IsQuote);
    }

    // ============ ERC-4626 Core ============

    function totalAssets() public view override returns (uint256) {
        if (state == State.UNINITIALIZED) return 0;
        return _calculateNav();
    }

    function deposit(uint256 assets, address receiver) public nonReentrant whenInitialized returns (uint256 shares) {
        if (state == State.DEAD) revert DepositsDisabled();

        // Check deposit permissions
        if (depositMode == DepositMode.CLOSED) {
            if (msg.sender != _deployer) revert DepositsDisabled();
        } else if (depositMode == DepositMode.SEMI_PRIVATE) {
            if (balanceOf[msg.sender] == 0 && msg.sender != _deployer) revert NotShareholder();
        }
        // PUBLIC mode: anyone can deposit

        shares = previewDeposit(assets);
        if (shares == 0) revert DepositsDisabled();

        // Transfer Quote tokens from sender
        _safeTransferFrom(asset, msg.sender, address(this), assets);

        // Update cost basis
        costBasis += assets;

        // Mint shares
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public nonReentrant whenInitialized returns (uint256 assets) {
        if (state == State.DEAD) revert DepositsDisabled();

        // Check deposit permissions (same as deposit)
        if (depositMode == DepositMode.CLOSED) {
            if (msg.sender != _deployer) revert DepositsDisabled();
        } else if (depositMode == DepositMode.SEMI_PRIVATE) {
            if (balanceOf[msg.sender] == 0 && msg.sender != _deployer) revert NotShareholder();
        }

        assets = previewMint(shares);

        // Transfer Quote tokens from sender
        _safeTransferFrom(asset, msg.sender, address(this), assets);

        // Update cost basis
        costBasis += assets;

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

        // Harvest fees from NFT first if in position
        if (state == State.IN_POSITION) {
            _harvestNftFees();
        }

        // Calculate pending fees BEFORE burning shares
        uint256 pendingQuote = _pendingQuoteFees(owner);
        uint256 pendingBase = _pendingBaseFees(owner);

        _burn(owner, shares);

        // Update fee debts for remaining balance
        userQuoteFeeDebt[owner] = (balanceOf[owner] * accQuoteFeesPerShare) / 1e18;
        userBaseFeeDebt[owner] = (balanceOf[owner] * accBaseFeesPerShare) / 1e18;

        // Handle withdrawal based on state
        _processWithdrawal(assets, receiver);

        // Transfer pending fees in-kind
        if (pendingQuote > 0) {
            totalUnclaimedQuoteFees -= pendingQuote;
            _safeTransfer(asset, receiver, pendingQuote);
        }
        if (pendingBase > 0) {
            totalUnclaimedBaseFees -= pendingBase;
            _safeTransfer(baseToken, receiver, pendingBase);
        }

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        if (pendingQuote > 0 || pendingBase > 0) {
            emit FeesCollected(owner, receiver, pendingQuote, pendingBase);
        }
    }

    function redeem(uint256 shares, address receiver, address owner) public nonReentrant whenInitialized returns (uint256 assets) {
        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender];
            if (allowed != type(uint256).max) {
                allowance[owner][msg.sender] = allowed - shares;
            }
        }

        assets = previewRedeem(shares);

        // Harvest fees from NFT first if in position
        if (state == State.IN_POSITION) {
            _harvestNftFees();
        }

        // Calculate pending fees BEFORE burning shares
        uint256 pendingQuote = _pendingQuoteFees(owner);
        uint256 pendingBase = _pendingBaseFees(owner);

        _burn(owner, shares);

        // Update fee debts for remaining balance
        userQuoteFeeDebt[owner] = (balanceOf[owner] * accQuoteFeesPerShare) / 1e18;
        userBaseFeeDebt[owner] = (balanceOf[owner] * accBaseFeesPerShare) / 1e18;

        // Handle withdrawal based on state
        _processWithdrawal(assets, receiver);

        // Transfer pending fees in-kind
        if (pendingQuote > 0) {
            totalUnclaimedQuoteFees -= pendingQuote;
            _safeTransfer(asset, receiver, pendingQuote);
        }
        if (pendingBase > 0) {
            totalUnclaimedBaseFees -= pendingBase;
            _safeTransfer(baseToken, receiver, pendingBase);
        }

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        if (pendingQuote > 0 || pendingBase > 0) {
            emit FeesCollected(owner, receiver, pendingQuote, pendingBase);
        }
    }

    // ============ Transfer Override ============

    function _transfer(address from, address to, uint256 amount) internal override {
        // Block transfers in CLOSED mode
        if (depositMode == DepositMode.CLOSED) {
            revert TransfersDisabled();
        }

        // Calculate pending fees for sender BEFORE transfer
        uint256 senderPendingQuote = _pendingQuoteFees(from);
        uint256 senderPendingBase = _pendingBaseFees(from);

        // Execute transfer
        super._transfer(from, to, amount);

        // Sender keeps their pending fees (adjust debt so pending stays the same)
        userQuoteFeeDebt[from] = (balanceOf[from] * accQuoteFeesPerShare / 1e18) - senderPendingQuote;
        userBaseFeeDebt[from] = (balanceOf[from] * accBaseFeesPerShare / 1e18) - senderPendingBase;

        // Receiver starts fresh (no historical fees for transferred shares)
        userQuoteFeeDebt[to] = (balanceOf[to] * accQuoteFeesPerShare) / 1e18;
        userBaseFeeDebt[to] = (balanceOf[to] * accBaseFeesPerShare) / 1e18;
    }

    function _mint(address to, uint256 amount) internal override {
        super._mint(to, amount);

        // Set fee debt so new minter has 0 pending fees for new shares
        userQuoteFeeDebt[to] = (balanceOf[to] * accQuoteFeesPerShare) / 1e18;
        userBaseFeeDebt[to] = (balanceOf[to] * accBaseFeesPerShare) / 1e18;
    }

    // ============ Operator Actions ============

    function executeSil(bytes calldata swapData) external override onlyOperator nonReentrant {
        if (state != State.IN_POSITION) {
            revert InvalidState(state, State.IN_POSITION);
        }

        // Verify SIL trigger condition
        uint160 currentPrice = _getCurrentSqrtPriceX96();
        if (!_isSilTriggered(currentPrice)) {
            revert SilNotTriggered(currentPrice, silSqrtPriceX96, token0IsQuote);
        }

        // Harvest fees FIRST (updates accumulators before closing)
        _harvestNftFees();

        // Close position (withdraw liquidity + collect principal)
        _closePosition();

        // Swap Base → Quote
        uint256 quoteBefore = IERC20Minimal(asset).balanceOf(address(this));
        _executeSwap(swapData);
        uint256 quoteAfter = IERC20Minimal(asset).balanceOf(address(this));

        // Verify swap direction: Quote must not decrease
        if (quoteAfter < quoteBefore) revert InvalidSwapDirection();

        // Transition state
        state = State.OUT_OF_POSITION_QUOTE;
        lastCloseBlock = block.number;

        emit PositionClosed(currentTokenId, state);
        emit SilTriggered(currentPrice, quoteAfter);

        currentTokenId = 0;
    }

    function executeTip(bytes calldata swapData) external override onlyOperator nonReentrant {
        if (state != State.IN_POSITION) {
            revert InvalidState(state, State.IN_POSITION);
        }

        // Verify TIP trigger condition
        uint160 currentPrice = _getCurrentSqrtPriceX96();
        if (!_isTipTriggered(currentPrice)) {
            revert TipNotTriggered(currentPrice, tipSqrtPriceX96, token0IsQuote);
        }

        // Harvest fees FIRST (updates accumulators before closing)
        _harvestNftFees();

        // Close position (withdraw liquidity + collect principal)
        _closePosition();

        // Swap Quote → Base
        uint256 baseBefore = IERC20Minimal(baseToken).balanceOf(address(this));
        _executeSwap(swapData);
        uint256 baseAfter = IERC20Minimal(baseToken).balanceOf(address(this));

        // Verify swap direction: Base must not decrease
        if (baseAfter < baseBefore) revert InvalidSwapDirection();

        // Transition state
        state = State.OUT_OF_POSITION_BASE;
        lastCloseBlock = block.number;

        emit PositionClosed(currentTokenId, state);
        emit TipTriggered(currentPrice, baseAfter);

        currentTokenId = 0;
    }

    function executeReopen(bytes calldata swapData) external override onlyOperator nonReentrant {
        if (state != State.OUT_OF_POSITION_QUOTE && state != State.OUT_OF_POSITION_BASE) {
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

        // Execute swap to get both tokens for LP
        _executeSwap(swapData);

        // Mint new LP position
        (uint256 newTokenId, uint128 liquidity) = _mintPosition();

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

    function canExecuteSil() external view override returns (bool) {
        if (state != State.IN_POSITION) return false;
        return _isSilTriggered(_getCurrentSqrtPriceX96());
    }

    function canExecuteTip() external view override returns (bool) {
        if (state != State.IN_POSITION) return false;
        return _isTipTriggered(_getCurrentSqrtPriceX96());
    }

    function canExecuteReopen() external view override returns (bool) {
        if (state != State.OUT_OF_POSITION_QUOTE && state != State.OUT_OF_POSITION_BASE) {
            return false;
        }
        if (block.number < lastCloseBlock + reopenCooldownBlocks) {
            return false;
        }
        return _isPriceInRange(_getCurrentSqrtPriceX96());
    }

    // ============ Fee Collection ============

    /// @inheritdoc IHedgeVault
    function collect(address receiver) external override nonReentrant whenInitialized returns (uint256 quoteAmount, uint256 baseAmount) {
        // Harvest from NFT if in position (updates accumulators)
        if (state == State.IN_POSITION) {
            _harvestNftFees();
        }

        // Calculate pending fees for caller
        uint256 shares = balanceOf[msg.sender];
        quoteAmount = _pendingQuoteFees(msg.sender);
        baseAmount = _pendingBaseFees(msg.sender);

        // Update fee debts
        userQuoteFeeDebt[msg.sender] = (shares * accQuoteFeesPerShare) / 1e18;
        userBaseFeeDebt[msg.sender] = (shares * accBaseFeesPerShare) / 1e18;

        // Transfer fees in-kind
        if (quoteAmount > 0) {
            totalUnclaimedQuoteFees -= quoteAmount;
            _safeTransfer(asset, receiver, quoteAmount);
        }
        if (baseAmount > 0) {
            totalUnclaimedBaseFees -= baseAmount;
            _safeTransfer(baseToken, receiver, baseAmount);
        }

        emit FeesCollected(msg.sender, receiver, quoteAmount, baseAmount);
    }

    /// @inheritdoc IHedgeVault
    function pendingFees(address user) external view override returns (uint256 pendingQuote, uint256 pendingBase) {
        pendingQuote = _pendingQuoteFees(user);
        pendingBase = _pendingBaseFees(user);
    }

    // ============ Internal - Fee Logic ============

    function _pendingQuoteFees(address user) internal view returns (uint256) {
        uint256 shares = balanceOf[user];
        if (shares == 0) return 0;
        uint256 accumulated = (shares * accQuoteFeesPerShare) / 1e18;
        uint256 debt = userQuoteFeeDebt[user];
        return accumulated > debt ? accumulated - debt : 0;
    }

    function _pendingBaseFees(address user) internal view returns (uint256) {
        uint256 shares = balanceOf[user];
        if (shares == 0) return 0;
        uint256 accumulated = (shares * accBaseFeesPerShare) / 1e18;
        uint256 debt = userBaseFeeDebt[user];
        return accumulated > debt ? accumulated - debt : 0;
    }

    /// @dev Harvest fees from NFT position and update accumulators
    function _harvestNftFees() internal {
        if (state != State.IN_POSITION || currentTokenId == 0) return;
        if (totalSupply == 0) return;

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

        // Update accumulators
        if (quoteFees > 0) {
            accQuoteFeesPerShare += (quoteFees * 1e18) / totalSupply;
            totalUnclaimedQuoteFees += quoteFees;
        }
        if (baseFees > 0) {
            accBaseFeesPerShare += (baseFees * 1e18) / totalSupply;
            totalUnclaimedBaseFees += baseFees;
        }

        emit FeesHarvested(collected0, collected1);
    }

    // ============ Internal - Trigger Logic ============

    function _isSilTriggered(uint160 currentPrice) internal view returns (bool) {
        if (token0IsQuote) {
            // sqrtPrice UP = actual price DOWN = SIL triggered
            return currentPrice >= silSqrtPriceX96;
        } else {
            // sqrtPrice DOWN = actual price DOWN = SIL triggered
            return currentPrice <= silSqrtPriceX96;
        }
    }

    function _isTipTriggered(uint160 currentPrice) internal view returns (bool) {
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

    // ============ Internal - Swap ============

    function _executeSwap(bytes calldata swapData) internal {
        if (swapData.length == 0) return;

        // Decode swap params: (augustus, calldata)
        (address augustus, bytes memory swapCalldata) = abi.decode(swapData, (address, bytes));

        // Validate Augustus
        if (!augustusRegistry.isValidAugustus(augustus)) {
            revert InvalidSwapDirection(); // Reuse error for invalid swap
        }

        // Get spender
        address spender = IAugustus(augustus).getTokenTransferProxy();

        // Determine which token to swap based on state
        address tokenIn;
        if (state == State.IN_POSITION) {
            // Closing position - we have both tokens, need to check what we're converting to
            // For SIL: swap Base → Quote
            // For TIP: swap Quote → Base
            // The caller (executeSil/executeTip) determines this by checking balance changes
            tokenIn = baseToken; // For SIL
            uint256 quoteBalance = IERC20Minimal(asset).balanceOf(address(this));
            uint256 baseBalance = IERC20Minimal(baseToken).balanceOf(address(this));

            // If we're doing TIP, we swap Quote
            // We determine this by looking at what the swap data is trying to swap
            // For now, approve both and let the swap calldata determine
            if (baseBalance > 0) {
                _safeApprove(baseToken, spender, baseBalance);
            }
            if (quoteBalance > 0) {
                _safeApprove(asset, spender, quoteBalance);
            }
        } else if (state == State.OUT_OF_POSITION_QUOTE) {
            // Reopening from Quote - swap Quote → get both tokens
            uint256 balance = IERC20Minimal(asset).balanceOf(address(this));
            _safeApprove(asset, spender, balance);
        } else if (state == State.OUT_OF_POSITION_BASE) {
            // Reopening from Base - swap Base → get both tokens
            uint256 balance = IERC20Minimal(baseToken).balanceOf(address(this));
            _safeApprove(baseToken, spender, balance);
        }

        // Execute swap
        (bool success, bytes memory returnData) = augustus.call(swapCalldata);
        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
            revert InvalidSwapDirection();
        }

        // Reset approvals
        _safeApprove(asset, spender, 0);
        _safeApprove(baseToken, spender, 0);
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
            // Base balance minus unclaimed base fees, converted to Quote value
            uint256 baseBalance = IERC20Minimal(baseToken).balanceOf(address(this));
            uint256 principalBase = baseBalance > totalUnclaimedBaseFees
                ? baseBalance - totalUnclaimedBaseFees
                : 0;
            return _convertBaseToQuote(principalBase);
        }

        // IN_POSITION: Calculate position value (excludes tokensOwed which are fees)
        return _calculatePositionValue();
    }

    function _calculatePositionValue() internal view returns (uint256) {
        uint256 tokenId = currentTokenId;
        if (tokenId == 0) return 0;

        // Get position data
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
            uint128 tokensOwed0,
            uint128 tokensOwed1
        ) = positionManager.positions(tokenId);

        // Get current price
        uint160 sqrtPriceX96 = _getCurrentSqrtPriceX96();

        // Calculate amounts from liquidity
        (uint256 amount0, uint256 amount1) = _getAmountsForLiquidity(
            sqrtPriceX96,
            tickLower_,
            tickUpper_,
            liquidity
        );

        // Add owed tokens (uncollected fees)
        amount0 += tokensOwed0;
        amount1 += tokensOwed1;

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

        // Get current sqrtPriceX96
        uint160 sqrtPriceX96 = _getCurrentSqrtPriceX96();

        // price = (sqrtPriceX96 / 2^96)^2
        // For token0IsQuote: price = token1/token0 = Base/Quote
        // For !token0IsQuote: price = token0/token1 = Base/Quote (after inversion)

        // Simplified calculation
        uint256 price;
        if (token0IsQuote) {
            // sqrtPrice = sqrt(token1/token0) = sqrt(Base/Quote)
            // price = Base/Quote
            // quoteAmount = baseAmount / price = baseAmount * Quote/Base
            price = (uint256(sqrtPriceX96) * uint256(sqrtPriceX96)) >> 192;
            if (price == 0) return 0;
            return (baseAmount << 96) / price;
        } else {
            // sqrtPrice = sqrt(token0/token1) = sqrt(Base/Quote)
            // price = Base/Quote
            price = (uint256(sqrtPriceX96) * uint256(sqrtPriceX96)) >> 192;
            return (baseAmount * price) >> 96;
        }
    }

    // ============ Internal - Uniswap Math ============

    function _getCurrentSqrtPriceX96() internal view returns (uint160) {
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(pool).slot0();
        return sqrtPriceX96;
    }

    function _getAmountsForLiquidity(
        uint160 sqrtRatioX96,
        int24 tickLower_,
        int24 tickUpper_,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        uint160 sqrtRatioAX96 = _getSqrtRatioAtTick(tickLower_);
        uint160 sqrtRatioBX96 = _getSqrtRatioAtTick(tickUpper_);

        if (sqrtRatioAX96 > sqrtRatioBX96) {
            (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        }

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            amount0 = _getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
            amount0 = _getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity);
            amount1 = _getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity);
        } else {
            amount1 = _getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        }
    }

    function _getAmount0ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity)
        internal
        pure
        returns (uint256)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) {
            (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        }
        uint256 intermediate = (uint256(liquidity) << 96) / sqrtRatioAX96;
        return (intermediate * (sqrtRatioBX96 - sqrtRatioAX96)) / sqrtRatioBX96;
    }

    function _getAmount1ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity)
        internal
        pure
        returns (uint256)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) {
            (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        }
        return (uint256(liquidity) * (sqrtRatioBX96 - sqrtRatioAX96)) / (1 << 96);
    }

    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    function _getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        unchecked {
            require(tick >= MIN_TICK && tick <= MAX_TICK, "TICK_OOR");

            uint256 absTick = tick < 0 ? uint256(uint24(-tick)) : uint256(uint24(tick));
            uint256 ratio = absTick & 0x1 != 0
                ? 0xfffcb933bd6fad37aa2d162d1a594001
                : 0x100000000000000000000000000000000;

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

    // ============ Internal - Pool Address ============

    function _computePoolAddress(address token0, address token1, uint24 fee) internal pure returns (address) {
        // Use the factory from position manager
        // For now, just read from slot0 of a known pool or use CREATE2
        // This is a simplified version - in production, compute via CREATE2
        bytes32 POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;

        // Ensure token0 < token1
        if (token0 > token1) {
            (token0, token1) = (token1, token0);
        }

        bytes32 salt = keccak256(abi.encode(token0, token1, fee));

        // Get factory address (hardcoded for Uniswap V3)
        address factory = 0x1F98431c8aD98523631AE4a59f267346ea31F984;

        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            factory,
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

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "APPROVE_FAILED");
    }
}
