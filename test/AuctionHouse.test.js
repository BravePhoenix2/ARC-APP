const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = value => ethers.parseUnits(String(value), 18);

async function deployPlatform() {
  const [creator, seller, bidder, other, sponsor, ineligible, treasury] = await ethers.getSigners();
  const factory = await ethers.deployContract("ArticStudioFactory", [treasury.address, 250]);
  const art = await ethers.deployContract("ArticArtMarket", [treasury.address, 250]);
  const auction = await ethers.deployContract("ArticAuctionHouse", [await factory.getAddress(), await art.getAddress(), treasury.address, 250]);
  await factory.connect(creator).create721("Auction collection", "AUCT", "ipfs://token.json", 0, 0, 100, 10, 500, false);
  const [collectionAddress] = await factory.getCollectionsByCreator(creator.address);
  const nft = await ethers.getContractAt("ArticStudioCollection", collectionAddress);
  await nft.connect(seller).mint(2);
  return { factory, art, auction, nft, creator, seller, bidder, other, sponsor, ineligible, treasury };
}

async function createAuction(context, options = {}) {
  const { nft, seller, auction } = context;
  const ends = (await time.latest()) + 120;
  await nft.connect(seller).approve(await auction.getAddress(), 1);
  await auction.connect(seller).createAuction(await nft.getAddress(), 1, options.reserve ?? USDC(1), ends);
  return ends;
}

