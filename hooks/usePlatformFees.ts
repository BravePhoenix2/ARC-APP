"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address } from "viem";
import { arcChain } from "@/lib/arcConfig";
import { protocol } from "@/lib/protocol";
import { readPlatformFeeTerms, type PlatformFeeClient } from "@/lib/platformFeeRead";

export { readPlatformFeeTerms } from "@/lib/platformFeeRead";

export function usePlatformFees(client: PlatformFeeClient | undefined, address: Address | null) {
  return useQuery({
    queryKey: ["platform-fee-terms", arcChain.id, address],
    enabled: !!client && !!address && protocol.isTestnet,
    retry: 1,
    queryFn: () => readPlatformFeeTerms(client!, address!),
  });
}
