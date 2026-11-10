import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { testnetConfigurationIssues } = await import("../lib/testnetReadiness");
  const issues = testnetConfigurationIssues();
  const { createPublicClient, http, parseAbi } = await import("viem");
  const { arcChain } = await import("../lib/arcConfig");
  const { protocol } = await import("../lib/protocol");
  const { readPlatformFeeTerms, readMintSurchargeBps, isMissingPlatformFeeInterface } = await import("../lib/platformFeeRead");
  const { prisma } = await import("../lib/prisma");
  const notices: string[] = [];
  const client = createPublicClient({ chain: arcChain, transport: http(undefined, { timeout: 10_000, retryCount: 0 }) });
  const abi = parseAbi(["function supportsMintSurcharge() pure returns (bool)", "function supportsImageSeries() pure returns (bool)", "function supportsMintPhases() pure returns (bool)", "function supportsAssetAuctions() pure returns (bool)", "function platformFeeBps() view returns (uint256)", "function mintSurchargeBps() view returns (uint256)", "function feeRecipient() view returns (address)", "function studioFactory() view returns (address)", "function artMarket() view returns (address)", "function metadataURI() view returns (string)"]);
  try {
    try { if (await client.getChainId() !== 5042002) issues.push("The configured RPC is not Arc Testnet."); }
    catch { issues.push("Arc Testnet RPC is unavailable."); }
    const checks = [["studio factory", protocol.factory, ["supportsImageSeries", "supportsMintPhases"]], ["art market", protocol.artMarket, []], ["auction house", protocol.auctions, []]] as const;
    for (const [name, address, capabilities] of checks) {
      if (!address) { issues.push(`Configure the ${name} address.`); continue; }
      try {
        const code = await client.getCode({ address });
        if (!code || code === "0x") throw new Error("No code");
        for (const functionName of capabilities) if (!await client.readContract({ address, abi, functionName })) throw new Error("Missing capability");
        const terms = await readPlatformFeeTerms(client, address);
        const expectedFee = BigInt(name === "studio factory" ? process.env.MINT_FEE_BPS || "250" : process.env.MARKETPLACE_FEE_BPS || "250");
        if (terms.legacy) notices.push(`The ${name} uses verified legacy terms with no platform sale/mint commission. The separate 5 test USDC collection creation payment still applies.`);
        else if (terms.bps !== expectedFee || terms.recipient?.toLowerCase() !== process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.toLowerCase()) throw new Error("Wrong fee terms");
        if (name === "studio factory") {
          const surcharge = await readMintSurchargeBps(client, address);
          if (terms.legacy) {
            if (surcharge !== BigInt(0)) throw new Error("Unverified legacy surcharge");
          } else if (surcharge !== BigInt(process.env.MINT_SURCHARGE_BPS || "200")) throw new Error("Wrong surcharge");
        }
        if (name === "auction house") {
          let assets = false;
          try { assets = await client.readContract({ address, abi, functionName: "supportsAssetAuctions" }); }
          catch (error) { if (!isMissingPlatformFeeInterface(error)) throw error; }
          if (!assets) notices.push("Digital/physical asset auctions are unavailable on the configured legacy house and must remain disabled. Existing NFT auctions/rewards use their retained contract.");
          const [factory, market] = await Promise.all([client.readContract({ address, abi, functionName: "studioFactory" }), client.readContract({ address, abi, functionName: "artMarket" })]);
          if (factory.toLowerCase() !== protocol.factory?.toLowerCase() || market.toLowerCase() !== protocol.artMarket?.toLowerCase()) throw new Error("Mismatched dependencies");
        }
      } catch { issues.push(`The ${name} is unavailable, incompatible, or has different immutable fee terms. Deploy/verify the current Testnet contracts and rebuild.`); }
    }
    try {
      await prisma.$queryRaw`SELECT 1`;
      // SELECT 1 alone cannot prove the new payment table/columns were migrated.
      await prisma.collectionCreationPayment.findFirst();
      if (process.env.VERCEL === "1" && await prisma.uploadedImage.count({ where: { byteSize: { gt: 4_500_000 } } })) issues.push("Stored images exceed Vercel's response size limit. Re-export those pilot images before hosting; do not delete their records blindly.");
      const unpinned = await prisma.item.count({ where: { OR: [{ itemType: "NFT", contractAddress: { not: null }, deploymentFactory: null }, { itemType: "WEB2_ART", artListingId: { not: null }, artMarketAddress: null }] } });
      if (unpinned) issues.push(`${unpinned} existing deployed items need their original factory/art market pinned before protocol replacement.`);
      const collections = await prisma.item.findMany({ where: { itemType: "NFT", contractAddress: { not: null } }, select: { contractAddress: true }, take: 101 });
      if (collections.length > 100) issues.push("Metadata checks are incomplete: more than 100 retained collections require a full metadata audit.");
      for (const item of collections.slice(0, 100)) {
        try {
          const uri = await client.readContract({ address: item.contractAddress as `0x${string}`, abi, functionName: "metadataURI" });
          if (/^https?:/.test(uri) && /(?:\.trycloudflare\.com|localhost|127\.0\.0\.1)/.test(new URL(uri).hostname)) issues.push("An existing collection embeds a temporary metadata host. Preserve its endpoint or explicitly replace the pilot collection before launch.");
        } catch { issues.push("An existing collection's metadata could not be checked; review retained deployments."); }
      }
    } catch { issues.push("Database/schema check failed. Apply the PostgreSQL migrations, generate the client for that provider, and verify connectivity."); }
  } finally { await prisma.$disconnect(); }
  for (const notice of Array.from(new Set(notices))) console.log(`Note: ${notice}`);
  for (const issue of Array.from(new Set(issues))) console.error(`- ${issue}`);
  if (issues.length) { console.error("Public Testnet configuration is not ready. No transactions or data changes were performed."); process.exitCode = 1; }
  else console.log("Configuration and read-only contract checks passed. Hosted login, wallet transactions, restore testing, monitoring and scheduled jobs still require release evidence.");
}
main().catch(() => { console.error("Testnet checks could not complete. Review the private environment/provider configuration."); process.exitCode = 1; });
