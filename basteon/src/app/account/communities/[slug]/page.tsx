import { CommunitiesHub } from "@/components/CommunitiesHub";

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommunitiesHub slug={slug} />;
}
