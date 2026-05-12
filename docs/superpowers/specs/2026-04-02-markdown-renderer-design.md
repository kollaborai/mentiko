# Markdown Renderer Replacement

## Problem

Custom regex-based parser in `web/components/editor/markdown-renderer.tsx` misses tables, task lists, strikethrough, nested lists, HTML passthrough, and images. Markdown shows as plain text in 6+ locations across the app. No mermaid/diagram support.

## Approach

Replace custom parser with `react-markdown` + plugins. Renders as React components (no `dangerouslySetInnerHTML`), supports HTML-in-markdown via `rehype-raw`, sanitized via `rehype-sanitize`.

Rejected alternatives:
- **marked + DOMPurify**: fast but innerHTML-based, no React component overrides
- **markdown-it**: plugin-heavy, also innerHTML, worse React integration

## Dependencies

```
react-markdown
remark-gfm          # tables, task lists, strikethrough, autolinks
rehype-raw           # HTML passthrough in markdown
rehype-sanitize      # sanitize HTML output
mermaid              # diagram rendering
```

## Components

### `web/components/ui/markdown.tsx`

Shared Markdown component used app-wide.

Props:
- `content: string` — markdown/html source
- `className?: string` — additional container classes
- `allowHtml?: boolean` — enable HTML passthrough (default: true)
- `compact?: boolean` — tighter spacing for inline contexts (messages, cards)

Internals:
- `react-markdown` with `remark-gfm` + `rehype-raw` + `rehype-sanitize`
- Custom code block renderer: detects `language-mermaid`, renders `MermaidBlock` instead of `<pre><code>`
- Custom link renderer: external links get `target="_blank" rel="noopener noreferrer"`
- All elements styled via CSS module matching current dark aesthetic

### `web/components/ui/mermaid-block.tsx`

Lazy-loaded mermaid renderer with edit mode.

States:
- **rendered**: SVG diagram displayed
- **editing**: textarea with mermaid source + live preview
- **error**: parse error message + source visible

Behavior:
- Renders mermaid source to SVG on mount via `mermaid.render()`
- Click SVG → enters edit mode (textarea with mermaid source)
- Edit mode: live preview as you type (debounced 300ms)
- Escape or click outside → exit edit mode
- `mermaid.initialize({ theme: 'dark' })` for dark theme
- Lazy: `dynamic import('mermaid')` only when a mermaid block appears on page

### `web/components/ui/markdown.module.css`

CSS module mirroring existing aesthetic from `markdown-renderer.tsx`:
- Dark bg, rgba white text, same font sizes/weights
- Code blocks: `#0a0a0a` bg, `1px rgba(255,255,255,0.06)` border, language label
- Inline code: monospace, subtle bg highlight
- Links: subtle underline, hover brightening
- Tables: borderless rows, alternating subtle bg
- Blockquotes: left border accent, muted text
- Task lists: custom checkbox styling
- Compact mode: tighter margins for inline use (messages, cards)

No `@tailwindcss/typography` — tighter control over dark theme, and Tailwind 4 doesn't need it.

## Wiring Locations

### 1. `web/components/editor/editor-pane.tsx`
- Replace `import { MarkdownRenderer }` with new `Markdown` component
- Line 324: `<MarkdownRenderer content={file.content} />` → `<Markdown content={file.content} />`

### 2. `web/components/conversation/message-renderer.tsx`
- Assistant messages (lines 69-84): wrap content in `<Markdown compact />`
- Keep tool use/results as monospace code blocks (don't format those as markdown)

### 3. `web/components/run/run-detail-panel.tsx`
- Replace custom `renderMarkdownBlock()` function (lines 196-234) with `<Markdown compact />`
- Replace `<pre>` output dumps (lines 1509-1514) with `<Markdown />`

### 4. `web/components/decision/overview-tab.tsx`
- Recommendation rationale (line 133-135) → `<Markdown compact />`
- Problem/root cause/impact (line 147-149) → `<Markdown compact />`
- Before/After/Net effect (line 166-179) → `<Markdown compact />`

### 5. `web/components/decision/option-cards.tsx`
- Option descriptions (line 282) → `<Markdown compact />`
- Pros/cons text (lines 345-365) → `<Markdown compact />`

### 6. `web/components/agent/agent-detail-panel.tsx`
- Prompt display (line 252) → `<Markdown />` (full width, not compact)

### 7. `web/components/artifact/artifact-generate-dialog.tsx`
- Artifact preview (lines 235-240) → `<Markdown />`

## Cleanup

- Delete `web/components/editor/markdown-renderer.tsx` (old custom parser)
- Remove the import from `editor-pane.tsx`

## Styling Reference

Port these values from the existing `markdown-renderer.tsx` scoped CSS:

| Element | Color | Size | Spacing |
|---------|-------|------|---------|
| Body text | `rgba(255,255,255,0.7)` | 13px | line-height 1.5 |
| h1 | `rgba(255,255,255,0.95)` | 24px / 900 weight | 24px top, 10px bottom |
| h2 | `rgba(255,255,255,0.9)` | 18px / 800 weight | 20px top, 8px bottom |
| h3 | `rgba(255,255,255,0.85)` | 15px / 700 weight | 16px top, 6px bottom |
| h4-h6 | `rgba(255,255,255,0.75)` | 14px / 600 weight | uppercase, letter-spacing 0.05em |
| Inline code | `rgba(255,255,255,0.75)` | 12px mono | 2px 6px padding, rgba bg 0.06 |
| Code block | `rgba(200,200,208,0.9)` | 12px mono / 1.6 lh | #0a0a0a bg, 12px 14px padding |
| Language label | `rgba(255,255,255,0.25)` | 9px uppercase | 0.08em spacing |
| Links | `rgba(200,200,200,0.9)` | inherit | bottom shadow underline |
| List markers | `rgba(255,255,255,0.2)` | inherit | 24px left padding |
| List items | `rgba(255,255,255,0.65)` | inherit | 4px vertical |
| Blockquote | `rgba(255,255,255,0.5)` | italic | 2px left border at 0.1 opacity |
| Strong | `rgba(255,255,255,0.85)` | 600 weight | — |
| Em | `rgba(255,255,255,0.65)` | italic | — |
| HR | `rgba(255,255,255,0.06)` | 1px height | 24px vertical margin |

Compact mode reduces all vertical margins by ~40%.
