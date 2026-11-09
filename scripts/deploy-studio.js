import hre from "hardhat";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;
  const network = await ethers.provider.getNetwork();
  const simulated = connection.networkConfig.type === "edr-simulated";
  if (network.chainId !== 5042002n && !simulated) throw new Error("Studio MVP deployment is restricted to Arc Testnet.");
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Use the browser setup at /settings/protocol, or configure a testnet deployer privately. Never share a private key in chat.");
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS || (simulated ? deployer.address : "");
  if (!ethers.isAddress(feeRecipient) || feeRecipient === ethers.ZeroAddress) throw new Error("Set FEE_RECIPIENT_ADDRESS to your nonzero treasury wallet before deploying.");
  const feeBps = (name, defaultValue) => {
    const value = process.env[name] || defaultValue;
    if (!/^\d+$/.test(value) || Number(value) > 1000) throw new Error(`${name} must be an integer from 0 to 1000 basis points.`);
    return Number(value);
  };
  const mintFeeBps = feeBps("MINT_FEE_BPS", "250");
  const mintSurchargeBps = feeBps("MINT_SURCHARGE_BPS", "200");
  const marketplaceFeeBps = feeBps("MARKETPLACE_FEE_BPS", "250");
  const factory = await (await ethers.getContractFactory("ArticStudioFactory")).deploy(feeRecipient, mintFeeBps, mintSurchargeBps);
  await factory.waitForDeployment();
  let creationFeeSupported, creationFee;
  try {
    [creationFeeSupported, creationFee] = await Promise.all([
      factory.supportsCollectionCreationFee(), factory.collectionCreationFee(),
    ]);
  } catch {
    throw new Error("The studio factory creation fee could not be verified. Stop and verify the deployed factory before continuing.");
  }
  if (!creationFeeSupported || creationFee !== ethers.parseUnits("5", 18)) {
    throw new Error("The deployed studio factory must support the fixed 5 native test-USDC collection creation fee.");
  }
  console.log("Verified collection creation fee: 5 native test USDC per collection. Creator network gas is separate.");
  const art = await (await ethers.getContractFactory("ArticArtMarket")).deploy(feeRecipient, marketplaceFeeBps);
  await art.waitForDeployment();
  const auctions = await (await ethers.getContractFactory("ArticAuctionHouse")).deploy(await factory.getAddress(), await art.getAddress(), feeRecipient, marketplaceFeeBps);
  await auctions.waitForDeployment();
  const auctionAddress = await auctions.getAddress();
  const legacyHouses = new Map();
  for (const value of [process.env.NEXT_PUBLIC_AUCTION_HOUSE_ADDRESS || "", ...(process.env.NEXT_PUBLIC_LEGACY_AUCTION_HOUSE_ADDRESSES || "").split(",")]) {
    const address = value.trim();
    if (ethers.isAddress(address) && address !== ethers.ZeroAddress && address.toLowerCase() !== auctionAddress.toLowerCase()) legacyHouses.set(address.toLowerCase(), address);
  }
  console.log("Save these public addresses in .env.local and rebuild/restart the app:");
  console.log(`NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS=${await factory.getAddress()}`);
  console.log(`NEXT_PUBLIC_ART_MARKET_ADDRESS=${await art.getAddress()}`);
  console.log(`NEXT_PUBLIC_AUCTION_HOUSE_ADDRESS=${auctionAddress}`);
  console.log(`NEXT_PUBLIC_LEGACY_AUCTION_HOUSE_ADDRESSES=${[...legacyHouses.values()].join(",")}`);
  console.log(`NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT=${feeRecipient}`);
  console.log(`FEE_RECIPIENT_ADDRESS=${feeRecipient}`);
  console.log(`MINT_FEE_BPS=${mintFeeBps}`);
  console.log(`MINT_SURCHARGE_BPS=${mintSurchargeBps}`);
  console.log(`MARKETPLACE_FEE_BPS=${marketplaceFeeBps}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
