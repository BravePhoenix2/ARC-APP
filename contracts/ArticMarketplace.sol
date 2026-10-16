// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArticMarketplace
/// @notice Secondary-market listing and buying for any ERC-721 collection,
/// priced entirely in Arc's native USDC. Takes a small fee on each sale.
contract ArticMarketplace is Ownable, ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    /// @notice Marketplace fee in basis points (250 = 2.5%).
    uint256 public feeBps = 250;

    /// @notice Hard cap on the fee so it can never be set unreasonably high.
    uint256 public constant MAX_FEE_BPS = 1_000; // 10%

    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @notice Where marketplace fees are sent.
    address public feeRecipient;

    /// @dev nftContract => tokenId => Listing
    mapping(address => mapping(uint256 => Listing)) public listings;

    event ItemListed(address indexed nftContract, uint256 indexed tokenId, address indexed seller, uint256 price);
    event ItemDelisted(address indexed nftContract, uint256 indexed tokenId, address indexed seller);
    event PriceUpdated(address indexed nftContract, uint256 indexed tokenId, uint256 newPrice);
    event ItemSold(
        address indexed nftContract,
        uint256 indexed tokenId,
        address seller,
        address indexed buyer,
        uint256 price,
        uint256 fee
    );
    event FeeBpsUpdated(uint256 newFeeBps);
    event FeeRecipientUpdated(address newFeeRecipient);

    error NotTokenOwner();
    error MarketplaceNotApproved();
    error PriceMustBePositive();
    error NotListed();
    error NotSeller();
    error IncorrectPayment(uint256 expected, uint256 received);
    error SellerNoLongerOwnsToken();
    error FeeTooHigh();
    error PayoutFailed();

    constructor(address feeRecipient_, address initialOwner) Ownable(initialOwner) {
        feeRecipient = feeRecipient_;
    }

    /// @notice List an owned, marketplace-approved token for sale.
    function listItem(address nftContract, uint256 tokenId, uint256 price) external {
        if (price == 0) revert PriceMustBePositive();

        IERC721 nft = IERC721(nftContract);
        if (nft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (nft.getApproved(tokenId) != address(this) && !nft.isApprovedForAll(msg.sender, address(this))) {
            revert MarketplaceNotApproved();
        }

        listings[nftContract][tokenId] = Listing({seller: msg.sender, price: price, active: true});
        emit ItemListed(nftContract, tokenId, msg.sender, price);
    }

    /// @notice Remove your own listing.
    function delistItem(address nftContract, uint256 tokenId) external {
        Listing storage listing = listings[nftContract][tokenId];
        if (!listing.active) revert NotListed();
        if (listing.seller != msg.sender) revert NotSeller();

        delete listings[nftContract][tokenId];
        emit ItemDelisted(nftContract, tokenId, msg.sender);
    }

    /// @notice Change the price of your own listing.
    function updatePrice(address nftContract, uint256 tokenId, uint256 newPrice) external {
        if (newPrice == 0) revert PriceMustBePositive();

        Listing storage listing = listings[nftContract][tokenId];
        if (!listing.active) revert NotListed();
        if (listing.seller != msg.sender) revert NotSeller();

        listing.price = newPrice;
        emit PriceUpdated(nftContract, tokenId, newPrice);
    }

    /// @notice Buy a listed token, paying its price in native USDC.
    function buyItem(address nftContract, uint256 tokenId) external payable nonReentrant {
        Listing memory listing = listings[nftContract][tokenId];
        if (!listing.active) revert NotListed();
        if (msg.value != listing.price) revert IncorrectPayment(listing.price, msg.value);

        IERC721 nft = IERC721(nftContract);
        if (nft.ownerOf(tokenId) != listing.seller) revert SellerNoLongerOwnsToken();

        delete listings[nftContract][tokenId];

        uint256 fee = (listing.price * feeBps) / BPS_DENOMINATOR;
        uint256 sellerProceeds = listing.price - fee;

        nft.safeTransferFrom(listing.seller, msg.sender, tokenId);

        (bool sentSeller, ) = payable(listing.seller).call{value: sellerProceeds}("");
        if (!sentSeller) revert PayoutFailed();

        if (fee > 0) {
            (bool sentFee, ) = payable(feeRecipient).call{value: fee}("");
            if (!sentFee) revert PayoutFailed();
        }

        emit ItemSold(nftContract, tokenId, listing.seller, msg.sender, listing.price, fee);
    }

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        emit FeeBpsUpdated(newFeeBps);
    }

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(newFeeRecipient);
    }
}
