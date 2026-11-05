import Link from "next/link";
import { arcChain } from "@/lib/arcConfig";

export default function TestnetNotice() {
  if (!arcChain.testnet) return null;
  return <aside aria-label="Public Testnet" className="relative border-b border-[#b55fbe]/20 bg-[#b55fbe]/10 px-4 py-3 text-center text-xs leading-5 text-[var(--page-text)]">Public Arc Testnet · Test USDC and NFTs have no monetary value. Use fictional delivery details. <Link href="/testnet" className="font-semibold underline underline-offset-2">Testing guide, privacy & support</Link></aside>;
}
