// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {UniswapV3Vault} from "../../contracts/vault/UniswapV3Vault.sol";
import {AllowlistedUniswapV3Vault} from "../../contracts/vault/AllowlistedUniswapV3Vault.sol";
import {UniswapV3VaultFactory} from "../../contracts/vault/UniswapV3VaultFactory.sol";
import {
    MockNonfungiblePositionManager,
    MockUniswapV3Factory,
    MockUniswapV3Pool
} from "./mocks/MockNonfungiblePositionManager.sol";

contract MockERC20F is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UniswapV3VaultFactoryTest is Test {
    UniswapV3VaultFactory public factory;
    UniswapV3Vault public baseImpl;
    AllowlistedUniswapV3Vault public allowlistedImpl;

    MockNonfungiblePositionManager public nfpm;
    MockUniswapV3Factory public uniFactory;
    MockUniswapV3Pool public pool;
    MockERC20F public tokenA;
    MockERC20F public tokenB;

    address public alice = makeAddr("alice");
    address public operator_ = makeAddr("operator");

    uint256 public constant TOKEN_ID_1 = 42;
    uint256 public constant TOKEN_ID_2 = 43;
    uint128 public constant INITIAL_LIQUIDITY = 1_000_000;
    uint24 public constant FEE = 3000;
    int24 public constant TICK_LOWER = -887220;
    int24 public constant TICK_UPPER = 887220;
    uint160 public constant SQRT_PRICE_X96 = 79228162514264337593543950336;

    function setUp() public {
        uniFactory = new MockUniswapV3Factory();
        nfpm = new MockNonfungiblePositionManager(address(uniFactory));
        tokenA = new MockERC20F("Token A", "TKNA");
        tokenB = new MockERC20F("Token B", "TKNB");
        pool = new MockUniswapV3Pool(SQRT_PRICE_X96, 0);

        uniFactory.setPool(address(tokenA), address(tokenB), FEE, address(pool));

        tokenA.mint(address(nfpm), 100_000_000e18);
        tokenB.mint(address(nfpm), 100_000_000e18);

        nfpm.createPosition(
            TOKEN_ID_1, alice, address(tokenA), address(tokenB), FEE, TICK_LOWER, TICK_UPPER, INITIAL_LIQUIDITY
        );
        nfpm.createPosition(
            TOKEN_ID_2, alice, address(tokenA), address(tokenB), FEE, TICK_LOWER, TICK_UPPER, INITIAL_LIQUIDITY
        );

        baseImpl = new UniswapV3Vault();
        allowlistedImpl = new AllowlistedUniswapV3Vault();
        factory = new UniswapV3VaultFactory(address(baseImpl), address(allowlistedImpl), address(nfpm));
    }

    // ============ Constructor ============

    function test_constructor_setsImmutables() public view {
        assertEq(factory.baseVaultImplementation(), address(baseImpl));
        assertEq(factory.allowlistedVaultImplementation(), address(allowlistedImpl));
        assertEq(factory.positionManager(), address(nfpm));
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(UniswapV3VaultFactory.ZeroAddress.selector);
        new UniswapV3VaultFactory(address(0), address(allowlistedImpl), address(nfpm));

        vm.expectRevert(UniswapV3VaultFactory.ZeroAddress.selector);
        new UniswapV3VaultFactory(address(baseImpl), address(0), address(nfpm));

        vm.expectRevert(UniswapV3VaultFactory.ZeroAddress.selector);
        new UniswapV3VaultFactory(address(baseImpl), address(allowlistedImpl), address(0));
    }

    // ============ createVault ============

    function test_createVault_deploysAndInitializes() public {
        vm.startPrank(alice);
        nfpm.approve(address(factory), TOKEN_ID_1);

        address vault = factory.createVault(TOKEN_ID_1, "Test Vault", "TV", 6, operator_);
        vm.stopPrank();

        UniswapV3Vault v = UniswapV3Vault(vault);
        assertEq(v.name(), "Test Vault");
        assertEq(v.symbol(), "TV");
        assertEq(v.decimals(), 6);
        assertEq(v.tokenId(), TOKEN_ID_1);
        assertEq(v.totalSupply(), INITIAL_LIQUIDITY);
        assertEq(v.balanceOf(alice), INITIAL_LIQUIDITY);
        assertEq(v.operator(), operator_);
        assertEq(nfpm.ownerOf(TOKEN_ID_1), vault);
    }

    function test_createVault_emitsEvent() public {
        vm.startPrank(alice);
        nfpm.approve(address(factory), TOKEN_ID_1);

        vm.expectEmit(false, true, true, true);
        emit UniswapV3VaultFactory.VaultCreated(address(0), alice, TOKEN_ID_1, false);

        factory.createVault(TOKEN_ID_1, "Test Vault", "TV", 6, operator_);
        vm.stopPrank();
    }

    function test_createVault_revertsWithoutApproval() public {
        vm.prank(alice);
        vm.expectRevert("Not authorized");
        factory.createVault(TOKEN_ID_1, "Test Vault", "TV", 6, operator_);
    }

    // ============ createAllowlistedVault ============

    function test_createAllowlistedVault_deploysAndInitializes() public {
        vm.startPrank(alice);
        nfpm.approve(address(factory), TOKEN_ID_2);

        address vault = factory.createAllowlistedVault(TOKEN_ID_2, "AL Vault", "ALV", 6, operator_, alice);
        vm.stopPrank();

        AllowlistedUniswapV3Vault v = AllowlistedUniswapV3Vault(vault);
        assertEq(v.name(), "AL Vault");
        assertEq(v.symbol(), "ALV");
        assertEq(v.allowlistAdmin(), alice);
        assertTrue(v.isAllowlisted(alice));
        assertTrue(v.allowlistEnabled());
        assertEq(v.operator(), operator_);
        assertEq(v.totalSupply(), INITIAL_LIQUIDITY);
        assertEq(v.balanceOf(alice), INITIAL_LIQUIDITY);
    }

    function test_createAllowlistedVault_emitsEvent() public {
        vm.startPrank(alice);
        nfpm.approve(address(factory), TOKEN_ID_2);

        vm.expectEmit(false, true, true, true);
        emit UniswapV3VaultFactory.VaultCreated(address(0), alice, TOKEN_ID_2, true);

        factory.createAllowlistedVault(TOKEN_ID_2, "AL Vault", "ALV", 6, operator_, alice);
        vm.stopPrank();
    }

    // ============ Multiple deployments ============

    function test_multipleVaults_eachIsIndependent() public {
        vm.startPrank(alice);
        nfpm.approve(address(factory), TOKEN_ID_1);
        nfpm.approve(address(factory), TOKEN_ID_2);

        address vault1 = factory.createVault(TOKEN_ID_1, "Vault 1", "V1", 6, operator_);
        address vault2 = factory.createVault(TOKEN_ID_2, "Vault 2", "V2", 12, operator_);
        vm.stopPrank();

        assertTrue(vault1 != vault2);
        assertEq(UniswapV3Vault(vault1).name(), "Vault 1");
        assertEq(UniswapV3Vault(vault2).name(), "Vault 2");
        assertEq(UniswapV3Vault(vault1).tokenId(), TOKEN_ID_1);
        assertEq(UniswapV3Vault(vault2).tokenId(), TOKEN_ID_2);
    }
}
