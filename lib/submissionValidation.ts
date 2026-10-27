import { isNftKind, type NftAttribute, type NftKind } from "./nftTypes";
import { parseCollectionImages, type CollectionImageInput } from "./collectionImages";

const categories = ["PAINTING", "RUG", "COSMETIC", "OTHER"] as const;
export type SubmissionInput = {
  itemType: "NFT" | "WEB2_ART";
  creationMethod: "HUMAN" | "AI_GENERATED" | "AI_ASSISTED" | "UNKNOWN";
  humanMadeDeclaration: boolean;
  creationProcess: string | null;
  creatorName: string;
  contactEmail: string | null;
  title: string;
  description: string;
  imageUrl: string;
  priceUsdc: number;
  category: typeof categories[number] | null;
  contractAddress: string | null;
  maxSupply: number | null;
  mintStartTime: Date | null;
  nftKind: NftKind | null;
  symbol: string | null;
  metadataUri: string | null;
  maxPerWallet: number | null;
  royaltyBps: number | null;
  attributes?: NftAttribute[];
  images: CollectionImageInput[];
};

export class SubmissionValidationError extends Error {}

export function parseSubmission(body: unknown): SubmissionInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SubmissionValidationError("Invalid application.");
  const b = body as Record<string, unknown>;
  let images: CollectionImageInput[];
  try { images = parseCollectionImages(b.images); } catch (error) { throw new SubmissionValidationError((error as Error).message); }
  function requiredText(key: string, max: number, label: string) {
    const value = b[key];
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
      throw new SubmissionValidationError(`${label} is required and must be under ${max + 1} characters.`);
    }
    return value.trim();
  }
  if (b.itemType !== "NFT" && b.itemType !== "WEB2_ART") throw new SubmissionValidationError("Choose NFT or Art.");
  if (b.itemType !== "NFT" && images.length) throw new SubmissionValidationError("Image series are available for NFT collections only.");
  const creatorName = requiredText("creatorName", 80, "Creator name");
  const title = requiredText("title", 120, "Title");
  const description = requiredText("description", 4000, "Description");
  const imageUrl = requiredText("imageUrl", 2048, "Artwork image");
  if (!/^\/api\/uploads\/[a-z0-9]{20,40}$/.test(imageUrl)) {
    let url;
    try { url = new URL(imageUrl); } catch { throw new SubmissionValidationError("Use a valid HTTPS image URL or upload an image."); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password) {
      throw new SubmissionValidationError("Image links must use HTTPS.");
    }
  }
  let contactEmail: string | null = null;
  if (b.contactEmail != null && b.contactEmail !== "") {
    if (typeof b.contactEmail !== "string" || b.contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.contactEmail.trim())) {
      throw new SubmissionValidationError("Enter a valid contact email.");
    }
    contactEmail = b.contactEmail.trim();
  }
  const price = typeof b.priceUsdc === "number" ? String(b.priceUsdc) : b.priceUsdc;
  if (typeof price !== "string" || !/^\d{1,7}(\.\d{1,6})?$/.test(price) || Number(price) < 0 || (b.itemType === "WEB2_ART" && Number(price) === 0) || Number(price) > 1_000_000) {
    throw new SubmissionValidationError(`Price must be between ${b.itemType === "NFT" ? "0" : "0.000001"} and 1,000,000 USDC, with at most 6 decimal places.`);
  }
  const methods = ["HUMAN", "AI_GENERATED", "AI_ASSISTED", "UNKNOWN"] as const;
  if (b.creationMethod != null && !methods.includes(b.creationMethod as typeof methods[number])) throw new SubmissionValidationError("Choose a valid creation method.");
  let creationMethod: SubmissionInput["creationMethod"] = (b.creationMethod as SubmissionInput["creationMethod"]) ?? "UNKNOWN";
  let creationProcess: string | null = null;
  const humanMadeDeclaration = b.humanMadeDeclaration === true;
  let category: SubmissionInput["category"] = null;
  const contractAddress = null;
  let maxSupply: number | null = null;
  let mintStartTime: Date | null = null;
  let nftKind: NftKind | null = null;
  let symbol: string | null = null;
  let metadataUri: string | null = null;
  let maxPerWallet: number | null = null;
  let royaltyBps: number | null = null;
  let attributes: NftAttribute[] | undefined;
  if (b.itemType === "WEB2_ART") {
    if (b.creationMethod && b.creationMethod !== "HUMAN") throw new SubmissionValidationError("AI-generated and AI-assisted work belongs in NFTs, not ART BAZZAR.");
    if (!humanMadeDeclaration) throw new SubmissionValidationError("Confirm that your original artwork was made without generative AI.");
    creationMethod = "HUMAN";
    creationProcess = requiredText("creationProcess", 2000, "Creation process");
    if (creationProcess.length < 30) throw new SubmissionValidationError("Describe your materials and creation process in at least 30 characters.");
    if (!/^\/api\/uploads\/[a-z0-9]{20,40}$/.test(imageUrl)) throw new SubmissionValidationError("Upload the ART BAZZAR image so it can be screened. Image links are allowed for NFTs.");
    if (!categories.includes(b.category as typeof categories[number])) throw new SubmissionValidationError("Choose an art category.");
    category = b.category as typeof categories[number];
  } else {
    if (b.contractAddress != null && b.contractAddress !== "") {
      throw new SubmissionValidationError("Submit this collection without an existing contract address. Deploy it from the approved collection page so its ownership and settings can be verified.");
    }
    if (b.nftKind != null && !isNftKind(b.nftKind)) throw new SubmissionValidationError("Choose a valid NFT type.");
    nftKind = isNftKind(b.nftKind) ? b.nftKind : "COLLECTIBLE";
    if (images.length > 1 && nftKind === "EDITION") throw new SubmissionValidationError("Editions share one image. Choose Collectible for an image series.");
    if (images.length && images[0].imageUrl !== imageUrl) throw new SubmissionValidationError("The first series image must be the collection cover.");
    if (images.length > 1 && (b.metadataUri || b.contractAddress)) throw new SubmissionValidationError("Image series use app-generated metadata and a new collection deployment.");
    const supply = typeof b.maxSupply === "string" && /^\d+$/.test(b.maxSupply) ? Number(b.maxSupply) : b.maxSupply;
    if (typeof supply !== "number" || !Number.isSafeInteger(supply) || supply < 1 || supply > 1_000_000) {
      throw new SubmissionValidationError("Supply must be a whole number between 1 and 1,000,000.");
    }
    maxSupply = supply;
    if (images.length > 1 && maxSupply !== images.length) throw new SubmissionValidationError("For an image series, supply must equal the number of images.");
    if (b.symbol != null && b.symbol !== "") {
      if (typeof b.symbol !== "string" || !/^[A-Z][A-Z0-9]{2,9}$/.test(b.symbol.trim().toUpperCase())) throw new SubmissionValidationError("Use 3–10 letters or numbers for the symbol, starting with a letter.");
      symbol = b.symbol.trim().toUpperCase();
    }
    if (b.metadataUri != null && b.metadataUri !== "") {
      if (typeof b.metadataUri !== "string" || b.metadataUri.trim().length > 2048) throw new SubmissionValidationError("Metadata must be a valid HTTPS or IPFS URI under 2,049 characters.");
      const uri = b.metadataUri.trim();
      let url: URL;
      try { url = new URL(uri); } catch { throw new SubmissionValidationError("Metadata must use a valid HTTPS or IPFS URI."); }
      if (!["https:", "ipfs:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new SubmissionValidationError("Metadata must use a valid HTTPS or IPFS URI.");
      metadataUri = uri;
    }
    if (b.maxPerWallet != null && b.maxPerWallet !== "") {
      const limit = typeof b.maxPerWallet === "string" && /^\d+$/.test(b.maxPerWallet) ? Number(b.maxPerWallet) : b.maxPerWallet;
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > maxSupply) throw new SubmissionValidationError("The per-wallet limit must be a whole number between 1 and the supply.");
      maxPerWallet = limit;
    } else if (nftKind === "SOULBOUND") maxPerWallet = 1;
    const royalties = b.royaltyBps == null || b.royaltyBps === "" ? 0 : typeof b.royaltyBps === "string" && /^\d+$/.test(b.royaltyBps) ? Number(b.royaltyBps) : b.royaltyBps;
    if (typeof royalties !== "number" || !Number.isInteger(royalties) || royalties < 0 || royalties > 1000) throw new SubmissionValidationError("Royalties must be a whole number from 0 to 1,000 basis points (0–10%).");
    if (nftKind === "SOULBOUND" && royalties !== 0) throw new SubmissionValidationError("Soulbound NFTs cannot be resold and must have zero resale royalties.");
    royaltyBps = royalties;
    if (nftKind === "SOULBOUND" && b.transferable === true) throw new SubmissionValidationError("Soulbound NFTs cannot be transferable.");
    attributes = [];
    if (b.attributes != null) {
      if (!Array.isArray(b.attributes) || b.attributes.length > 20) throw new SubmissionValidationError("Add at most 20 NFT traits.");
      attributes = b.attributes.map((attribute) => {
        if (!attribute || typeof attribute !== "object" || Array.isArray(attribute)) throw new SubmissionValidationError("Each NFT trait needs a name and value.");
        const { trait_type, value } = attribute as Record<string, unknown>;
        if (typeof trait_type !== "string" || !trait_type.trim() || trait_type.trim().length > 60) throw new SubmissionValidationError("Trait names must contain 1–60 characters.");
        if ((typeof value !== "string" || !value.trim() || value.trim().length > 120) && (typeof value !== "number" || !Number.isFinite(value))) throw new SubmissionValidationError("Trait values must be text of 1–120 characters or a finite number.");
        return { trait_type: trait_type.trim(), value: typeof value === "string" ? value.trim() : value as number };
      });
    }
    if (b.mintStartTime != null && b.mintStartTime !== "") {
      if (typeof b.mintStartTime !== "string") throw new SubmissionValidationError("Enter a valid mint start time.");
      mintStartTime = new Date(b.mintStartTime);
      if (Number.isNaN(mintStartTime.getTime())) throw new SubmissionValidationError("Enter a valid mint start time.");
    }
  }
  return { itemType: b.itemType, creationMethod, humanMadeDeclaration, creationProcess, creatorName, contactEmail, title, description, imageUrl, priceUsdc: Number(price), category, contractAddress, maxSupply, mintStartTime, nftKind, symbol, metadataUri, maxPerWallet, royaltyBps, images, ...(attributes ? { attributes } : {}) };
}
