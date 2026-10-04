import type { Metadata } from "next";
import "./globals.css";
import "./kiki.css";
import { Toaster } from "sonner";
export const metadata: Metadata = {
	title: "Kiki Connect",
	description: "Personal safety and support",
	icons: { icon: "/assets/kiki-favicon.png", apple: "/assets/kiki-favicon.png" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}<Toaster theme="dark" position="top-right" /></body></html>; }