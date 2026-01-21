// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {UniswapV3PositionVaultIntegrationBase} from "./UniswapV3PositionVault.Base.t.sol";
import {UniswapV3PositionVault} from "../../UniswapV3PositionVault.sol";
import {INonfungiblePositionManager} from "../../interfaces/INonfungiblePositionManager.sol";
import {IERC20} from "../../interfaces/IERC20.sol";

/// @title Deposit/Withdraw Integration Tests for UniswapV3PositionVault
/// @notice Tests deposit, mint, withdraw, and redeem operations
contract UniswapV3PositionVaultDepositWithdrawTest is UniswapV3PositionVaultIntegrationBase {
    function setUp() public override {
        super.setUp();
        _initializeVault();
    }

    // ============ Deposit Tests ============

    function test_deposit_increasesLiquidity() public {
        uint128 liquidityBefore = _getPositionLiquidity();

        // Alice deposits
        _fundAccountWithTokens(alice, 1 ether, 3000 * 1e6);
        _approveVault(alice);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(alice);
        vault.deposit(amount0, amount1, alice);

        uint128 liquidityAfter = _getPositionLiquidity();
        assertGt(liquidityAfter, liquidityBefore, "Liquidity should increase");
    }

    function test_deposit_mintsSharesProportionally() public {
        uint256 managerSharesBefore = vault.shares(manager);

        // Alice deposits ~10% of initial liquidity
        _fundAccountWithTokens(alice, 1 ether, 3000 * 1e6);
        _approveVault(alice);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(alice);
        uint256 aliceShares = vault.deposit(amount0, amount1, alice);

        // Alice should get roughly proportional shares
        // With 10% more liquidity, she should get ~10% of existing shares
        assertGt(aliceShares, 0, "Alice should get shares");
        assertLt(aliceShares, managerSharesBefore, "Alice shares should be less than manager (smaller deposit)");

        // Verify total shares increased
        uint256 totalShares = vault.totalShares();
        assertEq(totalShares, managerSharesBefore + aliceShares, "Total shares mismatch");

        // Verify shares balance
        _assertSharesBalanced();
    }

    function test_deposit_refundsUnusedTokens() public {
        _fundAccountWithTokens(alice, 5 ether, 3000 * 1e6);
        _approveVault(alice);

        // Deposit unbalanced amounts (too much ETH relative to MockUSD)
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(5 ether, 3000 * 1e6);

        uint256 wethBefore = IERC20(WETH).balanceOf(alice);
        uint256 musdBefore = IERC20(address(mockUSD)).balanceOf(alice);

        vm.prank(alice);
        vault.deposit(amount0, amount1, alice);

        uint256 wethAfter = IERC20(WETH).balanceOf(alice);
        uint256 musdAfter = IERC20(address(mockUSD)).balanceOf(alice);

        // Either WETH or MockUSD should have a refund (due to price ratio)
        uint256 wethUsed = wethBefore - wethAfter;
        uint256 musdUsed = musdBefore - musdAfter;

        // Not all tokens should be used (some refunded)
        assertTrue(wethUsed < 5 ether || musdUsed < 3000 * 1e6, "Should have some refund");
    }

    function test_deposit_revertsOnZeroAmounts() public {
        vm.prank(alice);
        vm.expectRevert(UniswapV3PositionVault.ZeroAmount.selector);
        vault.deposit(0, 0, alice);
    }

    function test_deposit_revertsWhenNotInitialized() public {
        // Deploy new vault without initializing
        vm.prank(manager);
        UniswapV3PositionVault uninitVault = new UniswapV3PositionVault(NFPM, positionId, "Test Vault", "TVAULT");

        _fundAccountWithTokens(alice, 1 ether, 3000 * 1e6);

        vm.startPrank(alice);
        IERC20(WETH).approve(address(uninitVault), type(uint256).max);
        IERC20(address(mockUSD)).approve(address(uninitVault), type(uint256).max);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.expectRevert(UniswapV3PositionVault.NotInitialized.selector);
        uninitVault.deposit(amount0, amount1, alice);
        vm.stopPrank();
    }

    function test_deposit_toDifferentReceiver() public {
        _fundAccountWithTokens(alice, 1 ether, 3000 * 1e6);
        _approveVault(alice);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        // Alice deposits but Bob receives shares
        vm.prank(alice);
        uint256 shares = vault.deposit(amount0, amount1, bob);

        assertEq(vault.shares(bob), shares, "Bob should receive shares");
        assertEq(vault.shares(alice), 0, "Alice should have no shares");
    }

    // ============ Mint Tests ============

    function test_mint_exactSharesIssued() public {
        _fundAccountWithTokens(alice, 10 ether, 30000 * 1e6);
        _approveVault(alice);

        uint256 sharesToMint = 0.5e18; // 50% of initial shares

        vm.prank(alice);
        vault.mint(sharesToMint, alice);

        assertEq(vault.shares(alice), sharesToMint, "Alice should have exact shares");
    }

    function test_mint_calculatesCorrectTokenAmounts() public {
        _fundAccountWithTokens(alice, 10 ether, 30000 * 1e6);
        _approveVault(alice);

        uint256 sharesToMint = 0.5e18;

        // Preview amounts needed
        (uint256 previewAmount0, uint256 previewAmount1) = vault.previewMint(sharesToMint);

        vm.prank(alice);
        (uint256 actualAmount0, uint256 actualAmount1) = vault.mint(sharesToMint, alice);

        // Actual amounts should be close to preview (within 2% tolerance)
        assertApproxEqRel(actualAmount0, previewAmount0, 0.02e18, "amount0 should match preview");
        assertApproxEqRel(actualAmount1, previewAmount1, 0.02e18, "amount1 should match preview");
    }

    function test_mint_revertsOnZeroShares() public {
        vm.prank(alice);
        vm.expectRevert(UniswapV3PositionVault.ZeroAmount.selector);
        vault.mint(0, alice);
    }

    // ============ Withdraw Tests ============

    function test_withdraw_decreasesLiquidity() public {
        uint128 liquidityBefore = _getPositionLiquidity();

        // Manager withdraws some assets
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(manager);
        vault.withdraw(amount0, amount1, manager, manager);

        uint128 liquidityAfter = _getPositionLiquidity();
        assertLt(liquidityAfter, liquidityBefore, "Liquidity should decrease");
    }

    function test_withdraw_burnsSharesProportionally() public {
        uint256 sharesBefore = vault.shares(manager);

        // Withdraw ~10% of position value
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(manager);
        uint256 sharesBurned = vault.withdraw(amount0, amount1, manager, manager);

        uint256 sharesAfter = vault.shares(manager);
        assertEq(sharesAfter, sharesBefore - sharesBurned, "Shares should decrease");
        assertGt(sharesBurned, 0, "Should burn some shares");
    }

    function test_withdraw_transfersAssetsToReceiver() public {
        uint256 bobWethBefore = IERC20(WETH).balanceOf(bob);
        uint256 bobMusdBefore = IERC20(address(mockUSD)).balanceOf(bob);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        // Manager withdraws to Bob
        vm.prank(manager);
        vault.withdraw(amount0, amount1, bob, manager);

        uint256 bobWethAfter = IERC20(WETH).balanceOf(bob);
        uint256 bobMusdAfter = IERC20(address(mockUSD)).balanceOf(bob);

        // Bob should receive tokens
        if (isWethToken0) {
            assertGe(bobWethAfter - bobWethBefore, amount0 * 99 / 100, "Bob should receive WETH");
            assertGe(bobMusdAfter - bobMusdBefore, amount1 * 99 / 100, "Bob should receive MockUSD");
        } else {
            assertGe(bobMusdAfter - bobMusdBefore, amount0 * 99 / 100, "Bob should receive MockUSD");
            assertGe(bobWethAfter - bobWethBefore, amount1 * 99 / 100, "Bob should receive WETH");
        }
    }

    function test_withdraw_revertsForNonOwner() public {
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        // Bob tries to withdraw manager's shares
        vm.prank(bob);
        vm.expectRevert(UniswapV3PositionVault.Unauthorized.selector);
        vault.withdraw(amount0, amount1, bob, manager);
    }

    function test_withdraw_revertsOnZeroAmounts() public {
        vm.prank(manager);
        vm.expectRevert(UniswapV3PositionVault.ZeroAmount.selector);
        vault.withdraw(0, 0, manager, manager);
    }

    function test_withdraw_revertsOnInsufficientShares() public {
        // Try to withdraw more than position value
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(100 ether, 300000 * 1e6);

        vm.prank(manager);
        vm.expectRevert("Insufficient shares");
        vault.withdraw(amount0, amount1, manager, manager);
    }

    // ============ Redeem Tests ============

    function test_redeem_burnsExactShares() public {
        uint256 sharesToRedeem = INITIAL_VAULT_SHARES / 2;
        uint256 sharesBefore = vault.shares(manager);

        vm.prank(manager);
        vault.redeem(sharesToRedeem, manager, manager);

        uint256 sharesAfter = vault.shares(manager);
        assertEq(sharesAfter, sharesBefore - sharesToRedeem, "Should burn exact shares");
    }

    function test_redeem_calculatesCorrectAssetAmounts() public {
        uint256 sharesToRedeem = INITIAL_VAULT_SHARES / 2;

        // Preview amounts
        (uint256 previewAmount0, uint256 previewAmount1) = vault.previewRedeem(sharesToRedeem);

        vm.prank(manager);
        (uint256 actualAmount0, uint256 actualAmount1) = vault.redeem(sharesToRedeem, manager, manager);

        // Actual should be close to preview (within 2% tolerance)
        assertApproxEqRel(actualAmount0, previewAmount0, 0.02e18, "amount0 should match preview");
        assertApproxEqRel(actualAmount1, previewAmount1, 0.02e18, "amount1 should match preview");
    }

    function test_redeem_revertsOnInsufficientShares() public {
        uint256 tooManyShares = INITIAL_VAULT_SHARES * 2;

        vm.prank(manager);
        vm.expectRevert("Insufficient shares");
        vault.redeem(tooManyShares, manager, manager);
    }

    function test_redeem_fullRedeemZerosShareBalance() public {
        vm.prank(manager);
        vault.redeem(INITIAL_VAULT_SHARES, manager, manager);

        assertEq(vault.shares(manager), 0, "Manager should have 0 shares");
        assertEq(vault.totalShares(), 0, "Total shares should be 0");
    }

    function test_redeem_revertsOnZeroShares() public {
        vm.prank(manager);
        vm.expectRevert(UniswapV3PositionVault.ZeroAmount.selector);
        vault.redeem(0, manager, manager);
    }

    // ============ Price Movement Tests ============

    function test_deposit_afterPriceUp() public {
        // Push price up
        _pushPriceUp(10000 * 1e6);

        // Alice can still deposit
        _fundAccountWithTokens(alice, 1 ether, 5000 * 1e6);
        _approveVault(alice);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 5000 * 1e6);

        vm.prank(alice);
        uint256 shares = vault.deposit(amount0, amount1, alice);

        assertGt(shares, 0, "Should get shares after price up");
    }

    function test_deposit_afterPriceDown() public {
        // Push price down
        _pushPriceDown(3 ether);

        // Alice can still deposit
        _fundAccountWithTokens(alice, 1 ether, 2000 * 1e6);
        _approveVault(alice);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 2000 * 1e6);

        vm.prank(alice);
        uint256 shares = vault.deposit(amount0, amount1, alice);

        assertGt(shares, 0, "Should get shares after price down");
    }

    function test_withdraw_afterPriceUp() public {
        // Push price up
        _pushPriceUp(10000 * 1e6);

        // Manager can still withdraw
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(0.5 ether, 1500 * 1e6);

        vm.prank(manager);
        uint256 sharesBurned = vault.withdraw(amount0, amount1, manager, manager);

        assertGt(sharesBurned, 0, "Should burn shares after price up");
    }

    function test_withdraw_afterPriceDown() public {
        // Push price down
        _pushPriceDown(3 ether);

        // Manager can still withdraw
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(0.5 ether, 1000 * 1e6);

        vm.prank(manager);
        uint256 sharesBurned = vault.withdraw(amount0, amount1, manager, manager);

        assertGt(sharesBurned, 0, "Should burn shares after price down");
    }

    // ============ Multi-User Tests ============

    function test_multipleDepositors() public {
        // Alice deposits
        _fundAccountWithTokens(alice, 2 ether, 6000 * 1e6);
        _approveVault(alice);

        (uint256 amount0A, uint256 amount1A) = _getDepositAmounts(2 ether, 6000 * 1e6);

        vm.prank(alice);
        vault.deposit(amount0A, amount1A, alice);

        // Bob deposits
        _fundAccountWithTokens(bob, 1 ether, 3000 * 1e6);
        _approveVault(bob);

        (uint256 amount0B, uint256 amount1B) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(bob);
        vault.deposit(amount0B, amount1B, bob);

        // Verify all shareholders
        assertGt(vault.shares(manager), 0, "Manager should have shares");
        assertGt(vault.shares(alice), 0, "Alice should have shares");
        assertGt(vault.shares(bob), 0, "Bob should have shares");

        // Verify shares are balanced
        _assertSharesBalanced();
    }

    function test_depositThenWithdraw_netZeroShares() public {
        uint256 sharesBefore = vault.totalShares();

        // Alice deposits
        _fundAccountWithTokens(alice, 1 ether, 3000 * 1e6);
        _approveVault(alice);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(alice);
        uint256 aliceShares = vault.deposit(amount0, amount1, alice);

        // Alice redeems all shares
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);

        // Total shares should be close to original
        uint256 sharesAfter = vault.totalShares();
        assertEq(sharesAfter, sharesBefore, "Total shares should return to original");
    }
}
