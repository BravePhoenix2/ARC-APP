import { headers } from "next/headers";
import CreatorApplication from "@/components/CreatorApplication";
import { localPreviewEnabled } from "@/lib/localPreview";

export default async function ApplyPage({ searchParams }: { searchParams?: Promise<{ type?: string | string[]; auth?: string | string[] }> }) {
  const query = await searchParams;
  const initialItemType = query?.type === "WEB2_ART" ? "WEB2_ART" : "NFT";
  return <CreatorApplication initialItemType={initialItemType} initialAuthMethod={query?.auth === "wallet" ? "wallet" : "email"} preview={localPreviewEnabled((await headers()).get("host"))} />;
}