describe("ArticAuctionHouse auctions", function () {
  it("escrows an approved ERC-721 and requires the reserve then a five-percent increase", async function () {
    const ctx = await loadFixture(deployPlatform);
    const { auction, nft, seller, bidder, other } = ctx;
    await createAuction(ctx);
    expect(await nft.ownerOf(1)).to.equal(await auction.getAddress());
    await expect(auction.connect(seller).bid(1, { value: USDC(1) })).to.be.revertedWithCustomError(auction, "SellerCannotBid");
    await expect(auction.connect(bidder).bid(1, { value: USDC(1) - 1n })).to.be.revertedWithCustomError(auction, "BidTooLow");
    await auction.connect(bidder).bid(1, { value: USDC(1) });
    expect(await auction.minimumBid(1)).to.equal(USDC("1.05"));
    await expect(auction.connect(other).bid(1, { value: USDC("1.049") })).to.be.revertedWithCustomError(auction, "BidTooLow");
    await auction.connect(other).bid(1, { value: USDC("1.05") });
    expect(await auction.pendingReturns(bidder.address)).to.equal(USDC(1));
    await expect(auction.connect(bidder).withdraw(other.address)).to.changeEtherBalances([auction, other], [-USDC(1), USDC(1)]);
    expect(await auction.pendingReturns(bidder.address)).to.equal(0);
  });

  it("settles permissionlessly after the deadline, credits royalties and lets only the winner retrieve the NFT", async function () {
    const ctx = await loadFixture(deployPlatform);
    const { auction, nft, creator, seller, bidder, other } = ctx;
    const ends = await createAuction(ctx);
    await auction.connect(bidder).bid(1, { value: USDC(2) });
    await expect(auction.settle(1)).to.be.revertedWithCustomError(auction, "AuctionStillOpen");
    await time.increaseTo(ends);
    await expect(auction.connect(other).bid(1, { value: USDC(3) })).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
    await auction.connect(other).settle(1);
    expect(await auction.pendingReturns(creator.address)).to.equal(USDC("0.1"));
    expect(await auction.pendingReturns(seller.address)).to.equal(USDC("1.85"));
    expect(await auction.pendingPlatformFees()).to.equal(USDC("0.05"));
    await expect(auction.connect(seller).claimNFT(1, seller.address)).to.be.revertedWithCustomError(auction, "NotNFTRecipient");
    await auction.connect(bidder).claimNFT(1, other.address);
    expect(await nft.ownerOf(1)).to.equal(other.address);
    await expect(auction.settle(1)).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
    await expect(auction.connect(bidder).claimNFT(1, bidder.address)).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
  });

  it("allows cancellation only before bids and returns unsold tokens to their seller", async function () {
    const ctx = await loadFixture(deployPlatform);
    const { auction, nft, seller, bidder } = ctx;
    await createAuction(ctx);
    await expect(auction.connect(bidder).cancelAuction(1)).to.be.revertedWithCustomError(auction, "NotSeller");
    await auction.connect(seller).cancelAuction(1);
    await auction.connect(seller).claimNFT(1, seller.address);
    expect(await nft.ownerOf(1)).to.equal(seller.address);
    const ends = await createAuction(ctx);
    await auction.connect(bidder).bid(2, { value: USDC(1) });
    await expect(auction.connect(seller).cancelAuction(2)).to.be.revertedWithCustomError(auction, "AuctionHasBids");
    await time.increaseTo(ends);
    await auction.settle(2);
  });

  it("rejects soulbound tokens, unsupported assets and accidental safe transfers", async function () {
    const ctx = await loadFixture(deployPlatform);
    const { factory, creator, seller, auction, nft, art } = ctx;
    await factory.connect(creator).create721("Soul", "SOUL", "ipfs://soul", 0, 0, 5, 1, 0, true);
    const addresses = await factory.getCollectionsByCreator(creator.address);
    const soul = await ethers.getContractAt("ArticStudioCollection", addresses[1]);
    await soul.connect(seller).mint(1);
    const ends = (await time.latest()) + 120;
    await expect(auction.connect(seller).createAuction(await soul.getAddress(), 1, USDC(1), ends)).to.be.revertedWithCustomError(auction, "SoulboundNFT");
    await expect(auction.connect(seller).createAuction(await art.getAddress(), 1, USDC(1), ends)).to.be.revertedWithCustomError(auction, "UnsupportedNFT");
    await expect(nft.connect(seller)["safeTransferFrom(address,address,uint256)"](seller.address, await auction.getAddress(), 1)).to.be.revertedWithCustomError(auction, "UnexpectedNFT");
  });

  it("keeps failed refund and NFT deliveries retryable without preventing settlement", async function () {
    const ctx = await loadFixture(deployPlatform);
    const { auction, nft, seller, bidder, other, factory } = ctx;
    const ends = await createAuction(ctx);
    await auction.connect(bidder).bid(1, { value: USDC(1) });
    await auction.connect(other).bid(1, { value: USDC(2) });
    await expect(auction.connect(bidder).withdraw(await factory.getAddress())).to.be.revertedWithCustomError(auction, "PayoutFailed");
    expect(await auction.pendingReturns(bidder.address)).to.equal(USDC(1));
    await time.increaseTo(ends);
    await auction.settle(1);
    await expect(auction.connect(other).claimNFT(1, await factory.getAddress())).to.be.reverted;
    expect((await auction.auctions(1)).nftClaimed).to.equal(false);
    expect(await auction.pendingReturns(seller.address)).to.equal(USDC("1.85"));
    await auction.connect(other).claimNFT(1, other.address);
    expect(await nft.ownerOf(1)).to.equal(other.address);
    await auction.connect(bidder).withdraw(bidder.address);
    expect(await auction.pendingReturns(bidder.address)).to.equal(0);
  });

  it("lets sellers recover auctions that end without bids", async function () {
    const ctx = await loadFixture(deployPlatform);
    const { auction, nft, seller } = ctx;
    const ends = await createAuction(ctx);
    await time.increaseTo(ends);
    await auction.settle(1);
    await auction.connect(seller).claimNFT(1, seller.address);
    expect(await nft.ownerOf(1)).to.equal(seller.address);
    expect(await auction.pendingReturns(seller.address)).to.equal(0);
  });
});

