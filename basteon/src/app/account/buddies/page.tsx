import { redirect } from "next/navigation";

export default function BuddiesPage() {
  redirect("/account/trips?mode=travel-together");
}
