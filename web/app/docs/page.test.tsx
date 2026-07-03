import { render, screen } from "@testing-library/react";
import DocsIndexPage from "./page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  ),
}));

jest.mock("@aliimam/icons", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
  // catch-all: any icon (including newly-added nav icons) resolves to a stub
  return new Proxy(
    {},
    { get: (_t, name) => (typeof name === "string" && name !== "__esModule" ? Icon : undefined) }
  );
});

describe("DocsIndexPage", () => {
  it("exposes docs search and card hooks for floating panel transparency", () => {
    render(<DocsIndexPage />);

    expect(screen.getByPlaceholderText("search docs... (cmd+k)")).toHaveAttribute("data-docs-search");
    expect(screen.getByRole("link", { name: /create a chain/i })).toHaveAttribute("data-docs-card");
    expect(screen.getByRole("link", { name: /chains agent pipeline definitions/i })).toHaveAttribute(
      "data-docs-card",
    );
    expect(screen.getByTestId("docs-architecture-panel")).toHaveAttribute("data-docs-card");
  });
});
