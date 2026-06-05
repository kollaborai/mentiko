// pm-client.ts -- IPC client for the mentiko process manager
// used by platform Next.js code to manage processes at runtime

import { Socket, createConnection } from 'net';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import type {
  IPCRequest,
  IPCResponse,
  ProcessInfo,
  StartData,
} from '../pm-types';

const SOCKET_PATH = join(homedir(), '.mentiko-pm', 'pm.sock');
const TIMEOUT_MS = 5000;

type PendingRequest = {
  resolve: (data: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class PMClient {
  private sock: Socket | null = null;
  private pending = new Map<string, PendingRequest>();
  private buf = '';

  async connect(): Promise<void> {
    if (this.sock && !this.sock.destroyed) return;
    return new Promise((resolve, reject) => {
      const sock = createConnection(SOCKET_PATH, () => {
        this.sock = sock;
        resolve();
      });
      sock.setEncoding('utf8');
      sock.on('data', (chunk: string) => this.onData(chunk));
      sock.on('close', () => this.onClose());
      sock.on('error', (err) => {
        if (!this.sock) reject(err);
      });
    });
  }

  disconnect(): void {
    if (this.sock) {
      this.sock.destroy();
      this.sock = null;
    }
    this.pending.forEach((req, id) => {
      clearTimeout(req.timer);
      req.reject(new Error('disconnected'));
      this.pending.delete(id);
    });
    this.buf = '';
  }

  async status(): Promise<{ processes: ProcessInfo[]; uptime: number; version: number }> {
    const data = await this.send({ cmd: 'status' });
    return data as { processes: ProcessInfo[]; uptime: number; version: number };
  }

  async list(): Promise<{ processes: Pick<ProcessInfo, 'name' | 'status' | 'pid' | 'uptime' | 'restarts'>[] }> {
    const data = await this.send({ cmd: 'list' });
    return data as { processes: Pick<ProcessInfo, 'name' | 'status' | 'pid' | 'uptime' | 'restarts'>[] };
  }

  async start(config: StartData): Promise<{ name: string; pid: number; status: 'starting' }> {
    const data = await this.send({ cmd: 'start', data: config });
    return data as { name: string; pid: number; status: 'starting' };
  }

  async stop(name: string): Promise<{ name: string; status: 'stopped' }> {
    const data = await this.send({ cmd: 'stop', data: { name } });
    return data as { name: string; status: 'stopped' };
  }

  async remove(name: string): Promise<{ name: string; removed: true }> {
    const data = await this.send({ cmd: 'remove', data: { name } });
    return data as { name: string; removed: true };
  }

  async restart(name: string): Promise<{ name: string; pid: number; status: 'starting' }> {
    const data = await this.send({ cmd: 'restart', data: { name } });
    return data as { name: string; pid: number; status: 'starting' };
  }

  // -- internals --

  private async send(msg: Omit<IPCRequest, 'id'>): Promise<Record<string, unknown>> {
    if (!this.sock || this.sock.destroyed) await this.connect();
    const id = randomUUID();
    const req: IPCRequest = { id, ...msg } as IPCRequest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${msg.cmd}`));
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.sock!.write(JSON.stringify(req) + '\n');
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let resp: IPCResponse;
      try {
        resp = JSON.parse(line);
      } catch {
        continue;
      }
      const req = this.pending.get(resp.id);
      if (!req) continue;
      clearTimeout(req.timer);
      this.pending.delete(resp.id);
      if (resp.ok === true) {
        req.resolve(resp.data);
      } else {
        const errResp = resp as { id: string; ok: false; error: string };
        req.reject(new Error(errResp.error));
      }
    }
  }

  private onClose(): void {
    this.sock = null;
    this.pending.forEach((req, id) => {
      clearTimeout(req.timer);
      req.reject(new Error('connection closed'));
      this.pending.delete(id);
    });
    this.buf = '';
  }
}
