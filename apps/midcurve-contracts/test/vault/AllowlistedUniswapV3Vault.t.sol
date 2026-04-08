// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {AllowlistedUniswapV3Vault} from "../../contracts/vault/AllowlistedUniswapV3Vault.sol";
import {
    MockNonfungiblePositionManager,
    MockUniswapV3Factory,
    MockUniswapV3Pool
} from "./mocks/MockNonfungiblePositionManager.sol";

contract MockERC20AL is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract AllowlistedUniswapV3VaultTest is Test {
    AllowlistedUniswapV3Vault public implementation;
    AllowlistedUniswapV3Vault public vault;

    MockNonfungiblePositionManager public nfpm;
    MockUniswapV3Factory public uniFactory;
    MockUniswapV3Pool public pool;
    MockERC20AL public tokenA;
    MockERC20AL public tokenB;

    address public alice = makeAddr("alice"); // deployer + initial admin
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    uint256 public constant TOKEN_ID = 42;
    uint128 public constant INITIAL_LIQUIDITY = 1_000_000;
    uint24 public constant FEE = 3000;
    int24 public constant TICK_LOWER = -887220;
    int24 public constant TICK_UPPER = 887220;
    uint160 public constant SQRT_PRICE_X96 = 79228162514264337593543950336;

    function setUp() public {
        uniFactory = new MockUniswapV3Factory();
        nfpm = new MockNonfungiblePositionManager(address(uniFactory));
        tokenA = new MockERC20AL("Token A", "TKNA");
        tokenB = new MockERC20AL("Token B", "TKNB");
        pool = new MockUniswapV3Pool(SQRT_PRICE_X96, 0);

        uniFactory.setPool(address(tokenA), address(tokenB), FEE, address(pool));

        nfpm.createPosition(
            TOKEN_ID, alice, address(tokenA), address(tokenB), FEE, TICK_LOWER, TICK_UPPER, INITIAL_LIQUIDITY
        );

        tokenA.mint(address(nfpm), 100_000_000e18);
        tokenB.mint(address(nfpm), 100_000_000e18);

        implementation = new AllowlistedUniswapV3Vault();
        vault = AllowlistedUniswapV3Vault(Clones.clone(address(implementation)));

        vm.prank(alice);
        nfpm.approve(address(this), TOKEN_ID);
        nfpm.transferFrom(alice, address(vault), TOKEN_ID);

        vault.initialize(
            address(nfpm), TOKEN_ID, "Allowlisted Vault", "AVLT", 6, alice, alice
        );
    }

    // ============ Initialization ============

    function test_initialize_setsAdmin() public view {
        assertEq(vault.allowlistAdmin(), alice);
    }

    function test_initialize_allowlistsAdminAndRecipient() public view {
        assertTrue(vault.allowlisted(alice));
    }

    function test_initialize_base6ParamRevertsOnAllowlisted() public {
        AllowlistedUniswapV3Vault v2 = AllowlistedUniswapV3Vault(Clones.clone(address(implementation)));
        vm.expectRevert("Use allowlisted initialize");
        // Try calling the 6-param base initialize
        AllowlistedUniswapV3Vault(address(v2)).initialize(
            address(nfpm), TOKEN_ID, "X", "Y", 18, alice
        );
    }

    // ============ Allowlist enforcement ============

    function test_transfer_revertsIfRecipientNotAllowlisted() public {
        vm.prank(alice);
        vm.expectRevert(AllowlistedUniswapV3Vault.RecipientNotAllowlisted.selector);
        vault.transfer(bob, 100);
    }

    function test_transfer_succeedsIfRecipientAllowlisted() public {
        vm.prank(alice);
        vault.setAllowlisted(bob, true);

        vm.prank(alice);
        vault.transfer(bob, 100);

        assertEq(vault.balanceOf(bob), 100);
    }

    function test_burn_alwaysPermittedEvenIfNotAllowlisted() public {
        // Remove alice from allowlist
        vm.prank(alice);
        vault.setAllowlisted(alice, false);

        // Alice can still burn
        vm.prank(alice);
        vault.burn(100, 0, 0);

        assertEq(vault.balanceOf(alice), INITIAL_LIQUIDITY - 100);
    }

    function test_mint_revertsIfCallerNotAllowlisted() public {
        uint256 amount = 1000e18;
        tokenA.mint(bob, amount);
        tokenB.mint(bob, amount);

        vm.startPrank(bob);
        tokenA.approve(address(vault), amount);
        tokenB.approve(address(vault), amount);
        vm.expectRevert(AllowlistedUniswapV3Vault.RecipientNotAllowlisted.selector);
        vault.mint(0, amount, amount);
        vm.stopPrank();
    }

    function test_mint_succeedsIfCallerAllowlisted() public {
        vm.prank(alice);
        vault.setAllowlisted(bob, true);

        uint256 amount = 1000e18;
        tokenA.mint(bob, amount);
        tokenB.mint(bob, amount);

        vm.startPrank(bob);
        tokenA.approve(address(vault), amount);
        tokenB.approve(address(vault), amount);
        vault.mint(0, amount, amount);
        vm.stopPrank();

        assertTrue(vault.balanceOf(bob) > 0);
    }

    // ============ Admin functions ============

    function test_setAllowlisted_onlyAdmin() public {
        vm.prank(bob);
        vm.expectRevert(AllowlistedUniswapV3Vault.OnlyAllowlistAdmin.selector);
        vault.setAllowlisted(carol, true);
    }

    function test_setAllowlistedBatch() public {
        address[] memory accounts = new address[](2);
        accounts[0] = bob;
        accounts[1] = carol;

        vm.prank(alice);
        vault.setAllowlistedBatch(accounts, true);

        assertTrue(vault.allowlisted(bob));
        assertTrue(vault.allowlisted(carol));
    }

    function test_setAllowlistedBatch_onlyAdmin() public {
        address[] memory accounts = new address[](1);
        accounts[0] = bob;

        vm.prank(bob);
        vm.expectRevert(AllowlistedUniswapV3Vault.OnlyAllowlistAdmin.selector);
        vault.setAllowlistedBatch(accounts, true);
    }

    // ============ Admin transfer (two-step) ============

    function test_transferAllowlistAdmin_twoStep() public {
        // Step 1: Initiate transfer
        vm.prank(alice);
        vault.transferAllowlistAdmin(bob);
        assertEq(vault.pendingAllowlistAdmin(), bob);
        assertEq(vault.allowlistAdmin(), alice); // Still alice

        // Step 2: Accept
        vm.prank(bob);
        vault.acceptAllowlistAdmin();
        assertEq(vault.allowlistAdmin(), bob);
        assertEq(vault.pendingAllowlistAdmin(), address(0));
    }

    function test_transferAllowlistAdmin_onlyAdmin() public {
        vm.prank(bob);
        vm.expectRevert(AllowlistedUniswapV3Vault.OnlyAllowlistAdmin.selector);
        vault.transferAllowlistAdmin(carol);
    }

    function test_acceptAllowlistAdmin_onlyPending() public {
        vm.prank(alice);
        vault.transferAllowlistAdmin(bob);

        vm.prank(carol);
        vm.expectRevert(AllowlistedUniswapV3Vault.OnlyPendingAdmin.selector);
        vault.acceptAllowlistAdmin();
    }

    function test_transferAllowlistAdmin_cancelBySettingZero() public {
        vm.prank(alice);
        vault.transferAllowlistAdmin(bob);

        vm.expectEmit(true, false, false, false);
        emit AllowlistedUniswapV3Vault.AllowlistAdminTransferCancelled(alice);

        vm.prank(alice);
        vault.transferAllowlistAdmin(address(0));

        assertEq(vault.pendingAllowlistAdmin(), address(0));
    }

    // ============ Allowlist removal ============

    function test_removedFromAllowlist_retainsSharesCanBurn() public {
        // Give bob some shares
        vm.prank(alice);
        vault.setAllowlisted(bob, true);
        vm.prank(alice);
        vault.transfer(bob, 1000);

        // Remove bob from allowlist
        vm.prank(alice);
        vault.setAllowlisted(bob, false);

        // Bob can't receive more shares
        vm.prank(alice);
        vm.expectRevert(AllowlistedUniswapV3Vault.RecipientNotAllowlisted.selector);
        vault.transfer(bob, 100);

        // But bob can burn
        vm.prank(bob);
        vault.burn(500, 0, 0);
        assertEq(vault.balanceOf(bob), 500);
    }
}
