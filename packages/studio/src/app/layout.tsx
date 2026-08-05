import { Geist, Geist_Mono } from "next/font/google";

import type { Metadata } from "next";

import "./globals.css";
import { AppProviders } from "@/components/console/app-providers";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 *
 */
export const metadata: Metadata = {
  title: "Goli Studio — Agentic Coding Console",
  description:
    "Goli Studio is a web console for an agentic coding agent. Stream prompts, watch tool calls, approve writes, and manage sessions.",
  keywords: [
    "Goli",
    "Goli Studio",
    "agentic coding",
    "AI coding assistant",
    "Next.js",
    "TypeScript",
    "shadcn/ui",
  ],
  authors: [{ name: "Goli Studio" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Goli Studio",
    description: "Agentic coding console.",
    siteName: "Goli Studio",
    type: "website",
  },
};

/**
 *
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <AppProviders>
          {children}
          <SonnerToaster richColors position="top-center" />
        </AppProviders>
      </body>
    </html>
  );
}
