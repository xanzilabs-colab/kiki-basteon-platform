import { LinkupMatch } from "@/components/LinkupMatch";

export default async function LinkupMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <LinkupMatch matchId={matchId} />;
}
