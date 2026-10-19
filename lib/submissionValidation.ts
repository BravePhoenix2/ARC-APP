import { isAddress } from "viem";

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
};

export class SubmissionValidationError extends Error {}

export function parseSubmission(body: unknown): SubmissionInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SubmissionValidationError("Invalid application.");
  const b = body as Record<string, unknown>;
  function requiredText(key: string, max: number, label: string) {
    const value = b[key];
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
      throw new SubmissionValidationError(`${label} is required and must be under ${max + 1} characters.`);
    }
    return value.trim();
  }
  if (b.itemType !== "NFT" && b.itemType !== "WEB2_ART") throw new SubmissionValidationError("Choose NFT or Art.");
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
  if (typeof price !== "string" || !/^\d{1,7}(\.\d{1,6})?$/.test(price) || Number(price) <= 0 || Number(price) > 1_000_000) {
    throw new SubmissionValidationError("Price must be between 0.000001 and 1,000,000 USDC, with at most 6 decimal places.");
  }
  const methods = ["HUMAN", "AI_GENERATED", "AI_ASSISTED", "UNKNOWN"] as const;
  if (b.creationMethod != null && !methods.includes(b.creationMethod as typeof methods[number])) throw new SubmissionValidationError("Choose a valid creation method.");
  let creationMethod: SubmissionInput["creationMethod"] = (b.creationMethod as SubmissionInput["creationMethod"]) ?? "UNKNOWN";
  let creationProcess: string | null = null;
  const humanMadeDeclaration = b.humanMadeDeclaration === true;
  let category: SubmissionInput["category"] = null;
  let contractAddress: string | null = null;
  let maxSupply: number | null = null;
  let mintStartTime: Date | null = null;
  if (b.itemType === "WEB2_ART") {
    if (b.creationMethod && b.creationMethod !== "HUMAN") throw new SubmissionValidationError("AI-generated and AI-assisted work belongs in NFTs, not original Art.");
    if (!humanMadeDeclaration) throw new SubmissionValidationError("Confirm that your original artwork was made without generative AI.");
    creationMethod = "HUMAN";
    creationProcess = requiredText("creationProcess", 2000, "Creation process");
    if (creationProcess.length < 30) throw new SubmissionValidationError("Describe your materials and creation process in at least 30 characters.");
    if (!/^\/api\/uploads\/[a-z0-9]{20,40}$/.test(imageUrl)) throw new SubmissionValidationError("Upload the original Art image so it can be screened. Image links are allowed for NFTs.");
    if (!categories.includes(b.category as typeof categories[number])) throw new SubmissionValidationError("Choose an art category.");
    category = b.category as typeof categories[number];
  } else {
    const supply = typeof b.maxSupply === "string" && /^\d+$/.test(b.maxSupply) ? Number(b.maxSupply) : b.maxSupply;
    if (typeof supply !== "number" || !Number.isSafeInteger(supply) || supply < 1 || supply > 1_000_000) {
      throw new SubmissionValidationError("Supply must be a whole number between 1 and 1,000,000.");
    }
    maxSupply = supply;
    if (b.contractAddress != null && b.contractAddress !== "") {
      if (typeof b.contractAddress !== "string" || !isAddress(b.contractAddress)) throw new SubmissionValidationError("Enter a valid collection contract address.");
      contractAddress = b.contractAddress;
    }
    if (b.mintStartTime != null && b.mintStartTime !== "") {
      if (typeof b.mintStartTime !== "string") throw new SubmissionValidationError("Enter a valid mint start time.");
      mintStartTime = new Date(b.mintStartTime);
      if (Number.isNaN(mintStartTime.getTime())) throw new SubmissionValidationError("Enter a valid mint start time.");
    }
  }
  return { itemType: b.itemType, creationMethod, humanMadeDeclaration, creationProcess, creatorName, contactEmail, title, description, imageUrl, priceUsdc: Number(price), category, contractAddress, maxSupply, mintStartTime };
}
