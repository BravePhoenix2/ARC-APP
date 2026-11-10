import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();
const { time } = networkHelpers;
const leaf = (key, wallet, tier) => ethers.keccak256(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "uint8"], [key, wallet, tier])));
const pair = (a, b) => ethers.keccak256(ethers.concat([a, b].sort()));

function tree(key, entries) {
  const leaves = entries.map(([wallet, tier]) => leaf(key, wallet, tier)).sort();
  const levels = [leaves];
  while (levels.at(-1).length > 1) {
    const row = levels.at(-1); const next = [];
    for (let i = 0; i < row.length; i += 2) next.push(i + 1 < row.length ? pair(row[i], row[i + 1]) : row[i]);
    levels.push(next);
  }
  return { root: levels.at(-1)[0], proof(wallet, tier) {
    let index = leaves.indexOf(leaf(key, wallet, tier)); const proof = [];
    for (const row of levels.slice(0, -1)) {
      if ((index ^ 1) < row.length) proof.push(row[index ^ 1]);
      index = Math.floor(index / 2);
    }
    return proof;
  } };
}

async function fixture(edition) {
  const [creator, guaranteed, fcfs, newcomer, outsider] = await ethers.getSigners();
  const factory = await ethers.deployContract("ArticStudioFactory", [creator.address, 250, 200]);
  const start = await time.latest() + 100;
  const key = ethers.id(`managed-${edition}`);
  const list = tree(key, [[guaranteed.address, 1], [fcfs.address, 2]]);
  const config = { root: list.root, collectionKey: key, ultimateStart: start, fcfsStart: start + 3600, publicStart: start + 7200, ultimateLimit: 2, fcfsLimit: 2, publicLimit: 4, ultimatePrice: 1, fcfsPrice: 2 };
  const args = ["Managed", "MGT", "ipfs://managed", 1, start, 8, 4, 0];
  const create = (nextConfig = config, allocation = 2) => edition
    ? factory.createEditionWithManagedPhases(...args, nextConfig, allocation)
    : factory.create721WithManagedPhases(...args, false, nextConfig, allocation);
  const receipt = await (await create()).wait();
  const address = receipt.logs.map(log => { try { return factory.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === "CollectionCreated").args.collection;
  const nft = await ethers.getContractAt(edition ? "ArticEdition" : "ArticStudioCollection", address);
  return { creator, guaranteed, fcfs, newcomer, outsider, factory, start, key, list, config, nft, create };
}

describe("Creator mint management", function () {
  for (const edition of [false, true]) {
    const standard = edition ? "ERC-1155" : "ERC-721";
    it(`${standard}: accepts FCFS above public and enforces guaranteed price floors and one-hour windows`, async function () {
      const { nft, factory, config, create, start } = await fixture(edition);
      expect(await factory.supportsMintManagement()).to.equal(true);
      expect(await nft.supportsMintManagement()).to.equal(true);
      expect(await nft.guaranteedAllocation()).to.equal(2);
      expect((await nft.mintPhases()).fcfsPrice).to.equal(2);
      expect(await nft.mintPrice()).to.equal(1);
      for (const invalid of [
        { ...config, ultimatePrice: 2 },
        { ...config, fcfsPrice: 0 },
        { ...config, fcfsStart: start + 3599 },
        { ...config, publicStart: start + 7201 },
      ]) await expect(create(invalid)).to.be.revertedWithCustomError(nft, "InvalidPhases");
      await expect(create(config, 10)).to.be.revertedWithCustomError(nft, "InvalidPhases");
      await expect(create(config, 3)).to.be.revertedWithCustomError(nft, "InvalidPhases");
    });

    it(`${standard}: permits owner wallet additions after creation and freezes the committed list when Guaranteed opens`, async function () {
      const { nft, creator, guaranteed, fcfs, newcomer, outsider, key, start, config } = await fixture(edition);
      const updated = tree(key, [[guaranteed.address, 1], [fcfs.address, 2], [newcomer.address, 1]]);
      await expect(nft.connect(outsider).updateAllowlistRoot(updated.root, 4)).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
      await expect(nft.updateAllowlistRoot(ethers.ZeroHash, 4)).to.be.revertedWithCustomError(nft, "InvalidPhases");
      await expect(nft.updateAllowlistRoot(updated.root, 10)).to.be.revertedWithCustomError(nft, "InvalidPhases");
      await expect(nft.updateAllowlistRoot(updated.root, 3)).to.be.revertedWithCustomError(nft, "InvalidPhases");
      await expect(nft.connect(creator).updateAllowlistRoot(updated.root, 4)).to.emit(nft, "AllowlistRootUpdated").withArgs(config.root, updated.root, 4);
      expect((await nft.mintPhases()).collectionKey).to.equal(key);
      expect(await nft.guaranteedAllocation()).to.equal(4);
      await time.increaseTo(start);
      await nft.connect(newcomer).mintAllowlisted(2, 1, updated.proof(newcomer.address, 1), { value: 2 });
      expect(await nft.guaranteedMinted()).to.equal(2);
      await expect(nft.updateAllowlistRoot(config.root, 2)).to.be.revertedWithCustomError(nft, "AllowlistAlreadyStarted");
    });

    it(`${standard}: reduces only unminted supply before or during mint while preserving Guaranteed allocations`, async function () {
      const { nft, guaranteed, fcfs, outsider, start, list } = await fixture(edition);
      await expect(nft.connect(outsider).reduceMaxSupply(7)).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
      for (const amount of [0, 8, 9, 1]) await expect(nft.reduceMaxSupply(amount)).to.be.revertedWithCustomError(nft, "InvalidSupplyReduction");
      await expect(nft.reduceMaxSupply(5)).to.emit(nft, "MaxSupplyReduced").withArgs(8, 5);
      await time.increaseTo(start);
      await nft.connect(guaranteed).mintAllowlisted(1, 1, list.proof(guaranteed.address, 1), { value: 1 });
      await expect(nft.reduceMaxSupply(1)).to.be.revertedWithCustomError(nft, "InvalidSupplyReduction");
      await nft.reduceMaxSupply(3);
      await time.increaseTo(start + 3600);
      await nft.connect(fcfs).mintAllowlisted(1, 2, list.proof(fcfs.address, 2), { value: 2 });
      await expect(nft.reduceMaxSupply(1)).to.be.revertedWithCustomError(nft, "InvalidSupplyReduction");
      await nft.reduceMaxSupply(2);
      expect(await nft.maxSupply()).to.equal(2);
      expect(await nft.totalMinted()).to.equal(2);
      await expect(nft.reduceMaxSupply(3)).to.be.revertedWithCustomError(nft, "InvalidSupplyReduction");
      await expect(nft.connect(fcfs).mintAllowlisted(1, 2, list.proof(fcfs.address, 2), { value: 2 })).to.be.revertedWithCustomError(nft, "ExceedsMaxSupply");
    });

    it(`${standard}: keeps phases exclusive, lets public mint indefinitely, and honors permanent creator closure`, async function () {
      const { nft, guaranteed, fcfs, outsider, start, list } = await fixture(edition);
      await expect(nft.closeMinting()).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
      await time.increaseTo(start);
      await expect(nft.closeMinting()).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
      await expect(nft.connect(outsider).mint(1, { value: 1 })).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
      await expect(nft.connect(fcfs).mintAllowlisted(1, 2, list.proof(fcfs.address, 2), { value: 2 })).to.be.revertedWithCustomError(nft, "NotAllowlisted");
      await nft.connect(guaranteed).mintAllowlisted(1, 1, list.proof(guaranteed.address, 1), { value: 1 });
      await time.increaseTo(start + 3600);
      await expect(nft.closeMinting()).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
      await expect(nft.connect(guaranteed).mintAllowlisted(1, 1, list.proof(guaranteed.address, 1), { value: 2 })).to.be.revertedWithCustomError(nft, "NotAllowlisted");
      await expect(nft.connect(outsider).mint(1, { value: 1 })).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
      await nft.connect(fcfs).mintAllowlisted(1, 2, list.proof(fcfs.address, 2), { value: 2 });
      await time.increaseTo(start + 7200 + 30 * 24 * 3600);
      await nft.connect(outsider).mint(1, { value: 1 });
      await expect(nft.connect(outsider).closeMinting()).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
      await expect(nft.closeMinting()).to.emit(nft, "MintingClosed");
      expect(await nft.mintClosed()).to.equal(true);
      await expect(nft.connect(outsider).mint(1, { value: 1 })).to.be.revertedWithCustomError(nft, "MintingIsClosed");
      await expect(nft.closeMinting()).to.be.revertedWithCustomError(nft, "MintingIsClosed");
      expect(await nft.totalMinted()).to.equal(3);
    });

    it(`${standard}: allows public-only supply management and protects the announced mint start from early closure`, async function () {
      const { factory, start, outsider } = await fixture(edition);
      const args = ["Public managed", "PUB", "ipfs://public", 1, start, 5, 5, 0];
      const receipt = await (await (edition ? factory.createEdition(...args) : factory.create721(...args, false))).wait();
      const address = receipt.logs.map(log => { try { return factory.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === "CollectionCreated").args.collection;
      const nft = await ethers.getContractAt(edition ? "ArticEdition" : "ArticStudioCollection", address);
      await nft.reduceMaxSupply(4);
      await expect(nft.closeMinting()).to.be.revertedWithCustomError(nft, "PhaseNotOpen");
      await time.increaseTo(start);
      await nft.connect(outsider).mint(2, { value: 2 });
      await nft.reduceMaxSupply(2);
      expect(await nft.totalMinted()).to.equal(2);
      expect(await nft.maxSupply()).to.equal(2);
      await nft.closeMinting();
      await expect(nft.connect(outsider).mint(1, { value: 1 })).to.be.revertedWithCustomError(nft, "MintingIsClosed");
    });
  }
});
