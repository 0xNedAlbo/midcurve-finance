// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/libraries/ResourceIds.sol";

contract ResourceIdsTest is Test {
    function test_poolId_generatesConsistentHash() public pure {
        bytes32 id1 = ResourceIds.poolId(1, address(0x1234));
        bytes32 id2 = ResourceIds.poolId(1, address(0x1234));

        assertEq(id1, id2, "Same inputs should generate same ID");
    }

    function test_poolId_differentChainId_differentHash() public pure {
        bytes32 id1 = ResourceIds.poolId(1, address(0x1234));
        bytes32 id2 = ResourceIds.poolId(42, address(0x1234));

        assertTrue(id1 != id2, "Different chainIds should generate different IDs");
    }

    function test_poolId_differentAddress_differentHash() public pure {
        bytes32 id1 = ResourceIds.poolId(1, address(0x1234));
        bytes32 id2 = ResourceIds.poolId(1, address(0x5678));

        assertTrue(id1 != id2, "Different addresses should generate different IDs");
    }

    function test_poolId_matchesExpectedFormat() public pure {
        // Verify the hash matches expected format: "uniswapv3:{chainId}:{poolAddress}"
        bytes32 expected = keccak256(abi.encodePacked("uniswapv3:", uint256(1), ":", address(0x1234)));
        bytes32 actual = ResourceIds.poolId(1, address(0x1234));

        assertEq(actual, expected, "Hash should match expected format");
    }

    function test_positionId_generatesConsistentHash() public pure {
        bytes32 id1 = ResourceIds.positionId(1, 12345);
        bytes32 id2 = ResourceIds.positionId(1, 12345);

        assertEq(id1, id2, "Same inputs should generate same ID");
    }

    function test_positionId_differentChainId_differentHash() public pure {
        bytes32 id1 = ResourceIds.positionId(1, 12345);
        bytes32 id2 = ResourceIds.positionId(42, 12345);

        assertTrue(id1 != id2, "Different chainIds should generate different IDs");
    }

    function test_positionId_differentTokenId_differentHash() public pure {
        bytes32 id1 = ResourceIds.positionId(1, 12345);
        bytes32 id2 = ResourceIds.positionId(1, 67890);

        assertTrue(id1 != id2, "Different tokenIds should generate different IDs");
    }

    function test_positionId_matchesExpectedFormat() public pure {
        // Verify the hash matches expected format: "uniswapv3:{chainId}:{nftTokenId}"
        bytes32 expected = keccak256(abi.encodePacked("uniswapv3:", uint256(1), ":", uint256(12345)));
        bytes32 actual = ResourceIds.positionId(1, 12345);

        assertEq(actual, expected, "Hash should match expected format");
    }

    function test_marketId_generatesConsistentHash() public pure {
        bytes32 id1 = ResourceIds.marketId("ETH", "USD");
        bytes32 id2 = ResourceIds.marketId("ETH", "USD");

        assertEq(id1, id2, "Same inputs should generate same ID");
    }

    function test_marketId_differentBase_differentHash() public pure {
        bytes32 id1 = ResourceIds.marketId("ETH", "USD");
        bytes32 id2 = ResourceIds.marketId("BTC", "USD");

        assertTrue(id1 != id2, "Different base symbols should generate different IDs");
    }

    function test_marketId_differentQuote_differentHash() public pure {
        bytes32 id1 = ResourceIds.marketId("ETH", "USD");
        bytes32 id2 = ResourceIds.marketId("ETH", "EUR");

        assertTrue(id1 != id2, "Different quote symbols should generate different IDs");
    }

    function test_marketId_matchesExpectedFormat() public pure {
        // Verify the hash matches expected format: "{base}/{quote}"
        bytes32 expected = keccak256(abi.encodePacked("ETH", "/", "USD"));
        bytes32 actual = ResourceIds.marketId("ETH", "USD");

        assertEq(actual, expected, "Hash should match expected format");
    }

    function test_poolId_positionId_areDistinct() public pure {
        // Even with same chain and "address" value, pool and position IDs should differ
        // because position uses NFT token ID (uint256) while pool uses address
        bytes32 poolId = ResourceIds.poolId(1, address(0x1234));
        bytes32 posId = ResourceIds.positionId(1, 0x1234);

        assertTrue(poolId != posId, "Pool and position IDs should be distinct");
    }
}
