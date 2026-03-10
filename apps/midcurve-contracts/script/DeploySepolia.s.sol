// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ManagedMockToken} from "../contracts/ManagedMockToken.sol";

// Diamond core
import {Diamond} from "../contracts/position-closer/diamond/Diamond.sol";
import {IDiamondCut} from "../contracts/position-closer/diamond/interfaces/IDiamondCut.sol";

// Facets
import {DiamondCutFacet} from "../contracts/position-closer/facets/DiamondCutFacet.sol";
import {DiamondLoupeFacet} from "../contracts/position-closer/facets/DiamondLoupeFacet.sol";
import {OwnershipFacet} from "../contracts/position-closer/facets/OwnershipFacet.sol";
import {VersionFacet} from "../contracts/position-closer/facets/VersionFacet.sol";
import {RegistrationFacet} from "../contracts/position-closer/facets/RegistrationFacet.sol";
import {ExecutionFacet} from "../contracts/position-closer/facets/ExecutionFacet.sol";
import {OwnerUpdateFacet} from "../contracts/position-closer/facets/OwnerUpdateFacet.sol";
import {ViewFacet} from "../contracts/position-closer/facets/ViewFacet.sol";
import {MulticallFacet} from "../contracts/position-closer/facets/MulticallFacet.sol";

// Init
import {DiamondInit} from "../contracts/position-closer/init/DiamondInit.sol";

// SwapRouter
import {MidcurveSwapRouter} from "../contracts/swap-router/MidcurveSwapRouter.sol";
import {UniswapV3Adapter} from "../contracts/swap-router/adapters/UniswapV3Adapter.sol";

// UniswapV3 interfaces
interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
    function token0() external view returns (address);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

/**
 * @title DeploySepoliaScript
 * @notice Bootstraps the full Midcurve testnet infrastructure on Sepolia:
 *         1. Mock tokens (mcUSD, mcWETH) with manager-controlled mint/burn
 *         2. UniswapV3 pool creation + liquidity seeding
 *         3. MidcurveSwapRouter (UniswapV3 adapter only, no Paraswap on Sepolia)
 *         4. PositionCloser Diamond (full 9-facet deployment)
 *
 * @dev Usage:
 *   pnpm sepolia:deploy
 *
 * Requires:
 *   - RPC_URL_SEPOLIA in .env
 *   - Funded deployer wallet (Sepolia ETH)
 *   - Deployer must be the MANAGER address (for minting initial supply)
 */
