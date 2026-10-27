import { config as loadEnv } from "dotenv";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";

loadEnv({ path: ".env.local", quiet: true });

const ARC_RPC_URL = process.env.ARC_RPC_URL || process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.io";
const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID || process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 5042002);
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
export default defineConfig({
  plugins: [hardhatEthers, hardhatEthersChaiMatchers, hardhatNetworkHelpers, hardhatMocha],
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Collection deployment keeps the public creation API flat and compiles
      // through IR to handle its metadata and mint-limit arguments safely.
      viaIR: true,
      // OpenZeppelin v5.6's Bytes.sol uses the `mcopy` opcode, which only
      // exists from the Cancun hardfork onward.
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: { type: "edr-simulated", chainType: "l1" },
    arc: {
      type: "http",
      chainType: "l1",
      url: ARC_RPC_URL,
      chainId: ARC_CHAIN_ID,
      // Never commit a real key — set DEPLOYER_PRIVATE_KEY in .env.local (gitignored).
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
    arcTestnet: {
      type: "http",
      chainType: "l1",
      url: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io",
      chainId: 5042002,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
});
