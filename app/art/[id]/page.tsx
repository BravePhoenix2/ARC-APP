import ArtCheckout from "@/components/ArtCheckout";
export default async function ArtDetailPage({ params }: { params: Promise<{ id: string }> }) { return <ArtCheckout id={(await params).id} />; }
