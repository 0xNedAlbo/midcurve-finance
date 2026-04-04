// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {INonfungiblePositionManagerMinimal} from
    "../../../contracts/position-closer/interfaces/INonfungiblePositionManagerMinimal.sol";

/// @title MockNonfungiblePositionManager
/// @notice Simulates the Uniswap V3 NonfungiblePositionManager for vault testing.
/// @dev Tracks positions, handles ERC721 basics, and simulates liquidity/fee operations.
contract MockNonfungiblePositionManager {
    // ============ Position data ============

    struct Position {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    mapping(uint256 => Position) public _positions;
    mapping(uint256 => address) public _owners;
    mapping(uint256 => address) public _approvals;
    mapping(address => mapping(address => bool)) public _operatorApprovals;

    address public factory;

    constructor(address factory_) {
        factory = factory_;
    }

    // ============ Test helpers ============

    function createPosition(
        uint256 tokenId,
        address owner,
        address token0_,
        address token1_,
        uint24 fee_,
        int24 tickLower_,
        int24 tickUpper_,
        uint128 liquidity_
    ) external {
        _positions[tokenId] = Position({
            token0: token0_,
            token1: token1_,
            fee: fee_,
            tickLower: tickLower_,
            tickUpper: tickUpper_,
            liquidity: liquidity_,
            tokensOwed0: 0,
            tokensOwed1: 0
        });
        _owners[tokenId] = owner;
    }

    /// @notice Simulate fee accrual by adding to tokensOwed
    function accrueFeesForTesting(uint256 tokenId, uint128 fees0, uint128 fees1) external {
        _positions[tokenId].tokensOwed0 += fees0;
        _positions[tokenId].tokensOwed1 += fees1;
    }

    // ============ NFPM interface ============

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Position storage p = _positions[tokenId];
        return (
            0, // nonce
            address(0), // operator
            p.token0,
            p.token1,
            p.fee,
            p.tickLower,
            p.tickUpper,
            p.liquidity,
            0, // feeGrowthInside0LastX128
            0, // feeGrowthInside1LastX128
            p.tokensOwed0,
            p.tokensOwed1
        );
    }

    function increaseLiquidity(INonfungiblePositionManagerMinimal.IncreaseLiquidityParams calldata params)
        external
        payable
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        Position storage p = _positions[params.tokenId];

        // Simulate: consume desired amounts proportionally. For simplicity,
        // add liquidity equal to amount0Desired (test controls the setup).
        // In tests, amount0Desired and amount1Desired represent what the caller approved.
        // We consume a reasonable portion.
        uint128 currentL = p.liquidity;

        // Compute amounts to consume: for a balanced position, consume both equally.
        // For testing, we'll consume the desired amounts and add proportional liquidity.
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;

        // Calculate liquidity to add based on amounts (simplified: L = amount0 for testing)
        // In real Uniswap, liquidity is computed from sqrtPrice and tick range.
        // Here we use a simple heuristic: average of both amounts if both > 0.
        if (amount0 > 0 && amount1 > 0) {
            liquidity = uint128((amount0 + amount1) / 2);
        } else if (amount0 > 0) {
            liquidity = uint128(amount0);
        } else {
            liquidity = uint128(amount1);
        }

        p.liquidity += liquidity;

        // Pull tokens from caller (the vault contract)
        if (amount0 > 0) IERC20(p.token0).transferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) IERC20(p.token1).transferFrom(msg.sender, address(this), amount1);

        return (liquidity, amount0, amount1);
    }

    function decreaseLiquidity(INonfungiblePositionManagerMinimal.DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage p = _positions[params.tokenId];
        require(p.liquidity >= params.liquidity, "Not enough liquidity");

        p.liquidity -= params.liquidity;

        // Simulate: convert liquidity back to token amounts (split evenly for testing)
        amount0 = uint256(params.liquidity) / 2;
        amount1 = uint256(params.liquidity) / 2;

        // Principal goes to tokensOwed (like real NFPM)
        p.tokensOwed0 += uint128(amount0);
        p.tokensOwed1 += uint128(amount1);

        return (amount0, amount1);
    }

    function collect(INonfungiblePositionManagerMinimal.CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage p = _positions[params.tokenId];

        amount0 = p.tokensOwed0 > params.amount0Max ? params.amount0Max : p.tokensOwed0;
        amount1 = p.tokensOwed1 > params.amount1Max ? params.amount1Max : p.tokensOwed1;

        p.tokensOwed0 -= uint128(amount0);
        p.tokensOwed1 -= uint128(amount1);

        // Transfer tokens to recipient
        if (amount0 > 0) IERC20(p.token0).transfer(params.recipient, amount0);
        if (amount1 > 0) IERC20(p.token1).transfer(params.recipient, amount1);

        return (amount0, amount1);
    }

    // ============ ERC721 minimal ============

    function ownerOf(uint256 tokenId) external view returns (address) {
        return _owners[tokenId];
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(
            _owners[tokenId] == from
                && (msg.sender == from || _approvals[tokenId] == msg.sender || _operatorApprovals[from][msg.sender]),
            "Not authorized"
        );
        _owners[tokenId] = to;
        _approvals[tokenId] = address(0);
    }

    function approve(address to, uint256 tokenId) external {
        require(_owners[tokenId] == msg.sender, "Not owner");
        _approvals[tokenId] = to;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        return _approvals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operatorApprovals[owner][operator];
    }
}

/// @title MockUniswapV3Factory
/// @notice Minimal mock for getPool() calls
contract MockUniswapV3Factory {
    mapping(bytes32 => address) private _pools;

    function setPool(address token0, address token1, uint24 fee, address poolAddr) external {
        _pools[keccak256(abi.encode(token0, token1, fee))] = poolAddr;
    }

    function getPool(address token0, address token1, uint24 fee) external view returns (address) {
        return _pools[keccak256(abi.encode(token0, token1, fee))];
    }
}

/// @title MockUniswapV3Pool
/// @notice Minimal mock for slot0() calls
contract MockUniswapV3Pool {
    uint160 public sqrtPriceX96;
    int24 public currentTick;

    constructor(uint160 sqrtPriceX96_, int24 tick_) {
        sqrtPriceX96 = sqrtPriceX96_;
        currentTick = tick_;
    }

    function setPrice(uint160 sqrtPriceX96_, int24 tick_) external {
        sqrtPriceX96 = sqrtPriceX96_;
        currentTick = tick_;
    }

    function slot0()
        external
        view
        returns (
            uint160,
            int24,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        )
    {
        return (sqrtPriceX96, currentTick, 0, 0, 0, 0, true);
    }
}
