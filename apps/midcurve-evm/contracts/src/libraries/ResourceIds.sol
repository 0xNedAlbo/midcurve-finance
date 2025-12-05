// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ResourceIds
 * @notice Library for generating consistent resource identifiers
 * @dev Resource IDs are used to identify pools, positions, and markets across the system
 *
 * ID Formats (as human-readable strings before hashing):
 * - poolId: "uniswapv3:{chainId}:{poolAddress}"
 * - positionId: "uniswapv3:{chainId}:{nftTokenId}"
 * - marketId: "{base}/{quote}"
 */
library ResourceIds {
    /**
     * @notice Generate a pool ID for a Uniswap V3 pool
     * @param chainId The chain ID where the pool exists
     * @param poolAddress The address of the pool contract
     * @return The bytes32 pool identifier
     */
    function poolId(uint256 chainId, address poolAddress) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("uniswapv3:", chainId, ":", poolAddress));
    }

    /**
     * @notice Generate a position ID for a Uniswap V3 position
     * @param chainId The chain ID where the position exists
     * @param nftTokenId The NFT token ID of the position
     * @return The bytes32 position identifier
     */
    function positionId(uint256 chainId, uint256 nftTokenId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("uniswapv3:", chainId, ":", nftTokenId));
    }

    /**
     * @notice Generate a market ID for a trading pair
     * @param base The base asset symbol (e.g., "ETH")
     * @param quote The quote asset symbol (e.g., "USD")
     * @return The bytes32 market identifier
     */
    function marketId(string memory base, string memory quote) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(base, "/", quote));
    }
}
