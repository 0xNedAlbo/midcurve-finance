// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

/// @title Access Control Unit Tests
/// @notice Tests modifiers, authorization checks, and slippage settings
/// @dev Uses a harness contract to test access control in isolation

/// @dev Harness exposing access control logic for unit testing
contract AccessControlHarness {
    // ============ Errors ============

    error Unauthorized();
    error NotInitialized();
    error ZeroAmount();

    // ============ Constants ============

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant DEFAULT_DEPOSIT_SLIPPAGE_BPS = 100;
    uint256 public constant DEFAULT_WITHDRAW_SLIPPAGE_BPS = 100;

    // ============ State ============

    address public immutable manager;
    bool public initialized;

    mapping(address => uint256) public shares;
    mapping(address => uint256) internal _shareholderDepositSlippageBps;
    mapping(address => uint256) internal _shareholderWithdrawSlippageBps;

    // ============ Constructor ============

    constructor() {
        manager = msg.sender;
    }

    // ============ Modifiers ============

    modifier onlyManager() {
        if (msg.sender != manager) revert Unauthorized();
        _;
    }

    modifier whenInitialized() {
        if (!initialized) revert NotInitialized();
        _;
    }

    // ============ Functions Under Test ============

    function managerOnlyFunction() external onlyManager returns (bool) {
        return true;
    }

    function initializedOnlyFunction() external whenInitialized returns (bool) {
        return true;
    }

    function setInitialized(bool value) external {
        initialized = value;
    }

    function setShares(address account, uint256 amount) external {
        shares[account] = amount;
    }

    // ============ Slippage Functions ============

    function getDepositSlippageBps(address shareholder) public view returns (uint256 slippageBps) {
        slippageBps = _shareholderDepositSlippageBps[shareholder];
        if (slippageBps == 0) {
            slippageBps = DEFAULT_DEPOSIT_SLIPPAGE_BPS;
        }
    }

    function setDepositSlippage(uint256 slippageBps) external {
        require(slippageBps <= BPS_DENOMINATOR, "Invalid slippage");
        _shareholderDepositSlippageBps[msg.sender] = slippageBps;
    }

    function getWithdrawSlippageBps(address shareholder) public view returns (uint256 slippageBps) {
        slippageBps = _shareholderWithdrawSlippageBps[shareholder];
        if (slippageBps == 0) {
            slippageBps = DEFAULT_WITHDRAW_SLIPPAGE_BPS;
        }
    }

    function setWithdrawSlippage(uint256 slippageBps) external {
        require(slippageBps <= BPS_DENOMINATOR, "Invalid slippage");
        _shareholderWithdrawSlippageBps[msg.sender] = slippageBps;
    }

    // ============ Simulated Withdraw/Redeem Authorization ============

    function withdraw(uint256 amount0, uint256 amount1, address receiver, address owner) external whenInitialized {
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        // Would do actual withdrawal here
    }

    function redeem(uint256 sharesToRedeem, address receiver, address owner) external whenInitialized {
        if (sharesToRedeem == 0) revert ZeroAmount();
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        // Would do actual redemption here
    }
}

