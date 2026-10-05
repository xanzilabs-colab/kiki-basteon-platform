import type { Metadata } from "next";
export const metadata: Metadata = { title: "Calculator", robots: { index: false, follow: false } };
export default function JournalLayout({ children }: { children: React.ReactNode }) { return children; }