import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./kiki.css";
import "./account-theme.css";
import { Toaster } from "sonner";
import { TouchSound } from "@/components/TouchSound";
import { AppDialogProvider } from "@/components/AppDialogProvider";
export const metadata: Metadata = {
	title: "Kiki Connect",
	description: "Personal safety and support",
	icons: { icon: "/assets/kiki-favicon.png", apple: "/assets/kiki-favicon.png" },
};
export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><AppDialogProvider>{children}<TouchSound /><Toaster theme="dark" position="top-right" /></AppDialogProvider></body></html>; }