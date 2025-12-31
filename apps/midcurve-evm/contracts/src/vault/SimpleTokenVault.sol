// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

/**
 * @title SimpleTokenVault
 * @notice Vault for a single immutable ERC20 token + a tracked ETH gas pool.
 *         - Owner: deposits/withdraws token + deposits/withdraws gas (ETH)
 *         - Operator: uses/returns token + reimburses gas (ETH) to itself
 *         - shutdown(): empties vault (vault token + ETH) and locks normal operations
 *         - after shutdown: owner can rescue arbitrary ERC20 and ERC721 stuck in the vault
 */
contract SimpleTokenVault is ReentrancyGuard, ERC721Holder {
    using SafeERC20 for IERC20;

    // --- Errors ---
    error NotOwner();
    error NotOperator();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientGasPool();
    error EthTransferFailed();
    error DirectEthNotAllowed();
    error VaultIsShutdown();

    // --- Events (Token) ---
    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, address indexed to, uint256 amount);

    event FundsUsed(address indexed operator, address indexed to, uint256 amount);
    event FundsReturned(address indexed operator, uint256 amount);

    // --- Events (Gas / ETH) ---
    event GasDeposited(address indexed owner, uint256 amountWei);
    event GasWithdrawn(address indexed owner, address indexed to, uint256 amountWei);
    event GasReimbursed(address indexed operator, uint256 amountWei);

    // --- Events (Shutdown / Rescue) ---
    event Shutdown(address indexed owner, uint256 vaultTokenAmount, uint256 ethAmountWei);
    event RescuedERC20(address indexed owner, address indexed token, uint256 amount);
    event RescuedERC721(address indexed owner, address indexed nft, uint256 tokenId);

    IERC20 public immutable token;      // the "vault token" (the one from constructor)
    address public immutable owner;
    address public immutable operator;

    // Tracked ETH available for reimbursements/withdrawals (in wei)
    uint256 public gasPool;

    // Once true: normal operations are locked; only rescue is allowed
    bool public isShutdown;

    constructor(address owner_, address operator_, IERC20 token_) {
        if (owner_ == address(0)) revert ZeroAddress();
        if (operator_ == address(0)) revert ZeroAddress();
        if (address(token_) == address(0)) revert ZeroAddress();

        owner = owner_;
        operator = operator_;
        token = token_;
    }

    // Prevent accidental ETH transfers that would bypass accounting
    receive() external payable {
        revert DirectEthNotAllowed();
    }

    // --- Modifiers ---
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier notShutdown() {
        if (isShutdown) revert VaultIsShutdown();
        _;
    }

    // --- Owner actions (Vault ERC20 token) ---
    /**
     * @notice Deposit vault token into the vault.
     * @dev Owner must approve this contract beforehand.
     */
    function deposit(uint256 amount) external onlyOwner notShutdown {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw vault token from the vault.
     */
    function withdraw(address to, uint256 amount) external onlyOwner notShutdown {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        token.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    // --- Operator actions (Vault ERC20 token) ---
    /**
     * @notice Temporarily use vault token (e.g. deploy into positions).
     */
    function useFunds(address to, uint256 amount) external onlyOperator notShutdown {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        token.safeTransfer(to, amount);
        emit FundsUsed(msg.sender, to, amount);
    }

    /**
     * @notice Return vault token back into the vault.
     * @dev Operator must approve this contract beforehand.
     */
    function returnFunds(uint256 amount) external onlyOperator notShutdown {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit FundsReturned(msg.sender, amount);
    }

    // --- Owner actions (Gas / ETH) ---
    function depositGas() external payable onlyOwner notShutdown {
        if (msg.value == 0) revert ZeroAmount();
        gasPool += msg.value;
        emit GasDeposited(msg.sender, msg.value);
    }

    function withdrawGas(address to, uint256 amountWei) external onlyOwner notShutdown nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amountWei == 0) revert ZeroAmount();
        if (amountWei > gasPool) revert InsufficientGasPool();

        gasPool -= amountWei;
        (bool ok, ) = to.call{value: amountWei}("");
        if (!ok) revert EthTransferFailed();

        emit GasWithdrawn(msg.sender, to, amountWei);
    }

    // --- Operator actions (Gas / ETH) ---
    /**
     * @notice Operator reimburses its execution gas costs from the vault's gasPool.
     * @dev Always pays to `operator` (not an arbitrary `to`) to keep accounting simple and safe.
     */
    function reimburseGas(uint256 amountWei) external onlyOperator notShutdown nonReentrant {
        if (amountWei == 0) revert ZeroAmount();
        if (amountWei > gasPool) revert InsufficientGasPool();

        gasPool -= amountWei;
        (bool ok, ) = operator.call{value: amountWei}("");
        if (!ok) revert EthTransferFailed();

        emit GasReimbursed(msg.sender, amountWei);
    }

    // --- Shutdown ---
    /**
     * @notice Close the vault forever: send all vault token + all ETH to owner, reset gasPool, lock operations.
     * @dev This does NOT pull funds back from the operator. It only empties what's currently inside the vault.
     */
    function shutdown() external onlyOwner nonReentrant {
        if (!isShutdown) {
            isShutdown = true;
        }

        uint256 vaultTokenAmt = token.balanceOf(address(this));
        if (vaultTokenAmt > 0) {
            token.safeTransfer(owner, vaultTokenAmt);
        }

        // Reset tracked gas pool to keep accounting consistent
        gasPool = 0;

        uint256 ethAmt = address(this).balance;
        if (ethAmt > 0) {
            (bool ok, ) = owner.call{value: ethAmt}("");
            if (!ok) revert EthTransferFailed();
        }

        emit Shutdown(owner, vaultTokenAmt, ethAmt);
    }

    // --- Rescue (only after shutdown) ---
    /**
     * @notice Rescue any ERC20 token stuck in the vault (entire balance) after shutdown.
     */
    function rescueERC20(IERC20 anyToken) external onlyOwner nonReentrant {
        if (!isShutdown) revert VaultIsShutdown();
        if (address(anyToken) == address(0)) revert ZeroAddress();

        uint256 amt = anyToken.balanceOf(address(this));
        if (amt == 0) revert ZeroAmount();

        anyToken.safeTransfer(owner, amt);
        emit RescuedERC20(owner, address(anyToken), amt);
    }

    /**
     * @notice Rescue an ERC721 token stuck in the vault after shutdown.
     */
    function rescueERC721(IERC721 nft, uint256 tokenId) external onlyOwner nonReentrant {
        if (!isShutdown) revert VaultIsShutdown();
        if (address(nft) == address(0)) revert ZeroAddress();

        nft.safeTransferFrom(address(this), owner, tokenId);
        emit RescuedERC721(owner, address(nft), tokenId);
    }

    // --- Views ---
    function tokenBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function ethBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
