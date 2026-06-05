// offline sync queue - SSR safe
// stores failed requests and retries on reconnect

interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timestamp: number;
  retries: number;
  maxRetries: number;
}

const SYNC_QUEUE_KEY = 'mentiko-sync-queue';
const MAX_QUEUE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 3;

class SyncQueue {
  private queue: QueuedRequest[] = [];
  private processing = false;
  private listeners: Set<(queue: QueuedRequest[]) => void> = new Set();
  private initialized = false;

  private init() {
    if (typeof window === 'undefined' || this.initialized) return;
    this.initialized = true;

    try {
      const stored = localStorage.getItem(SYNC_QUEUE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch {
      this.queue = [];
    }
  }

  private save() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(this.queue));
      this.notify();
    } catch {
      // quota exceeded
    }
  }

  private notify() {
    this.listeners.forEach(listener => listener([...this.queue]));
  }

  subscribe(listener: (queue: QueuedRequest[]) => void): () => void {
    this.init();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  add(request: Omit<QueuedRequest, 'id' | 'timestamp' | 'retries'>): string {
    this.init();
    if (typeof window === 'undefined') return '';

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const queued: QueuedRequest = {
      ...request,
      id,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: request.maxRetries || DEFAULT_MAX_RETRIES,
    };

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
    }

    this.queue.push(queued);
    this.save();
    return id;
  }

  remove(id: string): boolean {
    this.init();
    const index = this.queue.findIndex(r => r.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  get size(): number {
    this.init();
    return this.queue.length;
  }

  get all(): QueuedRequest[] {
    this.init();
    return [...this.queue];
  }

  clear() {
    this.queue = [];
    this.save();
  }

  async process(onSuccess?: (request: QueuedRequest, response: Response) => void): Promise<{
    processed: number;
    failed: number;
    remaining: number;
  }> {
    if (typeof window === 'undefined' || this.processing || this.queue.length === 0) {
      return { processed: 0, failed: 0, remaining: this.queue.length };
    }

    this.processing = true;

    let processed = 0;
    let failed = 0;

    for (let i = this.queue.length - 1; i >= 0; i--) {
      const request = this.queue[i];

      if (request.method === 'GET' || request.method === 'HEAD') {
        this.queue.splice(i, 1);
        continue;
      }

      if (request.retries >= request.maxRetries) {
        this.queue.splice(i, 1);
        failed++;
        continue;
      }

      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
        });

        if (response.ok) {
          this.queue.splice(i, 1);
          processed++;
          onSuccess?.(request, response);
        } else {
          request.retries++;
        }
      } catch {
        request.retries++;
      }
    }

    this.save();
    this.processing = false;

    return {
      processed,
      failed,
      remaining: this.queue.length,
    };
  }

  async retry(id: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    const request = this.queue.find(r => r.id === id);
    if (!request) return false;

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      if (response.ok) {
        this.remove(id);
        return true;
      }
      request.retries++;
      this.save();
      return false;
    } catch {
      request.retries++;
      this.save();
      return false;
    }
  }
}

export const syncQueue = new SyncQueue();

// react hook for sync queue
export function useSyncQueue() {
  const [queue, setQueue] = useState<QueuedRequest[]>(syncQueue.all);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    return syncQueue.subscribe(setQueue);
  }, []);

  const process = async () => {
    setProcessing(true);
    const result = await syncQueue.process();
    setProcessing(false);
    return result;
  };

  const retry = async (id: string) => {
    return syncQueue.retry(id);
  };

  const clear = () => {
    syncQueue.clear();
    setQueue([]);
  };

  return {
    queue,
    size: queue.length,
    processing,
    process,
    retry,
    clear,
  };
}

import { useState, useEffect } from 'react';
