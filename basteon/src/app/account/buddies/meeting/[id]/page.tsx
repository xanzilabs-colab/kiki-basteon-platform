import { notFound } from "next/navigation";
import { z } from "zod";
import { BuddyMeeting } from "@/components/BuddyMeeting";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  return <BuddyMeeting id={id} />;
}