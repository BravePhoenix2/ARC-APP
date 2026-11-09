import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();
const { time, loadFixture } = networkHelpers;

const USDC = value => ethers.parseUnits(String(value), 18);
const creatorFee = (base, bps = 250n) => base * bps / 10_000n;
const mintSurcharge = (base, bps = 200n) => base * bps / 10_000n;
const mintPayment = (base, surchargeBps = 200n) => base + mintSurcharge(base, surchargeBps);
const mintRevenue = (base, creatorBps = 250n, surchargeBps = 200n) => creatorFee(base, creatorBps) + mintSurcharge(base, surchargeBps);
const leaf = (key, wallet, tier) => ethers.keccak256(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "uint8"], [key, wallet, tier])));

async function deployMonetizedPlatform() {
  const [creator, seller, buyer, other, treasury] = await ethers.getSigners();
  const factory = await ethers.deployContract("ArticStudioFactory", [treasury.address, 250, 200]);
  const art = await ethers.deployContract("ArticArtMarket", [treasury.address, 250]);
  const auction = await ethers.deployContract("ArticAuctionHouse", [await factory.getAddress(), await art.getAddress(), treasury.address, 250]);
  return { creator, seller, buyer, other, treasury, factory, art, auction };
}

async function collectionFor(factory, creator, edition = false, price = USDC(2)) {
  const args = ["Revenue collection", "REV", "ipfs://revenue", price, 0, 100, 20, 500];
  if (edition) await factory.connect(creator).createEdition(...args);
  else await factory.connect(creator).create721(...args, false);
  const addresses = await factory.getCollectionsByCreator(creator.address);
  return ethers.getContractAt(edition ? "ArticEdition" : "ArticStudioCollection", addresses[addresses.length - 1]);
}

