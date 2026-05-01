// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {INonfungiblePositionManagerMinimal} from
    "../../../contracts/interfaces/INonfungiblePositionManagerMinimal.sol";

/// @notice Purpose-built NFPM mock for UniswapV3StakingVault tests.
///         Tests configure exact mint / decrease results so the (B, Q, b, q) state
///         that drives spec §10 case classification is fully controllable.
contract MockStakingNFPM {
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

    mapping(uint256 => Position) internal _positions;
    mapping(uint256 => address) internal _owners;

    address public factory;

    // Controllable mint() result (test sets before stake).
    uint256 public nextTokenId = 1;
    uint128 public nextMintLiquidity;
    uint256 public nextMintAmount0Used;
    uint256 public nextMintAmount1Used;

    // Controllable decreaseLiquidity() result, keyed per tokenId.
    mapping(uint256 => uint256) public nextDecrease0;
    mapping(uint256 => uint256) public nextDecrease1;

    constructor(address factory_) {
        factory = factory_;
    }

    // ============ Test helpers ============

    function setNextMintResult(uint128 liquidity_, uint256 amount0Used_, uint256 amount1Used_)
        external
    {
        nextMintLiquidity = liquidity_;
        nextMintAmount0Used = amount0Used_;
        nextMintAmount1Used = amount1Used_;
    }

    function setNextDecreaseResult(uint256 tokenId_, uint256 amount0_, uint256 amount1_) external {
        nextDecrease0[tokenId_] = amount0_;
        nextDecrease1[tokenId_] = amount1_;
    }

    function setLiquidityForTesting(uint256 tokenId_, uint128 liquidity_) external {
        _positions[tokenId_].liquidity = liquidity_;
    }

    function accrueFeesForTesting(uint256 tokenId_, uint128 fees0_, uint128 fees1_) external {
        _positions[tokenId_].tokensOwed0 += fees0_;
        _positions[tokenId_].tokensOwed1 += fees1_;
    }

    // ============ NFPM interface ============

    function positions(uint256 tokenId_)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0_,
            address token1_,
            uint24 fee,
            int24 tickLower_,
            int24 tickUpper_,
            uint128 liquidity_,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Position storage p = _positions[tokenId_];
        return (
            0,
            address(0),
            p.token0,
            p.token1,
            p.fee,
            p.tickLower,
            p.tickUpper,
            p.liquidity,
            0,
            0,
            p.tokensOwed0,
            p.tokensOwed1
        );
    }

    function mint(INonfungiblePositionManagerMinimal.MintParams calldata params)
        external
        payable
        returns (uint256 tokenId_, uint128 liquidity_, uint256 amount0, uint256 amount1)
    {
        tokenId_ = nextTokenId++;
        liquidity_ = nextMintLiquidity;
        amount0 = nextMintAmount0Used;
        amount1 = nextMintAmount1Used;

        if (amount0 > 0) {
            IERC20(params.token0).transferFrom(msg.sender, address(this), amount0);
        }
        if (amount1 > 0) {
            IERC20(params.token1).transferFrom(msg.sender, address(this), amount1);
        }

        _positions[tokenId_] = Position({
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity_,
            tokensOwed0: 0,
            tokensOwed1: 0
        });
        _owners[tokenId_] = params.recipient;
    }

    function increaseLiquidity(INonfungiblePositionManagerMinimal.IncreaseLiquidityParams calldata)
        external
        payable
        returns (uint128, uint256, uint256)
    {
        revert("not implemented");
    }

    function decreaseLiquidity(INonfungiblePositionManagerMinimal.DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage p = _positions[params.tokenId];
        require(p.liquidity >= params.liquidity, "NotEnoughLiquidity");
        p.liquidity -= params.liquidity;

        amount0 = nextDecrease0[params.tokenId];
        amount1 = nextDecrease1[params.tokenId];

        // forge-lint: disable-next-line(unsafe-typecast)
        p.tokensOwed0 += uint128(amount0);
        // forge-lint: disable-next-line(unsafe-typecast)
        p.tokensOwed1 += uint128(amount1);

        // Reset so a follow-up decrease without setup yields zero (no accidental reuse).
        nextDecrease0[params.tokenId] = 0;
        nextDecrease1[params.tokenId] = 0;
    }

    function collect(INonfungiblePositionManagerMinimal.CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage p = _positions[params.tokenId];
        amount0 = p.tokensOwed0 > params.amount0Max ? params.amount0Max : p.tokensOwed0;
        amount1 = p.tokensOwed1 > params.amount1Max ? params.amount1Max : p.tokensOwed1;

        // forge-lint: disable-next-line(unsafe-typecast)
        p.tokensOwed0 -= uint128(amount0);
        // forge-lint: disable-next-line(unsafe-typecast)
        p.tokensOwed1 -= uint128(amount1);

        if (amount0 > 0) IERC20(p.token0).transfer(params.recipient, amount0);
        if (amount1 > 0) IERC20(p.token1).transfer(params.recipient, amount1);
    }

    // ============ ERC721 minimal ============

    function ownerOf(uint256 tokenId_) external view returns (address) {
        return _owners[tokenId_];
    }

    function transferFrom(address, address, uint256) external pure {
        revert("not implemented");
    }

    function approve(address, uint256) external pure {
        revert("not implemented");
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function setApprovalForAll(address, bool) external pure {
        revert("not implemented");
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }
}

/// @notice Trivial factory mock with `getPool(token0, token1, fee) → address` lookup.
contract MockUniFactory {
    mapping(bytes32 => address) private _pools;

    function setPool(address token0, address token1, uint24 fee, address pool_) external {
        _pools[keccak256(abi.encode(token0, token1, fee))] = pool_;
    }

    function getPool(address token0, address token1, uint24 fee) external view returns (address) {
        return _pools[keccak256(abi.encode(token0, token1, fee))];
    }
}

/// @notice Trivial pool mock — only slot0() is read by the vault's quoteSwap path.
contract MockUniPool {
    uint160 public sqrtPriceX96;
    int24 public currentTick;

    constructor(uint160 sqrtPriceX96_, int24 tick_) {
        sqrtPriceX96 = sqrtPriceX96_;
        currentTick = tick_;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96, currentTick, 0, 0, 0, 0, true);
    }
}
