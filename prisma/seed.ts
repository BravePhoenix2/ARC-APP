import { prisma } from "../lib/prisma";

async function main() {
  const alice = await prisma.user.upsert({
    where: { walletAddress: "0x1111111111111111111111111111111111aaaa" },
    update: {},
    create: {
      walletAddress: "0x1111111111111111111111111111111111aaaa",
      username: "alice.arc",
      isCreator: true,
      bio: "Generative artist exploring geometric collage on Arc.",
    },
  });

  const ben = await prisma.user.upsert({
    where: { walletAddress: "0x2222222222222222222222222222222222bbbb" },
    update: {},
    create: {
      walletAddress: "0x2222222222222222222222222222222222bbbb",
      username: "ben.weaves",
      isCreator: true,
      bio: "Textile artist — physical rugs, digital twins.",
    },
  });

  const collector = await prisma.user.upsert({
    where: { walletAddress: "0x3333333333333333333333333333333333cccc" },
    update: {},
    create: {
      walletAddress: "0x3333333333333333333333333333333333cccc",
      username: "collector.eth",
    },
  });

  const now = Date.now();
  const hours = (n: number) => new Date(now + n * 60 * 60 * 1000);

  const nftItems = [
    {
      title: "Telescope Study No. 3",
      description: "First drop in the Studio Fragments series.",
      mintPriceUsdc: 25,
      mintStartTime: hours(48),
      maxSupply: 400,
      mintedCount: 0,
      status: "UPCOMING" as const,
      rarities: [
        { name: "Common", percentage: 60 },
        { name: "Rare", percentage: 25 },
        { name: "Epic", percentage: 10 },
        { name: "Legendary", percentage: 5 },
      ],
      creatorId: alice.id,
    },
    {
      title: "Ascent",
      description: "Minting live now — sub-second finality on Arc.",
      mintPriceUsdc: 40,
      mintStartTime: hours(-2),
      maxSupply: 250,
      mintedCount: 187,
      status: "LIVE" as const,
      rarities: [
        { name: "Common", percentage: 55 },
        { name: "Rare", percentage: 30 },
        { name: "Epic", percentage: 15 },
      ],
      creatorId: alice.id,
    },
    {
      title: "Reaching Hand",
      description: "Sold out — now trading on the secondary market.",
      mintPriceUsdc: 60,
      mintStartTime: hours(-96),
      maxSupply: 120,
      mintedCount: 120,
      status: "MINTED_OUT" as const,
      rarities: [
        { name: "Common", percentage: 50 },
        { name: "Rare", percentage: 35 },
        { name: "Legendary", percentage: 15 },
      ],
      creatorId: alice.id,
    },
    {
      title: "Pencil & Aperture",
      description: "Reschedule pending — new mint window announced soon.",
      mintPriceUsdc: 30,
      mintStartTime: hours(120),
      maxSupply: 300,
      mintedCount: 0,
      status: "UPCOMING" as const,
      rarities: [
        { name: "Common", percentage: 65 },
        { name: "Rare", percentage: 25 },
        { name: "Epic", percentage: 10 },
      ],
      creatorId: alice.id,
    },
  ];

  for (const item of nftItems) {
    await prisma.item.upsert({
      where: { id: `seed-nft-${item.title}` },
      update: {},
      create: { id: `seed-nft-${item.title}`, itemType: "NFT", ...item },
    });
  }

  const artItems = [
    {
      title: "Woven Horizon",
      description: "Hand-knotted wool rug, one of one.",
      category: "RUG" as const,
      priceUsdc: 480,
      quantityAvailable: 1,
      sold: false,
      creatorId: ben.id,
    },
    {
      title: "Midnight Study",
      description: "Oil on canvas, 24x36in.",
      category: "PAINTING" as const,
      priceUsdc: 950,
      quantityAvailable: 1,
      sold: false,
      creatorId: ben.id,
    },
    {
      title: "Pigment Set — Aurora",
      description: "Small-batch artistic cosmetic pigment set.",
      category: "COSMETIC" as const,
      priceUsdc: 65,
      quantityAvailable: 40,
      sold: false,
      creatorId: ben.id,
    },
    {
      title: "Loomed Fragment",
      description: "Sold — shipped to its collector last week.",
      category: "RUG" as const,
      priceUsdc: 310,
      quantityAvailable: 0,
      sold: true,
      creatorId: ben.id,
    },
  ];

  for (const item of artItems) {
    await prisma.item.upsert({
      where: { id: `seed-art-${item.title}` },
      update: {},
      create: { id: `seed-art-${item.title}`, itemType: "WEB2_ART", ...item },
    });
  }

  const liveNft = await prisma.item.findUnique({ where: { id: "seed-nft-Ascent" } });
  if (liveNft) {
    await prisma.activity.upsert({
      where: { id: "seed-activity-1" },
      update: {},
      create: {
        id: "seed-activity-1",
        type: "MINT",
        priceUsdc: liveNft.mintPriceUsdc,
        itemId: liveNft.id,
        userId: collector.id,
      },
    });
  }

  console.log(`Seeded ${nftItems.length} NFT items and ${artItems.length} art items.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
