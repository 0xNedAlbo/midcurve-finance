// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {AllowlistedUniswapV3Vault} from "../../contracts/vault/AllowlistedUniswapV3Vault.sol";
import {MintParams, BurnParams} from "../../contracts/vault/interfaces/IMultiTokenVault.sol";
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
    address public operator_ = makeAddr("operator");

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
            address(nfpm), TOKEN_ID, "Allowlisted Vault", "AVLT", 6, alice, operator_, alice
        );
    }

    // ============ Helpers ============

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

    // ============ Initialization ============

    function test_initialize_setsAdmin() public view {
        assertEq(vault.allowlistAdmin(), alice);
    }

    function test_initialize_allowlistsAdminAndRecipient() public view {
        assertTrue(vault.isAllowlisted(alice));
    }

    function test_initialize_allowlistEnabled() public view {
        assertTrue(vault.allowlistEnabled());
    }

    function test_initialize_base7ParamRevertsOnAllowlisted() public {
        AllowlistedUniswapV3Vault v2 = AllowlistedUniswapV3Vault(Clones.clone(address(implementation)));
        vm.expectRevert("Use allowlisted initialize");
        AllowlistedUniswapV3Vault(address(v2)).initialize(
            address(nfpm), TOKEN_ID, "X", "Y", 18, alice, operator_
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
        vault.addToAllowlist(bob);

        vm.prank(alice);
        vault.transfer(bob, 100);

        assertEq(vault.balanceOf(bob), 100);
    }

    function test_burn_alwaysPermittedEvenIfNotAllowlisted() public {
        // Remove alice from allowlist
        vm.prank(alice);
        vault.removeFromAllowlist(alice);

        // Alice can still burn
        vm.prank(alice);
        vault.burn(100, _burnParams(0, 0, alice));

        assertEq(vault.balanceOf(alice), INITIAL_LIQUIDITY - 100);
    }

    function test_mint_revertsIfRecipientNotAllowlisted() public {
        uint256 amount = 1000e18;
        tokenA.mint(bob, amount);
        tokenB.mint(bob, amount);

        vm.startPrank(bob);
        tokenA.approve(address(vault), amount);
        tokenB.approve(address(vault), amount);
        vm.expectRevert(AllowlistedUniswapV3Vault.RecipientNotAllowlisted.selector);
        vault.mint(0, _mintParams(amount, amount, bob));
        vm.stopPrank();
    }

    function test_mint_succeedsIfRecipientAllowlisted() public {
        vm.prank(alice);
        vault.addToAllowlist(bob);

        uint256 amount = 1000e18;
        tokenA.mint(bob, amount);
        tokenB.mint(bob, amount);

        vm.startPrank(bob);
        tokenA.approve(address(vault), amount);
        tokenB.approve(address(vault), amount);
        vault.mint(0, _mintParams(amount, amount, bob));
        vm.stopPrank();

        assertTrue(vault.balanceOf(bob) > 0);
    }

    // ============ Admin functions ============

    function test_addToAllowlist_onlyAdmin() public {
        vm.prank(bob);
        vm.expectRevert(AllowlistedUniswapV3Vault.OnlyAllowlistAdmin.selector);
        vault.addToAllowlist(carol);
    }

    function test_removeFromAllowlist_onlyAdmin() public {
        vm.prank(bob);
        vm.expectRevert(AllowlistedUniswapV3Vault.OnlyAllowlistAdmin.selector);
        vault.removeFromAllowlist(alice);
    }

    function test_addToAllowlist_works() public {
        vm.prank(alice);
        vault.addToAllowlist(bob);
        assertTrue(vault.isAllowlisted(bob));
    }

    function test_removeFromAllowlist_works() public {
        vm.prank(alice);
        vault.addToAllowlist(bob);
        assertTrue(vault.isAllowlisted(bob));

        vm.prank(alice);
        vault.removeFromAllowlist(bob);
        assertFalse(vault.isAllowlisted(bob));
    }

    // ============ Admin transfer (one-step) ============

    function test_transferAllowlistAdmin_oneStep() public {
        vm.prank(alice);
        vault.transferAllowlistAdmin(bob);

        assertEq(vault.allowlistAdmin(), bob);
    }

    function test_transferAllowlistAdmin_onlyAdmin() public {
        vm.prank(bob);
        vm.expectRevert(AllowlistedUniswapV3Vault.OnlyAllowlistAdmin.selector);
        vault.transferAllowlistAdmin(carol);
    }

    function test_transferAllowlistAdmin_renounceToZero() public {
        vm.prank(alice);
        vault.transferAllowlistAdmin(address(0));

        assertEq(vault.allowlistAdmin(), address(0));

        // No one can manage the allowlist anymore
        vm.prank(alice);
        vm.expectRevert(AllowlistedUniswapV3Vault.OnlyAllowlistAdmin.selector);
        vault.addToAllowlist(bob);
    }

    // ============ Disable allowlist ============

    function test_disableAllowlist() public {
        vm.prank(alice);
        vault.disableAllowlist();

        assertFalse(vault.allowlistEnabled());
        // Everyone is now allowlisted
        assertTrue(vault.isAllowlisted(bob));
        assertTrue(vault.isAllowlisted(carol));
    }

    function test_disableAllowlist_irreversible() public {
        vm.prank(alice);
        vault.disableAllowlist();

        // Cannot add to allowlist when disabled
        vm.prank(alice);
        vm.expectRevert(AllowlistedUniswapV3Vault.AllowlistAlreadyDisabled.selector);
        vault.addToAllowlist(bob);

        // Cannot remove from allowlist when disabled
        vm.prank(alice);
        vm.expectRevert(AllowlistedUniswapV3Vault.AllowlistAlreadyDisabled.selector);
        vault.removeFromAllowlist(alice);

        // Cannot disable again
        vm.prank(alice);
        vm.expectRevert(AllowlistedUniswapV3Vault.AllowlistAlreadyDisabled.selector);
        vault.disableAllowlist();
    }

    function test_disableAllowlist_onlyAdmin() public {
        vm.prank(bob);
        vm.expectRevert(AllowlistedUniswapV3Vault.OnlyAllowlistAdmin.selector);
        vault.disableAllowlist();
    }

    function test_disableAllowlist_opensTransfers() public {
        vm.prank(alice);
        vault.disableAllowlist();

        // Bob was never allowlisted, but can now receive shares
        vm.prank(alice);
        vault.transfer(bob, 100);
        assertEq(vault.balanceOf(bob), 100);
    }

    // ============ isAllowlisted ============

    function test_isAllowlisted_alwaysTrueForAddressZero() public view {
        assertTrue(vault.isAllowlisted(address(0)));
    }

    // ============ Allowlist removal ============

    function test_removedFromAllowlist_retainsSharesCanBurn() public {
        vm.prank(alice);
        vault.addToAllowlist(bob);
        vm.prank(alice);
        vault.transfer(bob, 1000);

        vm.prank(alice);
        vault.removeFromAllowlist(bob);

        // Bob can't receive more shares
        vm.prank(alice);
        vm.expectRevert(AllowlistedUniswapV3Vault.RecipientNotAllowlisted.selector);
        vault.transfer(bob, 100);

        // But bob can burn
        vm.prank(bob);
        vault.burn(500, _burnParams(0, 0, bob));
        assertEq(vault.balanceOf(bob), 500);
    }
}
