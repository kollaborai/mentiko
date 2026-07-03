"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { HierarchyFilled, LinkFilled, RouteSquareFilled, CodeFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function ChainVersionControlDocPage() {
  return (
    <div>
      <PageBanner
        title="Chain Version Control"
        subtitle="Every chain gets its own git repository. Track the history of a chain's definition, branch to experiment, and merge changes back — all from the chains editor."
        icon={HierarchyFilled}
        sectionColor="#b07ee8"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "API Reference", href: "/docs/api", icon: CodeFilled, iconColor: "#5cb88a" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

        <section className="mb-6">
          <h2 className="text-sm font-medium mb-2">Overview</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            Chain version control gives each chain its own git repository, initialized inside the
            chain&apos;s directory. What&apos;s versioned is the chain&apos;s <code className="text-foreground/70 bg-muted px-1 rounded">chain.json</code> —
            its agents, triggers, branches, and config — so you can see how a workflow evolved, roll back to
            a previous shape, or try a risky change on a branch before merging it into <code className="text-foreground/70 bg-muted px-1 rounded">main</code>.
          </p>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            It lives in the <strong className="text-foreground/80">Version Control</strong> panel in the chains
            editor — a collapsible section showing the current branch, recent commits, and a branch manager.
            This panel is focused on <strong className="text-foreground/80">history, branches, and merges</strong>;
            it is not a general staging/commit surface.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-sm font-medium mb-2">Where it lives</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            The repository is created under the chain&apos;s org-scoped directory. In the default org:
          </p>
          <CodeBlock>{`~/.mentiko/namespaces/{namespace_id}/chains/{chain_id}/
  chain.json        # the versioned chain definition
  .git/             # the chain's git repository`}</CodeBlock>
          <p className="text-xs text-foreground/60 leading-relaxed">
            Non-default orgs use <code className="text-foreground/70 bg-muted px-1 rounded">orgs/{"{org_id}"}/chains/{"{chain_id}"}/</code> under
            the namespace. Every git operation runs inside this directory via a shared, argument-array exec
            layer — no operation shells out to git, and branch names are validated before use.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-sm font-medium mb-2">Initializing</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            A chain has no history until you initialize it. When version control isn&apos;t set up, the panel
            shows an <strong className="text-foreground/80">Initialize Version Control</strong> button. Initializing
            creates the repository on <code className="text-foreground/70 bg-muted px-1 rounded">main</code>, writes a
            <code className="text-foreground/70 bg-muted px-1 rounded">.gitignore</code>, and makes the first commit
            (&quot;Initial import&quot;).
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-sm font-medium mb-2">Status &amp; history</h2>
          <div className="bg-card rounded-md p-3 mb-3">
            <p className="text-xs text-foreground/70 mb-1"><strong>Status line</strong></p>
            <p className="text-xs text-foreground/60 leading-relaxed">
              Shows whether the working tree is <code className="text-foreground/70 bg-muted px-1 rounded">clean</code> or
              <code className="text-foreground/70 bg-muted px-1 rounded">dirty</code>, the current branch, and
              <em> ahead</em> / <em>behind</em> counts relative to its upstream.
            </p>
          </div>
          <div className="bg-card rounded-md p-3 mb-3">
            <p className="text-xs text-foreground/70 mb-1"><strong>Recent commits</strong></p>
            <p className="text-xs text-foreground/60 leading-relaxed">
              A compact timeline of the latest commits. Selecting a commit opens a JSON diff of that
              commit&apos;s <code className="text-foreground/70 bg-muted px-1 rounded">chain.json</code> against the
              chain&apos;s current definition, so you can see exactly what changed.
            </p>
          </div>
        </section>

        <section className="mb-6">
          <h2 className="text-sm font-medium mb-2">Branches</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            The branch manager lists every branch, marks the current one, and offers per-branch actions:
          </p>
          <div className="bg-card rounded-md p-3 mb-3 space-y-2">
            <p className="text-xs text-foreground/60 leading-relaxed">
              <strong className="text-foreground/80">New Branch</strong> — create a branch from any existing branch as its start point.
            </p>
            <p className="text-xs text-foreground/60 leading-relaxed">
              <strong className="text-foreground/80">Switch</strong> — check out another branch. Uncommitted changes are rejected rather than silently carried over.
            </p>
            <p className="text-xs text-foreground/60 leading-relaxed">
              <strong className="text-foreground/80">Compare</strong> — see how many commits a branch is ahead of / behind the current one.
            </p>
            <p className="text-xs text-foreground/60 leading-relaxed">
              <strong className="text-foreground/80">Delete</strong> — remove a branch (with confirmation).
            </p>
          </div>
        </section>

        <section className="mb-6">
          <h2 className="text-sm font-medium mb-2">Merging</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            From the current branch, choose <strong className="text-foreground/80">Merge Into…</strong> and pick a
            source branch to merge into it. Three outcomes:
          </p>
          <div className="bg-card rounded-md p-3 mb-3 space-y-2">
            <p className="text-xs text-foreground/60 leading-relaxed">
              <strong className="text-emerald-400">Success</strong> — the merge applied cleanly.
            </p>
            <p className="text-xs text-foreground/60 leading-relaxed">
              <strong className="text-amber-400">Conflict</strong> — conflicting files are listed. You can
              <strong className="text-foreground/80"> Abort Merge</strong> to restore the pre-merge state, or resolve manually.
            </p>
            <p className="text-xs text-foreground/60 leading-relaxed">
              <strong className="text-destructive">Failed</strong> — a genuine error (unrelated histories, a bad ref, a dirty tree).
              The failure and its git message are surfaced rather than reported as a false success.
            </p>
          </div>
          <p className="text-xs text-foreground/60 leading-relaxed">
            The source dropdown excludes the current branch, so you can&apos;t accidentally merge a branch into itself.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-sm font-medium mb-2">API</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            The panel is backed by a chain-scoped git route family. All routes require an authenticated
            session with <code className="text-foreground/70 bg-muted px-1 rounded">manage_chains</code> permission.
          </p>
          <CodeBlock>{`POST   /api/chains/{id}/git/init      # initialize repo + .gitignore
GET    /api/chains/{id}/git/status    # working tree, ahead/behind
GET    /api/chains/{id}/git/history   # commit log
GET    /api/chains/{id}/git/branches  # list branches
POST   /api/chains/{id}/git/branches  # create / switch / delete / compare
GET    /api/chains/{id}/git/diff      # diff summary
POST   /api/chains/{id}/git/diff      # chain.json at a specific commit
POST   /api/chains/{id}/git/merge     # merge (success | conflict | error)
DELETE /api/chains/{id}/git/merge     # abort an in-progress merge
POST   /api/chains/{id}/git/revert    # revert a commit`}</CodeBlock>
          <p className="text-xs text-foreground/60 leading-relaxed">
            See the <a href="/docs/api" className="text-foreground/80 underline hover:text-foreground">API Reference</a> for
            full request and response shapes. Client access goes through the <code className="text-foreground/70 bg-muted px-1 rounded">useChainVersionControl</code> hook.
          </p>
        </section>

      </div>
    </div>
  );
}
