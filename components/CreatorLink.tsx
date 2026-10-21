import Link from "next/link";
export default function CreatorLink({ creator }: { creator: { id?: string; username: string | null; walletAddress?: string | null } }) {
  const name = creator.username || (creator.walletAddress ? `${creator.walletAddress.slice(0, 6)}…${creator.walletAddress.slice(-4)}` : "Artiq creator");
  return creator.id ? <Link href={`/creators/${creator.id}`} className="font-semibold text-[#b55fbe] hover:underline">{name}</Link> : <span>{name}</span>;
}
