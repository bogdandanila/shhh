import { createConnection, createServer, Server, Socket } from 'node:net';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { RpcRequest, RpcResponse } from '../shared/types';

export type Handlers = Record<string, (params: unknown) => Promise<unknown>>;

/** Newline-delimited JSON over a unix domain socket, mode 600. */
export class RpcServer {
  private server: Server | null = null;
  constructor(private socketPath: string, private handlers: Handlers) {}

  listen(): Promise<void> {
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath); // stale socket from a crash
    this.server = createServer((sock) => this.serve(sock));
    return new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socketPath, () => {
        chmodSync(this.socketPath, 0o600);
        resolve();
      });
    });
  }

  private serve(sock: Socket): void {
    let buf = '';
    sock.on('data', async (chunk) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let res: RpcResponse;
        try {
          const req = JSON.parse(line) as RpcRequest;
          const fn = this.handlers[req.method];
          if (!fn) res = { id: req.id, error: `Unknown method: ${req.method}` };
          else {
            try { res = { id: req.id, result: await fn(req.params) }; }
            catch (e) { res = { id: req.id, error: e instanceof Error ? e.message : String(e) }; }
          }
        } catch { res = { id: -1, error: 'Malformed request' }; }
        sock.write(JSON.stringify(res) + '\n');
      }
    });
    sock.on('error', () => sock.destroy());
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
        resolve();
      });
    });
  }
}

let nextId = 1;
export function rpcCall(socketPath: string, method: string, params?: unknown, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const sock = createConnection(socketPath);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('RPC timeout')); }, timeoutMs);
    let buf = '';
    let settled = false;
    sock.on('connect', () => sock.write(JSON.stringify({ id, method, params } satisfies RpcRequest) + '\n'));
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      settled = true;
      sock.end();
      try {
        const res = JSON.parse(buf.slice(0, nl)) as RpcResponse;
        if (res.error) reject(new Error(res.error)); else resolve(res.result);
      } catch (e) { reject(e); }
    });
    sock.on('close', () => {
      if (!settled) { clearTimeout(timer); reject(new Error('Connection closed before response')); }
    });
    sock.on('error', () => { if (settled) return; /* let close event reject */ });
  });
}
