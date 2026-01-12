// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAugustusRegistry
 * @notice Interface for Paraswap's AugustusRegistry contract
 * @dev Used to verify that an Augustus swapper address is legitimate
 *
 * Registry addresses by chain:
 * - Ethereum (1):    0xa68bEA62Dc4034A689AA0F58A76681433caCa663
 * - Arbitrum (42161): 0xdC6E2b14260F972ad4e5a31c68294Fba7E720701
 * - Base (8453):     0x7e31b336f9e8ba52ba3c4ac861b033ba90900bb3
 * - Optimism (10):   0x6e7bE86000dF697facF4396efD2aE2C322165dC3
 */
interface IAugustusRegistry {
    /**
     * @notice Check if an address is a valid Augustus swapper
     * @param augustus The address to check
     * @return True if the address is a valid Augustus swapper
     */
    function isValidAugustus(address augustus) external view returns (bool);
}

/**
 * @title IAugustus
 * @notice Interface for Paraswap's Augustus swapper contract (V5)
 * @dev Used to get the TokenTransferProxy address for approvals
 */
interface IAugustus {
    /**
     * @notice Get the TokenTransferProxy address
     * @dev This is the address that needs token approval for swaps
     * @return The TokenTransferProxy address
     */
    function getTokenTransferProxy() external view returns (address);
}
