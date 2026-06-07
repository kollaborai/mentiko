"use client";

import Link from "next/link";
import { UI_LIBRARY_GROUPS, UI_LIBRARY_RULES } from "@/components/ui/registry";
import { ComponentExample } from "./examples";
import { PageBanner } from "@/components/ui/page-banner";
import { ComponentFilled } from "@aliimam/icons";

const statusClasses = {
  approved: "bg-emerald-500/10 text-emerald-300",
  provisional: "bg-amber-500/10 text-amber-300",
  planned: "bg-muted text-muted-foreground",
} as const;

const sourceClasses = {
  "gaia-derived": "bg-sky-500/10 text-sky-300",
  "shared-app": "bg-foreground/5 text-foreground/70",
  "radix-base": "bg-violet-500/10 text-violet-300",
} as const;

export default function UiLibraryPage() {
  return (
    <div>
      <PageBanner
        title="UI Library"
        subtitle="The internal component library for mentiko. Agents should start here before building page-specific chrome or copying ad hoc patterns into route files."
        icon={ComponentFilled}
        sectionColor="#f59e0b"
      />
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-6 md:px-6">
      <header className="rounded-md bg-card p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="rounded-md bg-muted px-3 py-3 text-xs text-muted-foreground">
            <div>Source of truth: <code className="text-foreground/80">web/components/ui</code></div>
            <div className="mt-1">
              Design rules:{" "}
              <Link className="text-foreground underline underline-offset-4" href="/docs">
                docs
              </Link>{" "}
              + <code className="text-foreground/80">docs/DESIGN_SYSTEM.md</code>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        {UI_LIBRARY_RULES.map((rule) => (
          <div key={rule} className="rounded-md bg-card p-3 text-sm text-foreground/80">
            {rule}
          </div>
        ))}
      </section>

      <section className="rounded-md bg-card p-4">
        <h2>Baseline Model</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          The default mentiko workflow page is a dense, neutral list-detail layout.
          Use current `runs`, `tasks`, and `decisions` as the model before inventing
          a page-specific interpretation.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md bg-muted p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40">Do</div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Compact header and action cluster</li>
              <li>Compact search and filter controls</li>
              <li>Dense reusable list rows</li>
              <li>Neutral surfaces and restrained metadata</li>
            </ul>
          </div>
          <div className="rounded-md bg-muted p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40">Do Not</div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Turn workflow pages into hero layouts</li>
              <li>Swap list rows for showcase cards</li>
              <li>Add glow, blur, or decorative gradients</li>
              <li>Use oversized rounding to fake polish</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── New Aesthetic Patterns ── */}
      <section className="rounded-md bg-card p-4">
        <h2>Page Banner</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Every page uses <code className="text-foreground/80">PageBanner</code> as its header.
          It renders a pattern background, watermark identity icon, title, subtitle, and charm buttons.
          Supersedes the old <code className="text-foreground/80">PageHeader</code> component.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md bg-muted p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40">Anatomy</div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Pattern bg: zinc colors, fades center to right</li>
              <li>Watermark: page identity icon, sectionColor, 0.15 opacity</li>
              <li>Title: text-4xl font-black tracking-tighter</li>
              <li>Subtitle: text-sm text-foreground/50</li>
              <li>Charms: action icons + doc icons with tooltips</li>
            </ul>
          </div>
          <div className="rounded-md bg-muted p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40">Props</div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li><code className="text-foreground/70">title</code> — page title (h1)</li>
              <li><code className="text-foreground/70">subtitle</code> — description text</li>
              <li><code className="text-foreground/70">icon</code> — identity icon for watermark</li>
              <li><code className="text-foreground/70">sectionColor</code> — hex color for watermark tint</li>
              <li><code className="text-foreground/70">actions</code> — charm buttons array</li>
              <li><code className="text-foreground/70">docs</code> — doc link charms array</li>
            </ul>
          </div>
        </div>
        <ComponentExample id="page-banner" />
      </section>

      <section className="rounded-md bg-card p-4">
        <h2>Charm System</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Charms are icon-only buttons with radix tooltips in the third row of PageBanner.
          They provide quick navigation to related pages and documentation.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md bg-muted p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40">Action Charms</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Cross-link to related pages. Colored by destination section color.
            </p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40">Doc Charms</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Link to docs pages. Always amber (#f59e0b). Use topic identity icon.
            </p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40">Generate Charms</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Trigger AI generation. Purple with MagicStarFilled. Set <code className="text-foreground/70">generate: true</code>.
            </p>
          </div>
        </div>
        <ComponentExample id="charm-system" />
      </section>

      <section className="rounded-md bg-card p-4">
        <h2>Card Watermarks</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Cards can include an oversized identity icon as a watermark at bottom-right,
          clipped by overflow-hidden. Used on pages like /updates to reinforce visual identity.
        </p>
        <div className="mt-4 rounded-md bg-muted p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40">Rules</div>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>Icon size: h-48 w-48 (oversized, partially clipped)</li>
            <li>Position: absolute bottom-right</li>
            <li>Opacity: 0.1, colored by feature section color</li>
            <li>Container must have overflow-hidden</li>
            <li>One watermark per card maximum</li>
          </ul>
        </div>
        <ComponentExample id="card-watermark" />
      </section>

      <section className="rounded-md bg-card p-4">
        <h2>Generate Button Standard</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          All AI generation actions use MagicStarFilled in purple. Loading state swaps to
          RotateFilled with animate-spin. Consistent across all pages.
        </p>
        <ComponentExample id="generate-button" />
      </section>

      {UI_LIBRARY_GROUPS.map((group) => (
        <section key={group.id} className="space-y-4">
          <div>
            <h2>{group.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {group.components.map((component) => (
              <article key={component.id} className="rounded-md bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base">{component.name}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${statusClasses[component.status]}`}
                  >
                    {component.status}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${sourceClasses[component.source]}`}
                  >
                    {component.source.replace("-", " ")}
                  </span>
                </div>

                <p className="mt-3 text-sm text-foreground/80">{component.description}</p>

                <dl className="mt-4 space-y-3 text-xs">
                  <div>
                    <dt className="uppercase tracking-[0.16em] text-foreground/40">Import</dt>
                    <dd className="mt-1 font-mono text-foreground/75">{component.path}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.16em] text-foreground/40">Use It For</dt>
                    <dd className="mt-1 text-muted-foreground">{component.usage}</dd>
                  </div>
                  {component.notes && (
                    <div>
                      <dt className="uppercase tracking-[0.16em] text-foreground/40">Notes</dt>
                      <dd className="mt-1 text-muted-foreground">{component.notes}</dd>
                    </div>
                  )}
                </dl>

                <ComponentExample id={component.id} />
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="rounded-md bg-card p-4">
        <h2>Extension Workflow</h2>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Check the barrel export at <code className="text-foreground/80">web/components/ui/index.ts</code>.</li>
          <li>2. Reuse an approved component before touching route-local styling.</li>
          <li>3. If no shared primitive fits, inspect Gaia for the missing component pattern.</li>
          <li>4. Add the new primitive to <code className="text-foreground/80">web/components/ui</code> and register it here.</li>
          <li>5. Only then apply it to product pages.</li>
        </ol>
      </section>
    </main>
    </div>
  );
}
