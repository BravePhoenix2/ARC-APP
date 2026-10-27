import NftStudio from "@/components/NftStudio";
import { NFT_KINDS, type NftKind } from "@/lib/nftTypes";

export default async function CreateNftPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const query = await searchParams;
  const initialKind = NFT_KINDS.includes(query.kind as NftKind) ? query.kind as NftKind : "COLLECTIBLE";
  return <NftStudio initialKind={initialKind} />;
}
