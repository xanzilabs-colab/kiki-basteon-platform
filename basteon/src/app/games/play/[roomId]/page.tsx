import { MorabarabaRoom } from "@/components/MorabarabaRoom";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <MorabarabaRoom roomId={roomId} />;
}
