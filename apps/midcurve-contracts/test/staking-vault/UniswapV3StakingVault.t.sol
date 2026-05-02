// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {UniswapV3StakingVault} from "../../contracts/staking-vault/UniswapV3StakingVault.sol";
import {
    IStakingVault,
    StakeParams,
    TopUpParams,
    SwapStatus,
    SwapQuote
} from "../../contracts/staking-vault/interfaces/IStakingVault.sol";

import {MockStakingNFPM, MockUniFactory, MockUniPool} from "./mocks/MockStakingNFPM.sol";
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

    // Liquidity high enough that partial bps in [1, 10000] always yields a positive
    // partialLiquidity bucket for the mock's decreaseLiquidity flow.
    uint128 internal constant L_BIG = 10_000;

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

    /// @dev Standard initial stake. `desired0/1` are the consumed amounts (mock returns desired==used).
    function _stake(uint256 desired0, uint256 desired1, uint128 liquidity, bool isQ0, uint256 T)
        internal
        returns (uint256 tokenId)
    {
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

    /// @dev Configure the next decrease/collect to deliver `(amount0Out, amount1Out)` to the
    ///      vault, and set position liquidity to L_BIG so any bps yields a positive partial
    ///      liquidity bucket.
    function _arrangeClose(uint256 tokenId, uint256 amount0Out, uint256 amount1Out) internal {
        nfpm.setLiquidityForTesting(tokenId, L_BIG);
        nfpm.setNextDecreaseResult(tokenId, amount0Out, amount1Out);
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
        assertEq(vault.stakedQuote(), 1_000);
        assertEq(vault.stakedBase(), 800);
        assertEq(vault.yieldTarget(), 100);
        assertEq(vault.tokenId(), tokenId);
        assertEq(vault.pool(), address(pool));
        assertEq(vault.token0(), address(tokenA));
        assertEq(vault.token1(), address(tokenB));
        assertEq(vault.partialUnstakeBps(), 0);
    }

    function test_stake_happyPath_isToken0Quote_false() public {
        _stake(800, 1_000, 500, false, 100);
        assertEq(vault.stakedBase(), 800);
        assertEq(vault.stakedQuote(), 1_000);
    }

    function test_stake_refundsUnconsumed() public {
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

        assertEq(tokenA.balanceOf(alice), aliceA0 - 600);
        assertEq(tokenB.balanceOf(alice), aliceB0 - 400);
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

    // ============ stakeTopUp ============

    function _topUp(uint256 d0, uint256 d1, uint256 used0, uint256 used1, uint128 dL) internal {
        uint256 tid = vault.tokenId();
        nfpm.setNextIncreaseResult(tid, dL, used0, used1);
        tokenA.mint(alice, d0);
        tokenB.mint(alice, d1);
        vm.startPrank(alice);
        tokenA.approve(address(vault), d0);
        tokenB.approve(address(vault), d1);
        TopUpParams memory p = TopUpParams({
            amount0Desired: d0,
            amount1Desired: d1,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        });
        vault.stakeTopUp(p);
        vm.stopPrank();
    }

    function test_stakeTopUp_addsDeltas() public {
        _stake(1_000, 800, 500, true, 100); // Q=1000, B=800, T=100

        _topUp(500, 400, 500, 400, 200);

        assertEq(vault.stakedQuote(), 1_500); // 1000 + 500 (token0 = quote)
        assertEq(vault.stakedBase(), 1_200); // 800 + 400 (token1 = base)
    }

    function test_stakeTopUp_scalesYieldTarget_ceilRounded() public {
        _stake(1_000, 800, 500, true, 100); // Q=1000, T=100
        _topUp(500, 400, 500, 400, 200);

        // T_new = ceil(100 * 1500 / 1000) = 150
        assertEq(vault.yieldTarget(), 150);
    }

    function test_stakeTopUp_ceilingRoundsUp() public {
        // Choose values that produce a non-integer T_new to confirm ceil rounding.
        _stake(1_000, 800, 500, true, 7); // Q=1000, T=7
        _topUp(3, 2, 3, 2, 5);

        // T_new = ceil(7 * 1003 / 1000) = ceil(7.021) = 8
        assertEq(vault.yieldTarget(), 8);
    }

    function test_stakeTopUp_zeroQuote_leavesYieldTargetUnchanged() public {
        // Initial stake: token1 (base) only; quote consumed = 0.
        _stake(0, 1_000, 500, true, 100); // Q=0, B=1000, T=100
        _topUp(0, 200, 0, 200, 100);

        // Q == 0 → no anchor; T stays at 100.
        assertEq(vault.yieldTarget(), 100);
        assertEq(vault.stakedQuote(), 0);
        assertEq(vault.stakedBase(), 1_200);
    }

    function test_stakeTopUp_refundsUnconsumed() public {
        _stake(1_000, 800, 500, true, 100);

        uint256 tid = vault.tokenId();
        nfpm.setNextIncreaseResult(tid, 100, 200, 100); // used 200 of 500, 100 of 400
        tokenA.mint(alice, 500);
        tokenB.mint(alice, 400);
        uint256 a0 = tokenA.balanceOf(alice);
        uint256 b0 = tokenB.balanceOf(alice);
        vm.startPrank(alice);
        tokenA.approve(address(vault), 500);
        tokenB.approve(address(vault), 400);
        vault.stakeTopUp(TopUpParams({
            amount0Desired: 500,
            amount1Desired: 400,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        }));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), a0 - 200); // refunded 300
        assertEq(tokenB.balanceOf(alice), b0 - 100); // refunded 300
    }

    function test_stakeTopUp_revertsIfNotOwner() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(bob);
        vm.expectRevert(UniswapV3StakingVault.NotOwner.selector);
        vault.stakeTopUp(TopUpParams({
            amount0Desired: 1,
            amount1Desired: 1,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        }));
    }

    function test_stakeTopUp_revertsIfEmpty() public {
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.WrongState.selector);
        vault.stakeTopUp(TopUpParams({
            amount0Desired: 1,
            amount1Desired: 1,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        }));
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
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.WrongState.selector);
        vault.setYieldTarget(250);
    }

    // ============ partial unstake control ============

    function test_setPartialUnstakeBps_setsAndEmits() public {
        _stake(1_000, 800, 500, true, 100);

        vm.expectEmit(true, false, false, true, address(vault));
        emit IStakingVault.PartialUnstakeBpsSet(alice, 0, 3_000);
        vm.prank(alice);
        vault.setPartialUnstakeBps(3_000);
        assertEq(vault.partialUnstakeBps(), 3_000);
    }

    function test_setPartialUnstakeBps_zeroAndMaxAllowed() public {
        _stake(1_000, 800, 500, true, 100);
        vm.startPrank(alice);
        vault.setPartialUnstakeBps(0);
        assertEq(vault.partialUnstakeBps(), 0);
        vault.setPartialUnstakeBps(10_000);
        assertEq(vault.partialUnstakeBps(), 10_000);
        vm.stopPrank();
    }

    function test_setPartialUnstakeBps_revertsAbove10000() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.InvalidBps.selector);
        vault.setPartialUnstakeBps(10_001);
    }

    function test_setPartialUnstakeBps_revertsIfNotOwner() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(bob);
        vm.expectRevert(UniswapV3StakingVault.NotOwner.selector);
        vault.setPartialUnstakeBps(100);
    }

    function test_setPartialUnstakeBps_revertsIfEmpty() public {
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.WrongState.selector);
        vault.setPartialUnstakeBps(100);
    }

    function test_increasePartialUnstakeBps_addsToCounter() public {
        _stake(1_000, 800, 500, true, 100);
        vm.startPrank(alice);
        vault.setPartialUnstakeBps(3_000);
        vault.increasePartialUnstakeBps(2_000);
        assertEq(vault.partialUnstakeBps(), 5_000);
        vm.stopPrank();
    }

    function test_increasePartialUnstakeBps_revertsOnOverflow() public {
        _stake(1_000, 800, 500, true, 100);
        vm.startPrank(alice);
        vault.setPartialUnstakeBps(9_000);
        vm.expectRevert(UniswapV3StakingVault.InvalidBps.selector);
        vault.increasePartialUnstakeBps(2_000);
        vm.stopPrank();
    }

    function test_increasePartialUnstakeBps_zeroIsNoOp_emits() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(2_500);

        vm.expectEmit(true, false, false, true, address(vault));
        emit IStakingVault.PartialUnstakeBpsSet(alice, 2_500, 2_500);
        vm.prank(alice);
        vault.increasePartialUnstakeBps(0);
        assertEq(vault.partialUnstakeBps(), 2_500);
    }

    // ============ swap — full close (effectiveBps == 10000, default pendingBps == 0) ============

    function test_swap_case1_settles_with_zero_amountIn() public {
        uint256 T = 100;
        uint256 tokenId = _stake(1_000, 800, 500, true, T); // Q=1000, B=800
        _arrangeClose(tokenId, 1_200, 900); // b=900>=B, q=1200>=Q+T → Case 1

        vm.expectEmit(true, false, false, true, address(vault));
        emit IStakingVault.Swap(executor, address(0), 0, address(0), 0, 10_000);

        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
        assertEq(vault.unstakeBufferBase(), 800);
        assertEq(vault.unstakeBufferQuote(), 1_000);
        assertEq(vault.rewardBufferBase(), 100); // 900 - 800
        assertEq(vault.rewardBufferQuote(), 200); // 1200 - 1000
        assertEq(vault.stakedBase(), 0);
        assertEq(vault.stakedQuote(), 0);
        assertEq(vault.yieldTarget(), 0);
        assertEq(vault.partialUnstakeBps(), 0);
    }

    function test_swap_case1_revertsIfAmountInNonZero() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);

        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.InsufficientAmountIn.selector);
        vault.swap(address(0), 1, address(0), 0);
    }

    function test_swap_case2_executor_pays_quote() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100); // Q=1000, B=800
        _arrangeClose(tokenId, 900, 900); // b=900>B, q=900<Q+T=1100 → Case 2

        _approveExecutor(tokenA, 250);
        uint256 baseBefore = tokenB.balanceOf(executor);

        vm.prank(executor);
        uint256 out = vault.swap(address(tokenA), 250, address(tokenB), 50);

        assertEq(out, 100);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
        assertEq(vault.unstakeBufferBase(), 800);
        assertEq(vault.unstakeBufferQuote(), 1_000);
        assertEq(vault.rewardBufferBase(), 0);
        assertEq(vault.rewardBufferQuote(), 150); // (900 + 250) - 1000
        assertEq(tokenB.balanceOf(executor), baseBefore + 100);
        // Vault holds buffers: 800 base, 1150 quote.
        assertEq(tokenB.balanceOf(address(vault)), 800);
        assertEq(tokenA.balanceOf(address(vault)), 1_150);
    }

    function test_swap_case2_revertsIfAmountInBelowRequiredMin() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 900, 900);
        _approveExecutor(tokenA, 199);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.InsufficientAmountIn.selector);
        vault.swap(address(tokenA), 199, address(tokenB), 0);
    }

    function test_swap_case2_revertsIfMinAmountOutTooHigh() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 900, 900);
        _approveExecutor(tokenA, 250);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.SlippageExceeded.selector);
        vault.swap(address(tokenA), 250, address(tokenB), 101);
    }

    function test_swap_case2_revertsOnTokenMismatch() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 900, 900);
        _approveExecutor(tokenB, 250);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.TokenMismatch.selector);
        vault.swap(address(tokenB), 250, address(tokenA), 0);
    }

    function test_swap_case2_overpayment_flowsToQuoteRewardBuffer() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 900, 900);
        _approveExecutor(tokenA, 500);
        vm.prank(executor);
        uint256 out = vault.swap(address(tokenA), 500, address(tokenB), 0);
        assertEq(out, 100);
        assertEq(vault.rewardBufferQuote(), 400); // (900+500) - 1000
    }

    function test_swap_case3_executor_pays_base() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100); // Q=1000, B=800, T=100
        _arrangeClose(tokenId, 1_300, 700); // b=700<B, q=1300>Q+T=1100 → Case 3

        _approveExecutor(tokenB, 150);
        uint256 quoteBefore = tokenA.balanceOf(executor);

        vm.prank(executor);
        uint256 out = vault.swap(address(tokenB), 150, address(tokenA), 100);

        assertEq(out, 200);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
        assertEq(vault.rewardBufferBase(), 50); // (700 + 150) - 800
        assertEq(vault.rewardBufferQuote(), 100); // = T
        assertEq(tokenA.balanceOf(executor), quoteBefore + 200);
    }

    function test_swap_case3_overpayment_flowsToBaseRewardBuffer() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_300, 700);
        _approveExecutor(tokenB, 500);
        vm.prank(executor);
        uint256 out = vault.swap(address(tokenB), 500, address(tokenA), 0);
        assertEq(out, 200);
        assertEq(vault.rewardBufferBase(), 400); // (700+500) - 800
        assertEq(vault.rewardBufferQuote(), 100);
    }

    function test_swap_case4_reverts() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 500, 500);
        _approveExecutor(tokenA, 1_000);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.Underwater.selector);
        vault.swap(address(tokenA), 1_000, address(tokenB), 0);
    }

    function test_swap_case4_boundary_b_eq_B_q_lt_floor() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_000, 800); // b=B, q<Q+T
        _approveExecutor(tokenA, 1_000);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.Underwater.selector);
        vault.swap(address(tokenA), 1_000, address(tokenB), 0);
    }

    function test_swap_case4_boundary_b_lt_B_q_eq_floor() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_100, 700);
        _approveExecutor(tokenB, 1_000);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.Underwater.selector);
        vault.swap(address(tokenB), 1_000, address(tokenA), 0);
    }

    function test_swap_case1_boundary_b_eq_B_q_eq_floor() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_100, 800);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        assertEq(vault.rewardBufferBase(), 0);
        assertEq(vault.rewardBufferQuote(), 100);
    }

    function test_swap_case1_boundary_b_eq_B_q_gt_floor() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_500, 800);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        assertEq(vault.rewardBufferBase(), 0);
        assertEq(vault.rewardBufferQuote(), 500);
    }

    function test_swap_case1_boundary_b_gt_B_q_eq_floor() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_100, 1_000);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        assertEq(vault.rewardBufferBase(), 200);
        assertEq(vault.rewardBufferQuote(), 100);
    }

    function test_swap_overflow_isUnderwater() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, type(uint256).max);
        _arrangeClose(tokenId, 5_000, 5_000);
        _approveExecutor(tokenA, 1_000);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.Underwater.selector);
        vault.swap(address(tokenA), 1_000, address(tokenB), 0);
    }

    // ============ swap — partial close (effectiveBps < 10000) ============

    function test_swap_partial_case1_staysStaked() public {
        // Q=1000, B=800, T=100. pendingBps=5000 → targetBase=400, targetQuote=550.
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(5_000);
        // partial close yields b=500, q=600 → both >= targets → Case 1
        _arrangeClose(tokenId, 600, 500);

        vm.expectEmit(true, false, false, true, address(vault));
        emit IStakingVault.Swap(executor, address(0), 0, address(0), 0, 5_000);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Staked));
        assertEq(vault.partialUnstakeBps(), 0);
        assertEq(vault.unstakeBufferBase(), 400); // B*0.5
        assertEq(vault.unstakeBufferQuote(), 500); // Q*0.5
        assertEq(vault.rewardBufferBase(), 100); // 500 - 400
        assertEq(vault.rewardBufferQuote(), 100); // 600 - 500
        assertEq(vault.stakedBase(), 400);
        assertEq(vault.stakedQuote(), 500);
        assertEq(vault.yieldTarget(), 50);
    }

    function test_swap_partial_case2() public {
        // pendingBps=5000. targetBase=400, targetQuote=550. After partial: b=500, q=400 → Case 2.
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(5_000);
        _arrangeClose(tokenId, 400, 500);

        // requiredMin = 550 - 400 = 150; amountOut = 500 - 400 = 100
        _approveExecutor(tokenA, 200);
        vm.prank(executor);
        uint256 out = vault.swap(address(tokenA), 200, address(tokenB), 0);
        assertEq(out, 100);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Staked));
        assertEq(vault.unstakeBufferBase(), 400);
        assertEq(vault.unstakeBufferQuote(), 500);
        assertEq(vault.rewardBufferBase(), 0);
        assertEq(vault.rewardBufferQuote(), 100); // (400 + 200) - 500
    }

    function test_swap_partial_case3() public {
        // pendingBps=5000. After partial: b=300, q=700 → b<400, q>550 → Case 3.
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(5_000);
        _arrangeClose(tokenId, 700, 300);

        // requiredMin = 400 - 300 = 100; amountOut = 700 - 550 = 150
        _approveExecutor(tokenB, 100);
        vm.prank(executor);
        uint256 out = vault.swap(address(tokenB), 100, address(tokenA), 0);
        assertEq(out, 150);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Staked));
        assertEq(vault.rewardBufferBase(), 0); // (300 + 100) - 400
        assertEq(vault.rewardBufferQuote(), 50); // 550 - 500 (T*0.5 = 50)
    }

    function test_swap_partial_case4_reverts() public {
        // pendingBps=5000. After partial: b=200, q=300 → both deficit → Case 4.
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(5_000);
        _arrangeClose(tokenId, 300, 200);
        _approveExecutor(tokenA, 1_000);
        vm.prank(executor);
        vm.expectRevert(UniswapV3StakingVault.Underwater.selector);
        vault.swap(address(tokenA), 1_000, address(tokenB), 0);
    }

    function test_swap_partial_explicitFullViaPendingBps10000() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(10_000);
        _arrangeClose(tokenId, 1_200, 900); // identical to default-0 full close

        vm.expectEmit(true, false, false, true, address(vault));
        emit IStakingVault.Swap(executor, address(0), 0, address(0), 0, 10_000);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
    }

    function test_swap_sequentialPartials_buffersAccumulate() public {
        // 30% then 30% partials. Confirm buffers sum and (B,Q,T) reduce monotonically.
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);

        // First partial — pendingBps = 3000.
        vm.prank(alice);
        vault.setPartialUnstakeBps(3_000);
        // partial close: b=400, q=400; targets: tB=240, tQ=330. Case 1 (both surplus).
        _arrangeClose(tokenId, 400, 400);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        // After 1st: unstakeBufBase=240, unstakeBufQuote=300, rewardBufBase=160, rewardBufQuote=100.
        // staked: B=560, Q=700, T=70; state=Staked.
        assertEq(vault.unstakeBufferBase(), 240);
        assertEq(vault.unstakeBufferQuote(), 300);
        assertEq(vault.rewardBufferBase(), 160);
        assertEq(vault.rewardBufferQuote(), 100);
        assertEq(vault.stakedBase(), 560);
        assertEq(vault.stakedQuote(), 700);
        assertEq(vault.yieldTarget(), 70);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Staked));

        // Second partial — pendingBps = 3000 again.
        vm.prank(alice);
        vault.setPartialUnstakeBps(3_000);
        // Now B=560, Q=700, T=70. Targets: tB=168, tQ=231.
        // Arrange b=200, q=300 → Case 1 (both surplus).
        nfpm.setNextDecreaseResult(tokenId, 300, 200);
        tokenA.mint(address(nfpm), 300);
        tokenB.mint(address(nfpm), 200);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        // Buffers accumulate. New deltas: unstakeBaseDelta=168, unstakeQuoteDelta=210.
        // rewardBufBase += 200 - 168 = 32 → total 192. rewardBufQuote += 300 - 210 = 90 → total 190.
        assertEq(vault.unstakeBufferBase(), 240 + 168);
        assertEq(vault.unstakeBufferQuote(), 300 + 210);
        assertEq(vault.rewardBufferBase(), 160 + 32);
        assertEq(vault.rewardBufferQuote(), 100 + 90);
        assertEq(vault.stakedBase(), 560 - 168);
        assertEq(vault.stakedQuote(), 700 - 210);
        assertEq(vault.yieldTarget(), 70 - 21); // 70 * 3000 / 10000 = 21
    }

    // ============ unstake / claimRewards (buffer drain) ============

    function test_unstake_then_claim_paysOwner_full() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900); // Case 1 → reward 100/200
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        uint256 quoteBefore = tokenA.balanceOf(alice);
        uint256 baseBefore = tokenB.balanceOf(alice);

        vm.startPrank(alice);
        vault.unstake();
        vault.claimRewards();
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), quoteBefore + 1_000 + 200);
        assertEq(tokenB.balanceOf(alice), baseBefore + 800 + 100);
        assertEq(tokenA.balanceOf(address(vault)), 0);
        assertEq(tokenB.balanceOf(address(vault)), 0);
        assertEq(vault.unstakeBufferBase(), 0);
        assertEq(vault.unstakeBufferQuote(), 0);
        assertEq(vault.rewardBufferBase(), 0);
        assertEq(vault.rewardBufferQuote(), 0);
    }

    function test_claim_then_unstake_orderIndependent() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        vm.startPrank(alice);
        vault.claimRewards();
        vault.unstake();
        vm.stopPrank();
        assertEq(vault.unstakeBufferBase(), 0);
        assertEq(vault.rewardBufferBase(), 0);
    }

    function test_unstake_revertsIfBuffersEmpty() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        vm.startPrank(alice);
        vault.unstake();
        vm.expectRevert(UniswapV3StakingVault.NothingToUnstake.selector);
        vault.unstake();
        vm.stopPrank();
    }

    function test_claim_revertsIfBuffersEmpty() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        vm.startPrank(alice);
        vault.claimRewards();
        vm.expectRevert(UniswapV3StakingVault.NothingToClaim.selector);
        vault.claimRewards();
        vm.stopPrank();
    }

    function test_unstake_revertsIfEmpty_state() public {
        // Empty state — no buffers exist yet.
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

    function test_unstake_callableInStaked_partialCycle() public {
        // After a partial swap the state is Staked but buffers are non-empty.
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(5_000);
        _arrangeClose(tokenId, 600, 500); // Case 1 partial

        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Staked));

        uint256 baseBefore = tokenB.balanceOf(alice);
        uint256 quoteBefore = tokenA.balanceOf(alice);
        vm.startPrank(alice);
        vault.unstake();
        vault.claimRewards();
        vm.stopPrank();
        // unstake: 400 base, 500 quote. claim: 100 base, 100 quote.
        assertEq(tokenB.balanceOf(alice), baseBefore + 400 + 100);
        assertEq(tokenA.balanceOf(alice), quoteBefore + 500 + 100);
    }

    function test_unstake_multipleCycles_acrossSettlements() public {
        // Drain after partial 1, then settle full → drain again.
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(3_000);
        _arrangeClose(tokenId, 400, 400); // Case 1 partial → buffers populated

        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);

        uint256 baseBefore = tokenB.balanceOf(alice);
        uint256 quoteBefore = tokenA.balanceOf(alice);

        vm.startPrank(alice);
        vault.unstake();
        vault.claimRewards();
        vm.stopPrank();
        assertEq(vault.unstakeBufferBase(), 0);
        assertEq(vault.rewardBufferBase(), 0);

        // Now do full close on the remaining 70% position.
        // B=560, Q=700, T=70. Partial close: vault gets, say, 700 base + 800 quote.
        nfpm.setNextDecreaseResult(tokenId, 800, 700);
        tokenA.mint(address(nfpm), 800);
        tokenB.mint(address(nfpm), 700);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0); // pendingBps=0 → effectiveBps=10000

        // Second drain.
        vm.startPrank(alice);
        vault.unstake();
        vault.claimRewards();
        vm.stopPrank();
        // First drain delivered: 240 base + 300 quote (unstake) + 160 base + 100 quote (claim).
        // Second drain delivered: 560 base + 700 quote (unstake) + (700-560)=140 base + (800-700)=100 quote (claim).
        // Total alice received: 240+160+560+140 = 1100 base, 300+100+700+100 = 1200 quote.
        assertEq(tokenB.balanceOf(alice) - baseBefore, 1_100);
        assertEq(tokenA.balanceOf(alice) - quoteBefore, 1_200);
    }

    // ============ flashClose — full (bps == 10000) ============

    function _setupFlashCallback() internal returns (MockFlashCloseCallback cb) {
        // tokenA = quote, tokenB = base when isToken0Quote=true.
        cb = new MockFlashCloseCallback(address(vault), tokenB, tokenA);
    }

    function test_flashClose_full_case1_autoDrains() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900); // Case 1 surplus

        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.Exact);

        uint256 baseBefore = tokenB.balanceOf(alice);
        uint256 quoteBefore = tokenA.balanceOf(alice);

        vm.expectEmit(true, false, true, true, address(vault));
        emit IStakingVault.FlashCloseInitiated(alice, 10_000, address(cb), "");

        vm.prank(alice);
        vault.flashClose(10_000, address(cb), "");

        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
        // Auto-drain: buffers all zero post-call.
        assertEq(vault.unstakeBufferBase(), 0);
        assertEq(vault.unstakeBufferQuote(), 0);
        assertEq(vault.rewardBufferBase(), 0);
        assertEq(vault.rewardBufferQuote(), 0);
        // expected returned: 800 base, 1100 quote.
        // unstake delivers 800 base + 1000 quote; claim delivers 0 base + 100 quote.
        assertEq(tokenB.balanceOf(alice), baseBefore + 800);
        assertEq(tokenA.balanceOf(alice), quoteBefore + 1_100);
    }

    function test_flashClose_returnsSurplus_flowsToClaimRewards() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);

        MockFlashCloseCallback cb = _setupFlashCallback();
        tokenB.mint(address(cb), 50); // surplus base seed
        cb.setMode(MockFlashCloseCallback.Mode.SurplusBase);
        cb.setSurplus(50, 0);

        uint256 baseBefore = tokenB.balanceOf(alice);
        vm.prank(alice);
        vault.flashClose(10_000, address(cb), "");
        // Alice gets stakedBase + surplus: 800 + 50 = 850 base.
        assertEq(tokenB.balanceOf(alice), baseBefore + 850);
    }

    function test_flashClose_revertsOnInsufficientBase() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.InsufficientBase);
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.InsufficientBaseReturned.selector);
        vault.flashClose(10_000, address(cb), "");
    }

    function test_flashClose_revertsOnInsufficientQuote() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.InsufficientQuote);
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.InsufficientQuoteReturned.selector);
        vault.flashClose(10_000, address(cb), "");
    }

    function test_flashClose_revertsIfNotOwner() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(bob);
        vm.expectRevert(UniswapV3StakingVault.NotOwner.selector);
        vault.flashClose(10_000, address(0xdead), "");
    }

    function test_flashClose_reentrantSwap_revertsViaStateLock() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.ReentrantSwap);
        vm.prank(alice);
        vm.expectRevert();
        vault.flashClose(10_000, address(cb), "");
    }

    function test_flashClose_overflowYieldTarget_reverts() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, type(uint256).max);
        _arrangeClose(tokenId, 1_200, 900);
        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.Exact);
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.YieldTargetOverflow.selector);
        vault.flashClose(10_000, address(cb), "");
    }

    function test_flashClose_revertsIfBpsZero() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.InvalidBps.selector);
        vault.flashClose(0, address(0xdead), "");
    }

    function test_flashClose_revertsIfBpsAbove10000() public {
        _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vm.expectRevert(UniswapV3StakingVault.InvalidBps.selector);
        vault.flashClose(10_001, address(0xdead), "");
    }

    function test_flashClose_full_case2_callbackBridgesQuoteDeficit() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 900, 900); // Case 2

        MockFlashCloseCallback cb = _setupFlashCallback();
        tokenA.mint(address(cb), 200); // bridge 200 quote
        cb.setMode(MockFlashCloseCallback.Mode.Exact);

        uint256 baseBefore = tokenB.balanceOf(alice);
        uint256 quoteBefore = tokenA.balanceOf(alice);
        vm.prank(alice);
        vault.flashClose(10_000, address(cb), "");
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Settled));
        assertEq(tokenB.balanceOf(alice), baseBefore + 800);
        assertEq(tokenA.balanceOf(alice), quoteBefore + 1_100);
    }

    function test_flashClose_full_case3_callbackBridgesBaseDeficit() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_300, 700);
        MockFlashCloseCallback cb = _setupFlashCallback();
        tokenB.mint(address(cb), 100);
        cb.setMode(MockFlashCloseCallback.Mode.Exact);

        uint256 baseBefore = tokenB.balanceOf(alice);
        uint256 quoteBefore = tokenA.balanceOf(alice);
        vm.prank(alice);
        vault.flashClose(10_000, address(cb), "");
        assertEq(tokenB.balanceOf(alice), baseBefore + 800);
        assertEq(tokenA.balanceOf(alice), quoteBefore + 1_100);
    }

    function test_flashClose_full_case4_callbackBridgesBoth() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 500, 500);
        MockFlashCloseCallback cb = _setupFlashCallback();
        tokenB.mint(address(cb), 300);
        tokenA.mint(address(cb), 600);
        cb.setMode(MockFlashCloseCallback.Mode.Exact);

        uint256 baseBefore = tokenB.balanceOf(alice);
        uint256 quoteBefore = tokenA.balanceOf(alice);
        vm.prank(alice);
        vault.flashClose(10_000, address(cb), "");
        assertEq(tokenB.balanceOf(alice), baseBefore + 800);
        assertEq(tokenA.balanceOf(alice), quoteBefore + 1_100);
    }

    // ============ flashClose — partial (bps < 10000) ============

    function test_flashClose_partial_returnsToStaked_pendingBpsUntouched() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100); // Q=1000, B=800, T=100
        // Set a pendingBps that flashClose must NOT touch.
        vm.prank(alice);
        vault.setPartialUnstakeBps(2_000);

        // Partial flashClose at bps=5000.
        // expectedBase = 400, expectedQuote = 550. partial close yields b=500, q=600.
        _arrangeClose(tokenId, 600, 500);
        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.Exact);

        uint256 baseBefore = tokenB.balanceOf(alice);
        uint256 quoteBefore = tokenA.balanceOf(alice);
        vm.prank(alice);
        vault.flashClose(5_000, address(cb), "");

        // State returned to Staked, pendingBps preserved.
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Staked));
        assertEq(vault.partialUnstakeBps(), 2_000);
        // (B,Q,T) reduced proportionally.
        assertEq(vault.stakedBase(), 400);
        assertEq(vault.stakedQuote(), 500);
        assertEq(vault.yieldTarget(), 50);
        // Auto-drain: alice receives expected amounts.
        assertEq(tokenB.balanceOf(alice), baseBefore + 400);
        assertEq(tokenA.balanceOf(alice), quoteBefore + 550);
        // Buffers cleared.
        assertEq(vault.unstakeBufferBase(), 0);
        assertEq(vault.rewardBufferBase(), 0);
    }

    function test_flashClose_partial_drainsPreExistingBuffers() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);

        // First, do a partial swap that fills buffers but doesn't drain.
        vm.prank(alice);
        vault.setPartialUnstakeBps(3_000);
        _arrangeClose(tokenId, 400, 400); // Case 1 partial
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        // Buffers now: unstake (240, 300), reward (160, 100). State: Staked.

        // Now flashClose the remaining 50% of position. B=560, Q=700, T=70.
        // expectedBase = 280, expectedQuote = (770)*0.5 = 385.
        // Pre-balances at flashClose entry: vault holds 240+160=400 base, 300+100=400 quote.
        nfpm.setNextDecreaseResult(tokenId, 500, 400);
        tokenA.mint(address(nfpm), 500);
        tokenB.mint(address(nfpm), 400);
        MockFlashCloseCallback cb = _setupFlashCallback();
        cb.setMode(MockFlashCloseCallback.Mode.Exact);

        uint256 baseBefore = tokenB.balanceOf(alice);
        uint256 quoteBefore = tokenA.balanceOf(alice);
        vm.prank(alice);
        vault.flashClose(5_000, address(cb), "");

        // Alice receives the pre-existing buffers PLUS the new partial settlement.
        // Mode.Exact returns exactly (expectedBase=280, expectedQuote=385) to the vault.
        // New unstake delta: (280, 350). New reward delta: (0, 35). Combined with the
        // pre-existing buffers (240/300 unstake, 160/100 reward) the auto-drain yields:
        //   alice base  += 240 + 160 + 280 +  0 = 680
        //   alice quote += 300 + 100 + 350 + 35 = 785
        assertEq(tokenB.balanceOf(alice), baseBefore + 680);
        assertEq(tokenA.balanceOf(alice), quoteBefore + 785);
        assertEq(uint256(vault.state()), uint256(UniswapV3StakingVault.State.Staked));
        // Remaining staked: B=280, Q=350, T=35 (70 - 35).
        assertEq(vault.stakedBase(), 280);
        assertEq(vault.stakedQuote(), 350);
        assertEq(vault.yieldTarget(), 35);
    }

    // ============ quoteSwap (state-dependent) ============

    function test_quoteSwap_notApplicable_inEmpty() public view {
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.NotApplicable));
        assertEq(q.effectiveBps, 0);
    }

    function test_quoteSwap_notApplicable_inSettled() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        _arrangeClose(tokenId, 1_200, 900);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.NotApplicable));
        assertEq(q.effectiveBps, 0);
    }

    function test_quoteSwap_underwater_onOverflow() public {
        _stake(1_000, 800, 500, true, type(uint256).max);
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.Underwater));
        assertEq(q.effectiveBps, 10_000);
    }

    function test_quoteSwap_noSwapNeeded_via_owedFees() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        nfpm.setLiquidityForTesting(tokenId, 0);
        nfpm.accrueFeesForTesting(tokenId, 1_200, 900); // q=1200>=1100, b=900>=800

        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.NoSwapNeeded));
        assertEq(q.effectiveBps, 10_000);
    }

    function test_quoteSwap_executable_case2() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        nfpm.setLiquidityForTesting(tokenId, 0);
        nfpm.accrueFeesForTesting(tokenId, 900, 900);
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.Executable));
        assertEq(q.tokenIn, address(tokenA));
        assertEq(q.tokenOut, address(tokenB));
        assertEq(q.minAmountIn, 200);
        assertEq(q.amountOut, 100);
        assertEq(q.effectiveBps, 10_000);
    }

    function test_quoteSwap_executable_case3() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        nfpm.setLiquidityForTesting(tokenId, 0);
        nfpm.accrueFeesForTesting(tokenId, 1_300, 700);
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.Executable));
        assertEq(q.tokenIn, address(tokenB));
        assertEq(q.tokenOut, address(tokenA));
        assertEq(q.minAmountIn, 100);
        assertEq(q.amountOut, 200);
    }

    function test_quoteSwap_underwater_case4() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        nfpm.setLiquidityForTesting(tokenId, 0);
        nfpm.accrueFeesForTesting(tokenId, 500, 500);
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.Underwater));
    }

    function test_quoteSwap_partial_reflectsPendingBps() public {
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(5_000);
        // With L=0 + owed fees, principal = 0 regardless of bps; fees not pro-rated.
        nfpm.setLiquidityForTesting(tokenId, 0);
        nfpm.accrueFeesForTesting(tokenId, 600, 500); // q=600, b=500
        // Targets at 5000 bps: tB=400, tQ=550. Case 1 (both surplus).
        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.NoSwapNeeded));
        assertEq(q.effectiveBps, 5_000);
    }

    // ============ quoteSwap — live (unsnapshotted) fees ============

    function test_quoteSwap_liveFees_flipsCaseFromUnderwaterToExecutable() public {
        uint256 tokenId = _stake(10_000, 10_000, 1, true, 100);
        SwapQuote memory q0 = vault.quoteSwap();
        assertEq(uint256(q0.status), uint256(SwapStatus.Underwater));

        uint256 Q128 = 1 << 128;
        pool.setTickData(TICK_LOWER, 0, 0);
        pool.setTickData(TICK_UPPER, 0, 0);
        nfpm.setFeeGrowthInsideLastForTesting(tokenId, 0, 0);
        pool.setFeeGrowthGlobal(10_300 * Q128, 0);

        SwapQuote memory q1 = vault.quoteSwap();
        assertEq(uint256(q1.status), uint256(SwapStatus.Executable));
        assertEq(q1.tokenIn, address(tokenB));
        assertEq(q1.tokenOut, address(tokenA));
        assertApproxEqAbs(q1.amountOut, 200, 5);
        assertApproxEqAbs(q1.minAmountIn, 10_000, 5);
    }

    function test_quoteSwap_liveFees_reachNoSwapNeeded() public {
        uint256 tokenId = _stake(10_000, 10_000, 1, true, 100);
        uint256 Q128 = 1 << 128;
        pool.setTickData(TICK_LOWER, 0, 0);
        pool.setTickData(TICK_UPPER, 0, 0);
        nfpm.setFeeGrowthInsideLastForTesting(tokenId, 0, 0);
        pool.setFeeGrowthGlobal(11_000 * Q128, 11_000 * Q128);

        SwapQuote memory q = vault.quoteSwap();
        assertEq(uint256(q.status), uint256(SwapStatus.NoSwapNeeded));
    }

    // ============ Multicall ============

    function test_multicall_composes_setYieldTarget() public {
        _stake(1_000, 800, 500, true, 100);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSelector(UniswapV3StakingVault.setYieldTarget.selector, 250);
        calls[1] = abi.encodeWithSelector(UniswapV3StakingVault.setYieldTarget.selector, 500);
        vm.prank(alice);
        vault.multicall(calls);
        assertEq(vault.yieldTarget(), 500);
    }

    function test_multicall_revertsIfInnerCallReverts() public {
        _stake(1_000, 800, 500, true, 100);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeWithSelector(UniswapV3StakingVault.setYieldTarget.selector, 250);
        vm.prank(bob);
        vm.expectRevert(UniswapV3StakingVault.NotOwner.selector);
        vault.multicall(calls);
    }

    function test_multicall_setPartialThenUnstake_atomic() public {
        // Pre-fill unstake buffer via a partial swap.
        uint256 tokenId = _stake(1_000, 800, 500, true, 100);
        vm.prank(alice);
        vault.setPartialUnstakeBps(3_000);
        _arrangeClose(tokenId, 400, 400);
        vm.prank(executor);
        vault.swap(address(0), 0, address(0), 0);
        // Buffers populated, state Staked.

        // Now atomic: setPartialUnstakeBps(2000) + unstake() in one tx.
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSelector(
            UniswapV3StakingVault.setPartialUnstakeBps.selector, uint16(2_000)
        );
        calls[1] = abi.encodeWithSelector(UniswapV3StakingVault.unstake.selector);
        vm.prank(alice);
        vault.multicall(calls);

        assertEq(vault.partialUnstakeBps(), 2_000);
        assertEq(vault.unstakeBufferBase(), 0);
        assertEq(vault.unstakeBufferQuote(), 0);
    }

    // ============ Reentrancy probes ============

    function _setupMaliciousVault()
        internal
        returns (UniswapV3StakingVault v, ReentrantToken mal, MockERC20 plainBase, uint256 tid)
    {
        v = UniswapV3StakingVault(Clones.clone(address(implementation)));
        v.initialize(alice);

        mal = new ReentrantToken();
        plainBase = new MockERC20("B", "B");

        bool malIsToken0 = address(mal) < address(plainBase);
        address t0 = malIsToken0 ? address(mal) : address(plainBase);
        address t1 = malIsToken0 ? address(plainBase) : address(mal);
        bool isQ0 = malIsToken0;

        MockUniPool poolNew = new MockUniPool(SQRT_PRICE_X96, 0);
        uniFactory.setPool(t0, t1, FEE, address(poolNew));

        uint256 desired0 = isQ0 ? 1_000 : 800;
        uint256 desired1 = isQ0 ? 800 : 1_000;
        nfpm.setNextMintResult(500, desired0, desired1);

        mal.mintForTest(alice, desired0 + desired1);
        plainBase.mint(alice, desired0 + desired1);

        vm.startPrank(alice);
        IERC20(t0).approve(address(v), type(uint256).max);
        IERC20(t1).approve(address(v), type(uint256).max);
        StakeParams memory sp = StakeParams({
            token0: t0,
            token1: t1,
            fee: FEE,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: desired0,
            amount1Desired: desired1,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        });
        tid = v.stake(sp, isQ0, 100);
        vm.stopPrank();

        nfpm.setLiquidityForTesting(tid, L_BIG);
        nfpm.setNextDecreaseResult(tid, 900, 900);
        mal.mintForTest(address(nfpm), 900);
        plainBase.mint(address(nfpm), 900);

        mal.setTarget(address(v));
    }

    function test_stake_reentrancy_isBlocked() public {
        UniswapV3StakingVault v = UniswapV3StakingVault(Clones.clone(address(implementation)));
        v.initialize(alice);

        ReentrantToken mal = new ReentrantToken();
        MockERC20 plainBase = new MockERC20("B", "B");

        bool malIsToken0 = address(mal) < address(plainBase);
        address t0 = malIsToken0 ? address(mal) : address(plainBase);
        address t1 = malIsToken0 ? address(plainBase) : address(mal);
        bool isQ0 = malIsToken0;

        MockUniPool poolNew = new MockUniPool(SQRT_PRICE_X96, 0);
        uniFactory.setPool(t0, t1, FEE, address(poolNew));

        nfpm.setNextMintResult(500, isQ0 ? 1_000 : 800, isQ0 ? 800 : 1_000);
        mal.mintForTest(alice, 2_000);
        plainBase.mint(alice, 2_000);

        mal.setTarget(address(v));
        mal.armAttack();

        vm.startPrank(alice);
        IERC20(t0).approve(address(v), type(uint256).max);
        IERC20(t1).approve(address(v), type(uint256).max);
        StakeParams memory sp = StakeParams({
            token0: t0,
            token1: t1,
            fee: FEE,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: isQ0 ? 1_000 : 800,
            amount1Desired: isQ0 ? 800 : 1_000,
            amount0Min: 0,
            amount1Min: 0,
            deadline: DEADLINE
        });
        vm.expectRevert();
        v.stake(sp, isQ0, 100);
        vm.stopPrank();
    }

    function test_swap_reentrancy_isBlocked() public {
        (UniswapV3StakingVault v, ReentrantToken mal, MockERC20 plainBase,) =
            _setupMaliciousVault();
        mal.armAttack();
        mal.mintForTest(executor, 250);
        vm.prank(executor);
        IERC20(address(mal)).approve(address(v), 250);
        vm.prank(executor);
        vm.expectRevert();
        v.swap(address(mal), 250, address(plainBase), 0);
    }
}

/// @notice Minimal ERC-20 with a `transferFrom` hook that re-enters a target
///         vault's `swap()` once. Models the ERC-777 / fee-on-transfer
///         reentrancy threat.
contract ReentrantToken is ERC20 {
    address public target;
    bool public attack;

    constructor() ERC20("Reentrant", "REE") {}

    function setTarget(address t) external {
        target = t;
    }

    function armAttack() external {
        attack = true;
    }

    function mintForTest(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount)
        public
        override
        returns (bool)
    {
        bool ok = super.transferFrom(from, to, amount);
        if (attack && target != address(0)) {
            attack = false;
            UniswapV3StakingVault(target).swap(address(0), 0, address(0), 0);
        }
        return ok;
    }
}
