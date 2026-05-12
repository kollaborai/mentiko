/**
 * Plugin system types for Mentiko.
 *
 * Plugins extend chain execution with custom logic:
 *   - onEvent(event) - called when a chain/agent event is emitted
 *   - configure(config) - called to configure the plugin
 *
 * Built-in plugins: email, slack, github (see lib/plugins/)
 * Custom plugins: dropped into namespaces/{ns}/plugins/{id}/
 */

// Legacy hyphen format (plugin manifests, backward compat)
export type PluginEventTypeLegacy =
  | "chain-started"
  | "chain-completed"
  | "chain-stopped"
  | "agent-started"
  | "agent-completed"
  | "approval-requested"
  | "approval-approved"
  | "approval-rejected"
  | "webhook-received";

// Dot notation (platform event registry, preferred going forward)
export type PluginEventTypeDot =
  | "chain.started"
  | "chain.completed"
  | "chain.stopped"
  | "chain.failed"
  | "agent.started"
  | "agent.completed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "webhook.received";

export type PluginEventType = PluginEventTypeLegacy | PluginEventTypeDot | "*";

export interface PluginEvent {
  type: PluginEventType;
  chainId?: string;
  runId?: string;
  agentId?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: "string" | "secret" | "boolean" | "select";
  required?: boolean;
  options?: string[]; // for select type
  default?: string | boolean;
  description?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category:
    | "notification"    // slack, email, pagerduty — fire-and-forget outbound push
    | "task-provider"   // linear, notion, jira — bidirectional task sync
    | "ci-cd"           // github-pr, gitlab — create/update pipeline artifacts
    | "outbound-webhook"// send event payload to any HTTP endpoint
    | "integration"     // legacy / catch-all (avoid for new plugins)
    | "analytics"       // usage metrics, reporting
    | "custom";         // user-defined scripts
  events: PluginEventType[]; // which events this plugin handles
  configSchema: PluginConfigField[];
  /** path to the onEvent bash script, relative to plugin dir */
  onEventScript?: string;
  /** path to the configure bash script, relative to plugin dir */
  configureScript?: string;
  builtin?: boolean;
}

export interface PluginRegistration {
  id: string;
  manifest: PluginManifest;
  /** per-namespace config values */
  config: Record<string, string | boolean>;
  enabled: boolean;
  enabledAt?: string;
  disabledAt?: string;
  /** where the plugin lives on disk */
  pluginDir: string;
}

export interface PluginState {
  namespaceId: string;
  plugins: PluginRegistration[];
  updatedAt: string;
}
