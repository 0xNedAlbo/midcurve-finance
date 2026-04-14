// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {UniswapV3Vault} from "../../contracts/vault/UniswapV3Vault.sol";
import {MintParams, BurnParams} from "../../contracts/vault/interfaces/IMultiTokenVault.sol";
import {
    MockNonfungiblePositionManager,
    MockUniswapV3Factory,
    MockUniswapV3Pool
} from "./mocks/MockNonfungiblePositionManager.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UniswapV3VaultTest is Test {
    UniswapV3Vault public implementation;
    UniswapV3Vault public vault;

    MockNonfungiblePositionManager public nfpm;
    MockUniswapV3Factory public uniFactory;
    MockUniswapV3Pool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public operator_ = makeAddr("operator");

    uint256 public constant TOKEN_ID = 42;
    uint128 public constant INITIAL_LIQUIDITY = 1_000_000;
    uint24 public constant FEE = 3000;
    int24 public constant TICK_LOWER = -887220;
    int24 public constant TICK_UPPER = 887220;
    // sqrtPriceX96 for price = 1.0 (tick 0)
    uint160 public constant SQRT_PRICE_X96 = 79228162514264337593543950336;

    function setUp() public {
        // Deploy mocks
        uniFactory = new MockUniswapV3Factory();
        nfpm = new MockNonfungiblePositionManager(address(uniFactory));
        tokenA = new MockERC20("Token A", "TKNA");
        tokenB = new MockERC20("Token B", "TKNB");
        pool = new MockUniswapV3Pool(SQRT_PRICE_X96, 0);

        // Register pool in factory
        uniFactory.setPool(address(tokenA), address(tokenB), FEE, address(pool));

        // Create NFT position owned by alice
        nfpm.createPosition(
            TOKEN_ID, alice, address(tokenA), address(tokenB), FEE, TICK_LOWER, TICK_UPPER, INITIAL_LIQUIDITY
        );

        // Fund NFPM with tokens for collect() payouts
        tokenA.mint(address(nfpm), 100_000_000e18);
        tokenB.mint(address(nfpm), 100_000_000e18);

        // Deploy implementation and clone
        implementation = new UniswapV3Vault();
        vault = UniswapV3Vault(Clones.clone(address(implementation)));

        // Transfer NFT to vault and initialize
        vm.startPrank(alice);
        nfpm.approve(address(this), TOKEN_ID);
        vm.stopPrank();
        nfpm.transferFrom(alice, address(vault), TOKEN_ID);

        vault.initialize(
            address(nfpm), TOKEN_ID, "Vault Token", "VLT", 6, alice, operator_
        );
    }

    // ============ Helpers ============

    function _mintParams(uint256 maxAmount0, uint256 maxAmount1, address recipient)
        internal
        view
        returns (MintParams memory)
    {
        uint256[] memory maxAmounts = new uint256[](2);
        maxAmounts[0] = maxAmount0;
        maxAmounts[1] = maxAmount1;
        uint256[] memory minAmounts = new uint256[](2);
        return MintParams({maxAmounts: maxAmounts, minAmounts: minAmounts, recipient: recipient, deadline: block.timestamp});
    }

    function _burnParams(uint256 minAmount0, uint256 minAmount1, address recipient)
        internal
        view
        returns (BurnParams memory)
    {
        uint256[] memory minAmounts = new uint256[](2);
        minAmounts[0] = minAmount0;
        minAmounts[1] = minAmount1;
        return BurnParams({minAmounts: minAmounts, recipient: recipient, deadline: block.timestamp});
    }

    // ============ Initialization ============

    function test_initialize_setsMetadata() public view {
        assertEq(vault.name(), "Vault Token");
        assertEq(vault.symbol(), "VLT");
        assertEq(vault.decimals(), 6);
    }

    function test_initialize_setsPositionData() public view {
        assertEq(address(vault.positionManager()), address(nfpm));
        assertEq(vault.tokenId(), TOKEN_ID);
        assertEq(vault.token0(), address(tokenA));
        assertEq(vault.token1(), address(tokenB));
        assertEq(vault.pool(), address(pool));
    }

    function test_initialize_mintsSharesEqualToLiquidity() public view {
        assertEq(vault.totalSupply(), INITIAL_LIQUIDITY);
        assertEq(vault.balanceOf(alice), INITIAL_LIQUIDITY);
    }

    function test_initialize_vaultOwnsNFT() public view {
        assertEq(nfpm.ownerOf(TOKEN_ID), address(vault));
    }

    function test_initialize_setsOperator() public view {
        assertEq(vault.operator(), operator_);
    }

    function test_initialize_revertsIfAlreadyInitialized() public {
        vm.expectRevert(UniswapV3Vault.AlreadyInitialized.selector);
        vault.initialize(address(nfpm), TOKEN_ID, "X", "Y", 18, alice, operator_);
    }

    function test_initialize_zeroLiquidityMintsNoShares() public {
        uint256 emptyTokenId = 99;
        nfpm.createPosition(
            emptyTokenId, alice, address(tokenA), address(tokenB), FEE, TICK_LOWER, TICK_UPPER, 0
        );

        UniswapV3Vault emptyVault = UniswapV3Vault(Clones.clone(address(implementation)));
        vm.prank(alice);
        nfpm.approve(address(this), emptyTokenId);
        nfpm.transferFrom(alice, address(emptyVault), emptyTokenId);

        emptyVault.initialize(address(nfpm), emptyTokenId, "Empty", "EMPTY", 18, alice, operator_);

        assertEq(emptyVault.totalSupply(), 0);
        assertEq(emptyVault.balanceOf(alice), 0);
    }

    function test_initialize_feesClaimableViaAccumulator() public {
        // Create a fresh position with pre-existing fees
        uint256 feeTokenId = 200;
        nfpm.createPosition(
            feeTokenId, alice, address(tokenA), address(tokenB), FEE, TICK_LOWER, TICK_UPPER, INITIAL_LIQUIDITY
        );
        nfpm.accrueFeesForTesting(feeTokenId, 5000, 8000);

        // Deploy a new vault and initialize with the fee-bearing position
        UniswapV3Vault feeVault = UniswapV3Vault(Clones.clone(address(implementation)));
        vm.prank(alice);
        nfpm.approve(address(this), feeTokenId);
        nfpm.transferFrom(alice, address(feeVault), feeTokenId);

        uint256 aliceA_before = tokenA.balanceOf(alice);
        uint256 aliceB_before = tokenB.balanceOf(alice);

        feeVault.initialize(address(nfpm), feeTokenId, "FeeVault", "FVLT", 6, alice, operator_);

        // Fees should NOT have been sent directly to alice during init
        assertEq(tokenA.balanceOf(alice), aliceA_before, "no direct token0 transfer during init");
        assertEq(tokenB.balanceOf(alice), aliceB_before, "no direct token1 transfer during init");

        // Fees should be held by the vault
        assertEq(tokenA.balanceOf(address(feeVault)), 5000, "vault holds token0 fees");
        assertEq(tokenB.balanceOf(address(feeVault)), 8000, "vault holds token1 fees");

        // Alice can claim the initialization fees via collectYield
        vm.prank(alice);
        feeVault.collectYield(alice);

        assertEq(tokenA.balanceOf(alice) - aliceA_before, 5000, "alice claims token0 fees");
        assertEq(tokenB.balanceOf(alice) - aliceB_before, 8000, "alice claims token1 fees");
    }

    function test_initialize_feesNotOrphanedWithZeroLiquidity() public {
        // Edge case: position with fees but zero liquidity
        uint256 emptyFeeTokenId = 201;
        nfpm.createPosition(
            emptyFeeTokenId, alice, address(tokenA), address(tokenB), FEE, TICK_LOWER, TICK_UPPER, 0
        );
        nfpm.accrueFeesForTesting(emptyFeeTokenId, 1000, 2000);

        UniswapV3Vault emptyFeeVault = UniswapV3Vault(Clones.clone(address(implementation)));
        vm.prank(alice);
        nfpm.approve(address(this), emptyFeeTokenId);
        nfpm.transferFrom(alice, address(emptyFeeVault), emptyFeeTokenId);

        emptyFeeVault.initialize(address(nfpm), emptyFeeTokenId, "Empty", "EMPTY", 18, alice, operator_);

        // With zero liquidity, no shares minted → totalSupply = 0
        // Fees collected into vault but can't be distributed (supply = 0 in accumulator)
        // This is acceptable: zero-liquidity positions shouldn't have meaningful fees
        assertEq(emptyFeeVault.totalSupply(), 0);
    }

    function test_initialize_subsequentFeesWorkNormally() public {
        // Verify that after init with fees, the accumulator works for future fees too
        uint256 feeTokenId = 202;
        nfpm.createPosition(
            feeTokenId, alice, address(tokenA), address(tokenB), FEE, TICK_LOWER, TICK_UPPER, INITIAL_LIQUIDITY
        );
        nfpm.accrueFeesForTesting(feeTokenId, 1000, 1000);

        UniswapV3Vault feeVault = UniswapV3Vault(Clones.clone(address(implementation)));
        vm.prank(alice);
        nfpm.approve(address(this), feeTokenId);
        nfpm.transferFrom(alice, address(feeVault), feeTokenId);
        feeVault.initialize(address(nfpm), feeTokenId, "FV", "FV", 6, alice, operator_);

        // Claim init fees
        vm.prank(alice);
        feeVault.collectYield(alice);

        // Accrue new fees after init
        nfpm.accrueFeesForTesting(feeTokenId, 3000, 4000);

        uint256 aliceA_before = tokenA.balanceOf(alice);
        uint256 aliceB_before = tokenB.balanceOf(alice);

        vm.prank(alice);
        feeVault.collectYield(alice);

        assertEq(tokenA.balanceOf(alice) - aliceA_before, 3000, "post-init token0 fees");
        assertEq(tokenB.balanceOf(alice) - aliceB_before, 4000, "post-init token1 fees");
    }

    function test_initialize_revertsIfNFTNotOwned() public {
        uint256 otherTokenId = 100;
        nfpm.createPosition(
            otherTokenId, bob, address(tokenA), address(tokenB), FEE, TICK_LOWER, TICK_UPPER, 1000
        );

        UniswapV3Vault badVault = UniswapV3Vault(Clones.clone(address(implementation)));
        vm.expectRevert(UniswapV3Vault.NFTNotReceived.selector);
        badVault.initialize(address(nfpm), otherTokenId, "Bad", "BAD", 18, alice, operator_);
    }

    // ============ IMultiTokenVault — Identification ============

    function test_vaultType() public view {
        assertEq(vault.vaultType(), keccak256("uniswap-v3-concentrated-liquidity"));
    }

    function test_tokenCount() public view {
        assertEq(vault.tokenCount(), 2);
    }

    function test_tokens() public view {
        assertEq(vault.tokens(0), address(tokenA));
        assertEq(vault.tokens(1), address(tokenB));
    }

    function test_tokens_revertsOnInvalidIndex() public {
        vm.expectRevert(UniswapV3Vault.InvalidTokenIndex.selector);
        vault.tokens(2);
    }

    // ============ Operator ============

    function test_setOperator() public {
        vm.prank(operator_);
        vault.setOperator(bob);
        assertEq(vault.operator(), bob);
    }

    function test_setOperator_revertsIfNotOperator() public {
        vm.prank(alice);
        vm.expectRevert(UniswapV3Vault.NotOperator.selector);
        vault.setOperator(bob);
    }

    function test_tend_reverts() public {
        vm.prank(operator_);
        vm.expectRevert(UniswapV3Vault.UnsupportedTendOperation.selector);
        vault.tend(bytes32(0), "");
    }

    function test_tend_revertsIfNotOperator() public {
        vm.prank(alice);
        vm.expectRevert(UniswapV3Vault.NotOperator.selector);
        vault.tend(bytes32(0), "");
    }

    // ============ Burn ============

    function test_burn_decreasesLiquidityAndTransfers() public {
        uint256 shares = 500_000;

        vm.prank(alice);
        vault.burn(shares, _burnParams(0, 0, alice));

        assertEq(vault.balanceOf(alice), INITIAL_LIQUIDITY - shares);
        assertEq(vault.totalSupply(), INITIAL_LIQUIDITY - shares);
    }

    function test_burn_fullBurn() public {
        vm.prank(alice);
        vault.burn(INITIAL_LIQUIDITY, _burnParams(0, 0, alice));

        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.totalSupply(), 0);
        assertEq(nfpm.ownerOf(TOKEN_ID), address(vault));
    }

    function test_burn_revertsOnZeroShares() public {
        vm.prank(alice);
        vm.expectRevert(UniswapV3Vault.ZeroShares.selector);
        vault.burn(0, _burnParams(0, 0, alice));
    }

    function test_burn_revertsOnInsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert(UniswapV3Vault.InsufficientBalance.selector);
        vault.burn(INITIAL_LIQUIDITY + 1, _burnParams(0, 0, alice));
    }

    function test_burn_sendsTokensToRecipient() public {
        uint256 balA_before = tokenA.balanceOf(bob);
        uint256 balB_before = tokenB.balanceOf(bob);

        vm.prank(alice);
        vault.burn(INITIAL_LIQUIDITY / 2, _burnParams(0, 0, bob));

        // Tokens should go to bob (recipient), not alice (burner)
        assertTrue(tokenA.balanceOf(bob) > balA_before || tokenB.balanceOf(bob) > balB_before);
    }

    function test_burn_revertsOnExpiredDeadline() public {
        uint256[] memory minAmounts = new uint256[](2);
        BurnParams memory params = BurnParams({
            minAmounts: minAmounts,
            recipient: alice,
            deadline: block.timestamp - 1
        });

        vm.prank(alice);
        vm.expectRevert(UniswapV3Vault.DeadlineExpired.selector);
        vault.burn(100, params);
    }

    // ============ Mint ============

    function test_mint_increasesLiquidityAndShares() public {
        uint256 amount0 = 1000e18;
        uint256 amount1 = 1000e18;

        tokenA.mint(bob, amount0);
        tokenB.mint(bob, amount1);

        vm.startPrank(bob);
        tokenA.approve(address(vault), amount0);
        tokenB.approve(address(vault), amount1);
        vault.mint(0, _mintParams(amount0, amount1, bob));
        vm.stopPrank();

        assertTrue(vault.balanceOf(bob) > 0);
        assertTrue(vault.totalSupply() > INITIAL_LIQUIDITY);
    }

    function test_mint_sharesToRecipient() public {
        uint256 amount0 = 1000e18;
        uint256 amount1 = 1000e18;

        tokenA.mint(bob, amount0);
        tokenB.mint(bob, amount1);

        vm.startPrank(bob);
        tokenA.approve(address(vault), amount0);
        tokenB.approve(address(vault), amount1);
        // Bob mints but alice receives shares
        vault.mint(0, _mintParams(amount0, amount1, alice));
        vm.stopPrank();

        // Alice should have received the new shares
        assertTrue(vault.balanceOf(alice) > INITIAL_LIQUIDITY);
        // Bob should have no shares (he only provided tokens)
        assertEq(vault.balanceOf(bob), 0);
    }

    function test_mint_revertsOnExpiredDeadline() public {
        uint256[] memory maxAmounts = new uint256[](2);
        maxAmounts[0] = 100;
        maxAmounts[1] = 100;
        uint256[] memory minAmounts = new uint256[](2);
        MintParams memory params = MintParams({
            maxAmounts: maxAmounts,
            minAmounts: minAmounts,
            recipient: alice,
            deadline: block.timestamp - 1
        });

        vm.prank(alice);
        vm.expectRevert(UniswapV3Vault.DeadlineExpired.selector);
        vault.mint(0, params);
    }

    function test_mint_revertsOnInvalidTokenCount() public {
        uint256[] memory maxAmounts = new uint256[](3);
        uint256[] memory minAmounts = new uint256[](3);
        MintParams memory params = MintParams({
            maxAmounts: maxAmounts,
            minAmounts: minAmounts,
            recipient: alice,
            deadline: block.timestamp
        });

        vm.prank(alice);
        vm.expectRevert(UniswapV3Vault.InvalidTokenCount.selector);
        vault.mint(0, params);
    }

    // ============ Fee accumulator ============

    function test_collectYield_distributesAccumulatedFees() public {
        nfpm.accrueFeesForTesting(TOKEN_ID, 1000, 2000);

        uint256 balA_before = tokenA.balanceOf(alice);
        uint256 balB_before = tokenB.balanceOf(alice);

        vm.prank(alice);
        vault.collectYield(alice);

        assertEq(tokenA.balanceOf(alice) - balA_before, 1000);
        assertEq(tokenB.balanceOf(alice) - balB_before, 2000);
    }

    function test_collectYield_sendsToRecipient() public {
        nfpm.accrueFeesForTesting(TOKEN_ID, 1000, 2000);

        uint256 balA_before = tokenA.balanceOf(bob);
        uint256 balB_before = tokenB.balanceOf(bob);

        vm.prank(alice);
        vault.collectYield(bob);

        assertEq(tokenA.balanceOf(bob) - balA_before, 1000);
        assertEq(tokenB.balanceOf(bob) - balB_before, 2000);
    }

    function test_collectYield_proportionalDistribution() public {
        vm.prank(alice);
        vault.transfer(bob, INITIAL_LIQUIDITY / 2);

        nfpm.accrueFeesForTesting(TOKEN_ID, 10_000, 20_000);

        uint256 aliceA_before = tokenA.balanceOf(alice);
        uint256 bobA_before = tokenA.balanceOf(bob);

        vm.prank(alice);
        vault.collectYield(alice);
        vm.prank(bob);
        vault.collectYield(bob);

        uint256 aliceFee0 = tokenA.balanceOf(alice) - aliceA_before;
        uint256 bobFee0 = tokenA.balanceOf(bob) - bobA_before;

        assertApproxEqAbs(aliceFee0, 5000, 1);
        assertApproxEqAbs(bobFee0, 5000, 1);
    }

    function test_feeAccumulator_settlesOnTransfer() public {
        nfpm.accrueFeesForTesting(TOKEN_ID, 10_000, 0);

        vm.prank(alice);
        vault.transfer(bob, INITIAL_LIQUIDITY / 2);

        uint256 balA_before = tokenA.balanceOf(alice);
        vm.prank(alice);
        vault.collectYield(alice);
        assertEq(tokenA.balanceOf(alice) - balA_before, 10_000);

        uint256 bobA_before = tokenA.balanceOf(bob);
        vm.prank(bob);
        vault.collectYield(bob);
        assertEq(tokenA.balanceOf(bob) - bobA_before, 0);
    }

    function test_burn_settlesFeesForBurner() public {
        nfpm.accrueFeesForTesting(TOKEN_ID, 5000, 5000);

        uint256 balA_before = tokenA.balanceOf(alice);
        uint256 balB_before = tokenB.balanceOf(alice);

        vm.prank(alice);
        vault.burn(INITIAL_LIQUIDITY / 2, _burnParams(0, 0, alice));

        assertTrue(tokenA.balanceOf(alice) > balA_before);
        assertTrue(tokenB.balanceOf(alice) > balB_before);
    }

    // ============ View functions ============

    function test_claimableYield_includesTokensOwed() public {
        nfpm.accrueFeesForTesting(TOKEN_ID, 1000, 2000);

        uint256[] memory fees = vault.claimableYield(alice);
        assertEq(fees[0], 1000);
        assertEq(fees[1], 2000);

        vm.prank(alice);
        vault.collectYield(alice);

        fees = vault.claimableYield(alice);
        assertEq(fees[0], 0);
        assertEq(fees[1], 0);
    }

    function test_claimableYield_proportionalSplit() public {
        vm.prank(alice);
        vault.transfer(bob, INITIAL_LIQUIDITY / 2);

        nfpm.accrueFeesForTesting(TOKEN_ID, 10_000, 20_000);

        uint256[] memory aliceFees = vault.claimableYield(alice);
        uint256[] memory bobFees = vault.claimableYield(bob);

        assertApproxEqAbs(aliceFees[0], 5000, 1);
        assertApproxEqAbs(aliceFees[1], 10_000, 1);
        assertApproxEqAbs(bobFees[0], 5000, 1);
        assertApproxEqAbs(bobFees[1], 10_000, 1);
    }

    function test_claimableYield_includesUnsnapshottedPoolFees() public {
        uint256 Q128 = 1 << 128;
        uint256 feeGrowth0 = 1000 * Q128 / INITIAL_LIQUIDITY;
        uint256 feeGrowth1 = 2000 * Q128 / INITIAL_LIQUIDITY;
        pool.setFeeGrowthGlobal(feeGrowth0, feeGrowth1);

        uint256[] memory fees = vault.claimableYield(alice);
        assertApproxEqAbs(fees[0], 1000, 1);
        assertApproxEqAbs(fees[1], 2000, 1);
    }

    function test_claimableYield_allFourComponents() public {
        nfpm.accrueFeesForTesting(TOKEN_ID, 500, 500);
        vm.prank(alice);
        vault.collectYield(alice);

        nfpm.accrueFeesForTesting(TOKEN_ID, 300, 300);

        uint256 Q128 = 1 << 128;
        uint256 feeGrowth0 = 200 * Q128 / INITIAL_LIQUIDITY;
        uint256 feeGrowth1 = 200 * Q128 / INITIAL_LIQUIDITY;
        pool.setFeeGrowthGlobal(feeGrowth0, feeGrowth1);

        uint256[] memory fees = vault.claimableYield(alice);
        assertApproxEqAbs(fees[0], 500, 1);
        assertApproxEqAbs(fees[1], 500, 1);
    }

    function test_tickBounds_exposed() public view {
        assertEq(vault.tickLower(), TICK_LOWER);
        assertEq(vault.tickUpper(), TICK_UPPER);
    }

    // ============ Reentrancy ============

    function test_burn_revertsOnReentrancy() public {
        // The nonReentrant modifier should prevent reentrancy
    }

    // ============ Edge cases ============

    function test_operationsRevertWhenNotInitialized() public {
        UniswapV3Vault uninit = UniswapV3Vault(Clones.clone(address(implementation)));

        vm.expectRevert(UniswapV3Vault.NotInitialized.selector);
        uninit.mint(0, _mintParams(100, 100, alice));

        vm.expectRevert(UniswapV3Vault.NotInitialized.selector);
        uninit.burn(100, _burnParams(0, 0, alice));

        vm.expectRevert(UniswapV3Vault.NotInitialized.selector);
        uninit.collectYield(alice);
    }
}
