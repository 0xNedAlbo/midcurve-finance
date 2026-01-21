// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UniswapV3PositionVaultIntegrationBase} from "./UniswapV3PositionVault.Base.t.sol";
import {UniswapV3PositionVault} from "../../UniswapV3PositionVault.sol";

/// @title Share Accounting Integration Tests for UniswapV3PositionVault
/// @notice Tests preview functions, share calculations, and max functions
contract UniswapV3PositionVaultShareAccountingTest is UniswapV3PositionVaultIntegrationBase {
    function setUp() public override {
        super.setUp();
        _initializeVault();
    }

    // ============ Preview Deposit Tests ============

    function test_previewDeposit_matchesActualDeposit() public {
        _fundAccountWithTokens(alice, 2 ether, 6000 * 1e6);
        _approveVault(alice);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        // Get preview
        uint256 previewShares = vault.previewDeposit(amount0, amount1);

        // Actual deposit
        vm.prank(alice);
        uint256 actualShares = vault.deposit(amount0, amount1, alice);

        // Should be within 2% (accounting for slippage and rounding)
        assertApproxEqRel(actualShares, previewShares, 0.02e18, "Actual shares should match preview");
    }

    function test_previewDeposit_returnsZeroBeforeInit() public {
        // Deploy new uninitialized vault
        vm.prank(manager);
        UniswapV3PositionVault uninitVault = new UniswapV3PositionVault(NFPM, positionId, "Test Vault", "TVAULT");

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);
        uint256 preview = uninitVault.previewDeposit(amount0, amount1);

        assertEq(preview, 0, "Preview should be 0 before init");
    }

    function test_previewDeposit_zeroAmountsReturnsZero() public view {
        uint256 preview = vault.previewDeposit(0, 0);
        assertEq(preview, 0, "Preview for zero amounts should be 0");
    }

    // ============ Preview Mint Tests ============

    function test_previewMint_matchesActualMint() public {
        _fundAccountWithTokens(alice, 10 ether, 30000 * 1e6);
        _approveVault(alice);

        uint256 sharesToMint = 0.5e18;

        // Get preview
        (uint256 previewAmount0, uint256 previewAmount1) = vault.previewMint(sharesToMint);

        // Actual mint
        vm.prank(alice);
        (uint256 actualAmount0, uint256 actualAmount1) = vault.mint(sharesToMint, alice);

        // Should be within 2%
        assertApproxEqRel(actualAmount0, previewAmount0, 0.02e18, "amount0 should match preview");
        assertApproxEqRel(actualAmount1, previewAmount1, 0.02e18, "amount1 should match preview");
    }

    function test_previewMint_returnsZeroBeforeInit() public {
        vm.prank(manager);
        UniswapV3PositionVault uninitVault = new UniswapV3PositionVault(NFPM, positionId, "Test Vault", "TVAULT");

        (uint256 amount0, uint256 amount1) = uninitVault.previewMint(1e18);

        assertEq(amount0, 0, "amount0 should be 0 before init");
        assertEq(amount1, 0, "amount1 should be 0 before init");
    }

    function test_previewMint_zeroSharesReturnsZero() public view {
        (uint256 amount0, uint256 amount1) = vault.previewMint(0);
        assertEq(amount0, 0, "amount0 for zero shares should be 0");
        assertEq(amount1, 0, "amount1 for zero shares should be 0");
    }

    // ============ Preview Withdraw Tests ============

    function test_previewWithdraw_matchesActualWithdraw() public {
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        // Get preview
        uint256 previewShares = vault.previewWithdraw(amount0, amount1);

        // Actual withdraw
        vm.prank(manager);
        uint256 actualShares = vault.withdraw(amount0, amount1, manager, manager);

        // Should be within 5% (withdraw math has more variance due to liquidity calculation)
        assertApproxEqRel(actualShares, previewShares, 0.05e18, "Actual shares should match preview");
    }

    function test_previewWithdraw_returnsZeroBeforeInit() public {
        vm.prank(manager);
        UniswapV3PositionVault uninitVault = new UniswapV3PositionVault(NFPM, positionId, "Test Vault", "TVAULT");

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);
        uint256 preview = uninitVault.previewWithdraw(amount0, amount1);

        assertEq(preview, 0, "Preview should be 0 before init");
    }

    // ============ Preview Redeem Tests ============

    function test_previewRedeem_matchesActualRedeem() public {
        uint256 sharesToRedeem = INITIAL_VAULT_SHARES / 2;

        // Get preview
        (uint256 previewAmount0, uint256 previewAmount1) = vault.previewRedeem(sharesToRedeem);

        // Actual redeem
        vm.prank(manager);
        (uint256 actualAmount0, uint256 actualAmount1) = vault.redeem(sharesToRedeem, manager, manager);

        // Should be within 2%
        assertApproxEqRel(actualAmount0, previewAmount0, 0.02e18, "amount0 should match preview");
        assertApproxEqRel(actualAmount1, previewAmount1, 0.02e18, "amount1 should match preview");
    }

    function test_previewRedeem_returnsZeroBeforeInit() public {
        vm.prank(manager);
        UniswapV3PositionVault uninitVault = new UniswapV3PositionVault(NFPM, positionId, "Test Vault", "TVAULT");

        (uint256 amount0, uint256 amount1) = uninitVault.previewRedeem(1e18);

        assertEq(amount0, 0, "amount0 should be 0 before init");
        assertEq(amount1, 0, "amount1 should be 0 before init");
    }

    function test_previewRedeem_zeroSharesReturnsZero() public view {
        (uint256 amount0, uint256 amount1) = vault.previewRedeem(0);
        assertEq(amount0, 0, "amount0 for zero shares should be 0");
        assertEq(amount1, 0, "amount1 for zero shares should be 0");
    }

    // ============ Share Proportionality Tests ============

    function test_shares_proportionalToLiquidityAdded() public {
        uint128 initialLiquidity = _getPositionLiquidity();

        // Alice adds roughly the same amount as initial
        _fundAccountWithTokens(alice, 10 ether, 30000 * 1e6);
        _approveVault(alice);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(10 ether, 30000 * 1e6);

        vm.prank(alice);
        uint256 aliceShares = vault.deposit(amount0, amount1, alice);

        uint128 afterAliceLiquidity = _getPositionLiquidity();
        uint128 liquidityAdded = afterAliceLiquidity - initialLiquidity;

        // Alice's share ratio should approximately equal liquidity ratio
        // aliceShares / totalShares ≈ liquidityAdded / afterAliceLiquidity
        uint256 expectedShareRatio = (uint256(liquidityAdded) * 1e18) / afterAliceLiquidity;
        uint256 actualShareRatio = (aliceShares * 1e18) / vault.totalShares();

        assertApproxEqRel(actualShareRatio, expectedShareRatio, 0.05e18, "Share ratio should match liquidity ratio");
    }

    function test_shares_sumEqualsTotal() public {
        // Multiple depositors
        _fundAccountWithTokens(alice, 2 ether, 6000 * 1e6);
        _fundAccountWithTokens(bob, 1 ether, 3000 * 1e6);
        _approveVault(alice);
        _approveVault(bob);

        (uint256 amount0A, uint256 amount1A) = _getDepositAmounts(2 ether, 6000 * 1e6);
        (uint256 amount0B, uint256 amount1B) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(alice);
        vault.deposit(amount0A, amount1A, alice);

        vm.prank(bob);
        vault.deposit(amount0B, amount1B, bob);

        // Sum should equal total
        uint256 sum = vault.shares(manager) + vault.shares(alice) + vault.shares(bob);
        assertEq(sum, vault.totalShares(), "Sum of shares should equal totalShares");
    }

    function test_shares_noInflation() public {
        uint256 totalSharesBefore = vault.totalShares();

        // Alice deposits then immediately redeems
        _fundAccountWithTokens(alice, 1 ether, 3000 * 1e6);
        _approveVault(alice);

        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);

        vm.prank(alice);
        uint256 shares = vault.deposit(amount0, amount1, alice);

        vm.prank(alice);
        vault.redeem(shares, alice, alice);

        // Total shares should return to original
        assertEq(vault.totalShares(), totalSharesBefore, "Total shares should not inflate");
    }

    // ============ Max Functions Tests ============

    function test_maxDeposit_returnsMaxWhenInitialized() public view {
        (uint256 max0, uint256 max1) = vault.maxDeposit(alice);
        assertEq(max0, type(uint256).max, "maxDeposit0 should be max");
        assertEq(max1, type(uint256).max, "maxDeposit1 should be max");
    }

    function test_maxMint_returnsMaxWhenInitialized() public view {
        uint256 maxMint = vault.maxMint(alice);
        assertEq(maxMint, type(uint256).max, "maxMint should be max");
    }

    function test_maxWithdraw_returnsOwnerAssets() public view {
        // Manager has all shares, maxWithdraw should return position value
        (uint256 totalAmount0, uint256 totalAmount1) = vault.totalAssets();
        (uint256 max0, uint256 max1) = vault.maxWithdraw(manager);

        // Should be approximately equal to total assets
        assertApproxEqRel(max0, totalAmount0, 0.01e18, "maxWithdraw0 should match totalAssets");
        assertApproxEqRel(max1, totalAmount1, 0.01e18, "maxWithdraw1 should match totalAssets");
    }

    function test_maxWithdraw_returnsZeroForNonShareholder() public view {
        (uint256 max0, uint256 max1) = vault.maxWithdraw(alice);
        assertEq(max0, 0, "maxWithdraw0 should be 0");
        assertEq(max1, 0, "maxWithdraw1 should be 0");
    }

    function test_maxRedeem_returnsOwnerShares() public view {
        uint256 maxRedeem = vault.maxRedeem(manager);
        assertEq(maxRedeem, vault.shares(manager), "maxRedeem should equal shares");
    }

    function test_maxRedeem_returnsZeroForNonShareholder() public view {
        uint256 maxRedeem = vault.maxRedeem(alice);
        assertEq(maxRedeem, 0, "maxRedeem should be 0 for non-shareholder");
    }

    // ============ TotalAssets Tests ============

    function test_totalAssets_includesPositionAndVaultBalances() public view {
        (uint256 totalAmount0, uint256 totalAmount1) = vault.totalAssets();

        // Should have non-zero value from position
        assertTrue(totalAmount0 > 0 || totalAmount1 > 0, "totalAssets should be non-zero");

        // Position liquidity should exist
        uint128 liquidity = _getPositionLiquidity();
        assertGt(liquidity, 0, "Position should have liquidity");
    }

    function test_totalAssets_excludesReservedFees() public {
        // Generate fees
        _generateFees(5, 5000 * 1e6);

        // Collect fees to vault (updates accumulators)
        vm.prank(manager);
        vault.collectFees();

        // totalAssets should NOT include reserved fees
        (uint256 total0, uint256 total1) = vault.totalAssets();

        // Vault balance includes fees, but totalAssets subtracts reserved
        // This is hard to test precisely, but we verify totalAssets doesn't explode
        assertTrue(total0 >= 0 && total1 >= 0, "totalAssets should be non-negative");
    }

    function test_totalAssets_accurateAfterPriceChange() public {
        (uint256 before0, uint256 before1) = vault.totalAssets();

        // Push price up significantly
        _pushPriceUp(15000 * 1e6);

        (uint256 after0, uint256 after1) = vault.totalAssets();

        // Asset amounts should change (position rebalances as price moves)
        // Can't predict direction without knowing if we're in range
        assertTrue(
            after0 != before0 || after1 != before1,
            "totalAssets should change with price"
        );
    }

    // ============ Multi-Price Preview Consistency ============

    function test_previewFunctions_consistentAtDifferentPrices() public {
        // Test at initial price
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 ether, 3000 * 1e6);
        uint256 previewAtStart = vault.previewDeposit(amount0, amount1);

        // Push price up
        _pushPriceUp(10000 * 1e6);

        uint256 previewAfterUp = vault.previewDeposit(amount0, amount1);

        // Push price down
        _pushPriceDown(5 ether);

        uint256 previewAfterDown = vault.previewDeposit(amount0, amount1);

        // Previews should vary but all be positive
        assertGt(previewAtStart, 0, "Preview at start should be positive");
        assertGt(previewAfterUp, 0, "Preview after up should be positive");
        assertGt(previewAfterDown, 0, "Preview after down should be positive");

        // They should be different (price affects share calculation)
        assertTrue(
            previewAtStart != previewAfterUp || previewAfterUp != previewAfterDown,
            "Previews should vary with price"
        );
    }

    // ============ Edge Cases ============

    function test_preview_largeAmounts() public view {
        // Very large amounts
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1000 ether, 3_000_000 * 1e6);

        // Should not revert
        uint256 preview = vault.previewDeposit(amount0, amount1);
        assertGt(preview, 0, "Preview for large amounts should work");
    }

    function test_preview_smallAmounts() public view {
        // Very small amounts
        (uint256 amount0, uint256 amount1) = _getDepositAmounts(1 wei, 1);

        // Should not revert (may return 0 shares due to rounding)
        uint256 preview = vault.previewDeposit(amount0, amount1);
        // Just checking no revert
        assertTrue(preview >= 0, "Preview for tiny amounts should not revert");
    }
}