describe("ArticAuctionHouse digital and physical asset auctions", function () {
  it("creates both asset types alongside NFTs without changing existing auction fields", async function () {
    const ctx = await loadFixture(deployPlatform);
    const { auction, seller, nft } = ctx;
    expect(await auction.supportsAssetAuctions()).to.equal(true);
    const ends = await createAuction(ctx);
    expect((await auction.auctions(1)).length).to.equal(9);
    expect((await auction.auctions(1)).nft).to.equal(await nft.getAddress());
    expect((await auction.auctionAssets(1)).assetKey).to.equal(ethers.ZeroHash);
    expect((await auction.auctionAssets(1)).assetKind).to.equal(0);

    for (const kind of [1, 2]) {
      const assetKey = ethers.id(`asset-kind-${kind}`);
      const id = kind + 1;
      await expect(auction.connect(seller).createAssetAuction(assetKey, kind, USDC(1), ends))
        .to.emit(auction, "AssetAuctionCreated").withArgs(id, seller.address, assetKey, kind, USDC(1), ends);
      const asset = await auction.auctionAssets(id);
      const listing = await auction.auctions(id);
      expect(asset.assetKey).to.equal(assetKey);
      expect(asset.assetKind).to.equal(kind);
      expect(await auction.assetAuctionIds(seller.address, assetKey)).to.equal(id);
      expect(listing.length).to.equal(9);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.nft).to.equal(ethers.ZeroAddress);
      expect(listing.tokenId).to.equal(0);
      expect(listing.reservePrice).to.equal(USDC(1));
      expect(listing.endsAt).to.equal(ends);
      expect(listing.settled).to.equal(false);
      expect(await auction.minimumBid(id)).to.equal(USDC(1));
    }
    expect(await auction.nextAuctionId()).to.equal(4);
  });

  it("keeps one recoverable auction per seller and asset key while isolating other sellers", async function () {
    const { auction, seller, other } = await loadFixture(deployPlatform);
    const assetKey = ethers.id("recoverable-asset");
    const ends = (await time.latest()) + 120;
    await auction.connect(seller).createAssetAuction(assetKey, 1, USDC(1), ends);
    await expect(auction.connect(seller).createAssetAuction(assetKey, 1, USDC(1), ends))
      .to.be.revertedWithCustomError(auction, "AssetAlreadyAuctioned").withArgs(1);
    await auction.connect(other).createAssetAuction(assetKey, 2, USDC(2), ends);
    expect(await auction.assetAuctionIds(seller.address, assetKey)).to.equal(1);
    expect(await auction.assetAuctionIds(other.address, assetKey)).to.equal(2);
    await auction.connect(seller).cancelAuction(1);
    await expect(auction.connect(seller).createAssetAuction(assetKey, 1, USDC(1), ends))
      .to.be.revertedWithCustomError(auction, "AssetAlreadyAuctioned").withArgs(1);
    expect(await auction.nextAuctionId()).to.equal(3);
  });

  it("rejects missing identifiers, unsupported kinds, zero reserves and invalid deadlines", async function () {
    const { auction, seller } = await loadFixture(deployPlatform);
    const assetKey = ethers.id("valid-asset");
    const now = await time.latest();
    for (const args of [
      [ethers.ZeroHash, 1, USDC(1), now + 120],
      [assetKey, 0, USDC(1), now + 120],
      [assetKey, 3, USDC(1), now + 120],
      [assetKey, 255, USDC(1), now + 120],
      [assetKey, 1, 0, now + 120],
      [assetKey, 1, USDC(1), now + 59],
      [assetKey, 2, USDC(1), now + 30 * 24 * 60 * 60 + 120],
    ]) {
      await expect(auction.connect(seller).createAssetAuction(...args)).to.be.revertedWithCustomError(auction, "InvalidConfiguration");
    }
    expect(await auction.nextAuctionId()).to.equal(1);
    const starts = (await time.latest()) + 10;
    await time.setNextBlockTimestamp(starts);
    await auction.connect(seller).createAssetAuction(assetKey, 1, USDC(1), starts + 60);
    await time.setNextBlockTimestamp(starts + 1);
    await auction.connect(seller).createAssetAuction(ethers.id("last-allowed-end"), 2, USDC(1), starts + 1 + 30 * 24 * 60 * 60);
  });

  it("accepts repeated bids until the final second and rejects bids at the exact deadline", async function () {
    const { auction, seller, bidder, other } = await loadFixture(deployPlatform);
    const ends = (await time.latest()) + 120;
    await auction.connect(seller).createAssetAuction(ethers.id("timed-digital"), 1, USDC(1), ends);
    await expect(auction.connect(seller).bid(1, { value: USDC(1) })).to.be.revertedWithCustomError(auction, "SellerCannotBid");
    await expect(auction.connect(bidder).bid(1, { value: USDC(1) - 1n })).to.be.revertedWithCustomError(auction, "BidTooLow");
    await auction.connect(bidder).bid(1, { value: USDC(1) });
    expect(await auction.minimumBid(1)).to.equal(USDC("1.05"));
    await expect(auction.connect(other).bid(1, { value: USDC("1.05") - 1n })).to.be.revertedWithCustomError(auction, "BidTooLow");
    await expect(auction.settle(1)).to.be.revertedWithCustomError(auction, "AuctionStillOpen");
    await time.setNextBlockTimestamp(ends - 1);
    await auction.connect(other).bid(1, { value: USDC("1.05") });
    await time.setNextBlockTimestamp(ends);
    await expect(auction.connect(bidder).bid(1, { value: USDC(2) })).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
    expect((await auction.auctions(1)).highestBidder).to.equal(other.address);
    expect(await auction.pendingReturns(bidder.address)).to.equal(USDC(1));
    await auction.settle(1);
    await expect(auction.connect(bidder).bid(1, { value: USDC(2) })).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
  });

  for (const [kind, label] of [[1, "digital"], [2, "physical"]]) {
    it(`settles ${label} sales at the deadline and conserves refunds, proceeds and platform fees`, async function () {
      const { auction, seller, bidder, other, creator, treasury } = await loadFixture(deployPlatform);
      const ends = (await time.latest()) + 120;
      await auction.connect(seller).createAssetAuction(ethers.id(`${label}-sale`), kind, USDC(1), ends);
      await auction.connect(bidder).bid(1, { value: USDC(1) });
      await auction.connect(other).bid(1, { value: USDC(2) });
      await expect(auction.connect(seller).cancelAuction(1)).to.be.revertedWithCustomError(auction, "AuctionHasBids");
      await time.setNextBlockTimestamp(ends);
      await expect(auction.connect(creator).settle(1)).to.emit(auction, "AuctionSettled").withArgs(1, other.address, USDC(2));
      expect(await time.latest()).to.equal(ends);
      expect(await auction.pendingReturns(bidder.address)).to.equal(USDC(1));
      expect(await auction.pendingReturns(seller.address)).to.equal(USDC("1.95"));
      expect(await auction.pendingReturns(creator.address)).to.equal(0);
      expect(await auction.pendingPlatformFees()).to.equal(USDC("0.05"));
      expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(USDC(3));
      await expect(auction.connect(other).claimNFT(1, other.address)).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
      await expect(auction.connect(seller).claimNFT(1, seller.address)).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
      expect((await auction.auctions(1)).nftClaimed).to.equal(false);
      await expect(auction.settle(1)).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
      await expect(auction.connect(bidder).withdraw(bidder.address)).to.changeEtherBalances([auction, bidder], [-USDC(1), USDC(1)]);
      await expect(auction.connect(seller).withdraw(seller.address)).to.changeEtherBalances([auction, seller], [-USDC("1.95"), USDC("1.95")]);
      await expect(auction.connect(treasury).withdrawPlatformFees(treasury.address)).to.changeEtherBalances([auction, treasury], [-USDC("0.05"), USDC("0.05")]);
      expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0);
    });
  }

  it("cancels or settles unsold assets without inventing an NFT claim or charging a fee", async function () {
    const { auction, seller, bidder } = await loadFixture(deployPlatform);
    const ends = (await time.latest()) + 120;
    await auction.connect(seller).createAssetAuction(ethers.id("cancelled-digital"), 1, USDC(1), ends);
    await expect(auction.connect(bidder).cancelAuction(1)).to.be.revertedWithCustomError(auction, "NotSeller");
    await expect(auction.connect(seller).cancelAuction(1)).to.emit(auction, "AuctionCancelled").withArgs(1);
    await expect(auction.connect(bidder).bid(1, { value: USDC(1) })).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
    await expect(auction.connect(seller).claimNFT(1, seller.address)).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
    await auction.connect(seller).createAssetAuction(ethers.id("unsold-physical"), 2, USDC(1), ends);
    await time.increaseTo(ends);
    await auction.settle(2);
    await expect(auction.connect(seller).claimNFT(2, seller.address)).to.be.revertedWithCustomError(auction, "AuctionUnavailable");
    expect(await auction.pendingReturns(seller.address)).to.equal(0);
    expect(await auction.pendingPlatformFees()).to.equal(0);
    expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0);
  });
});

