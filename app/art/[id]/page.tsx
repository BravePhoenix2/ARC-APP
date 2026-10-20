import ArtCheckout from "@/components/ArtCheckout";
export default function ArtDetailPage({ params }: { params: { id: string } }) { return <ArtCheckout id={params.id} />; }
