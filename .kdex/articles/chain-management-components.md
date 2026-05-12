---
title: Chain Management Components
type: component
linked_files:
  - web/components/chain/add-agent-dialog.tsx
  - web/components/chain/agent-card.tsx
  - web/components/chain/agent-event-mapping.tsx
  - web/components/chain/agent-preview-tooltip.tsx
  - web/components/chain/agent-preview.tsx
  - web/components/chain/chain-branch-manager.tsx
  - web/components/chain/chain-diff-view.tsx
  - web/components/chain/chain-execution-stream.tsx
  - web/components/chain/chain-flow-graph.tsx
  - web/components/chain/chain-graph.tsx
  - web/components/chain/chain-history-timeline.tsx
  - web/components/chain/chain-icon.tsx
  - web/components/chain/chain-preview-tooltip.tsx
  - web/components/chain/chain-triggers-panel.tsx
  - web/components/chain/debug-panel.tsx
  - web/components/chain/event-timeline.tsx
  - web/components/chain/import-modal.tsx
  - web/components/chain/lazy-visual-editor.tsx
  - web/components/chain/live-output.tsx
  - web/components/chain/test-run-panel.tsx
  - web/components/chain/version-history.tsx
  - web/components/chain/visual-editor-reactflow.tsx
  - web/components/chain/visual-editor.tsx
file_hashes:
  web/components/chain/add-agent-dialog.tsx: sha256:91c631e3695563b2
  web/components/chain/agent-card.tsx: sha256:f29c8eccfa5c6a5e
  web/components/chain/agent-event-mapping.tsx: sha256:e9513d66995e78bf
  web/components/chain/agent-preview-tooltip.tsx: sha256:d8eed5b2199b52cf
  web/components/chain/agent-preview.tsx: sha256:4d4e5c2d120ea6a0
  web/components/chain/chain-branch-manager.tsx: sha256:a8665371f5e7327a
  web/components/chain/chain-diff-view.tsx: sha256:8e515f6f1800731d
  web/components/chain/chain-execution-stream.tsx: sha256:d33ef326a0f89eca
  web/components/chain/chain-flow-graph.tsx: sha256:a3b7c26ac16cce9a
  web/components/chain/chain-graph.tsx: sha256:a65ba6dea3c52174
  web/components/chain/chain-history-timeline.tsx: sha256:85bf4e5cd760b4f0
  web/components/chain/chain-icon.tsx: sha256:649891690e25df55
  web/components/chain/chain-preview-tooltip.tsx: sha256:e4324b451d304e4b
  web/components/chain/chain-triggers-panel.tsx: sha256:57ec8f82814f8774
  web/components/chain/debug-panel.tsx: sha256:b7659aa68848f684
  web/components/chain/event-timeline.tsx: sha256:94729cc62c64926c
  web/components/chain/import-modal.tsx: sha256:555a401d36d964ca
  web/components/chain/lazy-visual-editor.tsx: sha256:c74cf540afe16009
  web/components/chain/live-output.tsx: sha256:d64855e43cb77340
  web/components/chain/test-run-panel.tsx: sha256:8397820152d08a42
  web/components/chain/version-history.tsx: sha256:3cf76971d54e62e3
  web/components/chain/visual-editor-reactflow.tsx: sha256:33a376d831bec3ad
  web/components/chain/visual-editor.tsx: sha256:1d24c22e8fa56ca2
tags: [chain, graph, editor, visualization, react]
created: 2026-04-07T09:47:30.766078
updated: 2026-04-07T09:47:30.766078
status: current
related: []
---

