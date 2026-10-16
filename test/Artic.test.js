const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const MINT_PRICE = ethers.parseUnits("10", 6); // 10 "USDC" (6 decimals), paid as native value
const MAX_SUPPLY = 100;
const MAX_PER_WALLET = 5;

async function deployNFT(overrides = {}) {
  const [creator, other] = await ethers.getSigners();
  const startTime = overrides.startTime ?? (await time.latest()) + 3600; // 1 hour from now

  const ArticNFT = await ethers.getContractFactory("ArticNFT");
  const nft = await ArticNFT.deploy(
    overrides.name ?? "Test Collection",
    overrides.symbol ?? "TEST",
    overrides.baseURI ?? "ipfs://base/",
    overrides.mintPrice ?? MINT_PRICE,
    startTime,
    overrides.maxSupply ?? MAX_SUPPLY,
    overrides.maxPerWallet ?? MAX_PER_WALLET,
    overrides.creator ?? creator.address
  );
  await nft.waitForDeployment();
  return { nft, creator, other, startTime };
}

describe("ArticNFT", function () {
  describe("mint timing", function () {
    it("fails to mint before the mint start time", async function () {
      const { nft, other } = await deployNFT();

      await expect(nft.connect(other).mint(1, { value: MINT_PRICE })).to.be.revertedWithCustomError(
        nft,
        "MintingNotStarted"
      );
    });

    it("mints successfully once the start time has passed", async function () {
      const { nft, other, startTime } = await deployNFT();

      await time.increaseTo(startTime);

      await expect(nft.connect(other).mint(1, { value: MINT_PRICE }))
        .to.emit(nft, "Minted")
        .withArgs(other.address, 1, 1, MINT_PRICE);

      expect(await nft.ownerOf(1)).to.equal(other.address);
      expect(await nft.totalMinted()).to.equal(1);
    });

    it("rejects incorrect payment amounts", async function () {
      const { nft, other, startTime } = await deployNFT();
      await time.increaseTo(startTime);

      await expect(
        nft.connect(other).mint(1, { value: MINT_PRICE - 1n })
      ).to.be.revertedWithCustomError(nft, "IncorrectPayment");
    });

    it("forwards mint payments to the creator", async function () {
      const { nft, creator, other, startTime } = await deployNFT();
      await time.increaseTo(startTime);

      await expect(
        nft.connect(other).mint(2, { value: MINT_PRICE * 2n })
      ).to.changeEtherBalances([other, creator], [-(MINT_PRICE * 2n), MINT_PRICE * 2n]);
    });

    it("enforces max supply and per-wallet limits", async function () {
      const { nft, other, startTime } = await deployNFT({ maxSupply: 2, maxPerWallet: 1 });
      await time.increaseTo(startTime);

      await nft.connect(other).mint(1, { value: MINT_PRICE });
      await expect(nft.connect(other).mint(1, { value: MINT_PRICE })).to.be.revertedWithCustomError(
        nft,
        "ExceedsWalletLimit"
      );
    });
  });

  describe("rescheduling the mint start time", function () {
    it("lets the creator reschedule before minting begins", async function () {
      const { nft, creator, startTime } = await deployNFT();
      const newStartTime = startTime + 3600;

      await expect(nft.connect(creator).setMintStartTime(newStartTime))
        .to.emit(nft, "MintStartTimeUpdated")
        .withArgs(startTime, newStartTime);

      expect(await nft.mintStartTime()).to.equal(newStartTime);
    });

    it("blocks anyone other than the creator from rescheduling", async function () {
      const { nft, other, startTime } = await deployNFT();

      await expect(nft.connect(other).setMintStartTime(startTime + 3600)).to.be.revertedWithCustomError(
        nft,
        "OwnableUnauthorizedAccount"
      );
    });

    it("refuses to reschedule once minting has already started", async function () {
      const { nft, creator, startTime } = await deployNFT();
      await time.increaseTo(startTime);

      await expect(nft.connect(creator).setMintStartTime(startTime + 3600)).to.be.revertedWithCustomError(
        nft,
        "MintingAlreadyStarted"
      );
    });
  });
});

