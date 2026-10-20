const hre = require("hardhat");

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 5042002n && hre.network.name !== "hardhat") throw new Error("Studio MVP deployment is restricted to Arc Testnet.");
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("Use the browser setup at /settings/protocol, or configure a testnet deployer privately. Never share a private key in chat.");
  const factory = await (await hre.ethers.getContractFactory("ArticStudioFactory")).deploy();
  await factory.waitForDeployment();
  const art = await (await hre.ethers.getContractFactory("ArticArtMarket")).deploy();
  await art.waitForDeployment();
  const auctions = await (await hre.ethers.getContractFactory("ArticAuctionHouse")).deploy(await factory.getAddress(), await art.getAddress());
  await auctions.waitForDeployment();
  console.log("Save these public addresses in .env.local and rebuild/restart the app:");
  console.log(`NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS=${await factory.getAddress()}`);
  console.log(`NEXT_PUBLIC_ART_MARKET_ADDRESS=${await art.getAddress()}`);
  console.log(`NEXT_PUBLIC_AUCTION_HOUSE_ADDRESS=${await auctions.getAddress()}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
