// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArticNFT
/// @notice A single creator's NFT collection. Mint payments are made in
/// Arc's native currency, which is USDC (6 decimals) rather than ETH — there
/// is no ERC-20 token involved, mint price is just compared against
/// `msg.value` like a normal native-currency payable contract would compare
/// against wei.
contract ArticNFT is ERC721, Ownable, ReentrancyGuard {
    /// @notice Price to mint a single token, in native USDC (6 decimals).
    uint256 public mintPrice;

    /// @notice Unix timestamp minting opens at. Minting reverts before this.
    uint256 public mintStartTime;

    /// @notice Maximum number of tokens that will ever exist.
    uint256 public immutable maxSupply;

    /// @notice Maximum number of tokens a single wallet may mint.
    uint256 public immutable maxPerWallet;

    /// @notice Total number of tokens minted so far.
    uint256 public totalMinted;

    /// @notice Per-wallet mint counts, for enforcing `maxPerWallet`.
    mapping(address => uint256) public mintedByWallet;

    string private _baseTokenURI;
    uint256 private _nextTokenId = 1;

    event MintStartTimeUpdated(uint256 previousStartTime, uint256 newStartTime);
    event BaseURIUpdated(string newBaseURI);
    event Minted(address indexed to, uint256 quantity, uint256 startTokenId, uint256 totalPaid);

    error MintingNotStarted(uint256 mintStartTime, uint256 currentTime);
    error MintingAlreadyStarted();
    error ExceedsMaxSupply();
    error ExceedsWalletLimit();
    error IncorrectPayment(uint256 expected, uint256 received);
    error ZeroQuantity();
    error PayoutFailed();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        uint256 mintPrice_,
        uint256 mintStartTime_,
        uint256 maxSupply_,
        uint256 maxPerWallet_,
        address creator_
    ) ERC721(name_, symbol_) Ownable(creator_) {
        _baseTokenURI = baseURI_;
        mintPrice = mintPrice_;
        mintStartTime = mintStartTime_;
        maxSupply = maxSupply_;
        maxPerWallet = maxPerWallet_;
    }

    /// @notice Mint `quantity` tokens, paying `mintPrice * quantity` in
    /// native USDC via msg.value. Reverts before `mintStartTime`.
    function mint(uint256 quantity) external payable nonReentrant {
        if (quantity == 0) revert ZeroQuantity();
        if (block.timestamp < mintStartTime) revert MintingNotStarted(mintStartTime, block.timestamp);
        if (totalMinted + quantity > maxSupply) revert ExceedsMaxSupply();
        if (mintedByWallet[msg.sender] + quantity > maxPerWallet) revert ExceedsWalletLimit();

        uint256 cost = mintPrice * quantity;
        if (msg.value != cost) revert IncorrectPayment(cost, msg.value);

        totalMinted += quantity;
        mintedByWallet[msg.sender] += quantity;

        uint256 startTokenId = _nextTokenId;
        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(msg.sender, _nextTokenId);
            _nextTokenId++;
        }

        emit Minted(msg.sender, quantity, startTokenId, msg.value);

        if (cost > 0) {
            (bool sent, ) = payable(owner()).call{value: cost}("");
            if (!sent) revert PayoutFailed();
        }
    }

    /// @notice Reschedule when minting opens. Creator-only, and only while
    /// the current window hasn't opened yet.
    function setMintStartTime(uint256 newStartTime) external onlyOwner {
        if (block.timestamp >= mintStartTime) revert MintingAlreadyStarted();
        uint256 previous = mintStartTime;
        mintStartTime = newStartTime;
        emit MintStartTimeUpdated(previous, newStartTime);
    }

    /// @notice Update the metadata base URI (e.g. to fix a bad IPFS pin).
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function remainingSupply() external view returns (uint256) {
        return maxSupply - totalMinted;
    }

    function hasMintingStarted() external view returns (bool) {
        return block.timestamp >= mintStartTime;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
