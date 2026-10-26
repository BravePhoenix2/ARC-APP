const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const PRICE = ethers.parseUnits("2", 18);
const CREATOR_FEE_BPS = 250n;
const MINT_SURCHARGE_BPS = 200n;
const mintPayment = base => base + base * MINT_SURCHARGE_BPS / 10_000n;

async function deployStudio() {
  const [creator, minter, other] = await ethers.getSigners();
  const factory = await ethers.deployContract("ArticStudioFactory", [other.address, CREATOR_FEE_BPS, MINT_SURCHARGE_BPS]);
  await factory.waitForDeployment();
  return { factory, creator, minter, other };
}

async function createCollection(factory, creator, options = {}) {
  const start = options.start ?? (await time.latest()) + 30;
  const args = ["Test Collection", "TEST", options.metadataURI ?? "ipfs://metadata.json", options.price ?? PRICE, start,
    options.supply ?? 10, options.perWallet ?? 3, options.royalty ?? 500];
  const tx = options.edition
    ? await factory.connect(creator).createEdition(...args)
    : await factory.connect(creator).create721(...args, options.soulbound ?? false);
  const receipt = await tx.wait();
  const event = receipt.logs.map(log => { try { return factory.interface.parseLog(log); } catch { return null; } })
    .find(event => event?.name === "CollectionCreated");
  const collection = await ethers.getContractAt(options.edition ? "ArticEdition" : "ArticStudioCollection", event.args.collection);
  return { collection, start, event };
}

