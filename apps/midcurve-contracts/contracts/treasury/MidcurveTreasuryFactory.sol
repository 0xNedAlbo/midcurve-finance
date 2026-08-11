// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { MidcurveTreasury } from "./MidcurveTreasury.sol";

/// @title MidcurveTreasuryFactory
/// @notice Deploys EIP-1167 clones of MidcurveTreasury, one per environment per chain.
/// @dev Shared infrastructure, exactly like the position closers: deployed once per chain by the
///      publisher, verified once, recorded in deployments/*.json, seeded into shared_contracts.
///
///      Why a factory at all: a treasury deployed by a raw CREATE from the browser lands at an
///      unpredictable address and is verified on no block explorer, which leaves its onlyAdmin
///      functions — sweep, rescueEth, setOperator, transferAdmin — reachable only by hand-encoding
///      calldata. Etherscan-family explorers resolve an EIP-1167 clone to its implementation and
///      serve the implementation's verified source and ABI at the clone's address, so verifying
///      the implementation once per chain gives every instance a working Read/Write surface with
///      no per-instance verification step by anyone.
///
///      IDENTITY VS PREDICTION. Two separate jobs, deliberately not served by one mechanism:
///
///      - `predictTreasury` exists so the backend knows the address before the transaction is
///        sent. It is a deploy-time convenience and nothing more.
///      - `isTreasury` is the identity test. It is written once at creation and never cleared, so
///        it survives setOperator(), transferAdmin(), and any later change to the environment's
///        configuration.
///
///      These must not be conflated. The salt is derived from (admin, operator), so the predicted
///      address moves the moment setOperator() is called — which is the repair this whole design
///      exists to make reachable. Anything that treats "re-derivable from today's configuration"
///      as proof of provenance would reject a repaired treasury permanently.
contract MidcurveTreasuryFactory {
    // ============================================================================
    // Immutables
    // ============================================================================

    /// @notice The MidcurveTreasury implementation every clone delegates to.
    address public immutable implementation;

    // ============================================================================
    // Registry
    // ============================================================================

    /// @notice Attestation that this factory created an address. Never cleared.
    /// @dev The identity test for treasury registration. Deliberately independent of admin and
    ///      operator, both of which can change over an instance's life.
    mapping(address => bool) public isTreasury;

    /// @dev Instances created for an admin. An array rather than a single slot because the salt
    ///      is keyed on (admin, operator): one admin can hold more than one instance on a chain,
    ///      and a single slot would silently overwrite the first.
    mapping(address => address[]) private _treasuriesOfAdmin;

    // ============================================================================
    // Events
    // ============================================================================

    /// @notice Emitted once per instance actually created. Makes deployed treasuries discoverable
    ///         from chain data rather than only from the deploying user's transaction history.
    event TreasuryDeployed(
        address indexed treasury, address indexed admin, address indexed operator, address deployer
    );

    // ============================================================================
    // Errors
    // ============================================================================

    error ZeroAddress();

    // ============================================================================
    // Constructor
    // ============================================================================

    /// @param implementation_ MidcurveTreasury implementation for this chain, already bound to the
    ///        chain's swap router and WETH by its own constructor.
    constructor(address implementation_) {
        if (implementation_ == address(0)) revert ZeroAddress();
        implementation = implementation_;
    }

    // ============================================================================
    // Views
    // ============================================================================

    /// @notice The swap router every clone from this factory uses, read off the implementation.
    function swapRouter() external view returns (address) {
        return address(MidcurveTreasury(payable(implementation)).swapRouter());
    }

    /// @notice The WETH every clone from this factory uses, read off the implementation.
    function weth() external view returns (address) {
        return MidcurveTreasury(payable(implementation)).weth();
    }

    /// @notice The address createTreasury would produce for this admin and operator.
    /// @dev Deploy-time convenience only — see the identity note on the contract. Not a
    ///      provenance test: the result moves when the operator changes.
    function predictTreasury(address admin_, address operator_) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(admin_, operator_));
    }

    /// @notice Every instance this factory created for an admin, oldest first.
    /// @dev Lets a caller that has lost its record of the address find it again without a log
    ///      scan, and without depending on the operator having stayed the same.
    function treasuriesOf(address admin_) external view returns (address[] memory) {
        return _treasuriesOfAdmin[admin_];
    }

    // ============================================================================
    // Factory
    // ============================================================================

    /// @notice Deploy and initialize a treasury for an admin and operator.
    /// @dev Clone and initialize happen in one transaction, so there is no window in which a
    ///      third party could claim an instance somebody else deployed. Idempotent: a second call
    ///      with the same arguments returns the existing instance instead of reverting, which is
    ///      what makes a resumed or retried kickstart safe.
    /// @param admin_ The environment's configured admin — never the deploying user
    /// @param operator_ The environment's operator wallet
    /// @return treasury The instance address, newly created or already existing
    function createTreasury(address admin_, address operator_) external returns (address treasury) {
        if (admin_ == address(0)) revert ZeroAddress();
        if (operator_ == address(0)) revert ZeroAddress();

        bytes32 salt = _salt(admin_, operator_);
        address predicted = Clones.predictDeterministicAddress(implementation, salt);
        if (predicted.code.length > 0) {
            return predicted;
        }

        treasury = Clones.cloneDeterministic(implementation, salt);
        MidcurveTreasury(payable(treasury)).initialize(admin_, operator_);

        isTreasury[treasury] = true;
        _treasuriesOfAdmin[admin_].push(treasury);

        emit TreasuryDeployed(treasury, admin_, operator_, msg.sender);
    }

    // ============================================================================
    // Internal
    // ============================================================================

    function _salt(address admin_, address operator_) private pure returns (bytes32) {
        return keccak256(abi.encode(admin_, operator_));
    }
}
