// web/components/ui/markdown.tsx
"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";
import { MermaidBlock } from "./mermaid-block";
import styles from "./markdown.module.css";

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), "className"],
    input: [...(defaultSchema.attributes?.input || []), "type", "checked", "disabled"],
  },
  tagNames: [...(defaultSchema.tagNames || []), "input", "details", "summary"],
};

interface MarkdownProps {
  content: string;
  className?: string;
  allowHtml?: boolean;
  compact?: boolean;
}

export function Markdown({
  content,
  className = "",
  allowHtml = true,
  compact = false,
}: MarkdownProps) {
  const plugins = useMemo(() => {
    const rehype: Array<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [any, any] | any
    > = [];
    if (allowHtml) rehype.push(rehypeRaw);
    rehype.push([rehypeSanitize, sanitizeSchema]);
    return rehype;
  }, [allowHtml]);

  const components: Components = useMemo(
    () => ({
      code({ className: codeClassName, children, ...rest }) {
        const match = /language-(\w+)/.exec(codeClassName || "");
        const lang = match?.[1] || "";
        const text = String(children).replace(/\n$/, "");

        if (lang === "mermaid") {
          return <MermaidBlock source={text} />;
        }

        // inline code (no language class, single line)
        if (!match && !text.includes("\n")) {
          return (
            <code className={codeClassName} {...rest}>
              {children}
            </code>
          );
        }

        // fenced code block
        return (
          <div className={styles.codeBlock}>
            {lang && <div className={styles.codeLang}>{lang}</div>}
            <pre>
              <code>{text}</code>
            </pre>
          </div>
        );
      },
      pre({ children }) {
        // react-markdown wraps code blocks in <pre>, but we handle
        // the wrapper in our custom code component above.
        // If children is already our custom codeBlock div, pass through.
        return <>{children}</>;
      },
      a({ href, children, ...rest }) {
        const isExternal =
          href?.startsWith("http://") || href?.startsWith("https://");
        return (
          <a
            href={href}
            {...(isExternal
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            {...rest}
          >
            {children}
          </a>
        );
      },
    }),
    []
  );

  return (
    <div
      className={`${styles.root} ${compact ? styles.compact : ""} ${className}`.trim()}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={plugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
