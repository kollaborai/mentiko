import { InfoCircleFilled as Info } from "@aliimam/icons";
import Link from "next/link";

interface DocLinkProps {
  href: string;
  label?: string;
  className?: string;
}

/**
 * Subtle info icon that links to a docs page.
 * Use next to section headers or complex fields so users can self-serve.
 */
export function DocLink({ href, label, className = "" }: DocLinkProps) {
  return (
    <Link
      href={href}
      title={label ? `Docs: ${label}` : "Docs"}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground transition-colors ${className}`}
    >
      <Info className="h-3.5 w-3.5" />
    </Link>
  );
}
