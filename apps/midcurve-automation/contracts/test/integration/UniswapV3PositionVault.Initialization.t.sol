// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {UniswapV3PositionVaultIntegrationBase, IWETH, IERC721} from "./UniswapV3PositionVault.Base.t.sol";
import {UniswapV3PositionVault} from "../../UniswapV3PositionVault.sol";
import {INonfungiblePositionManager} from "../../interfaces/INonfungiblePositionManager.sol";
import {IERC20} from "../../interfaces/IERC20.sol";

/// @title Initialization Integration Tests for UniswapV3PositionVault
/// @notice Tests constructor validation and init() function behavior
contract UniswapV3PositionVaultInitializationTest is UniswapV3PositionVaultIntegrationBase {
    // ============ Constructor Tests ============

    function test_constructor_readsPositionData() public view {
        // Verify vault read position data correctly
        assertEq(vault.asset0(), token0, "asset0 mismatch");
        assertEq(vault.asset1(), token1, "asset1 mismatch");
        assertEq(vault.tickLower(), tickLower, "tickLower mismatch");
        assertEq(vault.tickUpper(), tickUpper, "tickUpper mismatch");
        assertEq(vault.pool(), pool, "pool mismatch");
    }

    function test_constructor_setsManager() public view {
        assertEq(vault.manager(), manager, "manager should be deployer");
    }

    function test_constructor_setsPositionManager() public view {
        assertEq(vault.positionManager(), NFPM, "positionManager mismatch");
    }

    function test_constructor_setsPositionId() public view {
        assertEq(vault.positionId(), positionId, "positionId mismatch");
    }

    function test_constructor_notInitializedByDefault() public view {
        assertFalse(vault.initialized(), "should not be initialized");
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(UniswapV3PositionVault.ZeroAddress.selector);
        new UniswapV3PositionVault(address(0), positionId, "Test Vault", "TVAULT");
    }

    // ============ Init Tests ============

    function test_init_transfersNftToVault() public {
        // Verify manager owns NFT before init
        assertEq(INonfungiblePositionManager(NFPM).ownerOf(positionId), manager, "manager should own NFT before init");

        // Initialize vault
        _initializeVault();

        // Verify vault now owns NFT
        assertEq(INonfungiblePositionManager(NFPM).ownerOf(positionId), address(vault), "vault should own NFT after init");
    }

    function test_init_setsInitializedTrue() public {
        assertFalse(vault.initialized(), "should not be initialized before");

        _initializeVault();

        assertTrue(vault.initialized(), "should be initialized after");
    }

    function test_init_mintsInitialSharesToManager() public {
        _initializeVault();

        assertEq(vault.shares(manager), INITIAL_VAULT_SHARES, "manager shares mismatch");
        assertEq(vault.totalShares(), INITIAL_VAULT_SHARES, "totalShares mismatch");
    }

    function test_init_setsFeeDebtToZero() public {
        _initializeVault();

        assertEq(vault.feeDebt0(manager), 0, "feeDebt0 should be 0");
        assertEq(vault.feeDebt1(manager), 0, "feeDebt1 should be 0");
    }

    function test_init_revertsIfCalledTwice() public {
        _initializeVault();

        // Try to init again
        vm.startPrank(manager);
        IERC721(NFPM).approve(address(vault), positionId);

        vm.expectRevert(UniswapV3PositionVault.AlreadyInitialized.selector);
        vault.init(INITIAL_VAULT_SHARES);
        vm.stopPrank();
    }

    function test_init_revertsOnZeroShares() public {
        vm.startPrank(manager);
        IERC721(NFPM).approve(address(vault), positionId);

        vm.expectRevert(UniswapV3PositionVault.ZeroAmount.selector);
        vault.init(0);
        vm.stopPrank();
    }

    function test_init_revertsIfNftNotApproved() public {
        // Try to init without approving NFT
        vm.prank(manager);
        vm.expectRevert(); // ERC721 transfer will fail
        vault.init(INITIAL_VAULT_SHARES);
    }

    function test_init_revertsOnEmptyPosition() public {
        // Create a new position with zero liquidity
        // First mint a position, then decrease all liquidity

        // Mint a new small position
        _wrapEth(manager, 1 ether);
        _mintMockUSD(manager, 3000 * 1e6);

        vm.startPrank(manager);
        IERC20(WETH).approve(NFPM, type(uint256).max);
        IERC20(address(mockUSD)).approve(NFPM, type(uint256).max);

        (uint256 amount0Desired, uint256 amount1Desired) = _getDepositAmounts(1 ether, 3000 * 1e6);

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

        (uint256 newPositionId, uint128 liquidity,,) = INonfungiblePositionManager(NFPM).mint(params);

        // Decrease all liquidity to make it empty
        INonfungiblePositionManager(NFPM).decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: newPositionId,
                liquidity: liquidity,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 3600
            })
        );

        // Collect all tokens
        INonfungiblePositionManager(NFPM).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: newPositionId,
                recipient: manager,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // Deploy vault for empty position
        UniswapV3PositionVault emptyVault = new UniswapV3PositionVault(NFPM, newPositionId, "Test Vault", "TVAULT");

        // Try to init - should fail with EmptyPosition
        IERC721(NFPM).approve(address(emptyVault), newPositionId);

        vm.expectRevert(UniswapV3PositionVault.EmptyPosition.selector);
        emptyVault.init(INITIAL_VAULT_SHARES);
        vm.stopPrank();
    }

    function test_init_canBeCalledByNonManager() public {
        // Transfer NFT to alice
        vm.prank(manager);
        INonfungiblePositionManager(NFPM).transferFrom(manager, alice, positionId);

        // Alice can call init (she owns the NFT)
        vm.startPrank(alice);
        IERC721(NFPM).approve(address(vault), positionId);
        vault.init(INITIAL_VAULT_SHARES);
        vm.stopPrank();

        // Alice gets the initial shares (not manager)
        assertEq(vault.shares(alice), INITIAL_VAULT_SHARES, "alice should get initial shares");
        assertEq(vault.shares(manager), 0, "manager should have 0 shares");
    }

    function test_init_withCustomShareAmount() public {
        uint256 customShares = 123456789e18;

        vm.startPrank(manager);
        IERC721(NFPM).approve(address(vault), positionId);
        vault.init(customShares);
        vm.stopPrank();

        assertEq(vault.shares(manager), customShares, "custom shares mismatch");
        assertEq(vault.totalShares(), customShares, "totalShares mismatch");
    }

    // ============ Post-Init View Function Tests ============

    function test_postInit_totalAssetsReturnsPositionValue() public {
        _initializeVault();

        (uint256 amount0, uint256 amount1) = vault.totalAssets();

        // Position should have non-zero value
        assertTrue(amount0 > 0 || amount1 > 0, "totalAssets should be non-zero");
    }

    function test_postInit_maxDepositReturnsMax() public {
        _initializeVault();

        (uint256 max0, uint256 max1) = vault.maxDeposit(alice);

        assertEq(max0, type(uint256).max, "maxDeposit0 should be max");
        assertEq(max1, type(uint256).max, "maxDeposit1 should be max");
    }

    function test_postInit_maxMintReturnsMax() public {
        _initializeVault();

        uint256 maxMint = vault.maxMint(alice);

        assertEq(maxMint, type(uint256).max, "maxMint should be max");
    }

    function test_postInit_maxWithdrawReturnsZeroForNonShareholder() public {
        _initializeVault();

        (uint256 max0, uint256 max1) = vault.maxWithdraw(alice);

        assertEq(max0, 0, "maxWithdraw0 should be 0 for non-shareholder");
        assertEq(max1, 0, "maxWithdraw1 should be 0 for non-shareholder");
    }

    function test_postInit_maxWithdrawReturnsValueForShareholder() public {
        _initializeVault();

        (uint256 max0, uint256 max1) = vault.maxWithdraw(manager);

        // Manager has shares, so maxWithdraw should be non-zero
        assertTrue(max0 > 0 || max1 > 0, "maxWithdraw should be non-zero for shareholder");
    }

    function test_postInit_maxRedeemReturnsShareBalance() public {
        _initializeVault();

        uint256 maxRedeem = vault.maxRedeem(manager);

        assertEq(maxRedeem, INITIAL_VAULT_SHARES, "maxRedeem should equal shares");
    }

    function test_postInit_pendingFeesZeroInitially() public {
        _initializeVault();

        (uint256 pending0, uint256 pending1) = vault.pendingFees(manager);

        assertEq(pending0, 0, "pendingFees0 should be 0");
        assertEq(pending1, 0, "pendingFees1 should be 0");
    }

    // ============ Pre-Init View Function Tests ============

    function test_preInit_maxDepositReturnsZero() public view {
        (uint256 max0, uint256 max1) = vault.maxDeposit(alice);

        assertEq(max0, 0, "maxDeposit0 should be 0 before init");
        assertEq(max1, 0, "maxDeposit1 should be 0 before init");
    }

    function test_preInit_maxMintReturnsZero() public view {
        uint256 maxMint = vault.maxMint(alice);

        assertEq(maxMint, 0, "maxMint should be 0 before init");
    }
}
