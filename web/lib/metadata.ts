import type { Metadata } from "next";

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://mentiko.com";

interface PageMetaOptions {
  title: string;
  description: string;
  path: string;
  images?: string[];
  noIndex?: boolean;
  ogType?: "website" | "article";
}

export function createPageMeta({
  title,
  description,
  path,
  images = ["/og-image.png"],
  noIndex = false,
  ogType = "website",
}: PageMetaOptions): Metadata {
  const url = `${baseUrl}${path}`;

  return {
    title,
    description,
    openGraph: {
      type: ogType,
      url,
      title,
      description,
      images: images.map((img) => ({
        url: img,
        width: 1200,
        height: 630,
      })),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : undefined,
    alternates: {
      canonical: path,
    },
  };
}

export const defaultMeta = {
  title: "mentiko - AI Orchestration Platform",
  description: "Build, orchestrate, and deploy AI agent chains with visual flow editor.",
};

export const routes = {
  chains: {
    title: "Chains",
    description: "Manage and execute AI agent chains with visual flow editor.",
  },
  schedules: {
    title: "Schedules",
    description: "Schedule recurring chain executions with cron expressions.",
  },
  conversations: {
    title: "Conversations",
    description: "View and manage conversation history across all chains.",
  },
  templates: {
    title: "Templates",
    description: "Browse and use pre-built chain templates.",
  },
  marketplace: {
    title: "Template Marketplace",
    description: "Discover and share chain templates with the community.",
  },
  api: {
    title: "API Documentation",
    description: "REST API reference for mentiko integration.",
  },
  settings: {
    title: "Settings",
    description: "Configure your mentiko workspace preferences.",
  },
};
