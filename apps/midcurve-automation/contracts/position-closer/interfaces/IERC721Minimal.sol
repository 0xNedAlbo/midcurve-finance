// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IERC721Minimal
/// @notice Minimal ERC721 interface for NFT operations
interface IERC721Minimal {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}
