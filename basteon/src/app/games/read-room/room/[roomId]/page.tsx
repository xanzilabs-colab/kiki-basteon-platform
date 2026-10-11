import { ReadRoomGame } from "@/components/ReadRoomGame";

export default async function ReadRoomBuddyPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <ReadRoomGame roomId={roomId} />;
}
