// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

import {UniswapV3StakingVault} from "../../contracts/staking-vault/UniswapV3StakingVault.sol";
import {UniswapV3StakingVaultFactory} from
    "../../contracts/staking-vault/UniswapV3StakingVaultFactory.sol";

import {MockStakingNFPM, MockUniFactory} from "./mocks/MockStakingNFPM.sol";

contract UniswapV3StakingVaultFactoryTest is Test {
    UniswapV3StakingVault internal implementation;
    UniswapV3StakingVaultFactory internal factory;

    MockStakingNFPM internal nfpm;
    MockUniFactory internal uniFactory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event VaultCreated(address indexed owner, address indexed vault);

    function setUp() public {
        uniFactory = new MockUniFactory();
        nfpm = new MockStakingNFPM(address(uniFactory));
        implementation = new UniswapV3StakingVault(address(nfpm));
        factory = new UniswapV3StakingVaultFactory(address(implementation), address(nfpm));
    }

    // ============ Construction ============

    function test_constructor_storesAddresses() public view {
        assertEq(factory.implementation(), address(implementation));
        assertEq(factory.positionManager(), address(nfpm));
    }

    function test_constructor_revertsOnZeroImpl() public {
        vm.expectRevert(UniswapV3StakingVaultFactory.ZeroAddress.selector);
        new UniswapV3StakingVaultFactory(address(0), address(nfpm));
    }

    function test_constructor_revertsOnZeroNfpm() public {
        vm.expectRevert(UniswapV3StakingVaultFactory.ZeroAddress.selector);
        new UniswapV3StakingVaultFactory(address(implementation), address(0));
    }

    // ============ createVault ============

    function test_createVault_atomicallyDeploysAndInitializes() public {
        vm.prank(alice);
        address vaultAddr = factory.createVault();

        UniswapV3StakingVault v = UniswapV3StakingVault(vaultAddr);
        assertEq(v.owner(), alice);
        // initialize() must not be re-callable — proves it ran in createVault().
        vm.expectRevert(UniswapV3StakingVault.AlreadyInitialized.selector);
        v.initialize(bob);
    }

    function test_createVault_emitsEvent() public {
        // Address of next clone is deterministic-ish but let's just observe topic[0].
        vm.expectEmit(true, false, false, false, address(factory));
        emit VaultCreated(alice, address(0)); // vault address ignored in topic check
        vm.prank(alice);
        factory.createVault();
    }

    function test_createVault_distinctClonesPerCall() public {
        vm.prank(alice);
        address v1 = factory.createVault();
        vm.prank(alice);
        address v2 = factory.createVault();
        assertTrue(v1 != v2);
    }

    function test_createVault_perCaller_ownership() public {
        vm.prank(alice);
        address va = factory.createVault();
        vm.prank(bob);
        address vb = factory.createVault();
        assertEq(UniswapV3StakingVault(va).owner(), alice);
        assertEq(UniswapV3StakingVault(vb).owner(), bob);
    }
}
