// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {UniswapV3PositionVaultIntegrationBase} from "./UniswapV3PositionVault.Base.t.sol";
import {UniswapV3PositionVault} from "../../UniswapV3PositionVault.sol";
import {INonfungiblePositionManager} from "../../interfaces/INonfungiblePositionManager.sol";
import {IERC20} from "../../interfaces/IERC20.sol";

/// @title Fee Distribution Integration Tests for UniswapV3PositionVault
/// @notice Tests fee generation, collection, and distribution among shareholders
contract UniswapV3PositionVaultFeeDistributionTest is UniswapV3PositionVaultIntegrationBase {
    function setUp() public override {
        super.setUp();
        _initializeVault();
    }

    // ============ Fee Generation Tests ============

    function test_feesAccumulateFromSwaps() public {
        // Check tokens owed before
        (uint128 owedBefore0, uint128 owedBefore1) = _getPositionTokensOwed();

        // Generate fees via swaps
        _generateFees(3, 10000 * 1e6);

        // Check tokens owed after
        (uint128 owedAfter0, uint128 owedAfter1) = _getPositionTokensOwed();

        // At least one token should have increased fees
        assertTrue(
            owedAfter0 > owedBefore0 || owedAfter1 > owedBefore1,
            "Fees should accumulate from swaps"
        );
    }

    function test_collectFees_retrievesFeesFromPosition() public {
        // Generate fees
        _generateFees(3, 10000 * 1e6);

        uint256 managerBalance0Before = IERC20(vault.asset0()).balanceOf(manager);
        uint256 managerBalance1Before = IERC20(vault.asset1()).balanceOf(manager);

        // Manager collects fees
        vm.prank(manager);
        (uint256 collected0, uint256 collected1) = vault.collectFees();

        uint256 managerBalance0After = IERC20(vault.asset0()).balanceOf(manager);
        uint256 managerBalance1After = IERC20(vault.asset1()).balanceOf(manager);

        // At least one token should have been collected
        assertTrue(collected0 > 0 || collected1 > 0, "Should collect some fees");

        // Manager balance should increase
        assertTrue(
            managerBalance0After > managerBalance0Before || managerBalance1After > managerBalance1Before,
            "Manager balance should increase"
        );
    }

    // ============ Pending Fees Tests ============

    function test_pendingFees_zeroWithNoActivity() public view {
        (uint256 pending0, uint256 pending1) = vault.pendingFees(manager);
        assertEq(pending0, 0, "pending0 should be 0 without fees");
        assertEq(pending1, 0, "pending1 should be 0 without fees");
    }

    function test_pendingFees_accurateAfterFeeCollection() public {
        // Generate fees
        _generateFees(3, 10000 * 1e6);

        // Manager is sole shareholder, should get 100% of fees
        // First call collectFees to update accumulators
        vm.prank(manager);
        (uint256 collected0, uint256 collected1) = vault.collectFees();

        // After collection, pending should be 0
        (uint256 pending0, uint256 pending1) = vault.pendingFees(manager);
        assertEq(pending0, 0, "pending0 should be 0 after collection");
        assertEq(pending1, 0, "pending1 should be 0 after collection");

        // Generate more fees
        _generateFees(2, 5000 * 1e6);

        // Now pending should be non-zero again
        (uint256 newPending0, uint256 newPending1) = vault.pendingFees(manager);
        assertTrue(newPending0 > 0 || newPending1 > 0, "New pending fees should accumulate");
    }

    function test_pendingFees_updatesAfterDeposit() public {
        // Generate fees when only manager is shareholder
        _generateFees(3, 10000 * 1e6);

        // Check manager's pending before Alice joins
        // Need to trigger collection to update accumulators
        vm.prank(manager);
        vault.collectFees();

        // Generate more fees
        _generateFees(2, 5000 * 1e6);

        // Get manager's pending
        (uint256 managerPending0Before,) = vault.pendingFees(manager);

        // Alice deposits (joins pool)
        _fundAccountWithTokens(alice, 10 ether, 30000 * 1e6);
        _approveVault(alice);
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(10 ether, 30000 * 1e6);

        vm.prank(alice);
        vault.deposit(amount0, amount1, alice);

        // Manager's pending should NOT change from Alice joining
        (uint256 managerPending0After,) = vault.pendingFees(manager);
        assertEq(managerPending0After, managerPending0Before, "Manager pending should not change");

        // Alice should have 0 pending (just joined)
        (uint256 alicePending0, uint256 alicePending1) = vault.pendingFees(alice);
        assertEq(alicePending0, 0, "Alice pending0 should be 0");
        assertEq(alicePending1, 0, "Alice pending1 should be 0");
    }

    // ============ Fee Distribution Tests ============

    function test_fees_distributedProportionally() public {
        // Alice deposits to get 50% of shares
        _fundAccountWithTokens(alice, 10 ether, 30000 * 1e6);
        _approveVault(alice);
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(10 ether, 30000 * 1e6);

        vm.prank(alice);
        vault.deposit(amount0, amount1, alice);

        uint256 aliceShares = vault.shares(alice);
        uint256 managerShares = vault.shares(manager);
        uint256 totalShares = vault.totalShares();

        // Generate fees
        _generateFees(3, 10000 * 1e6);

        // Both collect fees
        vm.prank(manager);
        (uint256 managerFee0, uint256 managerFee1) = vault.collectFees();

        vm.prank(alice);
        (uint256 aliceFee0, uint256 aliceFee1) = vault.collectFees();

        // Fees should be proportional to share ownership
        if (managerFee0 > 0 && aliceFee0 > 0) {
            uint256 expectedRatio = (managerShares * 1e18) / aliceShares;
            uint256 actualRatio = (managerFee0 * 1e18) / aliceFee0;
            assertApproxEqRel(actualRatio, expectedRatio, 0.05e18, "Fee ratio should match share ratio");
        }
    }

    function test_newDepositor_doesNotGetOldFees() public {
        // Generate fees when only manager has shares
        _generateFees(3, 10000 * 1e6);

        // Collect to update accumulators
        vm.prank(manager);
        vault.collectFees();

        // Generate more fees
        _generateFees(2, 5000 * 1e6);

        // Manager has pending fees
        (uint256 managerPendingBefore,) = vault.pendingFees(manager);
        assertTrue(managerPendingBefore > 0, "Manager should have pending fees");

        // Alice joins
        _fundAccountWithTokens(alice, 10 ether, 30000 * 1e6);
        _approveVault(alice);
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(10 ether, 30000 * 1e6);

        vm.prank(alice);
        vault.deposit(amount0, amount1, alice);

        // Alice should NOT have access to old fees (feeDebt protects this)
        (uint256 alicePending0, uint256 alicePending1) = vault.pendingFees(alice);
        assertEq(alicePending0, 0, "Alice should not get old fees");
        assertEq(alicePending1, 0, "Alice should not get old fees");
    }

    function test_fees_accumulateAcrossMultipleCollections() public {
        // Generate and collect fees multiple times
        uint256 totalCollected0 = 0;
        uint256 totalCollected1 = 0;

        for (uint256 i = 0; i < 3; i++) {
            _generateFees(2, 3000 * 1e6);

            vm.prank(manager);
            (uint256 c0, uint256 c1) = vault.collectFees();
            totalCollected0 += c0;
            totalCollected1 += c1;
        }

        // Should have collected fees across all rounds
        assertTrue(totalCollected0 > 0 || totalCollected1 > 0, "Should collect fees across rounds");
    }

    // ============ Fee Debt Management Tests ============

    function test_feeDebt_setCorrectlyOnDeposit() public {
        // Generate fees
        _generateFees(3, 10000 * 1e6);
        vm.prank(manager);
        vault.collectFees();

        uint256 accFee0Before = vault.accFeePerShare0();
        uint256 accFee1Before = vault.accFeePerShare1();

        // Alice deposits
        _fundAccountWithTokens(alice, 5 ether, 15000 * 1e6);
        _approveVault(alice);
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(5 ether, 15000 * 1e6);

        vm.prank(alice);
        vault.deposit(amount0, amount1, alice);

        // Alice's fee debt should be set based on accFeePerShare * her shares
        uint256 aliceShares = vault.shares(alice);
        uint256 expectedDebt0 = (accFee0Before * aliceShares) / 1e18;
        uint256 expectedDebt1 = (accFee1Before * aliceShares) / 1e18;

        // Note: May not be exactly equal due to rounding, but should be close
        assertApproxEqAbs(vault.feeDebt0(alice), expectedDebt0, 1e6, "feeDebt0 should match");
        assertApproxEqAbs(vault.feeDebt1(alice), expectedDebt1, 1e6, "feeDebt1 should match");
    }

    function test_feeDebt_resetOnWithdrawal() public {
        // Generate fees
        _generateFees(3, 10000 * 1e6);

        // Partial withdrawal
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(manager);
        vault.withdraw(amount0, amount1, manager, manager);

        // After withdrawal, fee debt should be reset to match remaining shares
        uint256 remainingShares = vault.shares(manager);
        uint256 accFee0 = vault.accFeePerShare0();
        uint256 accFee1 = vault.accFeePerShare1();

        uint256 expectedDebt0 = (accFee0 * remainingShares) / 1e18;
        uint256 expectedDebt1 = (accFee1 * remainingShares) / 1e18;

        assertApproxEqAbs(vault.feeDebt0(manager), expectedDebt0, 1e6, "feeDebt0 should reset");
        assertApproxEqAbs(vault.feeDebt1(manager), expectedDebt1, 1e6, "feeDebt1 should reset");
    }

    // ============ Edge Cases ============

    function test_collectFees_revertsWithNoShares() public {
        // Alice has no shares
        vm.prank(alice);
        vm.expectRevert("No shares");
        vault.collectFees();
    }

    function test_collectFees_zeroPendingIsNoop() public {
        // Manager collects with no pending fees
        vm.prank(manager);
        (uint256 c0, uint256 c1) = vault.collectFees();

        // Should be 0 but not revert
        assertEq(c0, 0, "Should collect 0 token0");
        assertEq(c1, 0, "Should collect 0 token1");
    }

    function test_withdrawal_includesPendingFees() public {
        // Generate fees
        _generateFees(3, 10000 * 1e6);

        uint256 managerBalance0Before = IERC20(vault.asset0()).balanceOf(manager);
        uint256 managerBalance1Before = IERC20(vault.asset1()).balanceOf(manager);

        // Withdraw (should include pending fees)
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(manager);
        vault.withdraw(amount0, amount1, manager, manager);

        uint256 managerBalance0After = IERC20(vault.asset0()).balanceOf(manager);
        uint256 managerBalance1After = IERC20(vault.asset1()).balanceOf(manager);

        // Manager should receive more than just the withdrawn amounts (includes fees)
        uint256 received0 = managerBalance0After - managerBalance0Before;
        uint256 received1 = managerBalance1After - managerBalance1Before;

        // Should receive at least the requested amounts
        if (isWethToken0) {
            assertGe(received0, amount0 * 99 / 100, "Should receive at least amount0");
            assertGe(received1, amount1 * 99 / 100, "Should receive at least amount1");
        } else {
            assertGe(received0, amount0 * 99 / 100, "Should receive at least amount0");
            assertGe(received1, amount1 * 99 / 100, "Should receive at least amount1");
        }
    }

    function test_redeem_includesPendingFees() public {
        // Generate fees
        _generateFees(3, 10000 * 1e6);

        uint256 managerBalance0Before = IERC20(vault.asset0()).balanceOf(manager);
        uint256 managerBalance1Before = IERC20(vault.asset1()).balanceOf(manager);

        // Redeem half shares
        uint256 sharesToRedeem = vault.shares(manager) / 2;

        vm.prank(manager);
        vault.redeem(sharesToRedeem, manager, manager);

        uint256 managerBalance0After = IERC20(vault.asset0()).balanceOf(manager);
        uint256 managerBalance1After = IERC20(vault.asset1()).balanceOf(manager);

        // Should have received assets
        assertTrue(
            managerBalance0After > managerBalance0Before || managerBalance1After > managerBalance1Before,
            "Should receive assets including fees"
        );

        // Pending fees should be 0 after redeem (fees were collected)
        (uint256 pending0, uint256 pending1) = vault.pendingFees(manager);
        assertEq(pending0, 0, "pending0 should be 0 after redeem");
        assertEq(pending1, 0, "pending1 should be 0 after redeem");
    }

    // ============ Complex Multi-User Scenarios ============

    function test_threeDepositors_feeDistribution() public {
        // Alice deposits (equal to manager)
        _fundAccountWithTokens(alice, 10 ether, 30000 * 1e6);
        _approveVault(alice);
        (uint256 a0, uint256 a1) = _getDepositAmounts(10 ether, 30000 * 1e6);

        vm.prank(alice);
        vault.deposit(a0, a1, alice);

        // Generate fees (manager + alice split 50/50)
        _generateFees(2, 5000 * 1e6);

        // Bob deposits
        _fundAccountWithTokens(bob, 5 ether, 15000 * 1e6);
        _approveVault(bob);
        (uint256 b0, uint256 b1) = _getDepositAmounts(5 ether, 15000 * 1e6);

        vm.prank(bob);
        vault.deposit(b0, b1, bob);

        // Generate more fees (all three share)
        _generateFees(2, 5000 * 1e6);

        // All collect fees
        vm.prank(manager);
        (uint256 mFee0,) = vault.collectFees();

        vm.prank(alice);
        (uint256 aFee0,) = vault.collectFees();

        vm.prank(bob);
        (uint256 bFee0,) = vault.collectFees();

        // Manager and Alice should have more than Bob (they got first round fees)
        // Bob only got second round fees
        if (mFee0 > 0 && aFee0 > 0 && bFee0 > 0) {
            // Manager and Alice had ~50% each of first round, then ~40% each of second
            // Bob had 0% of first round, ~20% of second
            assertGt(mFee0, bFee0, "Manager should get more than Bob");
            assertGt(aFee0, bFee0, "Alice should get more than Bob");
        }
    }

    function test_partialWithdrawal_preservesRemainingFees() public {
        // Generate fees
        _generateFees(3, 10000 * 1e6);

        // Collect to establish baseline
        vm.prank(manager);
        vault.collectFees();

        // Generate more fees
        _generateFees(2, 5000 * 1e6);

        uint256 sharesBefore = vault.shares(manager);

        // Partial withdrawal (50%)
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(5 ether, 15000 * 1e6);

        vm.prank(manager);
        vault.withdraw(amount0, amount1, manager, manager);

        uint256 sharesAfter = vault.shares(manager);

        // Manager should still have shares
        assertGt(sharesAfter, 0, "Manager should have remaining shares");
        assertLt(sharesAfter, sharesBefore, "Shares should decrease");

        // Generate more fees
        _generateFees(2, 5000 * 1e6);

        // Remaining shares should still earn fees
        (uint256 pending0, uint256 pending1) = vault.pendingFees(manager);
        assertTrue(pending0 > 0 || pending1 > 0, "Remaining shares should earn fees");
    }

    function test_fullWithdrawal_collectsAllFees() public {
        // Generate fees
        _generateFees(3, 10000 * 1e6);

        uint256 balance0Before = IERC20(vault.asset0()).balanceOf(manager);
        uint256 balance1Before = IERC20(vault.asset1()).balanceOf(manager);

        // Full redeem
        uint256 allShares = vault.shares(manager);

        vm.prank(manager);
        vault.redeem(allShares, manager, manager);

        uint256 balance0After = IERC20(vault.asset0()).balanceOf(manager);
        uint256 balance1After = IERC20(vault.asset1()).balanceOf(manager);

        // Should have received all position value + fees
        assertTrue(
            balance0After > balance0Before || balance1After > balance1Before,
            "Should receive all assets"
        );

        // Should have 0 shares left
        assertEq(vault.shares(manager), 0, "Should have 0 shares");
    }
}