describe("Artic community rewards and original-art checkout", function () {
  it("requires a verified on-chain mint or art purchase and limits the first eligible wallets", async function () {
    const { auction, art, seller, bidder, other, sponsor, ineligible } = await loadFixture(deployPlatform);
    const close = (await time.latest()) + 120;
    await auction.connect(sponsor).createRewardRound(close, 2, { value: USDC(10) });
    await expect(auction.connect(ineligible).joinRewardRound(1)).to.be.revertedWithCustomError(auction, "NotEligible");
    expect(await auction.isRewardEligible(seller.address)).to.equal(true);
    expect(await auction.isRewardEligible(bidder.address)).to.equal(false);
    await art.connect(other).createListing(ethers.id("art-application-1"), USDC(2));
    await expect(art.connect(other).buyListing(1, { value: USDC(2) })).to.be.revertedWithCustomError(art, "SelfPurchase");
    await expect(art.connect(bidder).buyListing(1, { value: USDC(1) })).to.be.revertedWithCustomError(art, "IncorrectPayment");
    await art.connect(bidder).buyListing(1, { value: USDC(2) });
    expect(await auction.isRewardEligible(bidder.address)).to.equal(true);
    expect(await art.pendingReturns(other.address)).to.equal(USDC("1.95"));
    expect(await art.pendingPlatformFees()).to.equal(USDC("0.05"));
    await expect(art.connect(other).withdraw(other.address)).to.changeEtherBalances([art, other], [-USDC("1.95"), USDC("1.95")]);
    await auction.connect(seller).joinRewardRound(1);
    await expect(auction.connect(seller).joinRewardRound(1)).to.be.revertedWithCustomError(auction, "AlreadyJoined");
    await auction.connect(bidder).joinRewardRound(1);
    await expect(auction.connect(other).joinRewardRound(1)).to.be.revertedWithCustomError(auction, "RewardFull");
    expect((await auction.rewardRounds(1)).participantCount).to.equal(2);
    // Bidding does not qualify this otherwise inactive wallet.
    expect(await auction.isRewardEligible(ineligible.address)).to.equal(false);
  });

  it("splits the funded pool among actual participants only after waiting ends, with one claim each", async function () {
    const { auction, seller, sponsor, other } = await loadFixture(deployPlatform);
    const close = (await time.latest()) + 120;
    await auction.connect(sponsor).createRewardRound(close, 10, { value: USDC(10) });
    await auction.connect(seller).joinRewardRound(1);
    await expect(auction.connect(seller).claimReward(1, seller.address)).to.be.revertedWithCustomError(auction, "RewardStillOpen");
    await expect(auction.settleRewardRound(1)).to.be.revertedWithCustomError(auction, "RewardStillOpen");
    await time.increaseTo(close);
    await expect(auction.connect(other).joinRewardRound(1)).to.be.revertedWithCustomError(auction, "RewardUnavailable");
    await expect(auction.connect(seller).claimReward(1, other.address)).to.changeEtherBalances([auction, other], [-USDC(10), USDC(10)]);
    expect((await auction.rewardRounds(1)).sharePerParticipant).to.equal(USDC(10));
    expect(await auction.rewardClaimed(1, seller.address)).to.equal(true);
    await expect(auction.connect(seller).claimReward(1, seller.address)).to.be.revertedWithCustomError(auction, "CannotClaimReward");
    await expect(auction.connect(other).claimReward(1, other.address)).to.be.revertedWithCustomError(auction, "CannotClaimReward");
  });

  it("returns only rounding dust to the sponsor and refunds the entire pool if nobody joins", async function () {
    const { auction, nft, seller, bidder, sponsor } = await loadFixture(deployPlatform);
    await nft.connect(bidder).mint(1);
    const close = (await time.latest()) + 120;
    await auction.connect(sponsor).createRewardRound(close, 3, { value: 11 });
    await auction.connect(seller).joinRewardRound(1);
    await auction.connect(bidder).joinRewardRound(1);
    await auction.connect(sponsor).createRewardRound(close, 2, { value: USDC(3) });
    await time.increaseTo(close);
    await auction.settleRewardRound(1);
    expect((await auction.rewardRounds(1)).sharePerParticipant).to.equal(5);
    expect(await auction.pendingReturns(sponsor.address)).to.equal(1);
    await auction.settleRewardRound(2);
    expect(await auction.pendingReturns(sponsor.address)).to.equal(USDC(3) + 1n);
    await auction.connect(seller).claimReward(1, seller.address);
    await auction.connect(bidder).claimReward(1, bidder.address);
    await auction.connect(sponsor).withdraw(sponsor.address);
    expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0);
  });

  it("preserves a participant's reward if the chosen receiver rejects native USDC", async function () {
    const { auction, factory, seller, sponsor } = await loadFixture(deployPlatform);
    const close = (await time.latest()) + 120;
    await auction.connect(sponsor).createRewardRound(close, 3, { value: USDC(1) });
    await auction.connect(seller).joinRewardRound(1);
    await time.increaseTo(close);
    await expect(auction.connect(seller).claimReward(1, await factory.getAddress())).to.be.revertedWithCustomError(auction, "PayoutFailed");
    expect(await auction.rewardClaimed(1, seller.address)).to.equal(false);
    expect((await auction.rewardRounds(1)).settled).to.equal(false);
    await auction.connect(seller).claimReward(1, seller.address);
    expect(await auction.rewardClaimed(1, seller.address)).to.equal(true);
    expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0);
  });

  it("rejects unfunded or invalid rounds and prevents purchasing cancelled or already sold art", async function () {
    const { auction, art, seller, bidder, sponsor } = await loadFixture(deployPlatform);
    const close = (await time.latest()) + 120;
    await expect(auction.connect(sponsor).createRewardRound(close, 3)).to.be.revertedWithCustomError(auction, "InvalidConfiguration");
    await expect(auction.connect(sponsor).createRewardRound(close, 0, { value: USDC(1) })).to.be.revertedWithCustomError(auction, "InvalidConfiguration");
    await art.connect(seller).createListing(ethers.id("cancelled-art"), USDC(1));
    await expect(art.connect(bidder).cancelListing(1)).to.be.revertedWithCustomError(art, "NotSeller");
    await art.connect(seller).cancelListing(1);
    await expect(art.connect(bidder).buyListing(1, { value: USDC(1) })).to.be.revertedWithCustomError(art, "ListingUnavailable");
    await art.connect(seller).createListing(ethers.id("purchased-art"), USDC(1));
    await art.connect(bidder).buyListing(2, { value: USDC(1) });
    await expect(art.connect(bidder).buyListing(2, { value: USDC(1) })).to.be.revertedWithCustomError(art, "ListingUnavailable");
    await expect(art.connect(seller).cancelListing(2)).to.be.revertedWithCustomError(art, "ListingUnavailable");
  });
});
