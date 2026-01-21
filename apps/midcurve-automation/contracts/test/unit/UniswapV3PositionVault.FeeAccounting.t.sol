// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

/// @title Fee Accounting Unit Tests
/// @notice Tests the fee accumulator math in isolation using a harness contract
/// @dev The vault's fee accounting follows the "accumulated fee per share" pattern:
///      - accFeePerShare = cumulative fees * PRECISION / totalShares
///      - pending = (accFeePerShare * userShares / PRECISION) - feeDebt
///      - feeDebt is set when shares change to preserve pending amounts

/// @dev Minimal harness exposing fee accounting logic for unit testing
contract FeeAccountingHarness {
    uint256 public constant ACC_PRECISION = 1e18;

    uint256 public totalShares;
    uint256 public accFeePerShare0;
    uint256 public accFeePerShare1;

    mapping(address => uint256) public shares;
    mapping(address => uint256) public feeDebt0;
    mapping(address => uint256) public feeDebt1;

    // ============ Fee Accounting Functions ============

    function pendingFees(address account) external view returns (uint256 pending0, uint256 pending1) {
        uint256 userShares = shares[account];
        if (userShares > 0) {
            pending0 = ((accFeePerShare0 * userShares) / ACC_PRECISION) - feeDebt0[account];
            pending1 = ((accFeePerShare1 * userShares) / ACC_PRECISION) - feeDebt1[account];
        }
    }

    function updateFeeAccumulators(uint256 collected0, uint256 collected1) external {
        if (totalShares > 0) {
            accFeePerShare0 += (collected0 * ACC_PRECISION) / totalShares;
            accFeePerShare1 += (collected1 * ACC_PRECISION) / totalShares;
        }
    }

    function getVaultBalances(
        uint256 rawBalance0,
        uint256 rawBalance1
    ) external view returns (uint256 balance0, uint256 balance1) {
        balance0 = rawBalance0;
        balance1 = rawBalance1;

        // Subtract fees reserved for shareholders
        uint256 reservedFees0 = (accFeePerShare0 * totalShares) / ACC_PRECISION;
        uint256 reservedFees1 = (accFeePerShare1 * totalShares) / ACC_PRECISION;

        if (balance0 > reservedFees0) {
            balance0 -= reservedFees0;
        } else {
            balance0 = 0;
        }

        if (balance1 > reservedFees1) {
            balance1 -= reservedFees1;
        } else {
            balance1 = 0;
        }
    }

    // ============ Test Helpers ============

    function setShares(address account, uint256 amount) external {
        uint256 oldShares = shares[account];
        if (amount > oldShares) {
            totalShares += (amount - oldShares);
        } else {
            totalShares -= (oldShares - amount);
        }
        shares[account] = amount;
    }

    function setFeeDebt(address account, uint256 debt0, uint256 debt1) external {
        feeDebt0[account] = debt0;
        feeDebt1[account] = debt1;
    }

    function setAccFeePerShare(uint256 acc0, uint256 acc1) external {
        accFeePerShare0 = acc0;
        accFeePerShare1 = acc1;
    }

    /// @dev Simulates a deposit: adds shares and sets fee debt to prevent claiming old fees
    function simulateDeposit(address account, uint256 newShares) external {
        shares[account] += newShares;
        totalShares += newShares;
        // Set debt so new depositor can't claim fees from before their deposit
        feeDebt0[account] += (accFeePerShare0 * newShares) / ACC_PRECISION;
        feeDebt1[account] += (accFeePerShare1 * newShares) / ACC_PRECISION;
    }

    /// @dev Simulates a withdrawal: burns shares and resets fee debt
    function simulateWithdrawal(address account, uint256 sharesToBurn) external {
        require(shares[account] >= sharesToBurn, "Insufficient shares");
        shares[account] -= sharesToBurn;
        totalShares -= sharesToBurn;
        // Reset fee debt to match remaining shares
        feeDebt0[account] = (accFeePerShare0 * shares[account]) / ACC_PRECISION;
        feeDebt1[account] = (accFeePerShare1 * shares[account]) / ACC_PRECISION;
    }

    /// @dev Simulates fee collection: calculates pending, updates debt, returns collected
    function simulateCollectFees(address account) external returns (uint256 collected0, uint256 collected1) {
        uint256 userShares = shares[account];
        require(userShares > 0, "No shares");

        collected0 = ((accFeePerShare0 * userShares) / ACC_PRECISION) - feeDebt0[account];
        collected1 = ((accFeePerShare1 * userShares) / ACC_PRECISION) - feeDebt1[account];

        feeDebt0[account] = (accFeePerShare0 * userShares) / ACC_PRECISION;
        feeDebt1[account] = (accFeePerShare1 * userShares) / ACC_PRECISION;
    }
}

