import { toHex, type Hex } from "viem";

export const COLLECTION_CREATION_FEE_CHAIN_ID = 5042002;

/** Bind a direct treasury transfer to this collection, never an unrelated deposit. */
export function collectionCreationFeeData(itemId: string): Hex {
  return toHex(`Artiq collection creation fee v1\nChain: ${COLLECTION_CREATION_FEE_CHAIN_ID}\nCollection: ${itemId}`);
}
