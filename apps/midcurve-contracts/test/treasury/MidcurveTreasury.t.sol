// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { MidcurveTreasury } from "../../contracts/treasury/MidcurveTreasury.sol";
import { IMidcurveTreasury } from "../../contracts/treasury/interfaces/IMidcurveTreasury.sol";
import { IMidcurveSwapRouter } from "../../contracts/swap-router/interfaces/IMidcurveSwapRouter.sol";
import { IWETH } from "../../contracts/treasury/interfaces/IWETH.sol";

// ============================================================================
// Mock Contracts
// ============================================================================

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Mock WETH that actually wraps/unwraps ETH
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool success,) = msg.sender.call{ value: amount }("");
        require(success, "MockWETH: ETH transfer failed");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

/// @dev Mock SwapRouter that simulates selling tokenIn for WETH.
///      Pre-fund this contract with WETH before calling sell().
contract MockSwapRouter {
    address public weth;

    constructor(address weth_) {
        weth = weth_;
    }

    function sell(
        address tokenIn,
        address, /* tokenOut */
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256, /* deadline */
        IMidcurveSwapRouter.Hop[] calldata /* path */
    ) external returns (uint256 amountOut) {
        // Pull tokenIn from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Send WETH to recipient (1:1 ratio for simplicity)
        amountOut = amountIn;
        require(amountOut >= minAmountOut, "MockSwapRouter: slippage");
        IERC20(weth).transfer(recipient, amountOut);

        return amountOut;
    }
}

// ============================================================================
// Tests
// ============================================================================

