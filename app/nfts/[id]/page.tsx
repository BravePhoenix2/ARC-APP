import CollectionDetail from "@/components/CollectionDetail";
export default function NftDetailPage({ params }: { params: { id: string } }) { return <CollectionDetail id={params.id} />; }
