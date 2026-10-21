// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface IArticMintRegistry {
    function notifyMint(address minter) external;
}

/// @notice A fixed-metadata collection with optional permanent ERC-5192 soulbinding.
/// Payments use Arc's native USDC, with 18 decimals. Royalties follow ERC-2981.
contract ArticStudioCollection is ERC721, ERC2981, Ownable, ReentrancyGuard {
    uint256 public immutable mintPrice;
    uint256 public immutable mintStartTime;
    uint256 public immutable maxSupply;
    uint256 public immutable maxPerWallet;
    bool public immutable soulbound;
    address public immutable registry;
    string public metadataURI;
    uint256 public totalMinted;
    mapping(address => uint256) public mintedByWallet;

    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    event Minted(address indexed to, uint256 quantity, uint256 firstTokenId, uint256 totalPaid);
    event ProceedsWithdrawn(address indexed receiver, uint256 amount);

    error InvalidConfiguration();
    error MintingNotStarted();
    error InvalidQuantity();
    error ExceedsMaxSupply();
    error ExceedsWalletLimit();
    error IncorrectPayment();
    error Soulbound();
    error PayoutFailed();

    constructor(
        string memory name_, string memory symbol_, string memory metadataURI_,
        uint256 mintPrice_, uint256 mintStartTime_, uint256 maxSupply_,
        uint256 maxPerWallet_, uint96 royaltyBps_, bool soulbound_, address creator_, address registry_
    ) ERC721(name_, symbol_) Ownable(creator_) {
        if (bytes(name_).length == 0 || bytes(name_).length > 480 || bytes(symbol_).length == 0 || bytes(symbol_).length > 16
            || bytes(metadataURI_).length == 0 || bytes(metadataURI_).length > 4_096 || maxSupply_ == 0 || maxSupply_ > 1_000_000
            || maxPerWallet_ == 0 || maxPerWallet_ > maxSupply_ || royaltyBps_ > 1_000) revert InvalidConfiguration();
        metadataURI = metadataURI_;
        mintPrice = mintPrice_;
        mintStartTime = mintStartTime_;
        maxSupply = maxSupply_;
        maxPerWallet = maxPerWallet_;
        soulbound = soulbound_;
        registry = registry_;
        _setDefaultRoyalty(creator_, royaltyBps_);
    }

    function mint(uint256 quantity) external payable nonReentrant {
        if (quantity == 0 || quantity > 100) revert InvalidQuantity();
        if (block.timestamp < mintStartTime) revert MintingNotStarted();
        if (totalMinted + quantity > maxSupply) revert ExceedsMaxSupply();
        if (mintedByWallet[msg.sender] + quantity > maxPerWallet) revert ExceedsWalletLimit();
        if (msg.value != mintPrice * quantity) revert IncorrectPayment();
        uint256 firstTokenId = totalMinted + 1;
        totalMinted += quantity;
        mintedByWallet[msg.sender] += quantity;
        if (registry != address(0)) IArticMintRegistry(registry).notifyMint(msg.sender);
        for (uint256 i; i < quantity; ++i) {
            _safeMint(msg.sender, firstTokenId + i);
            if (soulbound) emit Locked(firstTokenId + i);
        }
        emit Minted(msg.sender, quantity, firstTokenId, msg.value);
    }

    /// @notice Creator chooses a receiver, so a rejecting creator contract cannot block mints.
    function withdraw(address payable receiver) external onlyOwner nonReentrant {
        if (receiver == address(0)) revert InvalidConfiguration();
        uint256 amount = address(this).balance;
        (bool sent,) = receiver.call{value: amount}("");
        if (!sent) revert PayoutFailed();
        emit ProceedsWithdrawn(receiver, amount);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        bytes memory uri = bytes(metadataURI);
        if (uri.length > 0 && uri[uri.length - 1] == bytes1("/")) return string.concat(metadataURI, Strings.toString(tokenId));
        return metadataURI;
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return soulbound;
    }

    function approve(address to, uint256 tokenId) public override {
        if (soulbound && to != address(0)) revert Soulbound();
        super.approve(to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public override {
        if (soulbound && approved) revert Soulbound();
        super.setApprovalForAll(operator, approved);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (soulbound && _ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId);
    }
}
