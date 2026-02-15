// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Diamond} from "./position-closer/diamond/Diamond.sol";
import {IDiamondCut} from "./position-closer/diamond/interfaces/IDiamondCut.sol";
import {AppStorage, LibAppStorage} from "./position-closer/storage/AppStorage.sol";

/// @title UniswapV3PositionCloserFactory
/// @notice Factory for deploying UniswapV3PositionCloser diamonds
/// @dev Deploys one diamond per chain with shared facets (gas-efficient)
///
/// Architecture:
/// - Factory holds immutable references to all facet addresses
/// - All vaults on a chain share the same facet implementations
/// - Only the Diamond proxy is deployed per chain (minimal gas)
/// - Facets can be upgraded via diamondCut after deployment
contract UniswapV3PositionCloserFactory {
    // ============ Immutables (Chain Constants) ============

    /// @notice The Uniswap V3 NonfungiblePositionManager address
    address public immutable positionManager;

    /// @notice The MidcurveSwapRouter address for post-close token swaps
    address public immutable swapRouter;

    // ============ Shared Facets (Deploy Once Per Chain) ============

    address public immutable diamondCutFacet;
    address public immutable diamondLoupeFacet;
    address public immutable ownershipFacet;
    address public immutable registrationFacet;
    address public immutable executionFacet;
    address public immutable ownerUpdateFacet;
    address public immutable viewFacet;
    address public immutable versionFacet;
    address public immutable multicallFacet;

    // ============ Registry ============

    /// @notice The deployed diamond address (one per chain)
    address public diamond;

    // ============ Events ============

    event DiamondCreated(address indexed diamond, address indexed owner);

    // ============ Errors ============

    error ZeroAddress();
    error DiamondAlreadyExists();
    error DiamondNotCreated();

    // ============ Constructor ============

    /// @notice Deploy factory with all shared facet addresses
    /// @param positionManager_ The Uniswap V3 NonfungiblePositionManager
    /// @param swapRouter_ The MidcurveSwapRouter address
    /// @param facets_ Array of facet addresses in order:
    ///        [diamondCut, diamondLoupe, ownership, registration, execution,
    ///         ownerUpdate, view, version, multicall]
    constructor(
        address positionManager_,
        address swapRouter_,
        address[9] memory facets_
    ) {
        if (positionManager_ == address(0)) revert ZeroAddress();
        if (swapRouter_ == address(0)) revert ZeroAddress();

        positionManager = positionManager_;
        swapRouter = swapRouter_;

        diamondCutFacet = facets_[0];
        diamondLoupeFacet = facets_[1];
        ownershipFacet = facets_[2];
        registrationFacet = facets_[3];
        executionFacet = facets_[4];
        ownerUpdateFacet = facets_[5];
        viewFacet = facets_[6];
        versionFacet = facets_[7];
        multicallFacet = facets_[8];

        // Validate all facet addresses
        for (uint256 i = 0; i < 9; i++) {
            if (facets_[i] == address(0)) revert ZeroAddress();
        }
    }

    // ============ Factory Functions ============

    /// @notice Create the UniswapV3PositionCloser diamond
    /// @dev Can only be called once per chain (one shared contract)
    /// @return The deployed diamond address
    function createDiamond() external returns (address) {
        if (diamond != address(0)) revert DiamondAlreadyExists();

        // Build facet cuts array
        IDiamondCut.FacetCut[] memory cuts = _buildFacetCuts();

        // Encode initialization calldata
        bytes memory initCalldata = abi.encodeCall(this.initializeCloser, ());

        // Deploy diamond with facets and initialization
        diamond = address(new Diamond(
            cuts,
            Diamond.DiamondArgs({
                owner: msg.sender,
                init: address(this),
                initCalldata: initCalldata
            })
        ));

        emit DiamondCreated(diamond, msg.sender);

        return diamond;
    }

    /// @notice Initialize closer storage (called via delegatecall from Diamond constructor)
    /// @dev This function is called via delegatecall, so `this` refers to the diamond
    function initializeCloser() external {
        AppStorage storage s = LibAppStorage.appStorage();

        // Set chain constants
        s.positionManager = positionManager;
        s.swapRouter = swapRouter;

        // Set protocol config
        s.maxFeeBps = 100;          // 1% max operator fee
        s.interfaceVersion = 1_00;  // v1.0

        // Initialize reentrancy guard
        s.reentrancyLock = 1;
        s.initialized = true;
    }

    // ============ Internal Functions ============

    /// @dev Build the array of facet cuts for diamond construction
    function _buildFacetCuts() internal view returns (IDiamondCut.FacetCut[] memory cuts) {
        cuts = new IDiamondCut.FacetCut[](9);

        // DiamondCutFacet
        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: diamondCutFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getDiamondCutSelectors()
        });

        // DiamondLoupeFacet
        cuts[1] = IDiamondCut.FacetCut({
            facetAddress: diamondLoupeFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getDiamondLoupeSelectors()
        });

        // OwnershipFacet
        cuts[2] = IDiamondCut.FacetCut({
            facetAddress: ownershipFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getOwnershipSelectors()
        });

        // RegistrationFacet
        cuts[3] = IDiamondCut.FacetCut({
            facetAddress: registrationFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getRegistrationSelectors()
        });

        // ExecutionFacet
        cuts[4] = IDiamondCut.FacetCut({
            facetAddress: executionFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getExecutionSelectors()
        });

        // OwnerUpdateFacet
        cuts[5] = IDiamondCut.FacetCut({
            facetAddress: ownerUpdateFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getOwnerUpdateSelectors()
        });

        // ViewFacet
        cuts[6] = IDiamondCut.FacetCut({
            facetAddress: viewFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getViewSelectors()
        });

        // VersionFacet
        cuts[7] = IDiamondCut.FacetCut({
            facetAddress: versionFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getVersionSelectors()
        });

        // MulticallFacet
        cuts[8] = IDiamondCut.FacetCut({
            facetAddress: multicallFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getMulticallSelectors()
        });
    }

    // ============ Selector Getters ============

    function _getDiamondCutSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](1);
        selectors[0] = IDiamondCut.diamondCut.selector;
    }

    function _getDiamondLoupeSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](5);
        selectors[0] = bytes4(keccak256("facets()"));
        selectors[1] = bytes4(keccak256("facetFunctionSelectors(address)"));
        selectors[2] = bytes4(keccak256("facetAddresses()"));
        selectors[3] = bytes4(keccak256("facetAddress(bytes4)"));
        selectors[4] = bytes4(keccak256("supportsInterface(bytes4)"));
    }

    function _getOwnershipSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](2);
        selectors[0] = bytes4(keccak256("owner()"));
        selectors[1] = bytes4(keccak256("transferOwnership(address)"));
    }

    function _getRegistrationSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](2);
        selectors[0] = bytes4(keccak256("registerOrder((uint256,address,uint8,int24,address,address,uint256,uint16,uint8,uint16))"));
        selectors[1] = bytes4(keccak256("cancelOrder(uint256,uint8)"));
    }

    function _getExecutionSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](1);
        selectors[0] = bytes4(keccak256("executeOrder(uint256,uint8,address,uint16,(uint256,uint256,(bytes32,address,address,bytes)[]))"));
    }

    function _getOwnerUpdateSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](6);
        selectors[0] = bytes4(keccak256("setOperator(uint256,uint8,address)"));
        selectors[1] = bytes4(keccak256("setPayout(uint256,uint8,address)"));
        selectors[2] = bytes4(keccak256("setTriggerTick(uint256,uint8,int24)"));
        selectors[3] = bytes4(keccak256("setValidUntil(uint256,uint8,uint256)"));
        selectors[4] = bytes4(keccak256("setSlippage(uint256,uint8,uint16)"));
        selectors[5] = bytes4(keccak256("setSwapIntent(uint256,uint8,uint8,uint16)"));
    }

    function _getViewSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](7);
        selectors[0] = bytes4(keccak256("getOrder(uint256,uint8)"));
        selectors[1] = bytes4(keccak256("hasOrder(uint256,uint8)"));
        selectors[2] = bytes4(keccak256("canExecuteOrder(uint256,uint8)"));
        selectors[3] = bytes4(keccak256("getCurrentTick(address)"));
        selectors[4] = bytes4(keccak256("positionManager()"));
        selectors[5] = bytes4(keccak256("swapRouter()"));
        selectors[6] = bytes4(keccak256("maxFeeBps()"));
    }

    function _getVersionSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](2);
        selectors[0] = bytes4(keccak256("interfaceVersion()"));
        selectors[1] = bytes4(keccak256("version()"));
    }

    function _getMulticallSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](1);
        selectors[0] = bytes4(keccak256("multicall(bytes[])"));
    }
}
