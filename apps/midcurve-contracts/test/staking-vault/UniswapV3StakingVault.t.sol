// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {UniswapV3StakingVault} from "../../contracts/staking-vault/UniswapV3StakingVault.sol";
import {
    IStakingVault,
    StakeParams,
    SwapStatus,
    SwapQuote
} from "../../contracts/staking-vault/interfaces/IStakingVault.sol";

import {
    MockStakingNFPM,
    MockUniFactory,
    MockUniPool
} from "./mocks/MockStakingNFPM.sol";
import {MockFlashCloseCallback} from "./mocks/MockFlashCloseCallback.sol";

contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UniswapV3StakingVaultTest is Test {
    UniswapV3StakingVault internal implementation;
    UniswapV3StakingVault internal vault;

    MockStakingNFPM internal nfpm;
    MockUniFactory internal uniFactory;
    MockUniPool internal pool;

    MockERC20 internal tokenA; // becomes token0 (lower address)
    MockERC20 internal tokenB; // becomes token1

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal executor = makeAddr("executor");

    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_LOWER = -887220;
    int24 internal constant TICK_UPPER = 887220;
    uint160 internal constant SQRT_PRICE_X96 = 79228162514264337593543950336; // tick 0
    uint256 internal constant DEADLINE = type(uint256).max;

    function setUp() public {
        uniFactory = new MockUniFactory();
        nfpm = new MockStakingNFPM(address(uniFactory));
        pool = new MockUniPool(SQRT_PRICE_X96, 0);

        // Order tokens deterministically (token0 < token1)
        MockERC20 t1 = new MockERC20("A", "A");
        MockERC20 t2 = new MockERC20("B", "B");
        if (address(t1) < address(t2)) {
            tokenA = t1;
            tokenB = t2;
        } else {
            tokenA = t2;
            tokenB = t1;
        }

        uniFactory.setPool(address(tokenA), address(tokenB), FEE, address(pool));

        implementation = new UniswapV3StakingVault(address(nfpm));
        vault = UniswapV3StakingVault(Clones.clone(address(implementation)));
        vault.initialize(alice);
    }

    // ============ helpers ============

    /// @dev Standard stake: alice mints 1000 base + 1000 quote with `T` yield target.
    ///      Returns the minted tokenId. `isQ0` selects which token is quote.
    function _stake(uint256 desired0, uint256 desired1, uint128 liquidity, bool isQ0, uint256 T)
        internal
        returns (uint256 tokenId)
    {
        // Set what mint() will return as "consumed"
        nfpm.setNextMintResult(liquidity, desired0, desired1);

        tokenA.mint(alice, desired0);
        tokenB.mint(alice, desired1);
        vm.startPrank(alice);
        tokenA.approve(address(vault), desired0);
        tokenB.approve(address(vault), desired1);

        StakeParams memory p = StakeParams({
            token0: address(tokenA),
            token1: address(tokenB),
            fee: FEE,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: desired0,
            amount1Desired: desired1,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        });
        tokenId = vault.stake(p, isQ0, T);
        vm.stopPrank();
    }

    /// @dev Set up a swap()-time scenario: pre-load NFPM with the tokens that
    ///      decreaseLiquidity+collect will transfer to the vault, set the next
    ///      decrease result, and set position liquidity to a positive value
    ///      (so _closePosition actually decreases something).
    function _arrangeClose(uint256 tokenId, uint256 amount0Out, uint256 amount1Out) internal {
        nfpm.setLiquidityForTesting(tokenId, 1); // any positive
        nfpm.setNextDecreaseResult(tokenId, amount0Out, amount1Out);
        // Fund NFPM so collect() can pay out to the vault
        if (amount0Out > 0) tokenA.mint(address(nfpm), amount0Out);
        if (amount1Out > 0) tokenB.mint(address(nfpm), amount1Out);
    }

    function _approveExecutor(MockERC20 token, uint256 amount) internal {
        token.mint(executor, amount);
        vm.prank(executor);
        token.approve(address(vault), amount);
    }

    // ============ initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(vault.owner(), alice);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Empty));
    }

    function test_initialize_revertsOnSecondCall() public {
        vm.expectRevert(UniswapV3StakingVault.AlreadyInitialized.selector);
        vault.initialize(bob);
    }

    function test_initialize_revertsOnZeroOwner() public {
        UniswapV3StakingVault fresh = UniswapV3StakingVault(Clones.clone(address(implementation)));
        vm.expectRevert(UniswapV3StakingVault.ZeroOwner.selector);
        fresh.initialize(address(0));
    }

    // ============ stake ============

    function test_stake_happyPath_isToken0Quote_true() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);

        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Staked));
        assertEq(vault.isToken0Quote(), true);
        assertEq(vault.stakedQuote(), 1_000); // amount0Used
        assertEq(vault.stakedBase(), 800); // amount1Used
        assertEq(vault.yieldTarget(), 100);
        assertEq(vault.tokenId(), tokenId);
        assertEq(vault.pool(), address(pool));
        assertEq(vault.token0(), address(tokenA));
        assertEq(vault.token1(), address(tokenB));
    }

    function test_stake_happyPath_isToken0Quote_false() public {
        _stake(800, 1_000, 500, false, 100);
        assertEq(vault.stakedBase(), 800); // amount0Used
        assertEq(vault.stakedQuote(), 1_000); // amount1Used
    }

    function test_stake_refundsUnconsumed() public {
        // mint() will only consume 600 of 1000 token0 and 400 of 800 token1
        nfpm.setNextMintResult(300, 600, 400);
        tokenA.mint(alice, 1_000);
        tokenB.mint(alice, 800);
        vm.startPrank(alice);
        tokenA.approve(address(vault), 1_000);
        tokenB.approve(address(vault), 800);

        uint256 aliceA0 = tokenA.balanceOf(alice);
        uint256 aliceB0 = tokenB.balanceOf(alice);

        StakeParams memory p = StakeParams({
            token0: address(tokenA),
            token1: address(tokenB),
            fee: FEE,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: 1_000,
            amount1Desired: 800,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        });
        vault.stake(p, true, 100);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), aliceA0 - 600); // refunded 400
        assertEq(tokenB.balanceOf(alice), aliceB0 - 400); // refunded 400
        assertEq(vault.stakedQuote(), 600);
        assertEq(vault.stakedBase(), 400);
    }

    function test_stake_revertsIfNotOwner() public {
        nfpm.setNextMintResult(500, 1_000, 800);
        tokenA.mint(bob, 1_000);
        tokenB.mint(bob, 800);
        vm.startPrank(bob);
        tokenA.approve(address(vault), 1_000);
        tokenB.approve(address(vault), 800);
        StakeParams memory p = StakeParams({
            token0: address(tokenA),
            token1: address(tokenB),
            fee: FEE,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: 1_000,
            amount1Desired: 800,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        });
        vm.expectRevert(UniswapV3StakingVault.NotOwner.selector);
        vault.stake(p, true, 100);
        vm.stopPrank();
    }

    function test_stake_revertsIfNotEmpty() public {
        _stake(1_000, 800, 500, true, 100);
        nfpm.setNextMintResult(500, 1_000, 800);
        tokenA.mint(alice, 1_000);
        tokenB.mint(alice, 800);
        vm.startPrank(alice);
        tokenA.approve(address(vault), 1_000);
        tokenB.approve(address(vault), 800);
        StakeParams memory p = StakeParams({
            token0: address(tokenA),
            token1: address(tokenB),
            fee: FEE,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: 1_000,
            amount1Desired: 800,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        });
        vm.expectRevert(UniswapV3StakingVault.WrongState.selector);
        vault.stake(p, true, 100);
        vm.stopPrank();
    }

    // ============ setYieldTarget ============

    function test_setYieldTarget_owner_inStaked() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setYieldTarget(250);
        assertEq(vault.yieldTarget(), 250);
    }

    function test_setYieldTarget_revertsIfNotOwner() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(bob);
        vm.expectRevert(UniswapV3StakingVault.NotOwner.selector);
        vault.setYieldTarget(250);
    }

    function test_setYieldTarget_revertsIfWrongState() public {
        // Empty state
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.WrongState.selector);
        vault.setYieldTarget(250);
    }

    // ============ swap — Case 1 (no swap needed) ============

    function test_swap_case1_settles_with_zero_amountIn() public {
        uint256 T = 100;
        uint256 tokenId = _stake(1_000, 800, 500, true, T); // Q=1000, B=800

        // After close: b=900 (>=B=800), q=1200 (>=Q+T=1100). Case 1.
        // isToken0Quote = true → token0 = quote, token1 = base
        _arrangeClose(tokenId, 1_200, 900);

        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
        assertEq(vault.baseReward(), 100); // 900 - 800
        assertEq(vault.quoteReward(), 200); // 1200 - 1000
    }

    function test_swap_case1_revertsIfAmountInNonZero() public {
        uint256 T = 100;
        uint256 tokenId = _stake(1_000, 800, 500, true, T);
        _arrangeClose(tokenId, 1_200, 900); // Case 1

        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.InsufficientAmountIn.selector);
        vault.swap(address(0), 1, address(0), 0);
    }

    // ============ swap — Case 2 (executor sends quote, receives base) ============

    function test_swap_case2_executor_pays_quote() public {
        uint256 T = 100;
        uint256 tokenId = _stake(1_000, 800, 500, true, T); // Q=1000, B=800
        // After close: b=900 (>B=800), q=900 (<Q+T=1100). Case 2.
        _arrangeClose(tokenId, 900, 900);

        // requiredMin = (Q+T)-q = 200; amountOut = b-B = 100
        _approveExecutor(tokenA, 250); // tokenA = quote
        uint256 baseBefore = tokenB.balanceOf(executor); // tokenB = base

        vm.prank(executor);
        uint256 out = vault.swap(address(tokenA), 250, address(tokenB), 50);

        assertEq(out, 100);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
        assertEq(vault.baseReward(), 0);
        assertEq(vault.quoteReward(), 150); // (q + amountIn) - Q = (900+250)-1000
        assertEq(tokenB.balanceOf(executor), baseBefore + 100);
        // Vault now holds B base and (q+amountIn) quote
        assertEq(tokenB.balanceOf(address(vault)), 800);
        assertEq(tokenA.balanceOf(address(vault)), 1_150);
    }

    function test_swap_case2_revertsIfAmountInBelowRequiredMin() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 900, 900); // requiredMin = 200

        _approveExecutor(tokenA, 199);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.InsufficientAmountIn.selector);
        vault.swap(address(tokenA), 199, address(tokenB), 0);
    }

    function test_swap_case2_revertsIfMinAmountOutTooHigh() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 900, 900); // amountOut = 100

        _approveExecutor(tokenA, 250);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.SlippageExceeded.selector);
        vault.swap(address(tokenA), 250, address(tokenB), 101);
    }

    function test_swap_case2_revertsOnTokenMismatch() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 900, 900);

        _approveExecutor(tokenB, 250); // wrong direction
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.TokenMismatch.selector);
        vault.swap(address(tokenB), 250, address(tokenA), 0);
    }

    function test_swap_case2_overpayment_flowsToQuoteReward() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 900, 900); // Case 2: requiredMin=200, amountOut=100

        _approveExecutor(tokenA, 500); // overpay 300
        vm.prank(executor);
        uint256 out = vault.swap(address(tokenA), 500, address(tokenB), 0);
        assertEq(out, 100); // unchanged
        assertEq(vault.quoteReward(), 400); // (900+500)-1000
    }

    // ============ swap — Case 3 (executor sends base, receives quote) ============

    function test_swap_case3_executor_pays_base() public {
        uint256 T = 100;
        uint256 tokenId = _stake(1_000, 800, 500, true, T); // Q=1000, B=800
        // After close: b=700 (<B=800), q=1300 (>Q+T=1100). Case 3.
        _arrangeClose(tokenId, 1_300, 700);

        // requiredMin = B-b = 100; amountOut = q-(Q+T) = 200
        _approveExecutor(tokenB, 150); // tokenB = base
        uint256 quoteBefore = tokenA.balanceOf(executor);

        vm.prank(executor);
        uint256 out = vault.swap(address(tokenB), 150, address(tokenA), 100);

        assertEq(out, 200);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
        assertEq(vault.baseReward(), 50); // (b + amountIn) - B = (700+150)-800
        assertEq(vault.quoteReward(), 100); // = T
        assertEq(tokenA.balanceOf(executor), quoteBefore + 200);
    }

    function test_swap_case3_overpayment_flowsToBaseReward() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_300, 700); // requiredMin=100, amountOut=200

        _approveExecutor(tokenB, 500); // overpay
        vm.prank(executor);
        uint256 out = vault.swap(address(tokenB), 500, address(tokenA), 0);
        assertEq(out, 200);
        assertEq(vault.baseReward(), 400); // (700+500)-800
        assertEq(vault.quoteReward(), 100);
    }

    // ============ swap — Case 4 (underwater) ============

    function test_swap_case4_reverts() public {
        // Deficit on both sides
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 500, 500);

        _approveExecutor(tokenA, 1_000);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.Underwater.selector);
        vault.swap(address(tokenA), 1_000, address(tokenB), 0);
    }

    function test_swap_case4_boundary_b_eq_B_q_lt_floor() public {
        // b == B AND q < Q+T → spec §10 boundary: Case 4
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_000, 800); // b=800=B, q=1000<1100

        _approveExecutor(tokenA, 1_000);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.Underwater.selector);
        vault.swap(address(tokenA), 1_000, address(tokenB), 0);
    }

    function test_swap_case4_boundary_b_lt_B_q_eq_floor() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_100, 700); // b=700<B, q=1100==Q+T

        _approveExecutor(tokenB, 1_000);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.Underwater.selector);
        vault.swap(address(tokenB), 1_000, address(tokenA), 0);
    }

    function test_swap_case1_boundary_b_eq_B_q_eq_floor() public {
        // Degenerate Case 1: both at exact floor
        uint256 T = 100;
        uint256 tokenId = _stake(1_000, 800, 500, true, T);
        _arrangeClose(tokenId, 1_100, 800); // b=B, q=Q+T

        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        assertEq(vault.baseReward(), 0);
        assertEq(vault.quoteReward(), 100); // q-Q = T
    }

    function test_swap_case1_boundary_b_eq_B_q_gt_floor() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_500, 800); // b=B, q>Q+T

        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        assertEq(vault.baseReward(), 0);
        assertEq(vault.quoteReward(), 500);
    }

    function test_swap_case1_boundary_b_gt_B_q_eq_floor() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_100, 1_000); // b>B, q=Q+T

        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        assertEq(vault.baseReward(), 200);
        assertEq(vault.quoteReward(), 100);
    }

    // ============ Yield target overflow ============

    function test_swap_overflow_isUnderwater() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, type(uint256).max);
        _arrangeClose(tokenId, 5_000, 5_000); // any balances

        _approveExecutor(tokenA, 1_000);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.Underwater.selector);
        vault.swap(address(tokenA), 1_000, address(tokenB), 0);
    }

    // ============ unstake / claimRewards — settlement & one-shot ============

    function test_unstake_then_claim_paysOwner_full() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900); // Case 1: baseReward=100, quoteReward=200

        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        uint256 quoteBefore = tokenA.balanceOf(alice);
        uint256 baseBefore = tokenB.balanceOf(alice);

        vm.startPrank(alice);
        vault.unstake();
        vault.claimRewards();
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), quoteBefore + 1_000 + 200); // stakedQuote + quoteReward
        assertEq(tokenB.balanceOf(alice), baseBefore + 800 + 100); // stakedBase + baseReward
        assertEq(tokenA.balanceOf(address(vault)), 0);
        assertEq(tokenB.balanceOf(address(vault)), 0);
    }

    function test_claim_then_unstake_orderIndependent() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);

        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        uint256 quoteBefore = tokenA.balanceOf(alice);
        uint256 baseBefore = tokenB.balanceOf(alice);

        vm.startPrank(alice);
        vault.claimRewards();
        vault.unstake();
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), quoteBefore + 1_000 + 200);
        assertEq(tokenB.balanceOf(alice), baseBefore + 800 + 100);
    }

    function test_unstake_isOneShot() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        vm.startPrank(alice);
        vault.unstake();
        vm.expectRevert(UniswapV3StakingVault.AlreadyConsumed.selector);
        vault.unstake();
        vm.stopPrank();
    }

    function test_claim_isOneShot() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        vm.startPrank(alice);
        vault.claimRewards();
        vm.expectRevert(UniswapV3StakingVault.AlreadyConsumed.selector);
        vault.claimRewards();
        vm.stopPrank();
    }

    function test_unstake_revertsIfNotSettled() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.WrongState.selector);
        vault.unstake();
    }

    function test_claim_revertsIfNotOwner() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        vm.prank(bob);
        vm.expectRevert(UniswapV3StakingVault.NotOwner.selector);
        vault.claimRewards();
    }

    // ============ flashClose ============

    function _setupFlashCallback() internal returns (MockFlashCloseCallback cb) {
        // alice = base recipient, but tokens map: tokenA=quote, tokenB=base when isToken0Quote=true
        cb = new MockFlashCloseCallback(address(vault), tokenB, tokenA);
    }

    function test_flashClose_case1_exact_returnsAllRewards() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900); // Case 1: surplus

        MockFlashCloseCallback cb = _setupFlashCallback();
        // Vault will push (900 base, 1200 quote) to callback. Callback returns
        // exactly (expectedBase=800, expectedQuote=1100). Surplus 100 base + 100
        // quote stays with the callback. To prove vault accounting, fund callback
        // with nothing extra; Mode.Exact returns exactly required.

        cb.setMode(MockFlashCloseCallback.Mode.Exact);

        uint256 baseBefore = tokenB.balanceOf(alice);
        uint256 quoteBefore = tokenA.balanceOf(alice);

        vm.prank(alice);
        vault.flashClose(address(cb), "");

        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
        // baseReward = finalBase - stakedBase = 800-800 = 0
        // quoteReward = finalQuote - stakedQuote = 1100-1000 = 100
        assertEq(vault.baseReward(), 0);
        assertEq(vault.quoteReward(), 100);
        assertEq(tokenB.balanceOf(alice), baseBefore + 800);
        assertEq(tokenA.balanceOf(alice), quoteBefore + 1_100);
        assertTrue(vault.principalUnstaked());
        assertTrue(vault.rewardsClaimed());
    }

    function test_flashClose_returnsSurplus_flowsToClaimRewards() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        // Vault closes with q=1200, b=900 → enough to satisfy expected (B=800, Q+T=1100).
        _arrangeClose(tokenId, 1_200, 900);

        MockFlashCloseCallback cb = _setupFlashCallback();
        tokenB.mint(address(cb), 50); // pre-fund surplus base
        cb.setMode(MockFlashCloseCallback.Mode.SurplusBase);
        cb.setSurplus(50, 0);

        uint256 baseBefore = tokenB.balanceOf(alice);

        vm.prank(alice);
        vault.flashClose(address(cb), "");

        // baseReward = finalBase(850) - stakedBase(800) = 50
        assertEq(vault.baseReward(), 50);
        assertEq(tokenB.balanceOf(alice), baseBefore + 800 + 50);
    }

    function test_flashClose_revertsOnInsufficientBase() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);

        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.InsufficientBase);

        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.InsufficientBaseReturned.selector);
        vault.flashClose(address(cb), "");
    }

    function test_flashClose_revertsOnInsufficientQuote() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);

        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.InsufficientQuote);

        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.InsufficientQuoteReturned.selector);
        vault.flashClose(address(cb), "");
    }

    function test_flashClose_revertsIfNotOwner() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(bob);
        vm.expectRevert(UniswapV3StakingVault.NotOwner.selector);
        vault.flashClose(address(0xdead), "");
    }

    function test_flashClose_reentrantSwap_revertsViaNonReentrant() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);

        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.ReentrantSwap);

        vm.prank(alice);
        vm.expectRevert(); // OZ ReentrancyGuard "ReentrancyGuard: reentrant call"
        vault.flashClose(address(cb), "");
    }

    function test_flashClose_overflowYieldTarget_reverts() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, type(uint256).max);
        _arrangeClose(tokenId, 1_200, 900);

        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.Exact);

        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.YieldTargetOverflow.selector);
        vault.flashClose(address(cb), "");
    }

    // ============ quoteSwap (state-dependent) ============

    function test_quoteSwap_notApplicable_inEmpty() public view {
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.NotApplicable));
    }

    function test_quoteSwap_notApplicable_inSettled() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.NotApplicable));
    }

    function test_quoteSwap_underwater_onOverflow() public {
        _stake(1_000, 800, 500, true, type(uint256).max);
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.Underwater));
    }

    function test_quoteSwap_noSwapNeeded_via_owedFees() public {
        // Stake; then drop liquidity to 0 in NFPM and accrue fees so that
        // (principal=0) + (owed) >= (B, Q+T). Should classify as NoSwapNeeded.
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        nfpm.setLiquidityForTesting(tokenId, 0);
        // owed = (1200, 900) → quote=1200>=1100, base=900>=800
        nfpm.accrueFeesForTesting(tokenId, 1_200, 900);

        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.NoSwapNeeded));
    }

    function test_quoteSwap_executable_case2() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        nfpm.setLiquidityForTesting(tokenId, 0);
        nfpm.accrueFeesForTesting(tokenId, 900, 900); // q<floor, b>B

        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.Executable));
        assertEq(q.tokenIn, address(tokenA)); // quote
        assertEq(q.tokenOut, address(tokenB)); // base
        assertEq(q.minAmountIn, 200);
        assertEq(q.amountOut, 100);
    }

    function test_quoteSwap_executable_case3() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        nfpm.setLiquidityForTesting(tokenId, 0);
        nfpm.accrueFeesForTesting(tokenId, 1_300, 700); // q>floor, b<B

        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.Executable));
        assertEq(q.tokenIn, address(tokenB)); // base
        assertEq(q.tokenOut, address(tokenA)); // quote
        assertEq(q.minAmountIn, 100);
        assertEq(q.amountOut, 200);
    }

    function test_quoteSwap_underwater_case4() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        nfpm.setLiquidityForTesting(tokenId, 0);
        nfpm.accrueFeesForTesting(tokenId, 500, 500); // both deficit

        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.Underwater));
    }
}