contract AccessControlTest is Test {
    AccessControlHarness harness;

    address manager;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        manager = address(this);
        harness = new AccessControlHarness();
    }

    // ============ onlyManager modifier tests ============

    function test_onlyManager_allowsManager() public {
        bool result = harness.managerOnlyFunction();
        assertTrue(result);
    }

    function test_onlyManager_revertsForNonManager() public {
        vm.prank(alice);
        vm.expectRevert(AccessControlHarness.Unauthorized.selector);
        harness.managerOnlyFunction();
    }

    function test_onlyManager_revertsForAnyNonManager() public {
        address[] memory nonManagers = new address[](3);
        nonManagers[0] = alice;
        nonManagers[1] = bob;
        nonManagers[2] = address(0x123);

        for (uint256 i = 0; i < nonManagers.length; i++) {
            vm.prank(nonManagers[i]);
            vm.expectRevert(AccessControlHarness.Unauthorized.selector);
            harness.managerOnlyFunction();
        }
    }

    // ============ whenInitialized modifier tests ============

    function test_whenInitialized_revertsWhenNotInitialized() public {
        assertFalse(harness.initialized());

        vm.expectRevert(AccessControlHarness.NotInitialized.selector);
        harness.initializedOnlyFunction();
    }

    function test_whenInitialized_allowsWhenInitialized() public {
        harness.setInitialized(true);
        assertTrue(harness.initialized());

        bool result = harness.initializedOnlyFunction();
        assertTrue(result);
    }

    function test_whenInitialized_toggleBehavior() public {
        // Not initialized -> reverts
        vm.expectRevert(AccessControlHarness.NotInitialized.selector);
        harness.initializedOnlyFunction();

        // Set initialized -> works
        harness.setInitialized(true);
        assertTrue(harness.initializedOnlyFunction());

        // Unset initialized -> reverts again
        harness.setInitialized(false);
        vm.expectRevert(AccessControlHarness.NotInitialized.selector);
        harness.initializedOnlyFunction();
    }

    // ============ Slippage settings tests ============

    function test_getDepositSlippageBps_returnsDefault() public view {
        uint256 slippage = harness.getDepositSlippageBps(alice);
        assertEq(slippage, 100); // DEFAULT_DEPOSIT_SLIPPAGE_BPS
    }

    function test_setDepositSlippage_customValue() public {
        vm.prank(alice);
        harness.setDepositSlippage(50); // 0.5%

        uint256 slippage = harness.getDepositSlippageBps(alice);
        assertEq(slippage, 50);
    }

    function test_setDepositSlippage_zeroResetsToDefault() public {
        // Set custom first
        vm.prank(alice);
        harness.setDepositSlippage(50);
        assertEq(harness.getDepositSlippageBps(alice), 50);

        // Set to 0 -> should return default
        vm.prank(alice);
        harness.setDepositSlippage(0);
        assertEq(harness.getDepositSlippageBps(alice), 100); // Default
    }

    function test_setDepositSlippage_maxValue() public {
        vm.prank(alice);
        harness.setDepositSlippage(10000); // 100%

        uint256 slippage = harness.getDepositSlippageBps(alice);
        assertEq(slippage, 10000);
    }

    function test_setDepositSlippage_revertsAboveMax() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Invalid slippage"));
        harness.setDepositSlippage(10001);
    }

    function test_setDepositSlippage_perUserSetting() public {
        vm.prank(alice);
        harness.setDepositSlippage(50);

        vm.prank(bob);
        harness.setDepositSlippage(200);

        assertEq(harness.getDepositSlippageBps(alice), 50);
        assertEq(harness.getDepositSlippageBps(bob), 200);
    }

    function test_getWithdrawSlippageBps_returnsDefault() public view {
        uint256 slippage = harness.getWithdrawSlippageBps(alice);
        assertEq(slippage, 100); // DEFAULT_WITHDRAW_SLIPPAGE_BPS
    }

    function test_setWithdrawSlippage_customValue() public {
        vm.prank(alice);
        harness.setWithdrawSlippage(150);

        uint256 slippage = harness.getWithdrawSlippageBps(alice);
        assertEq(slippage, 150);
    }

    function test_setWithdrawSlippage_revertsAboveMax() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Invalid slippage"));
        harness.setWithdrawSlippage(10001);
    }

    function test_depositAndWithdrawSlippage_independent() public {
        vm.startPrank(alice);
        harness.setDepositSlippage(50);
        harness.setWithdrawSlippage(300);
        vm.stopPrank();

        assertEq(harness.getDepositSlippageBps(alice), 50);
        assertEq(harness.getWithdrawSlippageBps(alice), 300);
    }

    // ============ Withdraw authorization tests ============

    function test_withdraw_ownerCanWithdraw() public {
        harness.setInitialized(true);

        vm.prank(alice);
        harness.withdraw(100, 100, alice, alice);
        // No revert = success
    }

    function test_withdraw_revertsForNonOwner() public {
        harness.setInitialized(true);

        vm.prank(bob);
        vm.expectRevert(AccessControlHarness.Unauthorized.selector);
        harness.withdraw(100, 100, bob, alice); // Bob trying to withdraw Alice's funds
    }

    function test_withdraw_revertsWhenNotInitialized() public {
        vm.prank(alice);
        vm.expectRevert(AccessControlHarness.NotInitialized.selector);
        harness.withdraw(100, 100, alice, alice);
    }

    function test_withdraw_revertsOnZeroAmount() public {
        harness.setInitialized(true);

        vm.prank(alice);
        vm.expectRevert(AccessControlHarness.ZeroAmount.selector);
        harness.withdraw(0, 0, alice, alice);
    }

    function test_withdraw_allowsSingleTokenWithdraw() public {
        harness.setInitialized(true);

        vm.prank(alice);
        harness.withdraw(100, 0, alice, alice); // Only token0

        vm.prank(alice);
        harness.withdraw(0, 100, alice, alice); // Only token1
    }

    // ============ Redeem authorization tests ============

    function test_redeem_ownerCanRedeem() public {
        harness.setInitialized(true);

        vm.prank(alice);
        harness.redeem(100, alice, alice);
        // No revert = success
    }

    function test_redeem_revertsForNonOwner() public {
        harness.setInitialized(true);

        vm.prank(bob);
        vm.expectRevert(AccessControlHarness.Unauthorized.selector);
        harness.redeem(100, bob, alice); // Bob trying to redeem Alice's shares
    }

    function test_redeem_revertsWhenNotInitialized() public {
        vm.prank(alice);
        vm.expectRevert(AccessControlHarness.NotInitialized.selector);
        harness.redeem(100, alice, alice);
    }

    function test_redeem_revertsOnZeroShares() public {
        harness.setInitialized(true);

        vm.prank(alice);
        vm.expectRevert(AccessControlHarness.ZeroAmount.selector);
        harness.redeem(0, alice, alice);
    }

    // ============ Combined access control tests ============

    function test_multipleModifiers_bothMustPass() public {
        // whenInitialized is checked before onlyManager in most cases
        // Test that both conditions must be met

        // Not initialized, not manager
        vm.prank(alice);
        vm.expectRevert(AccessControlHarness.NotInitialized.selector);
        harness.withdraw(100, 100, alice, alice);

        // Initialized, not owner
        harness.setInitialized(true);
        vm.prank(bob);
        vm.expectRevert(AccessControlHarness.Unauthorized.selector);
        harness.withdraw(100, 100, bob, alice);

        // Initialized, is owner -> success
        vm.prank(alice);
        harness.withdraw(100, 100, alice, alice);
    }

    // ============ Fuzz tests ============

    function testFuzz_setDepositSlippage_validRange(uint256 slippage) public {
        vm.assume(slippage <= 10000);

        vm.prank(alice);
        harness.setDepositSlippage(slippage);

        uint256 result = harness.getDepositSlippageBps(alice);
        if (slippage == 0) {
            assertEq(result, 100); // Default
        } else {
            assertEq(result, slippage);
        }
    }

    function testFuzz_setWithdrawSlippage_validRange(uint256 slippage) public {
        vm.assume(slippage <= 10000);

        vm.prank(alice);
        harness.setWithdrawSlippage(slippage);

        uint256 result = harness.getWithdrawSlippageBps(alice);
        if (slippage == 0) {
            assertEq(result, 100); // Default
        } else {
            assertEq(result, slippage);
        }
    }

    function testFuzz_onlyOwnerCanWithdraw(address caller, address owner) public {
        vm.assume(caller != address(0) && owner != address(0));
        harness.setInitialized(true);

        if (caller == owner) {
            // Owner can withdraw
            vm.prank(caller);
            harness.withdraw(100, 100, caller, owner);
        } else {
            // Non-owner cannot
            vm.prank(caller);
            vm.expectRevert(AccessControlHarness.Unauthorized.selector);
            harness.withdraw(100, 100, caller, owner);
        }
    }
}