describe("Platform revenue", function () {
  it("rejects zero treasury addresses and rates above 10%, and supports zero fees", async function () {
    const { treasury, factory, art } = await loadFixture(deployMonetizedPlatform);
    for (const name of ["ArticStudioFactory", "ArticArtMarket", "ArticAuctionHouse"]) {
      const prefix = name === "ArticAuctionHouse" ? [await factory.getAddress(), await art.getAddress()] : [];
      const Contract = await ethers.getContractFactory(name);
      const suffix = name === "ArticStudioFactory" ? [200] : [];
      await expect(Contract.deploy(...prefix, ethers.ZeroAddress, 250, ...suffix)).to.be.revertedWithCustomError(Contract, "InvalidFeeRecipient");
      await expect(Contract.deploy(...prefix, treasury.address, 1001, ...suffix)).to.be.revertedWithCustomError(Contract, "PlatformFeeTooHigh");
      if (name === "ArticStudioFactory") {
        await expect(Contract.deploy(treasury.address, 250, 1001)).to.be.revertedWithCustomError(Contract, "PlatformFeeTooHigh");
      }
      const free = await Contract.deploy(...prefix, treasury.address, 0, ...(name === "ArticStudioFactory" ? [0] : []));
      expect(await free.platformFeeBps()).to.equal(0);
      expect(await free.feeRecipient()).to.equal(treasury.address);
      if (name === "ArticStudioFactory") expect(await free.mintSurchargeBps()).to.equal(0);
    }
  });

  for (const edition of [false, true]) it(`charges buyers above the creator price for ${edition ? "ERC-1155" : "ERC-721"} and prevents creator withdrawal bypass`, async function () {
    const { factory, creator, buyer, other, treasury } = await loadFixture(deployMonetizedPlatform);
    const collection = await collectionFor(factory, creator, edition);
    const base = USDC(6), deduction = creatorFee(base), surcharge = mintSurcharge(base);
    const platformRevenue = deduction + surcharge, creatorProceeds = base - deduction, total = base + surcharge;
    expect(await collection.feeRecipient()).to.equal(treasury.address);
    expect(await collection.platformFeeBps()).to.equal(250);
    expect(await collection.mintSurchargeBps()).to.equal(200);
    await expect(collection.connect(buyer).mint(3, { value: base })).to.be.revertedWithCustomError(collection, "IncorrectPayment");
    await expect(collection.connect(buyer).mint(3, { value: total })).to.emit(factory, "PlatformFeeAccrued").withArgs(await collection.getAddress(), platformRevenue);
    expect(await factory.pendingPlatformFees()).to.equal(platformRevenue);
    expect(await factory.totalPlatformFees()).to.equal(platformRevenue);
    expect(await ethers.provider.getBalance(await factory.getAddress())).to.equal(platformRevenue);
    expect(await ethers.provider.getBalance(await collection.getAddress())).to.equal(creatorProceeds);
    await expect(collection.connect(creator).withdraw(creator.address)).to.changeEtherBalances(ethers, [collection, creator], [-creatorProceeds, creatorProceeds]);
    expect(await ethers.provider.getBalance(await factory.getAddress())).to.equal(platformRevenue);
    await expect(factory.connect(creator).withdrawPlatformFees(creator.address)).to.be.revertedWithCustomError(factory, "NotFeeRecipient");
    await expect(factory.connect(treasury).withdrawPlatformFees(other.address)).to.changeEtherBalances(ethers, [factory, other], [-platformRevenue, platformRevenue]);
    expect(await factory.pendingPlatformFees()).to.equal(0);
    expect(await factory.totalPlatformFees()).to.equal(platformRevenue);
    await expect(factory.connect(treasury).withdrawPlatformFees(other.address)).to.be.revertedWithCustomError(factory, "NoPlatformFees");
    await expect(factory.connect(creator).notifyMint(buyer.address, { value: 1 })).to.be.revertedWithCustomError(factory, "NotRegisteredCollection");
  });

  it("charges $5.10, reserves $0.225 and leaves $4.875 for the creator at the standard rates", async function () {
    const { factory, creator, buyer } = await loadFixture(deployMonetizedPlatform);
    const collection = await collectionFor(factory, creator, false, USDC(5));
    await collection.connect(buyer).mint(1, { value: USDC("5.10") });
    expect(await factory.pendingPlatformFees()).to.equal(USDC("0.225"));
    expect(await ethers.provider.getBalance(await collection.getAddress())).to.equal(USDC("4.875"));
  });

  it("applies the creator deduction and buyer surcharge independently", async function () {
    const { creator, buyer, treasury } = await loadFixture(deployMonetizedPlatform);
    const surchargeOnlyFactory = await ethers.deployContract("ArticStudioFactory", [treasury.address, 0, 200]);
    const surchargeOnly = await collectionFor(surchargeOnlyFactory, creator, false, USDC(5));
    await surchargeOnly.connect(buyer).mint(1, { value: USDC("5.10") });
    expect(await surchargeOnlyFactory.pendingPlatformFees()).to.equal(USDC("0.10"));
    expect(await ethers.provider.getBalance(await surchargeOnly.getAddress())).to.equal(USDC(5));

    const deductionOnlyFactory = await ethers.deployContract("ArticStudioFactory", [treasury.address, 250, 0]);
    const deductionOnly = await collectionFor(deductionOnlyFactory, creator, true, USDC(5));
    await deductionOnly.connect(buyer).mint(1, { value: USDC(5) });
    expect(await deductionOnlyFactory.pendingPlatformFees()).to.equal(USDC("0.125"));
    expect(await ethers.provider.getBalance(await deductionOnly.getAddress())).to.equal(USDC("4.875"));
  });

  for (const edition of [false, true]) it(`rounds each ${edition ? "ERC-1155" : "ERC-721"} mint fee down once on the full batch base price`, async function () {
    const { factory, creator, buyer } = await loadFixture(deployMonetizedPlatform);
    const collection = await collectionFor(factory, creator, edition, 199n);
    const base = 199n * 3n;
    const deduction = creatorFee(base);
    const surcharge = mintSurcharge(base);
    const platformRevenue = deduction + surcharge;
    const total = base + surcharge;
    expect(deduction).to.equal(14n);
    expect(surcharge).to.equal(11n);
    await expect(collection.connect(buyer).mint(3, { value: total - 1n })).to.be.revertedWithCustomError(collection, "IncorrectPayment");
    await expect(collection.connect(buyer).mint(3, { value: total + 1n })).to.be.revertedWithCustomError(collection, "IncorrectPayment");
    await collection.connect(buyer).mint(3, { value: total });
    expect(await factory.pendingPlatformFees()).to.equal(platformRevenue);
    expect(await ethers.provider.getBalance(await collection.getAddress())).to.equal(base - deduction);
  });

  for (const edition of [false, true]) it(`charges the actual allowlist price and public price for phased ${edition ? "ERC-1155" : "ERC-721"} mints`, async function () {
    const { factory, creator, buyer } = await loadFixture(deployMonetizedPlatform);
    const start = (await time.latest()) + 100;
    const key = ethers.id(`revenue-phases-${edition}`);
    const config = { root: leaf(key, buyer.address, 1), collectionKey: key, ultimateStart: start, fcfsStart: start + 100, publicStart: start + 200, ultimateLimit: 2, fcfsLimit: 2, publicLimit: 2, ultimatePrice: USDC(1), fcfsPrice: USDC(2) };
    const args = ["Phased revenue", "PHREV", "ipfs://phased", USDC(3), start, 20, 6, 500];
    if (edition) await factory.connect(creator).createEditionWithPhases(...args, config);
    else await factory.connect(creator).create721WithPhases(...args, false, config);
    const [address] = await factory.getCollectionsByCreator(creator.address);
    const collection = await ethers.getContractAt(edition ? "ArticEdition" : "ArticStudioCollection", address);
    await time.increaseTo(start);
    await expect(collection.connect(buyer).mintAllowlisted(1, 1, [], { value: USDC(1) })).to.be.revertedWithCustomError(collection, "IncorrectPayment");
    await collection.connect(buyer).mintAllowlisted(1, 1, [], { value: mintPayment(USDC(1)) });
    expect(await factory.pendingPlatformFees()).to.equal(mintRevenue(USDC(1)));
    await time.increaseTo(start + 100);
    await collection.connect(buyer).mintAllowlisted(1, 1, [], { value: mintPayment(USDC(2)) });
    await time.increaseTo(start + 200);
    await collection.connect(buyer).mint(2, { value: mintPayment(USDC(6)) });
    const total = USDC(9);
    expect(await factory.pendingPlatformFees()).to.equal(mintRevenue(total));
    expect(await ethers.provider.getBalance(address)).to.equal(total - creatorFee(total));
  });

  it("does not charge free mints, zero-rate paid mints or zero-rate art sales", async function () {
    const { factory, creator, buyer, treasury } = await loadFixture(deployMonetizedPlatform);
    const free = await collectionFor(factory, creator, false, 0);
    await free.connect(buyer).mint(1);
    expect(await factory.hasMinted(buyer.address)).to.equal(true);
    expect(await factory.pendingPlatformFees()).to.equal(0);
    const zero = await ethers.deployContract("ArticStudioFactory", [treasury.address, 0, 0]);
    const paid = await collectionFor(zero, creator);
    await paid.connect(buyer).mint(1, { value: USDC(2) });
    expect(await zero.pendingPlatformFees()).to.equal(0);
    expect(await ethers.provider.getBalance(await paid.getAddress())).to.equal(USDC(2));
    const art = await ethers.deployContract("ArticArtMarket", [treasury.address, 0]);
    await art.connect(creator).createListing(ethers.id("zero-rate"), USDC(2));
    await art.connect(buyer).buyListing(1, { value: USDC(2) });
    expect(await art.pendingPlatformFees()).to.equal(0);
    expect(await art.pendingReturns(creator.address)).to.equal(USDC(2));
  });

  it("supports a 10% creator mint fee, 2% buyer surcharge and 1% marketplace fee with exact amounts", async function () {
    const { creator, seller, buyer, treasury } = await loadFixture(deployMonetizedPlatform);
    const factory = await ethers.deployContract("ArticStudioFactory", [treasury.address, 1000, 200]);
    const art = await ethers.deployContract("ArticArtMarket", [treasury.address, 100]);
    const auction = await ethers.deployContract("ArticAuctionHouse", [await factory.getAddress(), await art.getAddress(), treasury.address, 100]);
    const collection = await collectionFor(factory, creator, false, USDC(100));
    await collection.connect(seller).mint(1, { value: mintPayment(USDC(100)) });
    expect(await factory.pendingPlatformFees()).to.equal(USDC(12));
    expect(await ethers.provider.getBalance(await collection.getAddress())).to.equal(USDC(90));
    await art.connect(seller).createListing(ethers.id("one-percent"), USDC(100));
    await art.connect(buyer).buyListing(1, { value: USDC(100) });
    expect(await art.pendingPlatformFees()).to.equal(USDC(1));
    expect(await art.pendingReturns(seller.address)).to.equal(USDC(99));
    await collection.connect(seller).approve(await auction.getAddress(), 1);
    const ends = (await time.latest()) + 100;
    await auction.connect(seller).createAuction(await collection.getAddress(), 1, USDC(100), ends);
    await auction.connect(buyer).bid(1, { value: USDC(100) });
    await time.increaseTo(ends);
    await auction.settle(1);
    expect(await auction.pendingPlatformFees()).to.equal(USDC(1));
    expect(await auction.pendingReturns(creator.address)).to.equal(USDC(5));
    expect(await auction.pendingReturns(seller.address)).to.equal(USDC(94));
  });

  it("keeps art seller balances separate from treasury fees and rolls failed withdrawals back", async function () {
    const { art, factory, seller, buyer, other, treasury } = await loadFixture(deployMonetizedPlatform);
    const gross = USDC(20), platformFee = creatorFee(gross), net = gross - platformFee;
    await art.connect(seller).createListing(ethers.id("original"), gross);
    await art.connect(buyer).buyListing(1, { value: gross });
    expect(await art.pendingReturns(seller.address)).to.equal(net);
    expect(await art.pendingReturns(treasury.address)).to.equal(0);
    expect(await art.pendingPlatformFees()).to.equal(platformFee);
    await expect(art.connect(seller).withdrawPlatformFees(seller.address)).to.be.revertedWithCustomError(art, "NotFeeRecipient");
    await expect(art.connect(treasury).withdrawPlatformFees(ethers.ZeroAddress)).to.be.revertedWithCustomError(art, "InvalidFeeRecipient");
    await expect(art.connect(treasury).withdrawPlatformFees(await factory.getAddress())).to.be.revertedWithCustomError(art, "PlatformFeePayoutFailed");
    expect(await art.pendingPlatformFees()).to.equal(platformFee);
    expect(await art.totalPlatformFees()).to.equal(platformFee);
    await art.connect(treasury).withdrawPlatformFees(other.address);
    expect(await art.pendingReturns(seller.address)).to.equal(net);
    await art.connect(seller).withdraw(seller.address);
    expect(await ethers.provider.getBalance(await art.getAddress())).to.equal(0);
  });

  it("preserves every refund and reward while charging only a settled winning sale", async function () {
    const { factory, auction, creator, seller, buyer, other, treasury } = await loadFixture(deployMonetizedPlatform);
    const collection = await collectionFor(factory, creator, false, 0);
    await collection.connect(seller).mint(2);
    await collection.connect(seller).approve(await auction.getAddress(), 1);
    const ends = (await time.latest()) + 100;
    await auction.connect(seller).createAuction(await collection.getAddress(), 1, USDC(1), ends);
    await auction.connect(buyer).bid(1, { value: USDC(1) });
    await auction.connect(other).bid(1, { value: USDC(2) });
    await auction.connect(creator).createRewardRound(ends, 10, { value: USDC(10) });
    await auction.connect(seller).joinRewardRound(1);
    expect(await auction.pendingPlatformFees()).to.equal(0);
    expect(await auction.pendingReturns(buyer.address)).to.equal(USDC(1));
    await time.increaseTo(ends);
    await auction.settle(1);
    expect(await auction.pendingPlatformFees()).to.equal(USDC("0.05"));
    expect(await auction.pendingReturns(creator.address)).to.equal(USDC("0.1"));
    expect(await auction.pendingReturns(seller.address)).to.equal(USDC("1.85"));
    await auction.connect(treasury).withdrawPlatformFees(treasury.address);
    await auction.connect(buyer).withdraw(buyer.address);
    await auction.connect(creator).withdraw(creator.address);
    await auction.connect(seller).withdraw(seller.address);
    await auction.connect(seller).claimReward(1, seller.address);
    expect(await auction.totalPlatformFees()).to.equal(USDC("0.05"));
    expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0);
    await collection.connect(seller).approve(await auction.getAddress(), 2);
    const unsoldEnds = (await time.latest()) + 100;
    await auction.connect(seller).createAuction(await collection.getAddress(), 2, USDC(1), unsoldEnds);
    await time.increaseTo(unsoldEnds);
    await auction.settle(2);
    expect(await auction.pendingPlatformFees()).to.equal(0);
    expect(await auction.totalPlatformFees()).to.equal(USDC("0.05"));
  });

  it("lets a rejecting treasury accrue and later direct fees without blocking any sales", async function () {
    const { creator, seller, buyer, other } = await loadFixture(deployMonetizedPlatform);
    const treasury = await ethers.deployContract("PlatformFeeTestReceiver");
    const recipient = await treasury.getAddress();
    const factory = await ethers.deployContract("ArticStudioFactory", [recipient, 250, 200]);
    const art = await ethers.deployContract("ArticArtMarket", [recipient, 250]);
    const auction = await ethers.deployContract("ArticAuctionHouse", [await factory.getAddress(), await art.getAddress(), recipient, 250]);
    const collection = await collectionFor(factory, creator);
    await collection.connect(seller).mint(1, { value: mintPayment(USDC(2)) });
    await art.connect(seller).createListing(ethers.id("rejecting-treasury"), USDC(2));
    await art.connect(buyer).buyListing(1, { value: USDC(2) });
    await collection.connect(seller).approve(await auction.getAddress(), 1);
    const ends = (await time.latest()) + 100;
    await auction.connect(seller).createAuction(await collection.getAddress(), 1, USDC(1), ends);
    await auction.connect(buyer).bid(1, { value: USDC(2) });
    await time.increaseTo(ends);
    await auction.settle(1);
    for (const [contract, expectedFee] of [[factory, USDC("0.09")], [art, USDC("0.05")], [auction, USDC("0.05")]]) {
      expect(await contract.pendingPlatformFees()).to.equal(expectedFee);
      await expect(treasury.withdrawFees(await contract.getAddress(), recipient)).to.be.revertedWithCustomError(contract, "PlatformFeePayoutFailed");
      expect(await contract.pendingPlatformFees()).to.equal(expectedFee);
      await expect(treasury.withdrawFees(await contract.getAddress(), other.address)).to.changeEtherBalance(ethers, other, expectedFee);
      expect(await contract.pendingPlatformFees()).to.equal(0);
    }
  });

  for (const rejectsRoyalty of [false, true]) it(`settles safely when a royalty hook ${rejectsRoyalty ? "reverts" : "requests more than the sale proceeds"}`, async function () {
    const { auction, seller, buyer, creator } = await loadFixture(deployMonetizedPlatform);
    const nft = await (await ethers.getContractFactory("PlatformFeeTestNFT", seller)).deploy(creator.address, rejectsRoyalty);
    await nft.approve(await auction.getAddress(), 1);
    const ends = (await time.latest()) + 100;
    await auction.connect(seller).createAuction(await nft.getAddress(), 1, USDC(1), ends);
    await auction.connect(buyer).bid(1, { value: USDC(2) });
    await time.increaseTo(ends);
    await auction.settle(1);
    expect(await auction.pendingPlatformFees()).to.equal(USDC("0.05"));
    expect(await auction.pendingReturns(creator.address)).to.equal(rejectsRoyalty ? 0 : USDC("1.95"));
    expect(await auction.pendingReturns(seller.address)).to.equal(rejectsRoyalty ? USDC("1.95") : 0);
    await auction.connect(buyer).claimNFT(1, buyer.address);
    expect(await nft.ownerOf(1)).to.equal(buyer.address);
  });
});
