import { expect, test } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { RpcServer, rpcCall } from '../src/core/rpc';

test('request/response over unix socket, mode 600, unknown method errors', async () => {
  const sock = join(mkdtempSync(join(tmpdir(), 'shhh-')), 'shhh.sock');
  const server = new RpcServer(sock, {
    echo: async (params) => ({ got: params }),
    boom: async () => { throw new Error('kaboom'); },
  });
  await server.listen();
  expect(statSync(sock).mode & 0o777).toBe(0o600);

  expect(await rpcCall(sock, 'echo', { a: 1 })).toEqual({ got: { a: 1 } });
  await expect(rpcCall(sock, 'boom')).rejects.toThrow('kaboom');
  await expect(rpcCall(sock, 'nope')).rejects.toThrow(/unknown method/i);
  await server.close();
});

test('rpcCall rejects promptly when server destroys connection before response', async () => {
  const sockPath = join(mkdtempSync(join(tmpdir(), 'shhh-')), 'shhh.sock');
  const rawServer = createServer((sock) => { sock.destroy(); });
  await new Promise<void>((resolve) => rawServer.listen(sockPath, resolve));
  try {
    await expect(rpcCall(sockPath, 'x')).rejects.toThrow(/closed before response/i);
  } finally {
    await new Promise<void>((resolve) => rawServer.close(() => resolve()));
  }
}, 2_000);

test('stale socket file is replaced on listen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shhh-'));
  const sock = join(dir, 'shhh.sock');
  const s1 = new RpcServer(sock, { ping: async () => 'pong' });
  await s1.listen();
  await s1.close();
  const s2 = new RpcServer(sock, { ping: async () => 'pong' });
  await s2.listen(); // must not throw EADDRINUSE
  expect(await rpcCall(sock, 'ping')).toBe('pong');
  await s2.close();
});
