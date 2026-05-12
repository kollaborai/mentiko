"use client"

import { PageBanner } from "@/components/ui/page-banner";
import { DocumentTextFilled } from "@aliimam/icons";

export default function TroubleshootingDocsPage() {
  return (
    <div>
      <PageBanner
        title="Troubleshooting"
        subtitle="Common issues and how to fix them."
        icon={DocumentTextFilled}
        sectionColor="#f59e0b"
      />
      <div className="max-w-3xl px-6 pb-6">
      <div className="space-y-6">

        {/* build errors */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Build Errors After Agent Edits</h2>
            <p className="text-xs text-foreground/60 leading-relaxed">
              tglm agents sometimes mangle typescript syntax. missing commas, mixed brackets, wrong quotes.
            </p>
          </div>
          <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{`# check type errors
cd web && npx tsc --noEmit 2>&1 | head -60

# common issues
- missing commas in object/array literals
- single quotes instead of double quotes in jsx
- mixed {{ }} instead of { }
- missing type imports

# fix: only touch the syntax errors, dont restructure`}
          </div>
        </section>

        {/* dev server crashes */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Dev Server Crashes</h2>
            <p className="text-xs text-foreground/60 leading-relaxed">
              port 3000 already in use, usually from a tglm agent starting its own server.
            </p>
          </div>
          <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{`# check what's using port 3000
lsof -i :3000

# kill the process
kill -9 <PID>

# restart dev server
cd web && npm run dev`}
          </div>
        </section>

        {/* steer targets wrong session */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Steer Targets Wrong Session</h2>
            <p className="text-xs text-foreground/60 leading-relaxed">
              conversation input not going to the expected agent session.
            </p>
          </div>
          <div className="bg-card rounded-md p-3">
            <div className="text-[11px] font-mono text-foreground/70 mb-2">priority matching order</div>
            <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{`1. exact sessionId match
2. prefix match (session id starts with input)
3. partial match (session id contains input)
4. slug match (session name equals input)
5. agent role match`}
            </div>
            <p className="text-xs text-foreground/60 mt-2">
              check conversations/page.tsx:120-140 for the matching logic. select the conversation
              you want to target before typing.
            </p>
          </div>
        </section>

        {/* hydration errors */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Hydration Errors on Theme Toggle</h2>
            <p className="text-xs text-foreground/60 leading-relaxed">
              react hydration mismatch when toggling dark mode. ssr rendered different html than client.
            </p>
          </div>
          <div className="bg-card rounded-md p-3">
            <div className="text-[11px] font-mono text-foreground/70 mb-2">solution</div>
            <p className="text-xs text-foreground/60 mb-2">
              theme-toggle.tsx must check mounted state before rendering:
            </p>
            <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{`const [mounted, setMounted] = useState(false)

useEffect(() => {
  setMounted(true)
}, [])

if (!mounted) return null

// render theme toggle here`}
            </div>
          </div>
        </section>

        {/* chain not executing */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Chain Not Executing</h2>
            <p className="text-xs text-foreground/60 leading-relaxed">
              chain starts but agents dont run or get stuck.
            </p>
          </div>
          <div className="space-y-2">
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-1">check events directory</div>
              <p className="text-xs text-foreground/60">
                namespaces/{'{namespace_id}'}/events/ - should contain event json files as chain progresses
              </p>
            </div>
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-1">check sessions</div>
              <div className="bg-muted rounded-md p-2 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mt-2">
{`bin/p list
# should see agent sessions like agent-<name>-<timestamp>`}
              </div>
            </div>
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-1">check agent state</div>
              <p className="text-xs text-foreground/60">
                namespaces/{'{namespace_id}'}/state/ - contains current state of all agents
              </p>
            </div>
          </div>
        </section>

        {/* agent not found */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Agent Not Found Errors</h2>
            <p className="text-xs text-foreground/60 leading-relaxed">
              $ref in chain.json cant resolve to an agent definition.
            </p>
          </div>
          <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{`# resolution order
1. namespaces/{namespace_id}/agents/{name}/agent.json  (namespace-scoped)
2. agents/{name}/agent.json                    (shared/marketplace)

# verify agent exists
ls namespaces/default/agents/
ls agents/

# check $ref syntax matches agent name exactly
# case-sensitive, no file extension`}
          </div>
        </section>

        {/* session issues */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Common Session Issues</h2>
            <p className="text-xs text-foreground/60 leading-relaxed">
              pty-manager sessions not starting, naming conflicts, orphaned sessions.
            </p>
          </div>
          <div className="space-y-2">
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-1">orphaned sessions</div>
              <div className="bg-muted rounded-md p-2 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mt-2">
{`# list all sessions
bin/p list

# remove a specific session
bin/p remove SESSION_NAME`}
              </div>
            </div>
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-1">session naming conflicts</div>
              <p className="text-xs text-foreground/60">
                agent sessions use timestamp suffixes. if you run chains too fast, you might hit
                collision issues. chain-runner.sh adds unique suffixes to prevent this.
              </p>
            </div>
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-1">view running session output</div>
              <div className="bg-muted rounded-md p-2 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mt-2">
{`# find session name
bin/p list

# capture output (no attach mode, but capture shows output)
bin/p capture SESSION_NAME`}
              </div>
            </div>
          </div>
        </section>

        {/* still stuck */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Still Stuck</h2>
          </div>
          <div className="bg-card rounded-md p-3">
            <p className="text-xs text-foreground/60 leading-relaxed">
              check the logs in namespaces/{'{namespace_id}'}/runs/{'{run-id}'}/run.json for detailed error
              information. if all else fails, open an issue on github with the run log attached.
            </p>
          </div>
        </section>
      </div>
      </div>
    </div>
  )
}
