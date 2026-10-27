import hre from "hardhat";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();
  const network = connection.networkName;

  console.log(`Deploying to network "${network}" from ${deployer.address}`);

  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS || deployer.address;

  const Factory = await ethers.getContractFactory("ArticFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  console.log(`ArticFactory deployed to: ${await factory.getAddress()}`);

  const Marketplace = await ethers.getContractFactory("ArticMarketplace");
  const marketplace = await Marketplace.deploy(feeRecipient, deployer.address);
  await marketplace.waitForDeployment();
  console.log(`ArticMarketplace deployed to: ${await marketplace.getAddress()}`);
  console.log(`  fee recipient: ${feeRecipient}`);

  console.log("\nAdd these to .env.local:");
  console.log(`NEXT_PUBLIC_FACTORY_CONTRACT_ADDRESS=${await factory.getAddress()}`);
  console.log(`NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS=${await marketplace.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