describe("NFT Studio", function () {
  it("assigns a different metadata URI to each token in a numbered image series", async function () {
    const { factory, creator, minter } = await loadFixture(deployStudio);
    expect(await factory.supportsImageSeries()).to.equal(true);
    const { collection, start } = await createCollection(factory, creator, { metadataURI: "https://artiq.example/api/items/series/metadata/", supply: 3 });
    await expect(collection.tokenURI(1)).to.be.revertedWithCustomError(collection, "ERC721NonexistentToken");
    await time.increaseTo(start);
    await collection.connect(minter).mint(3, { value: mintPayment(PRICE * 3n) });
    for (let id = 1; id <= 3; id++) expect(await collection.tokenURI(id)).to.equal(`https://artiq.example/api/items/series/metadata/${id}`);
    expect(await collection.metadataURI()).to.equal("https://artiq.example/api/items/series/metadata/");
  });
  it("creates creator-owned ERC-721 and ERC-1155 collections and indexes their standard", async function () {
    const { factory, creator } = await loadFixture(deployStudio);
    const { collection: nft, event } = await createCollection(factory, creator);
    const { collection: edition } = await createCollection(factory, creator, { edition: true });
    expect(await nft.owner()).to.equal(creator.address);
    expect(await edition.owner()).to.equal(creator.address);
    expect(event.args.standard).to.equal(1);
    const entries = await factory.getAllCollections();
    expect(entries.length).to.equal(2);
    expect(entries[1].standard).to.equal(2);
    expect(await factory.collectionCreator(await edition.getAddress())).to.equal(creator.address);
    expect(await factory.getCollectionsByCreator(creator.address)).to.have.length(2);
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await edition.supportsInterface("0xd9b67a26")).to.equal(true);
    expect(await factory.supportsMintSurcharge()).to.equal(true);
    expect(await factory.platformFeeBps()).to.equal(CREATOR_FEE_BPS);
    expect(await factory.mintSurchargeBps()).to.equal(MINT_SURCHARGE_BPS);
    expect(await nft.supportsMintSurcharge()).to.equal(true);
    expect(await nft.platformFeeBps()).to.equal(CREATOR_FEE_BPS);
    expect(await nft.mintSurchargeBps()).to.equal(MINT_SURCHARGE_BPS);
    expect(await edition.supportsMintSurcharge()).to.equal(true);
    expect(await edition.platformFeeBps()).to.equal(CREATOR_FEE_BPS);
    expect(await edition.mintSurchargeBps()).to.equal(MINT_SURCHARGE_BPS);
  });

  it("uses native USDC at 18 decimals, fixed metadata and withdrawable creator proceeds", async function () {
    const { factory, creator, minter } = await loadFixture(deployStudio);
    const { collection, start } = await createCollection(factory, creator);
    await expect(collection.connect(minter).mint(1, { value: PRICE })).to.be.revertedWithCustomError(collection, "MintingNotStarted");
    await time.increaseTo(start);
    await expect(collection.connect(minter).mint(1, { value: ethers.parseUnits("2", 6) })).to.be.revertedWithCustomError(collection, "IncorrectPayment");
    await expect(collection.connect(minter).mint(2, { value: PRICE * 2n })).to.be.revertedWithCustomError(collection, "IncorrectPayment");
    const baseAmount = PRICE * 2n;
    const creatorFee = baseAmount * CREATOR_FEE_BPS / 10_000n;
    const surcharge = baseAmount * MINT_SURCHARGE_BPS / 10_000n;
    const platformRevenue = creatorFee + surcharge;
    const creatorProceeds = baseAmount - creatorFee;
    await collection.connect(minter).mint(2, { value: baseAmount + surcharge });
    expect(await collection.ownerOf(1)).to.equal(minter.address);
    expect(await collection.ownerOf(2)).to.equal(minter.address);
    expect(await collection.tokenURI(2)).to.equal("ipfs://metadata.json");
    expect(await factory.pendingPlatformFees()).to.equal(platformRevenue);
    expect(await ethers.provider.getBalance(await collection.getAddress())).to.equal(creatorProceeds);
    await expect(collection.connect(minter).withdraw(minter.address)).to.be.revertedWithCustomError(collection, "OwnableUnauthorizedAccount");
    await expect(collection.withdraw(creator.address)).to.changeEtherBalances([collection, creator], [-creatorProceeds, creatorProceeds]);
  });

  it("enforces supply, wallet and batch limits without granting eligibility on failed mints", async function () {
    const { factory, creator, minter, other } = await loadFixture(deployStudio);
    const { collection, start } = await createCollection(factory, creator, { supply: 3, perWallet: 2 });
    await time.increaseTo(start);
    await expect(collection.connect(minter).mint(0)).to.be.revertedWithCustomError(collection, "InvalidQuantity");
    await expect(collection.connect(minter).mint(1)).to.be.revertedWithCustomError(collection, "IncorrectPayment");
    expect(await factory.hasMinted(minter.address)).to.equal(false);
    await collection.connect(minter).mint(2, { value: mintPayment(PRICE * 2n) });
    expect(await factory.hasMinted(minter.address)).to.equal(true);
    await expect(collection.connect(minter).mint(1, { value: PRICE })).to.be.revertedWithCustomError(collection, "ExceedsWalletLimit");
    await collection.connect(other).mint(1, { value: mintPayment(PRICE) });
    await expect(collection.connect(other).mint(1, { value: PRICE })).to.be.revertedWithCustomError(collection, "ExceedsMaxSupply");
  });

  it("permanently locks soulbound tokens and disallows transfer approvals", async function () {
    const { factory, creator, minter, other } = await loadFixture(deployStudio);
    const { collection, start } = await createCollection(factory, creator, { soulbound: true });
    await time.increaseTo(start);
    await expect(collection.connect(minter).mint(1, { value: mintPayment(PRICE) })).to.emit(collection, "Locked").withArgs(1);
    expect(await collection.supportsInterface("0xb45a3c0e")).to.equal(true);
    expect(await collection.locked(1)).to.equal(true);
    await expect(collection.connect(minter).transferFrom(minter.address, other.address, 1)).to.be.revertedWithCustomError(collection, "Soulbound");
    await expect(collection.connect(minter).approve(other.address, 1)).to.be.revertedWithCustomError(collection, "Soulbound");
    await expect(collection.connect(minter).setApprovalForAll(other.address, true)).to.be.revertedWithCustomError(collection, "Soulbound");
    await collection.connect(minter).setApprovalForAll(other.address, false);
    await expect(collection.locked(999)).to.be.revertedWithCustomError(collection, "ERC721NonexistentToken");
  });

  it("keeps standard and membership tokens transferable and returns ERC-2981 royalties", async function () {
    const { factory, creator, minter, other } = await loadFixture(deployStudio);
    const { collection, start } = await createCollection(factory, creator);
    await time.increaseTo(start);
    await collection.connect(minter).mint(1, { value: mintPayment(PRICE) });
    expect(await collection.locked(1)).to.equal(false);
    await collection.connect(minter).transferFrom(minter.address, other.address, 1);
    expect(await collection.ownerOf(1)).to.equal(other.address);
    expect(await collection.supportsInterface("0x2a55205a")).to.equal(true);
    expect(await collection.royaltyInfo(1, PRICE)).to.deep.equal([creator.address, PRICE / 20n]);
  });

  it("mints transferable ERC-1155 editions and authenticates their mint activity", async function () {
    const { factory, creator, minter, other } = await loadFixture(deployStudio);
    const { collection, start } = await createCollection(factory, creator, { edition: true, supply: 5, perWallet: 3 });
    await time.increaseTo(start);
    await collection.connect(minter).mint(3, { value: mintPayment(PRICE * 3n) });
    expect(await collection.balanceOf(minter.address, 1)).to.equal(3);
    expect(await collection.totalMinted()).to.equal(3);
    expect(await collection.uri(1)).to.equal("ipfs://metadata.json");
    expect(await factory.hasMinted(minter.address)).to.equal(true);
    await expect(collection.connect(minter).mint(1, { value: PRICE })).to.be.revertedWithCustomError(collection, "ExceedsWalletLimit");
    await collection.connect(minter).safeTransferFrom(minter.address, other.address, 1, 1, "0x");
    expect(await collection.balanceOf(other.address, 1)).to.equal(1);
    // Merely receiving a transferred NFT is not the "minted" activity requirement.
    expect(await factory.hasMinted(other.address)).to.equal(false);
    expect(await collection.royaltyInfo(1, PRICE)).to.deep.equal([creator.address, PRICE / 20n]);
  });

  it("rejects invalid configurations and spoofed mint notifications", async function () {
    const { factory, creator, minter } = await loadFixture(deployStudio);
    await expect(factory.connect(minter).notifyMint(minter.address)).to.be.revertedWithCustomError(factory, "NotRegisteredCollection");
    const invalid = ["Test", "TST", "ipfs://data", PRICE, 0, 0, 1, 0, false];
    await expect(factory.connect(creator).create721(...invalid)).to.be.reverted;
    await expect(factory.connect(creator).create721("Test", "TST", "ipfs://data", PRICE, 0, 10, 1, 1001, false)).to.be.reverted;
    await expect(factory.connect(creator).create721("Test", "TST", "x".repeat(4097), PRICE, 0, 10, 1, 0, false)).to.be.reverted;
    await expect(factory.connect(creator).createEdition("x".repeat(481), "TST", "ipfs://data", PRICE, 0, 10, 1, 0)).to.be.reverted;
    expect(await factory.hasMinted(minter.address)).to.equal(false);
  });

  it("accepts a 120-character Unicode title for both NFT standards", async function () {
    const { factory, creator } = await loadFixture(deployStudio);
    const title = "🎨".repeat(120);
    await factory.connect(creator).create721(title, "ART", "ipfs://data", 0, 0, 10, 1, 0, false);
    await factory.connect(creator).createEdition(title, "ART", "ipfs://data", 0, 0, 10, 1, 0);
    const [nftAddress, editionAddress] = await factory.getCollectionsByCreator(creator.address);
    expect(await (await ethers.getContractAt("ArticStudioCollection", nftAddress)).name()).to.equal(title);
    expect(await (await ethers.getContractAt("ArticEdition", editionAddress)).name()).to.equal(title);
  });
});
