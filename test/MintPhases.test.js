const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const leaf = (key, wallet, tier) => ethers.keccak256(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "uint8"], [key, wallet, tier])));
const pair = (a, b) => ethers.keccak256(ethers.concat([a, b].sort()));
describe("Phased mint access", function () {
  for (const edition of [false, true]) it(`enforces phase windows, proofs, payments and cumulative wallet caps for ${edition ? "1155" : "721"}`, async function () {
    const [creator, ultimate, fcfs, publicWallet] = await ethers.getSigners();
    const factory = await ethers.deployContract("ArticStudioFactory", [creator.address, 250]);
    const start = await time.latest() + 100;
    const key = ethers.id("collection-one"); const a = leaf(key, ultimate.address, 1); const b = leaf(key, fcfs.address, 2);
    const config = { root: pair(a, b), collectionKey: key, ultimateStart: start, fcfsStart: start + 100, publicStart: start + 200, ultimateLimit: 1, fcfsLimit: 1, publicLimit: 2, ultimatePrice: 1, fcfsPrice: 2 };
    const args = ["Phases", "PH", "ipfs://metadata", 3, start, 10, 3, 500];
    const transaction = edition ? await factory.createEditionWithPhases(...args, config) : await factory.create721WithPhases(...args, false, config);
    const receipt = await transaction.wait();
    const address = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } }).find(l => l?.name === "CollectionCreated").args.collection;
    const nft = await ethers.getContractAt(edition ? "ArticEdition" : "ArticStudioCollection", address);
    expect(await factory.supportsMintPhases()).to.equal(true);
    await expect(nft.configurePhases(config)).to.be.revertedWithCustomError(nft, "InvalidPhases");
    await expect(nft.connect(ultimate).mintAllowlisted(1, 1, [b], { value: 1 })).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
    await time.increaseTo(start);
    await expect(nft.connect(ultimate).mint(1, { value: 3 })).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
    await expect(nft.connect(fcfs).mintAllowlisted(1, 2, [a], { value: 1 })).to.be.revertedWithCustomError(nft, "NotAllowlisted");
    await expect(nft.connect(publicWallet).mintAllowlisted(1, 1, [b], { value: 1 })).to.be.revertedWithCustomError(nft, "NotAllowlisted");
    await expect(nft.connect(ultimate).mintAllowlisted(1, 1, [b], { value: 2 })).to.be.revertedWithCustomError(nft, "IncorrectPayment");
    await nft.connect(ultimate).mintAllowlisted(1, 1, [b], { value: 1 });
    await expect(nft.connect(ultimate).mintAllowlisted(1, 1, [b], { value: 1 })).to.be.revertedWithCustomError(nft, "PhaseLimitExceeded");
    await time.increaseTo(start + 100);
    await nft.connect(fcfs).mintAllowlisted(1, 2, [a], { value: 2 });
    await nft.connect(ultimate).mintAllowlisted(1, 1, [b], { value: 2 });
    await expect(nft.connect(fcfs).mintAllowlisted(1, 1, [a], { value: 2 })).to.be.revertedWithCustomError(nft, "NotAllowlisted");
    await time.increaseTo(start + 200);
    await expect(nft.connect(ultimate).mintAllowlisted(1, 1, [b], { value: 1 })).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
    await expect(nft.connect(ultimate).mint(2, { value: 6 })).to.be.revertedWithCustomError(nft, "ExceedsWalletLimit");
    await nft.connect(ultimate).mint(1, { value: 3 });
    await nft.connect(publicWallet).mint(2, { value: 6 });
    await expect(nft.connect(publicWallet).mint(1, { value: 3 })).to.be.revertedWithCustomError(nft, "PhaseLimitExceeded");
    expect(await factory.hasMinted(ultimate.address)).to.equal(true);
    expect(await nft.totalMinted()).to.equal(6);
  });
  it("keeps factory and deployers under chain code limits", async function () {
    for (const name of ["ArticStudioFactory", "ArticCollectionDeployer", "ArticEditionDeployer"]) {
      const artifact = await artifacts.readArtifact(name);
      expect((artifact.deployedBytecode.length - 2) / 2).to.be.lessThan(24577);
      expect((artifact.bytecode.length - 2) / 2).to.be.lessThan(49153);
    }
  });
});

describe("Guaranteed Ultimate allocations", function () {
  it("protects the entire Ultimate supply from other tiers until every selected wallet can claim", async function () {
    const [treasury, first, second, outsider] = await ethers.getSigners();
    const factory = await ethers.deployContract("ArticStudioFactory", [treasury.address, 250]);
    const start = await time.latest() + 100; const key = ethers.id("guaranteed");
    const a = leaf(key, first.address, 1); const b = leaf(key, second.address, 1);
    const config = { root: pair(a, b), collectionKey: key, ultimateStart: start, fcfsStart: start + 100, publicStart: start + 200, ultimateLimit: 2, fcfsLimit: 1, publicLimit: 1, ultimatePrice: 0, fcfsPrice: 1 };
    const receipt = await (await factory.create721WithPhases("Guaranteed", "GTD", "ipfs://gtd", 2, start, 4, 2, 0, false, config)).wait();
    const address = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } }).find(l => l?.name === "CollectionCreated").args.collection;
    const nft = await ethers.getContractAt("ArticStudioCollection", address);
    await time.increaseTo(start);
    await expect(nft.connect(outsider).mint(4, { value: 8 })).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
    await expect(nft.connect(outsider).mintAllowlisted(2, 2, [a])).to.be.revertedWithCustomError(nft, "NotAllowlisted");
    await nft.connect(first).mintAllowlisted(2, 1, [b]);
    await expect(nft.connect(first).mintAllowlisted(1, 1, [b])).to.be.revertedWithCustomError(nft, "PhaseLimitExceeded");
    await nft.connect(second).mintAllowlisted(2, 1, [a]);
    expect(await nft.totalMinted()).to.equal(4);
    expect(await nft.mintedByWallet(second.address)).to.equal(2);
  });
});