describe("ArticFactory", function () {
  it("deploys a collection owned by the caller and indexes it", async function () {
    const [, creator] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ArticFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();

    const startTime = (await time.latest()) + 3600;
    const tx = await factory
      .connect(creator)
      .createCollection("My Drop", "DROP", "ipfs://base/", MINT_PRICE, startTime, MAX_SUPPLY, MAX_PER_WALLET);
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "CollectionCreated");

    expect(event).to.not.be.undefined;
    expect(event.args.creator).to.equal(creator.address);

    const collections = await factory.getCollectionsByCreator(creator.address);
    expect(collections).to.have.lengthOf(1);
    expect(collections[0]).to.equal(event.args.collection);

    const ArticNFT = await ethers.getContractFactory("ArticNFT");
    const nft = ArticNFT.attach(event.args.collection);
    expect(await nft.owner()).to.equal(creator.address);
  });
});

describe("ArticMarketplace", function () {
  async function deployMarketplaceWithMintedToken() {
    const [deployer, seller, buyer] = await ethers.getSigners();

    const Marketplace = await ethers.getContractFactory("ArticMarketplace");
    const marketplace = await Marketplace.deploy(deployer.address, deployer.address);
    await marketplace.waitForDeployment();

    const { nft, startTime } = await deployNFT({ creator: seller.address });
    await time.increaseTo(startTime);
    await nft.connect(seller).mint(1, { value: MINT_PRICE });

    return { marketplace, nft, deployer, seller, buyer };
  }

  it("lists and buys an NFT, paying the seller and the marketplace fee in USDC", async function () {
    const { marketplace, nft, deployer, seller, buyer } = await deployMarketplaceWithMintedToken();
    const price = ethers.parseUnits("50", 6);

    await nft.connect(seller).approve(await marketplace.getAddress(), 1);

    await expect(marketplace.connect(seller).listItem(await nft.getAddress(), 1, price))
      .to.emit(marketplace, "ItemListed")
      .withArgs(await nft.getAddress(), 1, seller.address, price);

    const fee = (price * 250n) / 10000n;
    const sellerProceeds = price - fee;

    await expect(
      marketplace.connect(buyer).buyItem(await nft.getAddress(), 1, { value: price })
    ).to.changeEtherBalances([buyer, seller, deployer], [-price, sellerProceeds, fee]);

    expect(await nft.ownerOf(1)).to.equal(buyer.address);

    const listing = await marketplace.listings(await nft.getAddress(), 1);
    expect(listing.active).to.equal(false);
  });

  it("rejects buying at the wrong price", async function () {
    const { marketplace, nft, seller, buyer } = await deployMarketplaceWithMintedToken();
    const price = ethers.parseUnits("50", 6);

    await nft.connect(seller).approve(await marketplace.getAddress(), 1);
    await marketplace.connect(seller).listItem(await nft.getAddress(), 1, price);

    await expect(
      marketplace.connect(buyer).buyItem(await nft.getAddress(), 1, { value: price - 1n })
    ).to.be.revertedWithCustomError(marketplace, "IncorrectPayment");
  });

  it("lets the seller delist and update price, and blocks non-sellers", async function () {
    const { marketplace, nft, seller, buyer } = await deployMarketplaceWithMintedToken();
    const price = ethers.parseUnits("50", 6);

    await nft.connect(seller).approve(await marketplace.getAddress(), 1);
    await marketplace.connect(seller).listItem(await nft.getAddress(), 1, price);

    await expect(
      marketplace.connect(buyer).updatePrice(await nft.getAddress(), 1, price + 1n)
    ).to.be.revertedWithCustomError(marketplace, "NotSeller");

    const newPrice = ethers.parseUnits("60", 6);
    await marketplace.connect(seller).updatePrice(await nft.getAddress(), 1, newPrice);
    expect((await marketplace.listings(await nft.getAddress(), 1)).price).to.equal(newPrice);

    await marketplace.connect(seller).delistItem(await nft.getAddress(), 1);
    expect((await marketplace.listings(await nft.getAddress(), 1)).active).to.equal(false);
  });

  it("requires marketplace approval before listing", async function () {
    const { marketplace, nft, seller } = await deployMarketplaceWithMintedToken();

    await expect(
      marketplace.connect(seller).listItem(await nft.getAddress(), 1, ethers.parseUnits("50", 6))
    ).to.be.revertedWithCustomError(marketplace, "MarketplaceNotApproved");
  });
});
