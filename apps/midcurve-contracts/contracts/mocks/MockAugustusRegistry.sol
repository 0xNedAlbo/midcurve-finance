// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockAugustusRegistry
 * @notice Mock Paraswap Augustus Registry for local testing
 * @dev Implements IAugustusRegistry interface with configurable valid addresses
 *
 * In production, the real AugustusRegistry validates that swap callers
 * are using legitimate Paraswap Augustus contracts. For local testing,
 * we need to register our MockAugustus as valid.
 */
contract MockAugustusRegistry {
    /// @notice Mapping of addresses that are valid Augustus swappers
    mapping(address => bool) public validAugustus;

    /**
     * @notice Register or unregister an Augustus address
     * @param augustus The address to configure
     * @param valid Whether the address should be considered valid
     */
    function setValidAugustus(address augustus, bool valid) external {
        validAugustus[augustus] = valid;
    }

    /**
     * @notice Check if an address is a valid Augustus swapper
     * @param augustus The address to check
     * @return True if the address is registered as valid
     */
    function isValidAugustus(address augustus) external view returns (bool) {
        return validAugustus[augustus];
    }
}
