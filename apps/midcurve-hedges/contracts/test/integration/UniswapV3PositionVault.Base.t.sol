// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {UniswapV3PositionVault} from "../../legacy/UniswapV3PositionVault.sol";
import {MockUSD} from "../../MockUSD.sol";
import {INonfungiblePositionManager} from "../../interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3Factory} from "../../interfaces/IUniswapV3Factory.sol";
import {IUniswapV3PoolMinimal} from "../../interfaces/IUniswapV3PoolMinimal.sol";
import {IERC20} from "../../interfaces/IERC20.sol";

/// @title Base Integration Test Contract for UniswapV3PositionVault
/// @notice Provides shared setup for all integration tests using mainnet fork
/// @dev Forks mainnet and sets up a complete testing environment with:
///      - MockUSD token deployment
///      - WETH/MockUSD pool creation
///      - Position NFT minting
///      - Vault deployment (uninitialized for test flexibility)
abstract contract UniswapV3PositionVaultIntegrationBase is Test {
    // ============ Mainnet Addresses ============

    address constant NFPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
    address constant UNISWAP_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address constant SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // ============ Pool Configuration ============

    uint24 constant POOL_FEE = 3000; // 0.3%
    int24 constant TICK_SPACING = 60; // For 0.3% fee tier

    // ============ Test Amounts ============

    uint256 constant INITIAL_ETH_LIQUIDITY = 10 ether;
    uint256 constant INITIAL_MUSD_LIQUIDITY = 30_000 * 1e6;
    uint256 constant INITIAL_VAULT_SHARES = 1e18;

    // ============ Test Accounts ============

    address manager;
    address alice;
    address bob;
    address charlie;

    // ============ Deployed Contracts ============

    MockUSD public mockUSD;
    UniswapV3PositionVault public vault;
    address public pool;
    uint256 public positionId;

    // ============ Token References ============

    address public token0;
    address public token1;
    bool public isWethToken0;

    // ============ Position State ============

    int24 public tickLower;
    int24 public tickUpper;

    // ============ Modifiers ============

    modifier asManager() {
        vm.startPrank(manager);
        _;
        vm.stopPrank();
    }

    modifier asAlice() {
        vm.startPrank(alice);
        _;
        vm.stopPrank();
    }

    modifier asBob() {
        vm.startPrank(bob);
        _;
        vm.stopPrank();
    }

    modifier asCharlie() {
        vm.startPrank(charlie);
        _;
        vm.stopPrank();
    }

    // ============ Setup ============

    function setUp() public virtual {
        // Fork mainnet
        string memory rpcUrl = vm.envString("RPC_URL_ETHEREUM");
        vm.createSelectFork(rpcUrl);

        // Initialize test accounts
        manager = makeAddr("manager");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        // Fund accounts with ETH for gas
        vm.deal(manager, 1000 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.deal(charlie, 1000 ether);

        // Deploy MockUSD
        vm.prank(manager);
        mockUSD = new MockUSD();

        // Create pool
        _createPool();

        // Mint position NFT to manager
        _mintInitialPosition();

        // Deploy vault (but don't initialize - tests control this)
        vm.prank(manager);
        vault = new UniswapV3PositionVault(NFPM, positionId, "Test Vault", "TVAULT");
    }

    // ============ Internal Setup Helpers ============

    function _createPool() internal {
        IUniswapV3FactoryFull factory = IUniswapV3FactoryFull(UNISWAP_FACTORY);

        // Create new pool (MockUSD address is unique per fork)
        vm.prank(manager);
        pool = factory.createPool(WETH, address(mockUSD), POOL_FEE);

        // Get token order
        token0 = IUniswapV3PoolMinimal(pool).token0();
        token1 = IUniswapV3PoolMinimal(pool).token1();
        isWethToken0 = (token0 == WETH);

        // Initialize at ~$3000/ETH
        // sqrtPriceX96 = sqrt(price) * 2^96
        // For WETH/MUSD: price = 3000 * 1e6 / 1e18 (adjusting for decimals)
        uint160 sqrtPriceX96;
        if (isWethToken0) {
            // token0 = WETH (18 dec), token1 = MockUSD (6 dec)
            // price = token1/token0 = 3000 * 1e6 / 1e18 = 3e-9
            // sqrt(3e-9) * 2^96 = ~4.34e24
            sqrtPriceX96 = 4339505466299284316182528;
        } else {
            // token0 = MockUSD (6 dec), token1 = WETH (18 dec)
            // price = token1/token0 = 1e18 / (3000 * 1e6) = 3.33e8
            // sqrt(3.33e8) * 2^96 = ~1.45e42
            sqrtPriceX96 = 1446501726624926496477173928747177;
        }

        IUniswapV3PoolInitialize(pool).initialize(sqrtPriceX96);
    }

    function _mintInitialPosition() internal {
        // Get current tick
        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(pool).slot0();

        // Set wide range around current price (+/- 2000 ticks, ~22% range)
        tickLower = ((currentTick - 2000) / TICK_SPACING) * TICK_SPACING;
        tickUpper = ((currentTick + 2000) / TICK_SPACING) * TICK_SPACING;

        // Prepare tokens for manager
        _wrapEth(manager, INITIAL_ETH_LIQUIDITY);
        _mintMockUSD(manager, INITIAL_MUSD_LIQUIDITY);

        // Approve NFPM
        vm.startPrank(manager);
        IERC20(WETH).approve(NFPM, type(uint256).max);
        IERC20(address(mockUSD)).approve(NFPM, type(uint256).max);

        // Determine amounts based on token order
        uint256 amount0Desired;
        uint256 amount1Desired;
        if (isWethToken0) {
            amount0Desired = INITIAL_ETH_LIQUIDITY;
            amount1Desired = INITIAL_MUSD_LIQUIDITY;
        } else {
            amount0Desired = INITIAL_MUSD_LIQUIDITY;
            amount1Desired = INITIAL_ETH_LIQUIDITY;
        }

        // Mint position
        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: token0,
            token1: token1,
            fee: POOL_FEE,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: amount0Desired,
            amount1Desired: amount1Desired,
            amount0Min: 0,
            amount1Min: 0,
            recipient: manager,
            deadline: block.timestamp + 3600
        });

        (positionId,,,) = INonfungiblePositionManager(NFPM).mint(params);
        vm.stopPrank();
    }

    // ============ Token Helpers ============

    function _wrapEth(address recipient, uint256 amount) internal {
        vm.deal(recipient, recipient.balance + amount);
        vm.prank(recipient);
        IWETH(WETH).deposit{value: amount}();
    }

    function _mintMockUSD(address recipient, uint256 amount) internal {
        mockUSD.mint(recipient, amount);
    }

    function _fundAccountWithTokens(address account, uint256 ethAmount, uint256 musdAmount) internal {
        _wrapEth(account, ethAmount);
        _mintMockUSD(account, musdAmount);
    }

    function _approveVault(address account) internal {
        vm.startPrank(account);
        IERC20(WETH).approve(address(vault), type(uint256).max);
        IERC20(address(mockUSD)).approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    // ============ Vault Initialization Helper ============

    function _initializeVault() internal {
        vm.startPrank(manager);
        IERC721(NFPM).approve(address(vault), positionId);
        vault.init(INITIAL_VAULT_SHARES);
        vm.stopPrank();
    }

    // ============ Price Manipulation Helpers ============

    /// @notice Push ETH price UP by buying ETH with MockUSD
    function _pushPriceUp(uint256 musdAmount) internal {
        _mintMockUSD(address(this), musdAmount);
        IERC20(address(mockUSD)).approve(SWAP_ROUTER, musdAmount);

        ISwapRouter(SWAP_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(mockUSD),
                tokenOut: WETH,
                fee: POOL_FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: musdAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @notice Push ETH price DOWN by selling ETH for MockUSD
    function _pushPriceDown(uint256 ethAmount) internal {
        _wrapEth(address(this), ethAmount);
        IERC20(WETH).approve(SWAP_ROUTER, ethAmount);

        ISwapRouter(SWAP_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: address(mockUSD),
                fee: POOL_FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: ethAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @notice Generate fees by executing round-trip swaps
    /// @param swapCount Number of round-trip swaps
    /// @param musdPerSwap MockUSD amount per swap direction
    function _generateFees(uint256 swapCount, uint256 musdPerSwap) internal {
        for (uint256 i = 0; i < swapCount; i++) {
            // Swap MockUSD -> WETH
            _mintMockUSD(address(this), musdPerSwap);
            IERC20(address(mockUSD)).approve(SWAP_ROUTER, musdPerSwap);

            uint256 wethOut = ISwapRouter(SWAP_ROUTER).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: address(mockUSD),
                    tokenOut: WETH,
                    fee: POOL_FEE,
                    recipient: address(this),
                    deadline: block.timestamp + 3600,
                    amountIn: musdPerSwap,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );

            // Swap WETH -> MockUSD (round trip)
            IERC20(WETH).approve(SWAP_ROUTER, wethOut);

            ISwapRouter(SWAP_ROUTER).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: WETH,
                    tokenOut: address(mockUSD),
                    fee: POOL_FEE,
                    recipient: address(this),
                    deadline: block.timestamp + 3600,
                    amountIn: wethOut,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        }
    }

    // ============ Position Query Helpers ============

    function _getPositionLiquidity() internal view returns (uint128) {
        (,,,,,,,uint128 liquidity,,,,) = INonfungiblePositionManager(NFPM).positions(positionId);
        return liquidity;
    }

    function _getPositionTokensOwed() internal view returns (uint128 tokensOwed0, uint128 tokensOwed1) {
        (,,,,,,,,,,tokensOwed0, tokensOwed1) = INonfungiblePositionManager(NFPM).positions(positionId);
    }

    // ============ Assertion Helpers ============

    function _assertSharesBalanced() internal view {
        uint256 total = vault.totalShares();
        uint256 sum = vault.shares(manager) + vault.shares(alice) + vault.shares(bob) + vault.shares(charlie);
        assertEq(sum, total, "Shares not balanced");
    }

    /// @notice Get deposit amounts based on token order
    function _getDepositAmounts(
        uint256 ethAmount,
        uint256 musdAmount
    ) internal view returns (uint256 amount0, uint256 amount1) {
        if (isWethToken0) {
            amount0 = ethAmount;
            amount1 = musdAmount;
        } else {
            amount0 = musdAmount;
            amount1 = ethAmount;
        }
    }
}

// ============ Required Interfaces ============

interface IERC721 {
    function approve(address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IUniswapV3FactoryFull {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}

interface IUniswapV3PoolInitialize {
    function initialize(uint160 sqrtPriceX96) external;
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
