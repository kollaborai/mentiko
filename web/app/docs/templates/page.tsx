"use client"

import { PageBanner } from "@/components/ui/page-banner";
import { CategoryFilled, LinkFilled, MagicStarFilled } from "@aliimam/icons";

export default function TemplatesDocsPage() {
  return (
    <div>
      <PageBanner
        title="Templates"
        subtitle="Reusable chain blueprints for common workflows."
        icon={CategoryFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Templates", href: "/marketplace/templates", icon: CategoryFilled, iconColor: "#5cb88a" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Generation", href: "/generation", icon: MagicStarFilled, iconColor: "#b07ee8" },
        ]}
      />
      <div className="max-w-3xl px-6 pb-6">
      <div className="space-y-6">

        {/* what are templates */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-2">What Are Templates</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            templates are pre-built chain definitions you can use as starting points. instead of writing
            chain.json from scratch, clone a template and customize it for your needs.
          </p>
          <p className="text-xs text-foreground/60 leading-relaxed">
            think of templates like github repo templates or cookiecutter projects - they encode best
            practices and common patterns so you dont start from zero every time.
          </p>
        </section>

        {/* template sources */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-2">Template Sources</h2>
          <div className="space-y-2">
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-1">examples/</div>
              <p className="text-xs text-foreground/60">
                example chains demonstrating patterns. basic reference implementations.
              </p>
            </div>
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-1">templates/</div>
              <p className="text-xs text-foreground/60">
                production-ready templates with proper structure, variables, and docs.
              </p>
            </div>
          </div>
        </section>

        {/* template marketplace */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-2">Template Marketplace</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            browse templates from the community marketplace. filter by category, rating, or use case.
            one-click install adds the template to your namespace.
          </p>
          <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{`# visit marketplace
/web/templates

# filter by category
research, coding, testing, deployment, automation

# install adds to your namespace
namespaces/{namespace_id}/templates/{template-name}/`}
          </div>
        </section>

        {/* creating your own */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-2">Creating Your Own Template</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            templates live in templates/{'{name}'}/ with two required files:
          </p>
          <div className="space-y-2">
            <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{`templates/my-workflow/
├── chain.json      # chain definition
└── README.md       # documentation`}
            </div>
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-2">chain.json</div>
              <p className="text-xs text-foreground/60">
                standard chain definition. include agents, triggers, events, and connections.
              </p>
            </div>
            <div className="bg-card rounded-md p-3">
              <div className="text-[11px] font-mono text-foreground/70 mb-2">README.md</div>
              <p className="text-xs text-foreground/60">
                describe what the template does, variables it accepts, and how to customize it.
              </p>
            </div>
          </div>
        </section>

        {/* template variables */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-2">Template Variables</h2>
          <p className="text-xs text-foreground/60 leading-relaxed mb-3">
            templates support placeholder variables that get replaced at runtime:
          </p>
          <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{`{TASK}         # user-provided task description
{GOAL}         # high-level objective
{CHAIN_NAME}   # name of the chain instance

# example in prompt
"Analyze this task: {TASK}"
"Work towards goal: {GOAL}"
"Chain {CHAIN_NAME} execution complete"`}
          </div>
          <p className="text-xs text-foreground/60 leading-relaxed mt-3">
            variables are replaced when the chain runs. use them to make templates flexible and
            reusable across different contexts.
          </p>
        </section>

        {/* cli usage */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-2">Using Templates from CLI</h2>
          <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{`# run a template directly
./bin/mentiko run --template my-template

# list available templates
./bin/mentiko template list

# create a chain from template
./bin/mentiko template clone my-template my-chain

# run the cloned chain
./bin/mentiko run my-chain`}
          </div>
        </section>

        {/* best practices */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-2">Best Practices</h2>
          <div className="space-y-2">
            <div className="bg-card rounded-md p-3">
              <div className="text-xs font-medium text-foreground mb-1">keep it focused</div>
              <p className="text-xs text-foreground/60">
                each template should do one thing well. combine templates for complex workflows.
              </p>
            </div>
            <div className="bg-card rounded-md p-3">
              <div className="text-xs font-medium text-foreground mb-1">document variables</div>
              <p className="text-xs text-foreground/60">
                list all {'{VAR}'} placeholders in the readme with examples.
              </p>
            </div>
            <div className="bg-card rounded-md p-3">
              <div className="text-xs font-medium text-foreground mb-1">test before sharing</div>
              <p className="text-xs text-foreground/60">
                run the template end-to-end. verify all variables resolve correctly.
              </p>
            </div>
          </div>
        </section>
      </div>
      </div>
    </div>
  )
}
