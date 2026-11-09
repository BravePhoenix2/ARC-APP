import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();
const { loadFixture, time } = networkHelpers;
const CREATION_FEE = ethers.parseUnits("5", 18);

async function platform() {
  const [creator, treasury, other] = await ethers.getSigners();
  const factory = await ethers.deployContract("ArticStudioFactory", [treasury.address, 250, 200]);
  return { creator, treasury, other, factory };
}

async function creationArguments(method, overrides = {}) {
  const start = (await time.latest()) + 100;
  const args = ["Creator collection", "CRT", "ipfs://collection", 0, start, overrides.supply ?? 10, 2, 500];
  if (method.startsWith("create721")) args.push(false);
  if (method.endsWith("WithPhases")) args.push({
    root: overrides.root ?? ethers.id("selected-wallets"), collectionKey: ethers.id("collection"),
    ultimateStart: start, fcfsStart: start + 100, publicStart: start + 200,
    ultimateLimit: 1, fcfsLimit: 1, publicLimit: 1, ultimatePrice: 0, fcfsPrice: 0,
  });
  return args;
}

describe("Collection creation fee", function () {
  it("exposes the fixed five native-USDC fee without charging for factory deployment", async function () {
    const { factory } = await loadFixture(platform);
    expect(await factory.supportsCollectionCreationFee()).to.equal(true);
    expect(await factory.collectionCreationFee()).to.equal(CREATION_FEE);
    expect(await factory.pendingPlatformFees()).to.equal(0);
    expect(await factory.totalPlatformFees()).to.equal(0);
    expect(await ethers.provider.getBalance(await factory.getAddress())).to.equal(0);
  });

  for (const method of ["create721", "createEdition", "create721WithPhases", "createEditionWithPhases"]) {
    it(`requires exactly five native USDC atomically for ${method}`, async function () {
      const { factory, creator } = await loadFixture(platform);
      const args = await creationArguments(method);
      for (const value of [0n, ethers.parseUnits("5", 6), CREATION_FEE - 1n, CREATION_FEE + 1n]) {
        await expect(factory.connect(creator)[method](...args, { value }))
          .to.be.revertedWithCustomError(factory, "IncorrectCollectionCreationFee");
      }
      expect(await factory.totalCollections()).to.equal(0);
      expect(await factory.pendingPlatformFees()).to.equal(0);
      expect(await ethers.provider.getBalance(await factory.getAddress())).to.equal(0);

      const transaction = await factory.connect(creator)[method](...args, { value: CREATION_FEE });
      const receipt = await transaction.wait();
      const [collection] = await factory.getCollectionsByCreator(creator.address);
      const events = receipt.logs.map(log => { try { return factory.interface.parseLog(log); } catch { return null; } });
      const paid = events.filter(event => event?.name === "CollectionCreationFeePaid");
      expect(paid).to.have.length(1);
      expect(paid[0].args).to.deep.equal([creator.address, collection, CREATION_FEE]);
      await expect(transaction).to.emit(factory, "PlatformFeeAccrued").withArgs(creator.address, CREATION_FEE);
      expect(await factory.collectionCreator(collection)).to.equal(creator.address);
      expect(await factory.totalCollections()).to.equal(1);
      expect(await factory.pendingPlatformFees()).to.equal(CREATION_FEE);
      expect(await factory.totalPlatformFees()).to.equal(CREATION_FEE);
      expect(await ethers.provider.getBalance(await factory.getAddress())).to.equal(CREATION_FEE);
      expect(await factory.hasMinted(creator.address)).to.equal(false, "paying a creation fee is not a collector mint");
    });

    it(`keeps the fee and collection registry unchanged when ${method} fails validation`, async function () {
      const { factory, creator } = await loadFixture(platform);
      const args = await creationArguments(method, method.endsWith("WithPhases") ? { root: ethers.ZeroHash } : { supply: 0 });
      await expect(factory.connect(creator)[method](...args, { value: CREATION_FEE })).to.revert(ethers);
      expect(await factory.totalCollections()).to.equal(0);
      expect(await factory.getCollectionsByCreator(creator.address)).to.have.length(0);
      expect(await factory.pendingPlatformFees()).to.equal(0);
      expect(await factory.totalPlatformFees()).to.equal(0);
      expect(await ethers.provider.getBalance(await factory.getAddress())).to.equal(0);
      expect(await factory.queryFilter(factory.filters.CollectionCreationFeePaid())).to.have.length(0);
    });
  }

  it("collects each new collection fee once and lets only the treasury withdraw it", async function () {
    const { factory, creator, treasury, other } = await loadFixture(platform);
    await factory.connect(creator).create721(...await creationArguments("create721"), { value: CREATION_FEE });
    await factory.connect(creator).createEdition(...await creationArguments("createEdition"), { value: CREATION_FEE });
    const total = CREATION_FEE * 2n;
    expect(await factory.pendingPlatformFees()).to.equal(total);
    expect(await factory.totalPlatformFees()).to.equal(total);
    await expect(factory.connect(creator).withdrawPlatformFees(creator.address)).to.be.revertedWithCustomError(factory, "NotFeeRecipient");
    await expect(factory.connect(treasury).withdrawPlatformFees(other.address))
      .to.changeEtherBalances(ethers, [factory, other], [-total, total]);
    expect(await factory.pendingPlatformFees()).to.equal(0);
    expect(await factory.totalPlatformFees()).to.equal(total);
    expect(await factory.totalCollections()).to.equal(2);
  });

  it("retains the creation fee when optional mint commission rates are zero", async function () {
    const { creator, treasury } = await loadFixture(platform);
    const factory = await ethers.deployContract("ArticStudioFactory", [treasury.address, 0, 0]);
    const args = await creationArguments("create721");
    await expect(factory.connect(creator).create721(...args)).to.be.revertedWithCustomError(factory, "IncorrectCollectionCreationFee");
    await factory.connect(creator).create721(...args, { value: CREATION_FEE });
    expect(await factory.pendingPlatformFees()).to.equal(CREATION_FEE);
  });
});
