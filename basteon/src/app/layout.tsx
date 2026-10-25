import type { Metadata } from "next";
import "./globals.css";
import "./kiki.css";
import { Toaster } from "sonner";
import { TouchSound } from "@/components/TouchSound";
import { AppDialogProvider } from "@/components/AppDialogProvider";
export const metadata: Metadata = {
	title: "Kiki Connect",
	description: "Personal safety and support",
	icons: {
		icon: [{ url: "/assets/kiki-favicon.png", sizes: "48x48", type: "image/png" }],
		apple: [{ url: "/assets/kiki-icon.png", sizes: "512x512", type: "image/png" }],
	},
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><AppDialogProvider>{children}<TouchSound /><Toaster theme="dark" position="top-right" /></AppDialogProvider></body></html>; }