contract MidcurveTreasuryTest is Test {
    MidcurveTreasury public treasury;
    MockERC20 public token;
    MockWETH public mockWeth;
    MockSwapRouter public mockRouter;

    address public admin = makeAddr("admin");
    address public operatorAddr = makeAddr("operator");
    address public stranger = makeAddr("stranger");
    address public recipient = makeAddr("recipient");

    function setUp() public {
        mockWeth = new MockWETH();
        mockRouter = new MockSwapRouter(address(mockWeth));
        token = new MockERC20("USD Coin", "USDC");

        treasury = new MidcurveTreasury(admin, operatorAddr, address(mockRouter), address(mockWeth));
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    function test_constructor_setsState() public view {
        assertEq(treasury.admin(), admin);
        assertEq(treasury.operator(), operatorAddr);
        assertEq(address(treasury.swapRouter()), address(mockRouter));
        assertEq(treasury.weth(), address(mockWeth));
    }

    function test_constructor_revertsOnZeroAdmin() public {
        vm.expectRevert(IMidcurveTreasury.ZeroAddress.selector);
        new MidcurveTreasury(address(0), operatorAddr, address(mockRouter), address(mockWeth));
    }

    function test_constructor_revertsOnZeroOperator() public {
        vm.expectRevert(IMidcurveTreasury.ZeroAddress.selector);
        new MidcurveTreasury(admin, address(0), address(mockRouter), address(mockWeth));
    }

    function test_constructor_revertsOnZeroSwapRouter() public {
        vm.expectRevert(IMidcurveTreasury.ZeroAddress.selector);
        new MidcurveTreasury(admin, operatorAddr, address(0), address(mockWeth));
    }

    function test_constructor_revertsOnZeroWeth() public {
        vm.expectRevert(IMidcurveTreasury.ZeroAddress.selector);
        new MidcurveTreasury(admin, operatorAddr, address(mockRouter), address(0));
    }

    // ============================================================================
    // receive
    // ============================================================================

    function test_receive_acceptsEth() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool success,) = address(treasury).call{ value: 1 ether }("");
        assertTrue(success);
        assertEq(address(treasury).balance, 1 ether);
    }

    // ============================================================================
    // sweep
    // ============================================================================

    function test_sweep_transfersTokens() public {
        token.mint(address(treasury), 1000e6);

        vm.prank(admin);
        treasury.sweep(address(token), recipient, 1000e6);

        assertEq(token.balanceOf(recipient), 1000e6);
        assertEq(token.balanceOf(address(treasury)), 0);
    }

    function test_sweep_emitsEvent() public {
        token.mint(address(treasury), 500e6);

        vm.expectEmit(true, true, false, true);
        emit IMidcurveTreasury.Sweep(address(token), recipient, 500e6);

        vm.prank(admin);
        treasury.sweep(address(token), recipient, 500e6);
    }

    function test_sweep_revertsIfNotAdmin() public {
        token.mint(address(treasury), 1000e6);

        vm.prank(stranger);
        vm.expectRevert(IMidcurveTreasury.NotAdmin.selector);
        treasury.sweep(address(token), recipient, 1000e6);
    }

    function test_sweep_revertsOnZeroRecipient() public {
        token.mint(address(treasury), 1000e6);

        vm.prank(admin);
        vm.expectRevert(IMidcurveTreasury.ZeroAddress.selector);
        treasury.sweep(address(token), address(0), 1000e6);
    }

    // ============================================================================
    // rescueETH
    // ============================================================================

    function test_rescueETH_sendsEth() public {
        vm.deal(address(treasury), 2 ether);

        vm.prank(admin);
        treasury.rescueETH(recipient, 1 ether);

        assertEq(recipient.balance, 1 ether);
        assertEq(address(treasury).balance, 1 ether);
    }

    function test_rescueETH_emitsEvent() public {
        vm.deal(address(treasury), 1 ether);

        vm.expectEmit(true, false, false, true);
        emit IMidcurveTreasury.EthRescued(recipient, 1 ether);

        vm.prank(admin);
        treasury.rescueETH(recipient, 1 ether);
    }

    function test_rescueETH_revertsIfNotAdmin() public {
        vm.deal(address(treasury), 1 ether);

        vm.prank(stranger);
        vm.expectRevert(IMidcurveTreasury.NotAdmin.selector);
        treasury.rescueETH(recipient, 1 ether);
    }

    function test_rescueETH_revertsOnZeroRecipient() public {
        vm.deal(address(treasury), 1 ether);

        vm.prank(admin);
        vm.expectRevert(IMidcurveTreasury.ZeroAddress.selector);
        treasury.rescueETH(address(0), 1 ether);
    }

    // ============================================================================
    // setOperator
    // ============================================================================

    function test_setOperator_updatesAndEmits() public {
        address newOp = makeAddr("newOperator");

        vm.expectEmit(true, true, false, false);
        emit IMidcurveTreasury.OperatorUpdated(operatorAddr, newOp);

        vm.prank(admin);
        treasury.setOperator(newOp);

        assertEq(treasury.operator(), newOp);
    }

    function test_setOperator_revertsIfNotAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(IMidcurveTreasury.NotAdmin.selector);
        treasury.setOperator(makeAddr("newOp"));
    }

    function test_setOperator_revertsOnZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(IMidcurveTreasury.ZeroAddress.selector);
        treasury.setOperator(address(0));
    }

    // ============================================================================
    // transferAdmin
    // ============================================================================

    function test_transferAdmin_updatesAndEmits() public {
        address newAdmin = makeAddr("newAdmin");

        vm.expectEmit(true, true, false, false);
        emit IMidcurveTreasury.AdminTransferred(admin, newAdmin);

        vm.prank(admin);
        treasury.transferAdmin(newAdmin);

        assertEq(treasury.admin(), newAdmin);
    }

    function test_transferAdmin_revertsIfNotAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(IMidcurveTreasury.NotAdmin.selector);
        treasury.transferAdmin(makeAddr("newAdmin"));
    }

    function test_transferAdmin_revertsOnZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(IMidcurveTreasury.ZeroAddress.selector);
        treasury.transferAdmin(address(0));
    }

    function test_transferAdmin_oldAdminLosesAccess() public {
        address newAdmin = makeAddr("newAdmin");

        vm.prank(admin);
        treasury.transferAdmin(newAdmin);

        // Old admin can no longer call admin-only functions
        vm.prank(admin);
        vm.expectRevert(IMidcurveTreasury.NotAdmin.selector);
        treasury.setOperator(makeAddr("someOp"));

        // New admin can
        vm.prank(newAdmin);
        treasury.setOperator(makeAddr("someOp"));
    }

    // ============================================================================
    // refuelOperator
    // ============================================================================

    function test_refuelOperator_byAdmin() public {
        uint256 amountIn = 1000e6;
        _setupRefuel(amountIn);

        uint256 operatorBalBefore = operatorAddr.balance;

        vm.prank(admin);
        treasury.refuelOperator(address(token), amountIn, 0, block.timestamp + 300, _emptyHops());

        // Operator received ETH (1:1 mock ratio, so amountIn WETH unwrapped)
        assertEq(operatorAddr.balance - operatorBalBefore, amountIn);
        // Treasury token balance is zero
        assertEq(token.balanceOf(address(treasury)), 0);
    }

    function test_refuelOperator_byOperator() public {
        uint256 amountIn = 500e6;
        _setupRefuel(amountIn);

        uint256 operatorBalBefore = operatorAddr.balance;

        vm.prank(operatorAddr);
        treasury.refuelOperator(address(token), amountIn, 0, block.timestamp + 300, _emptyHops());

        assertEq(operatorAddr.balance - operatorBalBefore, amountIn);
    }

    function test_refuelOperator_emitsEvent() public {
        uint256 amountIn = 1000e6;
        _setupRefuel(amountIn);

        vm.expectEmit(true, false, false, true);
        emit IMidcurveTreasury.RefuelOperator(address(token), amountIn, amountIn);

        vm.prank(admin);
        treasury.refuelOperator(address(token), amountIn, 0, block.timestamp + 300, _emptyHops());
    }

    function test_refuelOperator_revertsIfUnauthorized() public {
        uint256 amountIn = 1000e6;
        _setupRefuel(amountIn);

        vm.prank(stranger);
        vm.expectRevert(IMidcurveTreasury.NotAdminOrOperator.selector);
        treasury.refuelOperator(address(token), amountIn, 0, block.timestamp + 300, _emptyHops());
    }

    function test_refuelOperator_resetsApproval() public {
        uint256 amountIn = 1000e6;
        _setupRefuel(amountIn);

        vm.prank(admin);
        treasury.refuelOperator(address(token), amountIn, 0, block.timestamp + 300, _emptyHops());

        // Allowance should be 0 after execution
        assertEq(token.allowance(address(treasury), address(mockRouter)), 0);
    }

    // ============================================================================
    // refuelOperator — direct WETH path (skip swap)
    // ============================================================================

    function test_refuelOperator_directWethPath() public {
        uint256 amountIn = 1 ether;

        // Fund treasury with WETH directly (simulating WETH fees)
        vm.deal(address(this), amountIn);
        mockWeth.deposit{ value: amountIn }();
        MockERC20(address(mockWeth)).transfer(address(treasury), amountIn);

        uint256 operatorBalBefore = operatorAddr.balance;

        vm.prank(admin);
        treasury.refuelOperator(address(mockWeth), amountIn, amountIn, 0, _emptyHops());

        // Operator received ETH
        assertEq(operatorAddr.balance - operatorBalBefore, amountIn);
        // Treasury WETH balance is zero
        assertEq(MockERC20(address(mockWeth)).balanceOf(address(treasury)), 0);
    }

    function test_refuelOperator_directWethPath_doesNotTouchRouter() public {
        uint256 amountIn = 1 ether;

        // Fund treasury with WETH
        vm.deal(address(this), amountIn);
        mockWeth.deposit{ value: amountIn }();
        MockERC20(address(mockWeth)).transfer(address(treasury), amountIn);

        vm.prank(operatorAddr);
        treasury.refuelOperator(address(mockWeth), amountIn, amountIn, 0, _emptyHops());

        // Router should have zero allowance (was never approved)
        assertEq(MockERC20(address(mockWeth)).allowance(address(treasury), address(mockRouter)), 0);
    }

    function test_refuelOperator_directWethPath_emitsEvent() public {
        uint256 amountIn = 1 ether;

        vm.deal(address(this), amountIn);
        mockWeth.deposit{ value: amountIn }();
        MockERC20(address(mockWeth)).transfer(address(treasury), amountIn);

        vm.expectEmit(true, false, false, true);
        emit IMidcurveTreasury.RefuelOperator(address(mockWeth), amountIn, amountIn);

        vm.prank(admin);
        treasury.refuelOperator(address(mockWeth), amountIn, amountIn, 0, _emptyHops());
    }

    // ============================================================================
    // Helpers
    // ============================================================================

    /// @dev Fund treasury with tokenIn and fund mock router with WETH for the swap
    function _setupRefuel(uint256 amountIn) internal {
        // Give treasury the ERC20 tokens (simulating accumulated fees)
        token.mint(address(treasury), amountIn);

        // Fund mock router with WETH so it can send WETH back during sell()
        vm.deal(address(this), amountIn);
        mockWeth.deposit{ value: amountIn }();
        MockERC20(address(mockWeth)).transfer(address(mockRouter), amountIn);
    }

    function _emptyHops() internal pure returns (IMidcurveSwapRouter.Hop[] memory) {
        return new IMidcurveSwapRouter.Hop[](0);
    }
}
