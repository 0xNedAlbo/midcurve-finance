// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Diamond} from "./diamond/Diamond.sol";
import {IDiamondCut} from "./diamond/interfaces/IDiamondCut.sol";
import {AppStorage, LibAppStorage} from "./storage/AppStorage.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3Factory} from "./interfaces/IUniswapV3Factory.sol";

/// @title MidcurveHedgeVaultDiamondFactory
/// @notice Factory for deploying MidcurveHedgeVault diamonds with shared facets
/// @dev Deploys minimal Diamond proxies that delegate to shared facet implementations
contract MidcurveHedgeVaultDiamondFactory {
    // ============ Immutables (Chain Constants) ============

    /// @notice The Uniswap V3 NonfungiblePositionManager address
    address public immutable positionManager;

    /// @notice The Paraswap AugustusRegistry address for swap validation
    address public immutable augustusRegistry;

    // ============ Shared Facets (Deploy Once Per Chain) ============

    address public immutable diamondCutFacet;
    address public immutable diamondLoupeFacet;
    address public immutable ownershipFacet;
    address public immutable initFacet;
    address public immutable depositWithdrawFacet;
    address public immutable stateTransitionFacet;
    address public immutable swapFacet;
    address public immutable settingsFacet;
    address public immutable viewFacet;
    address public immutable erc20Facet;

    // ============ Registry ============

    /// @notice Array of all deployed diamonds
    address[] public diamonds;

    /// @notice Mapping from position ID to diamond address
    mapping(uint256 => address) public diamondByPositionId;

    // ============ Events ============

    event DiamondCreated(
        address indexed diamond,
        address indexed manager,
        uint256 indexed positionId,
        string name,
        string symbol
    );

    // ============ Errors ============

    error ZeroAddress();
    error DiamondAlreadyExists(uint256 positionId);

    // ============ Constructor ============

    /// @notice Deploy factory with all shared facet addresses
    /// @param positionManager_ The Uniswap V3 NonfungiblePositionManager
    /// @param augustusRegistry_ The Paraswap AugustusRegistry
    /// @param facets_ Array of facet addresses in order:
    ///        [diamondCut, diamondLoupe, ownership, init, depositWithdraw,
    ///         stateTransition, swap, settings, view, erc20]
    constructor(
        address positionManager_,
        address augustusRegistry_,
        address[10] memory facets_
    ) {
        if (positionManager_ == address(0)) revert ZeroAddress();
        if (augustusRegistry_ == address(0)) revert ZeroAddress();

        positionManager = positionManager_;
        augustusRegistry = augustusRegistry_;

        diamondCutFacet = facets_[0];
        diamondLoupeFacet = facets_[1];
        ownershipFacet = facets_[2];
        initFacet = facets_[3];
        depositWithdrawFacet = facets_[4];
        stateTransitionFacet = facets_[5];
        swapFacet = facets_[6];
        settingsFacet = facets_[7];
        viewFacet = facets_[8];
        erc20Facet = facets_[9];

        // Validate all facet addresses
        for (uint256 i = 0; i < 10; i++) {
            if (facets_[i] == address(0)) revert ZeroAddress();
        }
    }

    // ============ Factory Functions ============

    /// @notice Create a new MidcurveHedgeVault diamond
    /// @param positionId The Uniswap V3 position NFT ID
    /// @param operator_ The operator address (can execute vault operations)
    /// @param name_ The vault share token name
    /// @param symbol_ The vault share token symbol
    /// @return diamond The deployed diamond address
    function createDiamond(
        uint256 positionId,
        address operator_,
        string calldata name_,
        string calldata symbol_
    ) external returns (address diamond) {
        if (diamondByPositionId[positionId] != address(0)) {
            revert DiamondAlreadyExists(positionId);
        }

        // Build facet cuts array
        IDiamondCut.FacetCut[] memory cuts = _buildFacetCuts();

        // Encode initialization calldata
        bytes memory initCalldata = abi.encodeCall(
            this.initializeVault,
            (positionId, msg.sender, operator_, name_, symbol_)
        );

        // Deploy diamond with facets and initialization
        diamond = address(new Diamond(
            cuts,
            Diamond.DiamondArgs({
                owner: msg.sender,
                init: address(this),
                initCalldata: initCalldata
            })
        ));

        // Register diamond
        diamonds.push(diamond);
        diamondByPositionId[positionId] = diamond;

        emit DiamondCreated(diamond, msg.sender, positionId, name_, symbol_);
    }

    /// @notice Initialize vault storage (called via delegatecall from Diamond constructor)
    /// @dev This function is called via delegatecall, so `this` refers to the diamond
    /// @param positionId The Uniswap V3 position NFT ID
    /// @param manager_ The manager address
    /// @param operator_ The operator address
    /// @param name_ The vault share token name
    /// @param symbol_ The vault share token symbol
    function initializeVault(
        uint256 positionId,
        address manager_,
        address operator_,
        string calldata name_,
        string calldata symbol_
    ) external {
        // This is called via delegatecall from the Diamond constructor,
        // so AppStorage is the diamond's storage
        AppStorage storage s = LibAppStorage.appStorage();

        // Set chain constants (these are stored as storage, not immutables)
        s.positionManager = positionManager;
        s.augustusRegistry = augustusRegistry;

        // Set position data
        s.positionId = positionId;
        s.manager = manager_;
        s.operator = operator_;
        s.name = name_;
        s.symbol = symbol_;

        // Derive position data from NonfungiblePositionManager
        INonfungiblePositionManager pm = INonfungiblePositionManager(positionManager);

        address factory_ = pm.factory();
        s.uniswapFactory = factory_;

        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower_,
            int24 tickUpper_,
            ,
            ,
            ,
            ,
        ) = pm.positions(positionId);

        s.asset0 = token0;
        s.asset1 = token1;
        s.tickLower = tickLower_;
        s.tickUpper = tickUpper_;

        address pool_ = IUniswapV3Factory(factory_).getPool(token0, token1, fee);
        s.pool = pool_;

        // Initialize reentrancy lock
        s.reentrancyLock = 1;

        // Initialize default slippage settings
        s.exitPositionSlippageBps = 100; // 1%
        s.enterPositionSlippageBps = 100; // 1%

        // Initialize trigger prices (disabled by default)
        s.triggerPriceUpper = type(uint160).max;
        s.triggerPriceLower = 0;

        // Enable allowlist by default and add manager
        s.allowlistEnabled = true;
        s.allowlist[manager_] = true;

        // Note: initialized flag is NOT set here - it's set in InitFacet.init()
        // when the manager transfers the NFT and mints initial shares
    }

    // ============ View Functions ============

    /// @notice Get total number of deployed diamonds
    function diamondCount() external view returns (uint256) {
        return diamonds.length;
    }

    /// @notice Get all deployed diamond addresses
    function getAllDiamonds() external view returns (address[] memory) {
        return diamonds;
    }

    // ============ Internal Functions ============

    function _buildFacetCuts() internal view returns (IDiamondCut.FacetCut[] memory cuts) {
        cuts = new IDiamondCut.FacetCut[](10);

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

        // InitFacet
        cuts[3] = IDiamondCut.FacetCut({
            facetAddress: initFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getInitSelectors()
        });

        // DepositWithdrawFacet
        cuts[4] = IDiamondCut.FacetCut({
            facetAddress: depositWithdrawFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getDepositWithdrawSelectors()
        });

        // StateTransitionFacet
        cuts[5] = IDiamondCut.FacetCut({
            facetAddress: stateTransitionFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getStateTransitionSelectors()
        });

        // SwapFacet
        cuts[6] = IDiamondCut.FacetCut({
            facetAddress: swapFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getSwapSelectors()
        });

        // SettingsFacet
        cuts[7] = IDiamondCut.FacetCut({
            facetAddress: settingsFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getSettingsSelectors()
        });

        // ViewFacet
        cuts[8] = IDiamondCut.FacetCut({
            facetAddress: viewFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getViewSelectors()
        });

        // ERC20Facet
        cuts[9] = IDiamondCut.FacetCut({
            facetAddress: erc20Facet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getERC20Selectors()
        });
    }

    // ============ Selector Helper Functions ============

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

    function _getInitSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](2);
        selectors[0] = bytes4(keccak256("initializeVault(address,address,uint256,address,address,string,string)"));
        selectors[1] = bytes4(keccak256("init(uint256)"));
    }

    function _getDepositWithdrawSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](4);
        selectors[0] = bytes4(keccak256("deposit(uint256,uint256,address)"));
        selectors[1] = bytes4(keccak256("mint(uint256,address)"));
        selectors[2] = bytes4(keccak256("withdraw(uint256,uint256,address,address)"));
        selectors[3] = bytes4(keccak256("redeem(uint256,address,address)"));
    }

    function _getStateTransitionSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](7);
        selectors[0] = bytes4(keccak256("exitToAsset0((uint256,bytes))"));
        selectors[1] = bytes4(keccak256("exitToAsset1((uint256,bytes))"));
        selectors[2] = bytes4(keccak256("returnToPosition((uint256,bytes))"));
        selectors[3] = bytes4(keccak256("closeVault()"));
        selectors[4] = bytes4(keccak256("previewExitToAsset0()"));
        selectors[5] = bytes4(keccak256("previewExitToAsset1()"));
        selectors[6] = bytes4(keccak256("previewReturnToPosition()"));
    }

    function _getSwapSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](2);
        selectors[0] = bytes4(keccak256("performTokenSell(address,address,uint256,uint256,bytes)"));
        selectors[1] = bytes4(keccak256("performTokenBuy(address,address,uint256,uint256,bytes)"));
    }

    function _getSettingsSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](9);
        selectors[0] = bytes4(keccak256("setTriggerPriceUpper(uint160)"));
        selectors[1] = bytes4(keccak256("setTriggerPriceLower(uint160)"));
        selectors[2] = bytes4(keccak256("setPaused(bool)"));
        selectors[3] = bytes4(keccak256("setExitPositionSlippageBps(uint256)"));
        selectors[4] = bytes4(keccak256("setEnterPositionSlippageBps(uint256)"));
        selectors[5] = bytes4(keccak256("setDepositSlippage(uint256)"));
        selectors[6] = bytes4(keccak256("setWithdrawSlippage(uint256)"));
        selectors[7] = bytes4(keccak256("setAllowlistEnabled(bool)"));
        selectors[8] = bytes4(keccak256("addToAllowlist(address[])"));
        // Note: removeFromAllowlist has same signature pattern
    }

    function _getViewSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](32);
        // State getters
        selectors[0] = bytes4(keccak256("asset0()"));
        selectors[1] = bytes4(keccak256("asset1()"));
        selectors[2] = bytes4(keccak256("positionManager()"));
        selectors[3] = bytes4(keccak256("uniswapFactory()"));
        selectors[4] = bytes4(keccak256("pool()"));
        selectors[5] = bytes4(keccak256("positionId()"));
        selectors[6] = bytes4(keccak256("tickLower()"));
        selectors[7] = bytes4(keccak256("tickUpper()"));
        selectors[8] = bytes4(keccak256("manager()"));
        selectors[9] = bytes4(keccak256("operator()"));
        selectors[10] = bytes4(keccak256("currentState()"));
        selectors[11] = bytes4(keccak256("initialized()"));
        selectors[12] = bytes4(keccak256("paused()"));
        selectors[13] = bytes4(keccak256("triggerPriceUpper()"));
        selectors[14] = bytes4(keccak256("triggerPriceLower()"));
        selectors[15] = bytes4(keccak256("exitPositionSlippageBps()"));
        selectors[16] = bytes4(keccak256("enterPositionSlippageBps()"));
        selectors[17] = bytes4(keccak256("allowlistEnabled()"));
        selectors[18] = bytes4(keccak256("allowlist(address)"));
        // Fee getters
        selectors[19] = bytes4(keccak256("accFeePerShare0()"));
        selectors[20] = bytes4(keccak256("accFeePerShare1()"));
        selectors[21] = bytes4(keccak256("feeDebt0(address)"));
        selectors[22] = bytes4(keccak256("feeDebt1(address)"));
        selectors[23] = bytes4(keccak256("pendingFees(address)"));
        // Slippage getters
        selectors[24] = bytes4(keccak256("getDepositSlippageBps(address)"));
        selectors[25] = bytes4(keccak256("getWithdrawSlippageBps(address)"));
        // Accounting
        selectors[26] = bytes4(keccak256("totalAssets()"));
        selectors[27] = bytes4(keccak256("convertToShares(uint256,uint256)"));
        selectors[28] = bytes4(keccak256("convertToAssets(uint256)"));
        // Previews
        selectors[29] = bytes4(keccak256("previewDeposit(uint256,uint256)"));
        selectors[30] = bytes4(keccak256("previewMint(uint256)"));
        selectors[31] = bytes4(keccak256("previewWithdraw(uint256,uint256)"));
        // Note: additional selectors like maxDeposit, maxMint, etc. would be added
    }

    function _getERC20Selectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](11);
        selectors[0] = bytes4(keccak256("name()"));
        selectors[1] = bytes4(keccak256("symbol()"));
        selectors[2] = bytes4(keccak256("decimals()"));
        selectors[3] = bytes4(keccak256("totalSupply()"));
        selectors[4] = bytes4(keccak256("balanceOf(address)"));
        selectors[5] = bytes4(keccak256("allowance(address,address)"));
        selectors[6] = bytes4(keccak256("totalShares()"));
        selectors[7] = bytes4(keccak256("shares(address)"));
        selectors[8] = bytes4(keccak256("transfer(address,uint256)"));
        selectors[9] = bytes4(keccak256("approve(address,uint256)"));
        selectors[10] = bytes4(keccak256("transferFrom(address,address,uint256)"));
    }
}
