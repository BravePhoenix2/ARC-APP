// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArticPlatformFees} from "./ArticPlatformFees.sol";

/// @notice Fixed-price original-art payments and on-chain purchase receipts.
/// An art ID identifies the application listing; this is not physical-delivery escrow.
contract ArticArtMarket is ArticPlatformFees {
    struct Listing {
        address seller;
        bytes32 artId;
        uint256 price;
        address buyer;
        bool cancelled;
    }
    uint256 public nextListingId = 1;
    mapping(uint256 => Listing) public listings;
    mapping(address => bool) public hasPurchasedArt;
    mapping(address => uint256) public pendingReturns;

    event ArtListed(uint256 indexed listingId, address indexed seller, bytes32 indexed artId, uint256 price);
    event ArtPurchased(uint256 indexed listingId, address indexed buyer, uint256 price);
    event ArtListingCancelled(uint256 indexed listingId);
    event Withdrawal(address indexed account, address indexed receiver, uint256 amount);
    error InvalidListing();
    error ListingUnavailable();
    error NotSeller();
    error SelfPurchase();
    error IncorrectPayment();
    error NothingToWithdraw();
    error PayoutFailed();

    constructor(address feeRecipient_, uint256 platformFeeBps_) ArticPlatformFees(feeRecipient_, platformFeeBps_) {}

    function createListing(bytes32 artId, uint256 price) external returns (uint256 listingId) {
        if (artId == bytes32(0) || price == 0) revert InvalidListing();
        listingId = nextListingId++;
        listings[listingId] = Listing(msg.sender, artId, price, address(0), false);
        emit ArtListed(listingId, msg.sender, artId, price);
    }

    function buyListing(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        if (listing.seller == address(0) || listing.cancelled || listing.buyer != address(0)) revert ListingUnavailable();
        if (listing.seller == msg.sender) revert SelfPurchase();
        if (msg.value != listing.price) revert IncorrectPayment();
        listing.buyer = msg.sender;
        hasPurchasedArt[msg.sender] = true;
        uint256 fee = _platformFee(msg.value);
        _accruePlatformFee(fee);
        pendingReturns[listing.seller] += msg.value - fee;
        emit ArtPurchased(listingId, msg.sender, msg.value);
    }

    function cancelListing(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        if (listing.cancelled || listing.buyer != address(0)) revert ListingUnavailable();
        listing.cancelled = true;
        emit ArtListingCancelled(listingId);
    }

    function withdraw(address payable receiver) external nonReentrant {
        if (receiver == address(0)) revert PayoutFailed();
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingReturns[msg.sender] = 0;
        (bool sent,) = receiver.call{value: amount}("");
        if (!sent) revert PayoutFailed();
        emit Withdrawal(msg.sender, receiver, amount);
    }
}
