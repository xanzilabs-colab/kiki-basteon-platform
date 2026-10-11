import { LinkupLobby } from "@/components/LinkupLobby";

export default async function LinkupRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <LinkupLobby roomId={roomId} />;
}
