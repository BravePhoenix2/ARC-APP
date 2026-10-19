import { headers } from "next/headers";
import CreatorApplication from "@/components/CreatorApplication";
import { localPreviewEnabled } from "@/lib/localPreview";

export default function ApplyPage({ searchParams }: { searchParams?: { type?: string | string[]; auth?: string | string[] } }) {
  const initialItemType = searchParams?.type === "WEB2_ART" ? "WEB2_ART" : "NFT";
  return <CreatorApplication initialItemType={initialItemType} initialAuthMethod={searchParams?.auth === "wallet" ? "wallet" : "email"} preview={localPreviewEnabled(headers().get("host"))} />;
}
