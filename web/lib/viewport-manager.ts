/**
 * Viewport Manager -- tracks active viewport sessions and provides
 * the bridge between API routes and active browser viewports.
 *
 * Each viewport session has:
 *   - a unique ID
 *   - current URL, title, loading state
 *   - navigation history (back/forward)
 *   - optional capture buffer (screenshots, DOM snapshots)
 *
 * Designed for expansion:
 *   - AI agent programmatic control (navigate, click, type, screenshot)
 *   - event recording (click stream capture for replay)
 *   - viewport sharing (agent + human see same page)
 *   - multi-tab support
 *   - mobile viewport emulation
 */

export interface ViewportSession {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  history: string[];
  historyIndex: number;
  createdAt: number;
  updatedAt: number;
  // capture state (for AI agent interaction)
  lastScreenshot?: string; // base64 png
  lastDom?: string; // serialized DOM text
  // viewport config
  width: number;
  height: number;
  userAgent?: string;
}

export interface ViewportEvent {
  type: "navigate" | "click" | "type" | "scroll" | "select" | "load" | "error";
  timestamp: number;
  sessionId: string;
  data: Record<string, unknown>;
}

class ViewportManager {
  private sessions = new Map<string, ViewportSession>();
  private events = new Map<string, ViewportEvent[]>();
  private counter = 0;

  /**
   * Create a new viewport session.
   */
  create(url: string, opts?: { width?: number; height?: number; userAgent?: string }): ViewportSession {
    const id = `vp_${Date.now()}_${++this.counter}`;
    const session: ViewportSession = {
      id,
      url,
      title: "",
      loading: true,
      history: [url],
      historyIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      width: opts?.width ?? 1280,
      height: opts?.height ?? 800,
      userAgent: opts?.userAgent,
    };
    this.sessions.set(id, session);
    this.events.set(id, []);
    return session;
  }

  /**
   * Get a viewport session by ID.
   */
  get(id: string): ViewportSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * List all active sessions.
   */
  list(): ViewportSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Update session state (called when iframe reports navigation/load).
   */
  update(id: string, updates: Partial<Pick<ViewportSession, "url" | "title" | "loading" | "lastScreenshot" | "lastDom">>): ViewportSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    if (updates.url && updates.url !== session.url) {
      // new navigation -- add to history
      session.history = session.history.slice(0, session.historyIndex + 1);
      session.history.push(updates.url);
      session.historyIndex = session.history.length - 1;
    }

    Object.assign(session, updates, { updatedAt: Date.now() });
    return session;
  }

  /**
   * Navigate to a URL.
   */
  navigate(id: string, url: string): ViewportSession | undefined {
    return this.update(id, { url, loading: true });
  }

  /**
   * Go back in history.
   */
  back(id: string): ViewportSession | undefined {
    const session = this.sessions.get(id);
    if (!session || session.historyIndex <= 0) return session;
    session.historyIndex--;
    session.url = session.history[session.historyIndex];
    session.loading = true;
    session.updatedAt = Date.now();
    return session;
  }

  /**
   * Go forward in history.
   */
  forward(id: string): ViewportSession | undefined {
    const session = this.sessions.get(id);
    if (!session || session.historyIndex >= session.history.length - 1) return session;
    session.historyIndex++;
    session.url = session.history[session.historyIndex];
    session.loading = true;
    session.updatedAt = Date.now();
    return session;
  }

  /**
   * Record an event (for replay / AI agent logging).
   */
  recordEvent(sessionId: string, event: Omit<ViewportEvent, "timestamp" | "sessionId">): void {
    const events = this.events.get(sessionId);
    if (!events) return;
    events.push({
      ...event,
      timestamp: Date.now(),
      sessionId,
    });
    // keep last 1000 events per session
    if (events.length > 1000) {
      events.splice(0, events.length - 1000);
    }
  }

  /**
   * Get recorded events for a session.
   */
  getEvents(sessionId: string): ViewportEvent[] {
    return this.events.get(sessionId) ?? [];
  }

  /**
   * Destroy a viewport session.
   */
  destroy(id: string): boolean {
    this.events.delete(id);
    return this.sessions.delete(id);
  }

  /**
   * Clean up stale sessions (older than maxAge ms, default 1 hour).
   */
  cleanup(maxAge = 3600000): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.updatedAt > maxAge) {
        this.destroy(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// singleton -- shared across API routes and SSR
export const viewportManager = new ViewportManager();
