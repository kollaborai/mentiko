// hooks
export { useWebSocket } from "./use-websocket";
export { useBreakpoints } from "./use-breakpoints";
export { useOnlineStatus } from "./use-online-status";
export { useGlobalSearch } from "./use-global-search";

// hook-specific types (extensions of base types)
export type { StreamEvent, StreamEventType, UseWebSocketReturn, WebSocketOptions, ConnectionState } from "./use-websocket";
export type { Breakpoint, BreakpointState as BPState, UseBreakpointsReturn } from "./use-breakpoints";
