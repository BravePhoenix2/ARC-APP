// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ArticMintPhases} from "./ArticMintPhases.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IArticMintRegistry} from "./ArticStudioCollection.sol";

/// @notice A limited ERC-1155 edition of token ID 1, paid in native USDC (18 decimals).
contract ArticEdition is ERC1155, ERC2981, Ownable, ReentrancyGuard, ArticMintPhases {
    uint256 public constant TOKEN_ID = 1;
    string public name;
    string public symbol;
    string public metadataURI;
    uint256 public immutable mintPrice;
    uint256 public immutable mintStartTime;
    uint256 public immutable maxSupply;
    uint256 public immutable maxPerWallet;
    address public immutable registry;
    address public immutable feeRecipient;
    uint256 public immutable platformFeeBps;
    uint256 public immutable mintSurchargeBps;
    uint256 public totalMinted;
    mapping(address => uint256) public mintedByWallet;

    event Minted(address indexed to, uint256 quantity, uint256 totalPaid);
    event ProceedsWithdrawn(address indexed receiver, uint256 amount);
    error InvalidConfiguration();
    error MintingNotStarted();
    error InvalidQuantity();
    error ExceedsMaxSupply();
    error ExceedsWalletLimit();
    error IncorrectPayment();
    error PayoutFailed();

    constructor(
        string memory name_, string memory symbol_, string memory metadataURI_,
        uint256 mintPrice_, uint256 mintStartTime_, uint256 maxSupply_,
        uint256 maxPerWallet_, uint96 royaltyBps_, address creator_, address registry_
    ) ERC1155(metadataURI_) Ownable(creator_) {
        if (bytes(name_).length == 0 || bytes(name_).length > 480 || bytes(symbol_).length == 0 || bytes(symbol_).length > 16
            || bytes(metadataURI_).length == 0 || bytes(metadataURI_).length > 4_096 || maxSupply_ == 0 || maxSupply_ > 1_000_000
            || maxPerWallet_ == 0 || maxPerWallet_ > maxSupply_ || royaltyBps_ > 1_000) revert InvalidConfiguration();
        name = name_;
        symbol = symbol_;
        metadataURI = metadataURI_;
        mintPrice = mintPrice_;
        mintStartTime = mintStartTime_;
        maxSupply = maxSupply_;
        maxPerWallet = maxPerWallet_;
        registry = registry_;
        if (registry_ != address(0)) {
            feeRecipient = IArticMintRegistry(registry_).feeRecipient();
            platformFeeBps = IArticMintRegistry(registry_).platformFeeBps();
            mintSurchargeBps = IArticMintRegistry(registry_).mintSurchargeBps();
            if (feeRecipient == address(0) || platformFeeBps > 1_000 || mintSurchargeBps > 1_000) revert InvalidConfiguration();
        }
        _setDefaultRoyalty(creator_, royaltyBps_);
    }

    function supportsMintSurcharge() external pure returns (bool) { return true; }

    function configurePhases(PhaseConfig calldata config) external {
        if (msg.sender != registry || totalMinted != 0) revert InvalidPhases();
        _configurePhases(config, maxPerWallet, mintStartTime, mintPrice);
    }

    function mintAllowlisted(uint256 quantity, uint8 tier, bytes32[] calldata proof) external payable nonReentrant {
        _mintTokens(quantity, _checkAllowlistPhase(quantity, tier, proof));
    }

    function mint(uint256 quantity) external payable nonReentrant {
        _checkPublicPhase(quantity);
        _mintTokens(quantity, mintPrice);
    }

    function _mintTokens(uint256 quantity, uint256 price) private {
        if (quantity == 0 || quantity > 100) revert InvalidQuantity();
        if (block.timestamp < mintStartTime) revert MintingNotStarted();
        if (totalMinted + quantity > maxSupply) revert ExceedsMaxSupply();
        if (mintedByWallet[msg.sender] + quantity > maxPerWallet) revert ExceedsWalletLimit();
        uint256 baseAmount = price * quantity;
        uint256 creatorFee = (baseAmount * platformFeeBps) / 10_000;
        uint256 surcharge = (baseAmount * mintSurchargeBps) / 10_000;
        if (msg.value != baseAmount + surcharge) revert IncorrectPayment();
        totalMinted += quantity;
        mintedByWallet[msg.sender] += quantity;
        if (registry != address(0)) {
            IArticMintRegistry(registry).notifyMint{value: creatorFee + surcharge}(msg.sender);
        }
        _mint(msg.sender, TOKEN_ID, quantity, "");
        emit Minted(msg.sender, quantity, msg.value);
    }

    function withdraw(address payable receiver) external onlyOwner nonReentrant {
        if (receiver == address(0)) revert InvalidConfiguration();
        uint256 amount = address(this).balance;
        (bool sent,) = receiver.call{value: amount}("");
        if (!sent) revert PayoutFailed();
        emit ProceedsWithdrawn(receiver, amount);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