contract DeploySepoliaScript is Script {
    // ========================================
    // Sepolia UniswapV3 addresses
    // ========================================
    address constant FACTORY = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c;
    address constant NFPM = 0x1238536071E1c677A632429e3655c799b22cDA52;
    address constant SWAP_ROUTER_02 = 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E;

    // ========================================
    // Midcurve configuration
    // ========================================
    address constant MANAGER = 0x670A843229Fb0B7B86E74E74fAE41383314448Cf;

    // Pool fee tier: 0.3%
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60; // For 0.3% fee tier

    // Diamond configuration
    uint32 constant INTERFACE_VERSION = 100; // v1.0
    uint16 constant MAX_FEE_BPS = 100; // 1%

    // Initial token supply
    uint256 constant MC_USD_TOTAL_SUPPLY = 100_000_000 * 1e6; // 100M mcUSD (6 decimals)
    uint256 constant MC_WETH_TOTAL_SUPPLY = 50_000 * 1e18; // 50K mcWETH (18 decimals)

    // Half goes to pool seeding
    uint256 constant MC_USD_POOL_AMOUNT = MC_USD_TOTAL_SUPPLY / 2; // 50M mcUSD
    uint256 constant MC_WETH_POOL_AMOUNT = MC_WETH_TOTAL_SUPPLY / 2; // 25K mcWETH

    function run() public {
        console.log("=== Sepolia Full Deployment ===");
        console.log("Chain ID:", block.chainid);
        require(block.chainid == 11155111, "Not Sepolia");
        console.log("");

        vm.startBroadcast();

        // ========================================
        // Phase A: Deploy Mock Tokens
        // ========================================
        console.log("--- Phase A: Mock Tokens ---");

        ManagedMockToken mcUSD =
            new ManagedMockToken("Midcurve Mock USDC Token", "mcUSD", 6, MANAGER);
        console.log("mcUSD deployed at:", address(mcUSD));

        ManagedMockToken mcWETH =
            new ManagedMockToken("Midcurve Mock ETH Token", "mcWETH", 18, MANAGER);
        console.log("mcWETH deployed at:", address(mcWETH));

        // Mint initial supply to MANAGER (deployer = MANAGER for this script)
        mcUSD.mint(MANAGER, MC_USD_TOTAL_SUPPLY);
        console.log("Minted 100,000,000 mcUSD to deployer");

        mcWETH.mint(MANAGER, MC_WETH_TOTAL_SUPPLY);
        console.log("Minted 50,000 mcWETH to deployer");

        // ========================================
        // Phase B: Create and Seed UniswapV3 Pool
        // ========================================
        console.log("");
        console.log("--- Phase B: UniswapV3 Pool ---");

        // Create pool
        address pool = IUniswapV3Factory(FACTORY).createPool(address(mcWETH), address(mcUSD), FEE);
        console.log("Pool created at:", pool);

        // Determine token order
        IUniswapV3Pool poolContract = IUniswapV3Pool(pool);
        address token0 = poolContract.token0();
        address token1;
        if (token0 == address(mcWETH)) {
            token1 = address(mcUSD);
        } else {
            token1 = address(mcWETH);
        }

        // Initialize pool at ~2000 mcUSD per mcWETH
        //
        // Price calculation with decimal adjustment:
        // - mcWETH has 18 decimals, mcUSD has 6 decimals
        // - Decimal adjustment factor = 10^(18-6) = 10^12
        //
        // If token0 = mcWETH: price = token1/token0 = mcUSD/mcWETH (in raw units)
        //   Raw price = 2000 * 10^6 / 10^18 = 2000 / 10^12 = 2e-9
        //   sqrtPriceX96 = sqrt(2e-9) * 2^96 = 3.541e21
        //
        // If token0 = mcUSD: price = token1/token0 = mcWETH/mcUSD (in raw units)
        //   Raw price = 10^18 / (2000 * 10^6) = 10^12 / 2000 = 5e8
        //   sqrtPriceX96 = sqrt(5e8) * 2^96 = 1.770e51

        uint160 sqrtPriceX96;
        if (token0 == address(mcWETH)) {
            // token0 = mcWETH, token1 = mcUSD
            sqrtPriceX96 = 3541767351169043210420224; // ~2000 mcUSD/mcWETH
            console.log("Token order: mcWETH (token0), mcUSD (token1)");
        } else {
            // token0 = mcUSD, token1 = mcWETH
            sqrtPriceX96 = 1770883675584521724529963007335936; // ~2000 mcUSD/mcWETH
            console.log("Token order: mcUSD (token0), mcWETH (token1)");
        }

        poolContract.initialize(sqrtPriceX96);

        // Read back tick for liquidity range calculation
        (, int24 currentTick,,,,,) = poolContract.slot0();
        console.log("Pool initialized, current tick:", currentTick);

        // Set wide range around current price (+/- 2000 ticks ≈ +/- 22%)
        // forge-lint: disable-next-line(divide-before-multiply)
        int24 tickLower = ((currentTick - 2000) / TICK_SPACING) * TICK_SPACING;
        // forge-lint: disable-next-line(divide-before-multiply)
        int24 tickUpper = ((currentTick + 2000) / TICK_SPACING) * TICK_SPACING;

        // Approve NFPM to spend tokens
        mcUSD.approve(NFPM, type(uint256).max);
        mcWETH.approve(NFPM, type(uint256).max);

        // Determine amounts based on token order
        uint256 amount0Desired;
        uint256 amount1Desired;
        if (token0 == address(mcWETH)) {
            amount0Desired = MC_WETH_POOL_AMOUNT;
            amount1Desired = MC_USD_POOL_AMOUNT;
        } else {
            amount0Desired = MC_USD_POOL_AMOUNT;
            amount1Desired = MC_WETH_POOL_AMOUNT;
        }

        // Mint liquidity position
        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) =
            INonfungiblePositionManager(NFPM).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0,
                    token1: token1,
                    fee: FEE,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired,
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: MANAGER,
                    deadline: block.timestamp + 3600
                })
            );

        console.log("Liquidity position minted, NFT ID:", tokenId);
        console.log("Liquidity:", liquidity);
        console.log("Amount0 used:", amount0);
        console.log("Amount1 used:", amount1);

        // ========================================
        // Phase C: Deploy Midcurve Shared Contracts
        // ========================================
        console.log("");
        console.log("--- Phase C: Midcurve Shared Contracts ---");

        // Deploy UniswapV3Adapter
        UniswapV3Adapter uniAdapter = new UniswapV3Adapter(SWAP_ROUTER_02);
        console.log("UniswapV3Adapter deployed at:", address(uniAdapter));

        // Deploy MidcurveSwapRouter (no ParaswapAdapter on Sepolia)
        MidcurveSwapRouter midcurveSwapRouter = new MidcurveSwapRouter(MANAGER);
        console.log("MidcurveSwapRouter deployed at:", address(midcurveSwapRouter));

        // Register UniswapV3 adapter
        midcurveSwapRouter.registerAdapter(uniAdapter.VENUE_ID(), address(uniAdapter));

        // Add mock tokens as SwapTokens
        midcurveSwapRouter.addSwapToken(address(mcWETH));
        midcurveSwapRouter.addSwapToken(address(mcUSD));

        // Deploy all Diamond facets
        DiamondCutFacet diamondCutFacet = new DiamondCutFacet();
        DiamondLoupeFacet diamondLoupeFacet = new DiamondLoupeFacet();
        OwnershipFacet ownershipFacet = new OwnershipFacet();
        VersionFacet versionFacet = new VersionFacet();
        RegistrationFacet registrationFacet = new RegistrationFacet();
        ExecutionFacet executionFacet = new ExecutionFacet();
        OwnerUpdateFacet ownerUpdateFacet = new OwnerUpdateFacet();
        ViewFacet viewFacet = new ViewFacet();
        MulticallFacet multicallFacet = new MulticallFacet();

        // Deploy init contract
        DiamondInit diamondInit = new DiamondInit();

        // Build FacetCut array
        IDiamondCut.FacetCut[] memory facetCuts = new IDiamondCut.FacetCut[](9);

        facetCuts[0] = IDiamondCut.FacetCut({
            facetAddress: address(diamondCutFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getDiamondCutSelectors()
        });

        facetCuts[1] = IDiamondCut.FacetCut({
            facetAddress: address(diamondLoupeFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getDiamondLoupeSelectors()
        });

        facetCuts[2] = IDiamondCut.FacetCut({
            facetAddress: address(ownershipFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getOwnershipSelectors()
        });

        facetCuts[3] = IDiamondCut.FacetCut({
            facetAddress: address(versionFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getVersionSelectors()
        });

        facetCuts[4] = IDiamondCut.FacetCut({
            facetAddress: address(registrationFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getRegistrationSelectors()
        });

        facetCuts[5] = IDiamondCut.FacetCut({
            facetAddress: address(executionFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getExecutionSelectors()
        });

        facetCuts[6] = IDiamondCut.FacetCut({
            facetAddress: address(ownerUpdateFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getOwnerUpdateSelectors()
        });

        facetCuts[7] = IDiamondCut.FacetCut({
            facetAddress: address(viewFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getViewSelectors()
        });

        facetCuts[8] = IDiamondCut.FacetCut({
            facetAddress: address(multicallFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getMulticallSelectors()
        });

        // Build init calldata
        bytes memory initCalldata = abi.encodeWithSelector(
            DiamondInit.init.selector, NFPM, address(midcurveSwapRouter), INTERFACE_VERSION, MAX_FEE_BPS
        );

        // Deploy Diamond
        Diamond.DiamondArgs memory args =
            Diamond.DiamondArgs({owner: MANAGER, init: address(diamondInit), initCalldata: initCalldata});

        Diamond positionCloserDiamond = new Diamond(facetCuts, args);
        console.log("PositionCloser Diamond deployed at:", address(positionCloserDiamond));

        vm.stopBroadcast();

        // ========================================
        // Deployment Summary
        // ========================================
        console.log("");
        console.log("========================================");
        console.log("=== Sepolia Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("Mock Tokens:");
        console.log("  mcUSD:                ", address(mcUSD));
        console.log("  mcWETH:               ", address(mcWETH));
        console.log("");
        console.log("UniswapV3 Pool:");
        console.log("  mcWETH/mcUSD Pool:    ", pool);
        console.log("  Liquidity NFT ID:     ", tokenId);
        console.log("");
        console.log("Midcurve Contracts:");
        console.log("  UniswapV3Adapter:     ", address(uniAdapter));
        console.log("  MidcurveSwapRouter:   ", address(midcurveSwapRouter));
        console.log("  PositionCloser:       ", address(positionCloserDiamond));
        console.log("");
        console.log("========================================");
    }

    // ========================================
    // SELECTOR HELPERS (identical to DeployLocal.s.sol)
    // ========================================

    function getDiamondCutSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = IDiamondCut.diamondCut.selector;
        return selectors;
    }

    function getDiamondLoupeSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = DiamondLoupeFacet.facets.selector;
        selectors[1] = DiamondLoupeFacet.facetFunctionSelectors.selector;
        selectors[2] = DiamondLoupeFacet.facetAddresses.selector;
        selectors[3] = DiamondLoupeFacet.facetAddress.selector;
        selectors[4] = DiamondLoupeFacet.supportsInterface.selector;
        return selectors;
    }

    function getOwnershipSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = OwnershipFacet.owner.selector;
        selectors[1] = OwnershipFacet.transferOwnership.selector;
        return selectors;
    }

    function getVersionSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = VersionFacet.interfaceVersion.selector;
        selectors[1] = VersionFacet.version.selector;
        return selectors;
    }

    function getRegistrationSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = RegistrationFacet.registerOrder.selector;
        selectors[1] = RegistrationFacet.cancelOrder.selector;
        return selectors;
    }

    function getExecutionSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = ExecutionFacet.executeOrder.selector;
        return selectors;
    }

    function getOwnerUpdateSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = OwnerUpdateFacet.setOperator.selector;
        selectors[1] = OwnerUpdateFacet.setPayout.selector;
        selectors[2] = OwnerUpdateFacet.setTriggerTick.selector;
        selectors[3] = OwnerUpdateFacet.setValidUntil.selector;
        selectors[4] = OwnerUpdateFacet.setSlippage.selector;
        selectors[5] = OwnerUpdateFacet.setSwapIntent.selector;
        return selectors;
    }

    function getViewSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = ViewFacet.getOrder.selector;
        selectors[1] = ViewFacet.hasOrder.selector;
        selectors[2] = ViewFacet.canExecuteOrder.selector;
        selectors[3] = ViewFacet.getCurrentTick.selector;
        selectors[4] = ViewFacet.positionManager.selector;
        selectors[5] = ViewFacet.swapRouter.selector;
        selectors[6] = ViewFacet.maxFeeBps.selector;
        return selectors;
    }

    function getMulticallSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MulticallFacet.multicall.selector;
        return selectors;
    }
}
