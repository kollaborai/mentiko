import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { RootLayoutClient } from "./layout-client";
import { getUserDisplayPreferencesInitScript } from "@/lib/user-display-preferences";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const viewport: Viewport = {
  themeColor: "#000000",
};

const baseUrl = process.env.BETTER_AUTH_URL || "https://mentiko.com";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "mentiko — AI Agent Orchestration",
    template: "%s | mentiko",
  },
  description: "Deploy and orchestrate AI agent pipelines. Build, run, and monitor multi-agent chains that automate complex workflows.",
  keywords: ["AI agents", "agent orchestration", "automation", "Claude", "AI pipeline"],
  authors: [{ name: "mentiko" }],
  creator: "mentiko",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: baseUrl,
    siteName: "mentiko",
    title: "mentiko — AI Agent Orchestration",
    description: "Deploy and orchestrate AI agent pipelines. Build, run, and monitor multi-agent chains that automate complex workflows.",
  },
  twitter: {
    card: "summary",
    title: "mentiko — AI Agent Orchestration",
    description: "Deploy and orchestrate AI agent pipelines.",
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "mentiko",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground">
        <Script
          id="user-display-preferences-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: getUserDisplayPreferencesInitScript() }}
        />
        <RootLayoutClient>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
