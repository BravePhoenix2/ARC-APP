import { isAddress, parseAbi, type Address } from "viem";

export type MintedCollection = {
  id: string; title: string; imageUrl: string; contractAddress: string | null; nftKind?: string | null;
};
export const mintedNftAbi = parseAbi([
  "function mintedByWallet(address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function balanceOf(address,uint256) view returns (uint256)",
]);

/** Read every catalog page, with bounded RPC concurrency and explicit partial failures. */
export async function loadMyNfts(
  wallet: Address,
  getPage: (cursor: string | null) => Promise<{ items: MintedCollection[]; nextCursor: string | null }>,
  read: (item: MintedCollection, wallet: Address) => Promise<{ minted: bigint; balance: bigint }>,
) {
  const items: (MintedCollection & { minted: bigint; balance: bigint })[] = [];
  const failed: MintedCollection[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await getPage(cursor);
    const collections = page.items.filter((item) => {
      if (!item.contractAddress || !isAddress(item.contractAddress)) return false;
      const key = item.contractAddress.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    for (let index = 0; index < collections.length; index += 4) {
      await Promise.all(collections.slice(index, index + 4).map(async (item) => {
        try {
          const counts = await read(item, wallet);
          if (counts.minted > BigInt(0)) items.push({ ...item, ...counts });
        } catch { failed.push(item); }
      }));
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("The collection list could not be completed. Please refresh.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { items, failed };
}
