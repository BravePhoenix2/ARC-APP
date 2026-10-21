export type ArtDelivery = {
  recipient: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  instructions: string;
};

export const emptyArtDelivery: ArtDelivery = { recipient: "", phone: "", addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", country: "", instructions: "" };

export function validateArtDelivery(input: unknown): ArtDelivery {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Enter your delivery address.");
  const fields: Array<[keyof ArtDelivery, number, number, string]> = [
    ["recipient", 2, 100, "Recipient name"], ["phone", 6, 30, "Phone number"],
    ["addressLine1", 5, 200, "Street address"], ["addressLine2", 0, 200, "Address line 2"],
    ["city", 2, 100, "City"], ["region", 0, 100, "State or region"],
    ["postalCode", 0, 20, "Postal code"], ["country", 2, 80, "Country"], ["instructions", 0, 500, "Delivery instructions"],
  ];
  const result = { ...emptyArtDelivery };
  for (const [key, min, max, label] of fields) {
    const raw = (input as Record<string, unknown>)[key] ?? "";
    if (typeof raw !== "string" || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error(`${label} is invalid.`);
    const value = raw.trim();
    if (value.length < min || value.length > max) throw new Error(`${label} must contain ${min ? `${min} to ` : "at most "}${max} characters.`);
    result[key] = value;
  }
  if (!/^[+\d() .-]+$/.test(result.phone) || result.phone.replace(/\D/g, "").length < 6) throw new Error("Enter a valid phone number for delivery.");
  return result;
}