```yaml
---
title: Chain Management Components
type: component
tags: chain, graph, editor, visualization, react, reactflow
related: []
---

## Overview

The chain management components provide a comprehensive UI for creating, editing, visualizing, and managing AI agent chains. This is the visual interface for the chain system, allowing users to build agent workflows through drag-and-drop graph editors, JSON editing, and event mapping.

## Key Components

### Visual Editors

- **`VisualChainEditor`** (`visual-editor.tsx`) - Original SVG-based visual editor with drag-and-drop node positioning
- **`VisualChainEditorReactFlow`** (`visual-editor-reactflow.tsx`) - Modern ReactFlow-based editor with improved UX
- **`ChainFlowGraph`** (`chain-flow-graph.tsx`) - Static SVG graph visualization with topology preview
- **`lazy-visual-editor.tsx`** - Lazy-loaded wrapper for code splitting

### Agent Management

- **`AddAgentDialog`** (`add-agent-dialog.tsx`) - Modal for adding agents from registry, generating with AI, or creating blank
- **`AgentCard`** (`agent-card.tsx`) - Display card for agent sessions with output preview and message input
- **`AgentPreview`** (`agent-preview.tsx`) - Compact preview component showing agent details
- **`AgentPreviewTooltip`** (`agent-preview-tooltip.tsx`) - Hover tooltip for agent information

### Event & Branching

- **`AgentEventMapping`** (`agent-event-mapping.tsx`) - UI for configuring triggers, emits, error handlers, and timeout handlers
- **`ChainTriggersPanel`** (`chain-triggers-panel.tsx`) - Panel for configuring event triggers and cross-chain dependencies
- **`ChainBranchManager`** (`chain-branch-manager.tsx`) - Git-style branch management with create, switch, merge, and diff

### Import/Export

- **`ImportModal`** family (`import-modal.tsx`) - Import chains from URL, JSON, YAML, or clipboard with preview
- **`ChainCustomizationModal`** - Configure variables and execution settings before import

### Testing & Debugging

- **`TestRunPanel`** (`test-run-panel.tsx`) - Bottom panel for testing chain execution with live output
- **`DebugPanel`** (`debug-panel.tsx`) - Debug mode with breakpoints and step-through execution
- **`LiveOutput`** (`live-output.tsx`) - Live terminal output viewer for agent sessions

### History & Versioning

- **`VersionHistory`** (`version-history.tsx`) - Version history viewer with diff and restore
- **`ChainHistoryTimeline`** (`chain-history-timeline.tsx`) - Timeline view of git commits and versions
- **`ChainDiffView`** (`chain-diff-view.tsx`) - Visual diff viewer for comparing chain versions

### Execution

- **`ChainExecutionStream`** (`chain-execution-stream.tsx`) - Real-time execution status stream via WebSocket

### Utility Components

- **`ChainIcon`** (`chain-icon.tsx`) - Deterministic icon generator from chain ID
- **`ChainPreviewTooltip`** (`chain-preview-tooltip.tsx`) - Hover tooltip for chain preview
- **`ChainGraph`** (`chain-graph.tsx`) - Simple vertical chain visualization
- **`EventTimeline`** (`event-timeline.tsx`) - Timeline view of chain events

## Key Interfaces

### ChainAgent

```typescript
type ChainAgent = {
  id: string;
  name: string;
  role?: string;
  prompt?: string;
  triggers?: string[];      // Events that start this agent
  emits?: string;           // Event this agent produces
  timeout?: number;
  retry?: { max_retries?: number; backoff?: string };
  model?: string;
  tools?: string[];
  on_error?: string;        // Agent to run on error
  on_timeout?: string;      // Agent to run on timeout
};
```

### ChainBranch

Branch mappings define event routing:

```typescript
type ChainBranch = {
  [event: string]: string | string[] | {
    fan_out?: string[];     // Parallel execution targets
    fan_in?: string;        // Merge point after fan_out
    on_error?: string;      // Error handler for group
    conditions?: Array<{   // Conditional routing
      if: string;
      then: string;
    }>;
    default?: string;
  };
};
```

### VisualChainEditorProps

```typescript
interface VisualChainEditorProps {
  agents: ChainAgent[];
  branches?: ChainBranch;
  parallelBranches?: Record<string, ParallelBranch>;
  onAddAgent: () => void;
  onDeleteAgent: (id: string) => void;
  onEditAgent: (agent: ChainAgent) => void;
  onEditEdge?: (fromId: string, toId: string, event: string) => void;
  onDeleteEdge?: (fromId: string, toId: string, event: string) => void;
  readOnly?: boolean;
  debugMode?: boolean;
  breakpoints?: Set<string>;
  onToggleBreakpoint?: (agentId: string) => void;
}
```

## How It Works

### Agent Addition Flow

1. User clicks "Add Agent" → `AddAgentDialog` opens
2. Three modes:
   - **Browse**: Search/filter agent registry, pick existing
   - **Generate**: AI generates agent from description via `/api/agents/registry/generate`
   - **Blank**: Create empty agent
3. Selected agent converted via `registryToChainAgent()` and added to chain

### Visual Graph Layout

Both visual editors use BFS-based layout:

1. Find entry points (agents with `manual-start` trigger)
2. Build emit→agents map for routing
3. BFS traversal assigns levels to agents
4. Position nodes: horizontal spacing for same-level agents, vertical spacing between levels
5. Handle fan_out branches: insert fork/join nodes, route parallel agents through them

### Event Mapping

`AgentEventMapping` provides a form-based interface for:

- **Triggers**: Events that start an agent (e.g., `manual-start`, `analysis-done`)
- **Emits**: Event the agent produces (e.g., `code-complete`)
- **On Error**: Agent to run when this agent fails
- **On Timeout**: Agent to run when timeout occurs

Topology preview shows the flow graph with color-coded edges:
- Green: branch mappings
- Red: error routes
- Purple: timeout routes

### Import Process

1. User provides URL, pastes JSON/YAML, or uses clipboard
2. `ChainImportPreviewModal` parses and validates
3. Shows summary, agent list, errors, warnings
4. `ChainCustomizationModal` (optional) for variable substitution
5. API call to import with customizations

### Testing

`TestRunPanel` provides an in-page test runner:

1. Optional user prompt input
2. POST to `/api/chains/run` with chain and profile
3. Poll for output updates every 2s
4. Display live output in terminal view
5. Link to full run detail when complete

## Patterns

### Lazy Loading

Heavy ReactFlow editor is code-split:

```typescript
export const VisualChainEditorReactFlow = lazy(() =>
  import("./visual-editor-reactflow").then(m => ({ default: m.VisualChainEditor }))
);
```

### Deterministic Icons

`ChainIcon` uses djb2 hash for consistent colors/icons from same seed:

```typescript
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
```

### BFS Layout Algorithm

Used in both graph components:

```typescript
const levels: ChainAgent[][] = [];
const placed = new Set<string>();
const queue = entryAgents.map(a => ({ agent: a, level: 0 }));

