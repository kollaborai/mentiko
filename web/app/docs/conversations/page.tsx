"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { MessageCircleFilled, RouteSquareFilled, BotMessageSquare } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function ConversationsDocPage() {
  return (
    <div>
      <PageBanner
        title="Conversations"
        subtitle="AI sessions with different agents (claude, codex, kollabor, aider). Each conversation has a message history with tool calls and responses."
        icon={MessageCircleFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Conversations", href: "/conversations", icon: MessageCircleFilled, iconColor: "#5b9ef5" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Types</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Conversations support different AI agents:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div><span className="text-foreground/70">claude</span> - Anthropic Claude (via claude CLI)</div>
          <div><span className="text-foreground/70">codex</span> - OpenAI Codex (via openai CLI)</div>
          <div><span className="text-foreground/70">kollabor</span> - Custom collaborative agent</div>
          <div><span className="text-foreground/70">aider</span> - Aider code editor agent</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Message Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Conversations store messages in JSONL format. Each message has a role and
          content, with optional tool calls and results.
        </p>
        <CodeBlock>{`// message format
{
  "role": "assistant",  // user | assistant | system
  "content": "Let me check the file...",
  "tool_calls": [
    {
      "id": "call_abc123",
      "name": "read_file",
      "input": { "file_path": "/path/to/file.ts" }
    }
  ],
  "tool_results": [
    {
      "tool_call_id": "call_abc123",
      "output": "file contents here..."
    }
  ]
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Session Management</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Each conversation runs in a PTY session managed by pty-manager. Sessions
          are isolated and can be listed, read, and destroyed.
        </p>
        <CodeBlock>{`// session naming
conv-{agent}-{timestamp}     // e.g. conv-claude-1678900000

// pty-manager commands
./bin/p list                  # list active sessions
./bin/p read <session>        # read session output
./bin/p send <session> "msg"  # send input to session
./bin/p destroy <session>     # terminate session`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Steer Input</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The steer input lets you send messages to live conversation sessions.
          It auto-detects the target session based on context.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div>Type in steer input and press Enter to send</div>
          <div>Messages go to the active or last-used session</div>
          <div>Response appears in the conversation view</div>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Steer input is available on the conversations page and in the run detail
          panel for agent conversations.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Conversation Storage</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Conversations are stored in the workspace-scoped conversations directory:
        </p>
        <CodeBlock>{`// storage path
namespaces/{id}/projects/{encoded-cwd}/conversations/{agent}/{conversationId}/
# default project collapses: namespaces/{id}/conversations/{agent}/{conversationId}/

// files in conversation directory
messages.jsonl    # message history
metadata.json     # title, agent, timestamps
state.json        # session state (if active)`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Tool Calls</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Agents use tools to interact with the system. Common tools include:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60">
          <div><code className="text-foreground/70">read_file</code> - read file contents</div>
          <div><code className="text-foreground/70">write_file</code> - create or overwrite files</div>
          <div><code className="text-foreground/70">edit_file</code> - make targeted edits</div>
          <div><code className="text-foreground/70">bash</code> - run shell commands</div>
          <div><code className="text-foreground/70">web_search</code> - search the web</div>
          <div><code className="text-foreground/70">browser_action</code> - interact with web pages</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Conversation Sorting</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Conversations are sorted by recency:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Primary: lastModified (bucketed to hour)</div>
          <div>Secondary: messageCount (more messages = higher priority)</div>
          <div>Result: most recent and most active conversations first</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Linked Conversations</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Conversations can be linked to runs, chains, or tasks. The link appears
          in the conversation metadata and is shown in the UI.
        </p>
        <CodeBlock>{`// linked conversation metadata
{
  "id": "conv-abc123",
  "agent": "claude",
  "title": "Fix authentication bug",
  "linkedTo": {
    "type": "run",
    "id": "run-xyz789"
  },
  "messageCount": 15,
  "lastModified": "2026-03-16T10:30:00Z"
}`}</CodeBlock>
      </section>
      </div>
    </div>
  );
}
