const hre = require("hardhat");

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 5042002n && hre.network.name !== "hardhat") throw new Error("Studio MVP deployment is restricted to Arc Testnet.");
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("Use the browser setup at /settings/protocol, or configure a testnet deployer privately. Never share a private key in chat.");
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS || (hre.network.name === "hardhat" ? deployer.address : "");
  if (!hre.ethers.isAddress(feeRecipient) || feeRecipient === hre.ethers.ZeroAddress) throw new Error("Set FEE_RECIPIENT_ADDRESS to your nonzero treasury wallet before deploying.");
  const feeBps = (name) => {
    const value = process.env[name] || "250";
    if (!/^\d+$/.test(value) || Number(value) > 1000) throw new Error(`${name} must be an integer from 0 to 1000 basis points.`);
    return Number(value);
  };
  const mintFeeBps = feeBps("MINT_FEE_BPS");
  const marketplaceFeeBps = feeBps("MARKETPLACE_FEE_BPS");
  const factory = await (await hre.ethers.getContractFactory("ArticStudioFactory")).deploy(feeRecipient, mintFeeBps);
  await factory.waitForDeployment();
  const art = await (await hre.ethers.getContractFactory("ArticArtMarket")).deploy(feeRecipient, marketplaceFeeBps);
  await art.waitForDeployment();
  const auctions = await (await hre.ethers.getContractFactory("ArticAuctionHouse")).deploy(await factory.getAddress(), await art.getAddress(), feeRecipient, marketplaceFeeBps);
  await auctions.waitForDeployment();
  const auctionAddress = await auctions.getAddress();
  const legacyHouses = new Map();
  for (const value of [process.env.NEXT_PUBLIC_AUCTION_HOUSE_ADDRESS || "", ...(process.env.NEXT_PUBLIC_LEGACY_AUCTION_HOUSE_ADDRESSES || "").split(",")]) {
    const address = value.trim();
    if (hre.ethers.isAddress(address) && address !== hre.ethers.ZeroAddress && address.toLowerCase() !== auctionAddress.toLowerCase()) legacyHouses.set(address.toLowerCase(), address);
  }
  console.log("Save these public addresses in .env.local and rebuild/restart the app:");
  console.log(`NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS=${await factory.getAddress()}`);
  console.log(`NEXT_PUBLIC_ART_MARKET_ADDRESS=${await art.getAddress()}`);
  console.log(`NEXT_PUBLIC_AUCTION_HOUSE_ADDRESS=${auctionAddress}`);
  console.log(`NEXT_PUBLIC_LEGACY_AUCTION_HOUSE_ADDRESSES=${[...legacyHouses.values()].join(",")}`);
  console.log(`NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT=${feeRecipient}`);
  console.log(`FEE_RECIPIENT_ADDRESS=${feeRecipient}`);
  console.log(`MINT_FEE_BPS=${mintFeeBps}`);
  console.log(`MARKETPLACE_FEE_BPS=${marketplaceFeeBps}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
