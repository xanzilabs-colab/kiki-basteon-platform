import { TeachGame } from "@/components/TeachGame";

export default async function TeachOneRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <TeachGame mode="pair" roomId={roomId} />;
}
