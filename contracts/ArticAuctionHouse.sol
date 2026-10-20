// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IArticEligibility {
    function hasMinted(address account) external view returns (bool);
    function hasPurchasedArt(address account) external view returns (bool);
}

interface IERC5192Probe {
    function locked(uint256 tokenId) external view returns (bool);
}

/// @notice Escrowed ERC-721 English auctions and separately funded community reward rounds.
/// All monetary amounts are Arc native USDC with 18 decimals. No reward depends on bidding.
contract ArticAuctionHouse is IERC721Receiver, ReentrancyGuard {
    struct Auction {
        address seller;
        address nft;
        uint256 tokenId;
        uint256 reservePrice;
        address highestBidder;
        uint256 highestBid;
        uint64 endsAt;
        bool settled;
        bool nftClaimed;
    }
    struct RewardRound {
        address sponsor;
        uint64 closesAt;
        uint32 maxParticipants;
        uint32 participantCount;
        uint256 pool;
        uint256 sharePerParticipant;
        bool settled;
    }

    address public immutable studioFactory;
    address public immutable artMarket;
    uint256 public nextAuctionId = 1;
    uint256 public nextRewardRoundId = 1;
    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => RewardRound) public rewardRounds;
    mapping(uint256 => mapping(address => bool)) public hasJoinedReward;
    mapping(uint256 => mapping(address => bool)) public rewardClaimed;
    mapping(address => uint256) public pendingReturns;
    address private _expectedNFT;
    address private _expectedSeller;
    uint256 private _expectedTokenId;

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, address indexed nft, uint256 tokenId, uint256 reservePrice, uint64 endsAt);
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 amount);
    event AuctionCancelled(uint256 indexed auctionId);
    event NFTClaimed(uint256 indexed auctionId, address indexed receiver);
    event Withdrawal(address indexed account, address indexed receiver, uint256 amount);
    event RewardRoundCreated(uint256 indexed roundId, address indexed sponsor, uint64 closesAt, uint32 maxParticipants, uint256 pool);
    event RewardJoined(uint256 indexed roundId, address indexed participant, uint32 position);
    event RewardRoundSettled(uint256 indexed roundId, uint256 sharePerParticipant, uint256 sponsorRefund);
    event RewardClaimed(uint256 indexed roundId, address indexed participant, address indexed receiver, uint256 amount);

    error InvalidConfiguration();
    error UnsupportedNFT();
    error SoulboundNFT();
    error NotTokenOwner();
    error AuctionUnavailable();
    error AuctionStillOpen();
    error AuctionHasBids();
    error NotSeller();
    error SellerCannotBid();
    error BidTooLow(uint256 minimum);
    error NotNFTRecipient();
    error UnexpectedNFT();
    error NothingToWithdraw();
    error PayoutFailed();
    error RewardUnavailable();
    error RewardStillOpen();
    error RewardFull();
    error AlreadyJoined();
    error NotEligible();
    error CannotClaimReward();

    constructor(address studioFactory_, address artMarket_) {
        if (studioFactory_.code.length == 0 || artMarket_.code.length == 0) revert InvalidConfiguration();
        studioFactory = studioFactory_;
        artMarket = artMarket_;
    }

    function createAuction(address nft, uint256 tokenId, uint256 reservePrice, uint64 endsAt) external nonReentrant returns (uint256 auctionId) {
        if (reservePrice == 0 || endsAt < block.timestamp + 60 || endsAt > block.timestamp + 30 days) revert InvalidConfiguration();
        if (nft.code.length == 0) revert UnsupportedNFT();
        try IERC165(nft).supportsInterface(type(IERC721).interfaceId) returns (bool supported) {
            if (!supported) revert UnsupportedNFT();
        } catch { revert UnsupportedNFT(); }
        try IERC165(nft).supportsInterface(0xb45a3c0e) returns (bool supportsSoulbound) {
            if (supportsSoulbound) {
                try IERC5192Probe(nft).locked(tokenId) returns (bool isLocked) {
                    if (isLocked) revert SoulboundNFT();
                } catch { revert SoulboundNFT(); }
            }
        } catch { revert UnsupportedNFT(); }
        if (IERC721(nft).ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        auctionId = nextAuctionId++;
        auctions[auctionId] = Auction(msg.sender, nft, tokenId, reservePrice, address(0), 0, endsAt, false, false);
        _expectedNFT = nft;
        _expectedSeller = msg.sender;
        _expectedTokenId = tokenId;
        IERC721(nft).safeTransferFrom(msg.sender, address(this), tokenId);
        _expectedNFT = address(0);
        _expectedSeller = address(0);
        _expectedTokenId = 0;
        if (IERC721(nft).ownerOf(tokenId) != address(this)) revert UnexpectedNFT();
        emit AuctionCreated(auctionId, msg.sender, nft, tokenId, reservePrice, endsAt);
    }

    function minimumBid(uint256 auctionId) public view returns (uint256) {
        Auction storage auction = auctions[auctionId];
        if (auction.highestBid == 0) return auction.reservePrice;
        uint256 increment = auction.highestBid / 20;
        return auction.highestBid + (increment == 0 ? 1 : increment);
    }

    function bid(uint256 auctionId) external payable nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.seller == address(0) || auction.settled || block.timestamp >= auction.endsAt) revert AuctionUnavailable();
        if (msg.sender == auction.seller) revert SellerCannotBid();
        uint256 minimum = minimumBid(auctionId);
        if (msg.value < minimum) revert BidTooLow(minimum);
        if (auction.highestBidder != address(0)) pendingReturns[auction.highestBidder] += auction.highestBid;
        auction.highestBidder = msg.sender;
        auction.highestBid = msg.value;
        emit BidPlaced(auctionId, msg.sender, msg.value);
    }

    /// @notice Anyone can settle after the deadline; payments and NFT retrieval are independent.
    function settle(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.seller == address(0) || auction.settled) revert AuctionUnavailable();
        if (block.timestamp < auction.endsAt) revert AuctionStillOpen();
        auction.settled = true;
        if (auction.highestBid > 0) {
            uint256 royalty;
            // A third-party NFT must not be able to block settlement with a reverting royalty hook.
            try IERC2981(auction.nft).royaltyInfo{gas: 30_000}(auction.tokenId, auction.highestBid) returns (address recipient, uint256 amount) {
                if (recipient != address(0) && amount <= auction.highestBid) {
                    royalty = amount;
                    pendingReturns[recipient] += amount;
                }
            } catch {}
            pendingReturns[auction.seller] += auction.highestBid - royalty;
        }
        emit AuctionSettled(auctionId, auction.highestBidder, auction.highestBid);
    }

    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.seller != msg.sender) revert NotSeller();
        if (auction.settled) revert AuctionUnavailable();
        if (auction.highestBidder != address(0)) revert AuctionHasBids();
        auction.settled = true;
        emit AuctionCancelled(auctionId);
    }

    function claimNFT(uint256 auctionId, address receiver) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.seller == address(0) || !auction.settled || auction.nftClaimed) revert AuctionUnavailable();
        address recipient = auction.highestBidder == address(0) ? auction.seller : auction.highestBidder;
        if (msg.sender != recipient) revert NotNFTRecipient();
        if (receiver == address(0)) revert InvalidConfiguration();
        auction.nftClaimed = true;
        IERC721(auction.nft).safeTransferFrom(address(this), receiver, auction.tokenId);
        emit NFTClaimed(auctionId, receiver);
    }

    function withdraw(address payable receiver) external nonReentrant {
        if (receiver == address(0)) revert InvalidConfiguration();
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingReturns[msg.sender] = 0;
        (bool sent,) = receiver.call{value: amount}("");
        if (!sent) revert PayoutFailed();
        emit Withdrawal(msg.sender, receiver, amount);
    }

    function isRewardEligible(address account) public view returns (bool) {
        return IArticEligibility(studioFactory).hasMinted(account) || IArticEligibility(artMarket).hasPurchasedArt(account);
    }

    /// @notice Free registration is limited to the first N eligible distinct wallet addresses.
    /// A wallet is not proof of a unique person; ownership of multiple wallets is not prevented.
    function createRewardRound(uint64 closesAt, uint32 maxParticipants) external payable returns (uint256 roundId) {
        if (maxParticipants == 0 || maxParticipants > 10_000 || msg.value < maxParticipants
            || closesAt < block.timestamp + 60 || closesAt > block.timestamp + 30 days) revert InvalidConfiguration();
        roundId = nextRewardRoundId++;
        rewardRounds[roundId] = RewardRound(msg.sender, closesAt, maxParticipants, 0, msg.value, 0, false);
        emit RewardRoundCreated(roundId, msg.sender, closesAt, maxParticipants, msg.value);
    }

    function joinRewardRound(uint256 roundId) external nonReentrant {
        RewardRound storage round = rewardRounds[roundId];
        if (round.sponsor == address(0) || round.settled || block.timestamp >= round.closesAt) revert RewardUnavailable();
        if (hasJoinedReward[roundId][msg.sender]) revert AlreadyJoined();
        if (round.participantCount >= round.maxParticipants) revert RewardFull();
        if (!isRewardEligible(msg.sender)) revert NotEligible();
        hasJoinedReward[roundId][msg.sender] = true;
        round.participantCount++;
        emit RewardJoined(roundId, msg.sender, round.participantCount);
    }

    function settleRewardRound(uint256 roundId) external nonReentrant {
        _settleRewardRound(roundId);
    }

    function _settleRewardRound(uint256 roundId) private {
        RewardRound storage round = rewardRounds[roundId];
        if (round.sponsor == address(0) || round.settled) revert RewardUnavailable();
        if (block.timestamp < round.closesAt) revert RewardStillOpen();
        round.settled = true;
        uint256 refund = round.pool;
        if (round.participantCount > 0) {
            round.sharePerParticipant = round.pool / round.participantCount;
            refund = round.pool % round.participantCount;
        }
        pendingReturns[round.sponsor] += refund;
        emit RewardRoundSettled(roundId, round.sharePerParticipant, refund);
    }

    /// @notice Participants claim after the deadline. No server or automatic transfer is required.
    function claimReward(uint256 roundId, address payable receiver) external nonReentrant {
        RewardRound storage round = rewardRounds[roundId];
        if (!hasJoinedReward[roundId][msg.sender] || rewardClaimed[roundId][msg.sender]) revert CannotClaimReward();
        if (receiver == address(0)) revert InvalidConfiguration();
        if (!round.settled) _settleRewardRound(roundId);
        rewardClaimed[roundId][msg.sender] = true;
        (bool sent,) = receiver.call{value: round.sharePerParticipant}("");
        if (!sent) revert PayoutFailed();
        emit RewardClaimed(roundId, msg.sender, receiver, round.sharePerParticipant);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata) external view returns (bytes4) {
        if (msg.sender != _expectedNFT || operator != address(this) || from != _expectedSeller || tokenId != _expectedTokenId) revert UnexpectedNFT();
        return IERC721Receiver.onERC721Received.selector;
    }
}