while (queue.length > 0) {
  const { agent, level } = queue.shift();
  if (placed.has(agent.id)) continue;
  placed.add(agent.id);
  levels[level].push(agent);
  
  const nextAgents = emitMap.get(agent.emits) || [];
  nextAgents.forEach(next => {
    if (!placed.has(next.id)) {
      queue.push({ agent: next, level: level + 1 });
    }
  });
}
```

### Tooltip Composition

Tooltips use Radix UI primitives with custom content:

```typescript
<Tooltip delayDuration={100}>
  <TooltipTrigger asChild>
    <span>{children}</span>
  </TooltipTrigger>
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content side={side}>
      {/* custom content */}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
</Tooltip>
```

## Gotchas

### Fan-Out vs Array Branches

Two similar patterns for parallel execution:
- Array in branches: `{ "event": ["agent-a", "agent-b"] }`
- Object form: `{ "event": { fan_out: ["agent-a", "agent-b"], fan_in: "merge-agent" } }`

The object form is required for fan-in and group error handling.

### Agent ID Uniqueness

Marketplace agents may omit `id`. The editor ensures uniqueness:

```typescript
const agents = useMemo(() =>
  rawAgents.map((a, i) => 
    a.id ? a : { ...a, id: a.name?.toLowerCase().replace(/\s+/g, "-") || `agent-${i}` }
  ),
  [rawAgents]
);
```

### SVG Marker Definitions

Arrow markers must be defined per-color since `fill` is not inheritable:

```typescript
<marker id="arrow-error" ...>
  <polygon points="0 0, 10 3.5, 0 7" fill={colors.edgeError} />
</marker>
```

### Edge Click Detection

In SVG editors, edges are thin lines. An invisible wider path enables clicking:

```typescript
{/* invisible wider path for easier clicking */}
<path d={pathD} fill="none" stroke="transparent" strokeWidth="16" />
{/* visible path */}
<path d={pathD} fill="none" stroke={edgeColor} strokeWidth="2" />
```

## Dependencies

- **@xyflow/react**: ReactFlow library for graph visualization
- **@aliimam/icons**: Icon library (replaces lucide-react)
- **@radix-ui/react-tooltip**: Tooltip primitives
- Agent types from `@/lib/types`
- Namespace-aware fetch from `@/lib/use-namespace-fetch`
- API client utilities from `@/lib/api-client`
```