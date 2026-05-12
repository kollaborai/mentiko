export type WebhookSource = 'github' | 'gitlab' | 'bitbucket' | 'custom' | 'slack' | 'discord';

export type WebhookEventType =
  | 'push'
  | 'pull_request'
  | 'pull_request_review'
  | 'issues'
  | 'issue_comment'
  | 'deployment'
  | 'deployment_status'
  | 'release'
  | 'star'
  | 'fork'
  | 'ping'
  | 'custom';

export interface WebhookPayload {
  [key: string]: unknown;
}

export interface WebhookEvent {
  id: string;
  source: WebhookSource;
  type: WebhookEventType;
  payload: WebhookPayload;
  timestamp: string;
  processed?: boolean;
  chainId?: string;
}

export interface WebhookEventFilter {
  sources?: WebhookSource[];
  types?: WebhookEventType[];
  branches?: string[];
  labels?: string[];
  states?: ('open' | 'closed' | 'merged' | 'draft')[];
}

export interface WebhookSubscription {
  id: string;
  chainId: string;
  eventFilter: WebhookEventFilter;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  secret?: string;
  endpointUrl?: string;
  /** Computed at API time: the URL to configure in GitHub/external service */
  receiveUrl?: string;
}
