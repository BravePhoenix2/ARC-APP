"use client";

import CreatorApplication from "@/components/CreatorApplication";
import type { NftKind } from "@/lib/nftTypes";

/** NFT details go straight to setup; the creator pays when creating the collection on-chain. */
export default function NftStudio({ initialKind = "COLLECTIBLE", initialAuthMethod = "email" }: { initialKind?: NftKind; initialAuthMethod?: "email" | "wallet" }) {
  return <CreatorApplication initialItemType="NFT" initialNftKind={initialKind} initialAuthMethod={initialAuthMethod} />;
}
