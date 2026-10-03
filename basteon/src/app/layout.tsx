import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
export const metadata: Metadata = { title: "Basteon Response Console", description: "Emergency response operations" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}<Toaster theme="dark" position="top-right" /></body></html>; }