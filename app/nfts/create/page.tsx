import NftStudio from "@/components/NftStudio";
import { NFT_KINDS, type NftKind } from "@/lib/nftTypes";

export default function CreateNftPage({ searchParams }: { searchParams: { kind?: string } }) {
  const initialKind = NFT_KINDS.includes(searchParams.kind as NftKind) ? searchParams.kind as NftKind : "COLLECTIBLE";
  return <NftStudio initialKind={initialKind} />;
}
