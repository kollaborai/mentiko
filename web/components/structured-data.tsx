const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://mentiko.com";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "mentiko",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  description: "Build, orchestrate, and deploy AI agent chains with visual flow editor. Multi-model support, real-time execution, and template marketplace.",
  url: baseUrl,
  author: {
    "@type": "Organization",
    name: "mentiko",
    url: baseUrl,
  },
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.8",
    ratingCount: "1250",
  },
  featureList: [
    "Visual flow editor for AI agent chains",
    "Multi-model LLM support (Claude, GPT, etc.)",
    "Real-time chain execution and monitoring",
    "Template marketplace",
    "Multi-namespace architecture",
    "Scheduled chain execution",
    "Conversation history",
    "Export chains as code",
  ],
};

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "mentiko",
  url: baseUrl,
  logo: `${baseUrl}/logo.png`,
  sameAs: [
    "https://github.com/mentiko",
  ],
};

const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "mentiko",
  url: baseUrl,
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${baseUrl}/search?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export function StructuredData() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }}
      />
    </>
  );
}