contract FeeAccountingTest is Test {
    FeeAccountingHarness harness;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address charlie = address(0xC);

    uint256 constant PRECISION = 1e18;

    function setUp() public {
        harness = new FeeAccountingHarness();
    }

    // ============ pendingFees tests ============

    function test_pendingFees_zeroShares() public view {
        (uint256 pending0, uint256 pending1) = harness.pendingFees(alice);
        assertEq(pending0, 0);
        assertEq(pending1, 0);
    }

    function test_pendingFees_noFeesAccumulated() public {
        harness.setShares(alice, 1000e18);

        (uint256 pending0, uint256 pending1) = harness.pendingFees(alice);
        assertEq(pending0, 0);
        assertEq(pending1, 0);
    }

    function test_pendingFees_singleShareholder() public {
        harness.setShares(alice, 1000e18);
        harness.updateFeeAccumulators(100e18, 50e18);

        (uint256 pending0, uint256 pending1) = harness.pendingFees(alice);
        assertEq(pending0, 100e18);
        assertEq(pending1, 50e18);
    }

    function test_pendingFees_multipleShareholders_equalShares() public {
        harness.setShares(alice, 500e18);
        harness.setShares(bob, 500e18);

        harness.updateFeeAccumulators(100e18, 50e18);

        (uint256 alicePending0, uint256 alicePending1) = harness.pendingFees(alice);
        (uint256 bobPending0, uint256 bobPending1) = harness.pendingFees(bob);

        // Each gets 50% of fees
        assertEq(alicePending0, 50e18);
        assertEq(alicePending1, 25e18);
        assertEq(bobPending0, 50e18);
        assertEq(bobPending1, 25e18);
    }

    function test_pendingFees_multipleShareholders_unequalShares() public {
        harness.setShares(alice, 750e18); // 75%
        harness.setShares(bob, 250e18); // 25%

        harness.updateFeeAccumulators(100e18, 100e18);

        (uint256 alicePending0, uint256 alicePending1) = harness.pendingFees(alice);
        (uint256 bobPending0, uint256 bobPending1) = harness.pendingFees(bob);

        assertEq(alicePending0, 75e18);
        assertEq(alicePending1, 75e18);
        assertEq(bobPending0, 25e18);
        assertEq(bobPending1, 25e18);
    }

    function test_pendingFees_afterDeposit_noOldFees() public {
        // Alice deposits first, fees accumulate, then Bob deposits
        harness.setShares(alice, 500e18);
        harness.updateFeeAccumulators(100e18, 100e18);

        // Bob deposits with proper fee debt set
        harness.simulateDeposit(bob, 500e18);

        // Alice should have full 100e18, Bob should have 0
        (uint256 alicePending0, uint256 alicePending1) = harness.pendingFees(alice);
        (uint256 bobPending0, uint256 bobPending1) = harness.pendingFees(bob);

        assertEq(alicePending0, 100e18);
        assertEq(alicePending1, 100e18);
        assertEq(bobPending0, 0);
        assertEq(bobPending1, 0);
    }

    function test_pendingFees_afterDeposit_newFeesShared() public {
        // Alice deposits, fees accumulate, Bob deposits, more fees accumulate
        harness.setShares(alice, 500e18);
        harness.updateFeeAccumulators(100e18, 100e18); // Only Alice gets these

        harness.simulateDeposit(bob, 500e18);
        harness.updateFeeAccumulators(100e18, 100e18); // Both get these (50/50)

        (uint256 alicePending0, uint256 alicePending1) = harness.pendingFees(alice);
        (uint256 bobPending0, uint256 bobPending1) = harness.pendingFees(bob);

        // Alice: 100 (old) + 50 (new) = 150
        // Bob: 0 (old) + 50 (new) = 50
        assertEq(alicePending0, 150e18);
        assertEq(alicePending1, 150e18);
        assertEq(bobPending0, 50e18);
        assertEq(bobPending1, 50e18);
    }

    // ============ updateFeeAccumulators tests ============

    function test_updateFeeAccumulators_zeroShares() public {
        // No shares = no update (avoids division by zero)
        harness.updateFeeAccumulators(100e18, 50e18);
        assertEq(harness.accFeePerShare0(), 0);
        assertEq(harness.accFeePerShare1(), 0);
    }

    function test_updateFeeAccumulators_singleUpdate() public {
        harness.setShares(alice, 1000e18);
        harness.updateFeeAccumulators(100e18, 50e18);

        // accFeePerShare = fees * PRECISION / totalShares
        // = 100e18 * 1e18 / 1000e18 = 100e18 * 1e18 / 1000e18 = 1e17
        uint256 expectedAcc0 = (100e18 * PRECISION) / 1000e18;
        uint256 expectedAcc1 = (50e18 * PRECISION) / 1000e18;

        assertEq(harness.accFeePerShare0(), expectedAcc0);
        assertEq(harness.accFeePerShare1(), expectedAcc1);
    }

    function test_updateFeeAccumulators_multipleUpdates() public {
        harness.setShares(alice, 1000e18);

        harness.updateFeeAccumulators(100e18, 0);
        harness.updateFeeAccumulators(50e18, 25e18);

        uint256 expectedAcc0 = (150e18 * PRECISION) / 1000e18;
        uint256 expectedAcc1 = (25e18 * PRECISION) / 1000e18;

        assertEq(harness.accFeePerShare0(), expectedAcc0);
        assertEq(harness.accFeePerShare1(), expectedAcc1);
    }

    function test_updateFeeAccumulators_zeroFees() public {
        harness.setShares(alice, 1000e18);
        harness.updateFeeAccumulators(0, 0);

        assertEq(harness.accFeePerShare0(), 0);
        assertEq(harness.accFeePerShare1(), 0);
    }

    // ============ getVaultBalances tests ============

    function test_getVaultBalances_noReservedFees() public view {
        (uint256 balance0, uint256 balance1) = harness.getVaultBalances(1000e18, 500e18);
        assertEq(balance0, 1000e18);
        assertEq(balance1, 500e18);
    }

    function test_getVaultBalances_withReservedFees() public {
        harness.setShares(alice, 1000e18);
        harness.updateFeeAccumulators(100e18, 50e18);

        // Raw balance minus reserved fees
        (uint256 balance0, uint256 balance1) = harness.getVaultBalances(1000e18, 500e18);

        // Reserved = accFeePerShare * totalShares / PRECISION = fees collected
        assertEq(balance0, 1000e18 - 100e18);
        assertEq(balance1, 500e18 - 50e18);
    }

    function test_getVaultBalances_reservedExceedsBalance() public {
        harness.setShares(alice, 1000e18);
        harness.updateFeeAccumulators(200e18, 100e18);

        // Raw balance is less than reserved fees
        (uint256 balance0, uint256 balance1) = harness.getVaultBalances(100e18, 50e18);

        // Should return 0, not underflow
        assertEq(balance0, 0);
        assertEq(balance1, 0);
    }

    // ============ Fee collection flow tests ============

    function test_collectFees_singleShareholder() public {
        harness.setShares(alice, 1000e18);
        harness.updateFeeAccumulators(100e18, 50e18);

        (uint256 collected0, uint256 collected1) = harness.simulateCollectFees(alice);

        assertEq(collected0, 100e18);
        assertEq(collected1, 50e18);

        // After collection, pending should be 0
        (uint256 pending0, uint256 pending1) = harness.pendingFees(alice);
        assertEq(pending0, 0);
        assertEq(pending1, 0);
    }

    function test_collectFees_multipleTimes() public {
        harness.setShares(alice, 1000e18);

        // First fee distribution
        harness.updateFeeAccumulators(100e18, 50e18);
        (uint256 collected0a, uint256 collected1a) = harness.simulateCollectFees(alice);
        assertEq(collected0a, 100e18);
        assertEq(collected1a, 50e18);

        // Second fee distribution
        harness.updateFeeAccumulators(200e18, 100e18);
        (uint256 collected0b, uint256 collected1b) = harness.simulateCollectFees(alice);
        assertEq(collected0b, 200e18);
        assertEq(collected1b, 100e18);
    }

    function test_collectFees_noPendingFees() public {
        harness.setShares(alice, 1000e18);
        // No fees accumulated

        (uint256 collected0, uint256 collected1) = harness.simulateCollectFees(alice);
        assertEq(collected0, 0);
        assertEq(collected1, 0);
    }

    // ============ Withdrawal fee handling tests ============

    function test_withdrawal_resetsDebtForRemainingShares() public {
        harness.setShares(alice, 1000e18);
        harness.updateFeeAccumulators(100e18, 50e18);

        // Note: In the actual vault, withdrawal collects pending fees FIRST, then burns shares.
        // The harness simulates the debt reset that happens after withdrawal.
        // So after withdrawal, pending for remaining shares starts fresh at 0.

        // Partial withdrawal (50%)
        harness.simulateWithdrawal(alice, 500e18);

        // After withdrawal, fee debt is reset to match remaining shares at current accFeePerShare.
        // This means pending fees are 0 (the actual vault would have paid out the 100e18 during withdrawal)
        (uint256 pending0, uint256 pending1) = harness.pendingFees(alice);
        assertEq(pending0, 0);
        assertEq(pending1, 0);

        // New fees after withdrawal are shared
        harness.updateFeeAccumulators(100e18, 50e18);
        (pending0, pending1) = harness.pendingFees(alice);
        assertEq(pending0, 100e18);
        assertEq(pending1, 50e18);
    }

    function test_withdrawal_fullWithdrawalZerosPending() public {
        harness.setShares(alice, 1000e18);
        harness.updateFeeAccumulators(100e18, 50e18);

        // Full withdrawal
        harness.simulateWithdrawal(alice, 1000e18);

        // Alice should have 0 pending (no shares left)
        (uint256 pending0, uint256 pending1) = harness.pendingFees(alice);
        assertEq(pending0, 0);
        assertEq(pending1, 0);
    }

    // ============ Edge case tests ============

    function test_dustRounding() public {
        // Small amounts to test rounding behavior
        harness.setShares(alice, 3);
        harness.updateFeeAccumulators(10, 10);

        // accFeePerShare = 10 * 1e18 / 3 = 3333333333333333333 (with rounding)
        // pending = 3333333333333333333 * 3 / 1e18 = 9 (rounds down from 10)
        (uint256 pending0, uint256 pending1) = harness.pendingFees(alice);

        // Due to integer division, we may lose some dust
        assertLe(pending0, 10);
        assertLe(pending1, 10);
        assertGe(pending0, 9); // Should recover most
        assertGe(pending1, 9);
    }

    function test_threeShareholders_complexScenario() public {
        // Alice deposits first
        harness.setShares(alice, 1000e18);

        // First fee distribution (only Alice)
        harness.updateFeeAccumulators(300e18, 300e18);

        // Bob deposits
        harness.simulateDeposit(bob, 1000e18);

        // Second fee distribution (Alice and Bob split)
        harness.updateFeeAccumulators(200e18, 200e18);

        // Charlie deposits
        harness.simulateDeposit(charlie, 1000e18);

        // Third fee distribution (all three split)
        harness.updateFeeAccumulators(300e18, 300e18);

        // Check pending fees
        (uint256 alicePending0,) = harness.pendingFees(alice);
        (uint256 bobPending0,) = harness.pendingFees(bob);
        (uint256 charliePending0,) = harness.pendingFees(charlie);

        // Alice: 300 (solo) + 100 (50% of 200) + 100 (33% of 300) = 500
        // Bob: 0 (wasn't in) + 100 (50% of 200) + 100 (33% of 300) = 200
        // Charlie: 0 + 0 + 100 (33% of 300) = 100
        assertEq(alicePending0, 500e18);
        assertEq(bobPending0, 200e18);
        assertEq(charliePending0, 100e18);

        // Total should equal total fees distributed
        assertEq(alicePending0 + bobPending0 + charliePending0, 800e18);
    }

    // ============ Fuzz tests ============

    function testFuzz_pendingFees_neverExceedsTotal(uint128 shares_, uint128 fees0, uint128 fees1) public {
        vm.assume(shares_ > 0);

        harness.setShares(alice, shares_);
        harness.updateFeeAccumulators(fees0, fees1);

        (uint256 pending0, uint256 pending1) = harness.pendingFees(alice);

        // Pending should never exceed what was distributed
        assertLe(pending0, fees0);
        assertLe(pending1, fees1);
    }

    function testFuzz_multipleDepositors_totalPendingDoesNotExceedDistributed(
        uint64 aliceShares,
        uint64 bobShares,
        uint64 fees
    ) public {
        vm.assume(aliceShares > 0 && bobShares > 0);
        vm.assume(uint256(aliceShares) + uint256(bobShares) <= type(uint128).max);

        harness.setShares(alice, aliceShares);
        harness.setShares(bob, bobShares);
        harness.updateFeeAccumulators(fees, 0);

        (uint256 alicePending,) = harness.pendingFees(alice);
        (uint256 bobPending,) = harness.pendingFees(bob);

        // Key invariant: total pending should never exceed distributed fees
        // (rounding always rounds down, so some dust may be lost)
        assertLe(alicePending + bobPending, fees);
    }
}
