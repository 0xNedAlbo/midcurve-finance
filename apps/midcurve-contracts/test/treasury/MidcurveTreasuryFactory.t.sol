// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { MidcurveTreasury } from "../../contracts/treasury/MidcurveTreasury.sol";
import { MidcurveTreasuryFactory } from "../../contracts/treasury/MidcurveTreasuryFactory.sol";
import { IMidcurveTreasury } from "../../contracts/treasury/interfaces/IMidcurveTreasury.sol";
import { MockWETH, MockSwapRouter } from "./MidcurveTreasury.t.sol";

contract MidcurveTreasuryFactoryTest is Test {
    MidcurveTreasury public implementation;
    MidcurveTreasuryFactory public factory;
    MockWETH public mockWeth;
    MockSwapRouter public mockRouter;

    address public admin = makeAddr("admin");
    address public operatorAddr = makeAddr("operator");
    address public newOperator = makeAddr("newOperator");
    address public stranger = makeAddr("stranger");

    event TreasuryDeployed(
        address indexed treasury, address indexed admin, address indexed operator, address deployer
    );

    function setUp() public {
        mockWeth = new MockWETH();
        mockRouter = new MockSwapRouter(address(mockWeth));

        implementation = new MidcurveTreasury(address(mockRouter), address(mockWeth));
        factory = new MidcurveTreasuryFactory(address(implementation));
    }

    // ============================================================================
    // Construction
    // ============================================================================

    function test_constructor_setsImplementation() public view {
        assertEq(factory.implementation(), address(implementation));
    }

    function test_constructor_revertsOnZeroImplementation() public {
        vm.expectRevert(MidcurveTreasuryFactory.ZeroAddress.selector);
        new MidcurveTreasuryFactory(address(0));
    }

    function test_views_passThroughChainFacts() public view {
        assertEq(factory.weth(), address(mockWeth));
        assertEq(factory.swapRouter(), address(mockRouter));
    }

    // ============================================================================
    // createTreasury
    // ============================================================================

    function test_createTreasury_deploysInitializedClone() public {
        address treasury = factory.createTreasury(admin, operatorAddr);

        assertGt(treasury.code.length, 0);
        assertEq(MidcurveTreasury(payable(treasury)).admin(), admin);
        assertEq(MidcurveTreasury(payable(treasury)).operator(), operatorAddr);
        assertEq(MidcurveTreasury(payable(treasury)).weth(), address(mockWeth));
        assertEq(address(MidcurveTreasury(payable(treasury)).swapRouter()), address(mockRouter));
    }

    /// @dev An EIP-1167 clone is 45 bytes of runtime code. This is what the block explorers
    ///      pattern-match on to resolve the implementation and serve its ABI at this address.
    function test_createTreasury_deploysMinimalProxy() public {
        address treasury = factory.createTreasury(admin, operatorAddr);
        assertEq(treasury.code.length, 45);
    }

    function test_createTreasury_emitsEvent() public {
        address predicted = factory.predictTreasury(admin, operatorAddr);

        vm.expectEmit(true, true, true, true);
        emit TreasuryDeployed(predicted, admin, operatorAddr, address(this));
        factory.createTreasury(admin, operatorAddr);
    }

    function test_createTreasury_matchesPrediction() public {
        address predicted = factory.predictTreasury(admin, operatorAddr);
        assertEq(factory.createTreasury(admin, operatorAddr), predicted);
    }

    function test_createTreasury_differentOperatorGivesDifferentAddress() public {
        assertTrue(
            factory.predictTreasury(admin, operatorAddr) != factory.predictTreasury(admin, newOperator)
        );
    }

    function test_createTreasury_revertsOnZeroAdmin() public {
        vm.expectRevert(MidcurveTreasuryFactory.ZeroAddress.selector);
        factory.createTreasury(address(0), operatorAddr);
    }

    function test_createTreasury_revertsOnZeroOperator() public {
        vm.expectRevert(MidcurveTreasuryFactory.ZeroAddress.selector);
        factory.createTreasury(admin, address(0));
    }

    /// @dev A resumed or retried kickstart must not revert and must not produce a second
    ///      instance. This is what makes the deploy step safe to press twice.
    function test_createTreasury_isIdempotent() public {
        address first = factory.createTreasury(admin, operatorAddr);
        address second = factory.createTreasury(admin, operatorAddr);

        assertEq(second, first);
        assertEq(factory.treasuriesOf(admin).length, 1);
    }

    // ============================================================================
    // isTreasury — the identity test
    // ============================================================================

    function test_isTreasury_attestsWhatItCreated() public {
        address treasury = factory.createTreasury(admin, operatorAddr);
        assertTrue(factory.isTreasury(treasury));
    }

    function test_isTreasury_falseForUnknownAddress() public view {
        assertFalse(factory.isTreasury(stranger));
        assertFalse(factory.isTreasury(address(implementation)));
    }

    /// @dev A clone of our implementation that this factory did not create is somebody else's
    ///      contract, however identical its bytecode.
    function test_isTreasury_falseForForeignClone() public {
        address foreign = Clones.clone(address(implementation));
        MidcurveTreasury(payable(foreign)).initialize(admin, operatorAddr);

        assertFalse(factory.isTreasury(foreign));
    }

    /// @dev THE POINT OF THE MAPPING. setOperator() is the repair for a stale operator binding,
    ///      and it moves the predicted address. Provenance must not move with it, or the repair
    ///      would make the treasury impossible to re-register.
    function test_isTreasury_survivesSetOperator() public {
        address treasury = factory.createTreasury(admin, operatorAddr);

        vm.prank(admin);
        MidcurveTreasury(payable(treasury)).setOperator(newOperator);

        assertTrue(factory.isTreasury(treasury));
        // The prediction has moved; the attestation has not.
        assertTrue(factory.predictTreasury(admin, newOperator) != treasury);
    }

    function test_isTreasury_survivesTransferAdmin() public {
        address treasury = factory.createTreasury(admin, operatorAddr);

        vm.prank(admin);
        MidcurveTreasury(payable(treasury)).transferAdmin(stranger);

        assertTrue(factory.isTreasury(treasury));
    }

    // ============================================================================
    // treasuriesOf — discovery for a caller that lost the address
    // ============================================================================

    function test_treasuriesOf_emptyForUnknownAdmin() public view {
        assertEq(factory.treasuriesOf(stranger).length, 0);
    }

    function test_treasuriesOf_recordsCreatedInstance() public {
        address treasury = factory.createTreasury(admin, operatorAddr);

        address[] memory found = factory.treasuriesOf(admin);
        assertEq(found.length, 1);
        assertEq(found[0], treasury);
    }

    /// @dev The recovery case: the row is gone, the operator has since been rotated, so the
    ///      predicted address no longer points at the live instance. Discovery must still find
    ///      it, or the flow would deploy a second treasury and strand the first.
    function test_treasuriesOf_findsInstanceAfterOperatorRotation() public {
        address treasury = factory.createTreasury(admin, operatorAddr);

        vm.prank(admin);
        MidcurveTreasury(payable(treasury)).setOperator(newOperator);

        assertEq(factory.predictTreasury(admin, newOperator).code.length, 0);

        address[] memory found = factory.treasuriesOf(admin);
        assertEq(found.length, 1);
        assertEq(found[0], treasury);
        assertEq(MidcurveTreasury(payable(found[0])).operator(), newOperator);
    }

    /// @dev The salt is keyed on (admin, operator), so one admin can hold more than one instance
    ///      on a chain. An array rather than a single slot is what keeps the first one findable.
    function test_treasuriesOf_holdsBothInstancesForOneAdmin() public {
        address first = factory.createTreasury(admin, operatorAddr);
        address second = factory.createTreasury(admin, newOperator);

        assertTrue(first != second);

        address[] memory found = factory.treasuriesOf(admin);
        assertEq(found.length, 2);
        assertEq(found[0], first);
        assertEq(found[1], second);
    }

    function test_treasuriesOf_separatesAdmins() public {
        factory.createTreasury(admin, operatorAddr);
        factory.createTreasury(stranger, operatorAddr);

        assertEq(factory.treasuriesOf(admin).length, 1);
        assertEq(factory.treasuriesOf(stranger).length, 1);
    }

    // ============================================================================
    // Claiming
    // ============================================================================

    /// @dev Deploy and initialize are one transaction, so there is no window in which a third
    ///      party can claim an instance somebody else deployed. A front-runner supplying the same
    ///      arguments produces exactly the instance that was wanted, and pays for it.
    function test_createTreasury_frontRunnerProducesTheSameInstance() public {
        address predicted = factory.predictTreasury(admin, operatorAddr);

        vm.prank(stranger);
        address treasury = factory.createTreasury(admin, operatorAddr);

        assertEq(treasury, predicted);
        assertEq(MidcurveTreasury(payable(treasury)).admin(), admin);
        assertEq(MidcurveTreasury(payable(treasury)).operator(), operatorAddr);
    }

    function test_createTreasury_cannotBeReinitializedByAnyone() public {
        address treasury = factory.createTreasury(admin, operatorAddr);

        vm.prank(stranger);
        vm.expectRevert(IMidcurveTreasury.AlreadyInitialized.selector);
        MidcurveTreasury(payable(treasury)).initialize(stranger, stranger);
    }
}
