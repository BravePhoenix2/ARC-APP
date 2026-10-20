"use client";

import CreatorApplication from "@/components/CreatorApplication";
import type { NftKind } from "@/lib/nftTypes";

/** Uses the same reviewed, account-bound flow as every creator submission. */
export default function NftStudio({ initialKind = "COLLECTIBLE", initialAuthMethod = "email" }: { initialKind?: NftKind; initialAuthMethod?: "email" | "wallet" }) {
  return <CreatorApplication initialItemType="NFT" initialNftKind={initialKind} initialAuthMethod={initialAuthMethod} />;
}
