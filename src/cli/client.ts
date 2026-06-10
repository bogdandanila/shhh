import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { rpcCall } from '../core/rpc';

export const DATA_DIR = join(homedir(), 'Library', 'Application Support', 'shhh');
export const SOCKET_PATH = join(DATA_DIR, 'shhh.sock');
const APP_PATH = '/Applications/shhh.app';

export async function rpc(method: string, params?: unknown): Promise<unknown> {
  try {
    return await rpcCall(SOCKET_PATH, method, params);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      if (!existsSync(APP_PATH)) throw new Error('shhh.app is not installed. Run: shhh install');
      await new Promise<void>((res, rej) => execFile('open', ['-g', APP_PATH], (err) => (err ? rej(err) : res())));
      await new Promise((r) => setTimeout(r, 2500)); // app boot
      return rpcCall(SOCKET_PATH, method, params);
    }
    throw e;
  }
}

/** Hidden input — key never appears in argv or shell history. */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const { stdin } = process;
    stdin.resume(); stdin.setRawMode?.(true);
    let value = '';
    const onData = (ch: Buffer) => {
      const c = ch.toString('utf8');
      if (c === '\x03') process.exit(1);
      if (c === '\x7f') { value = value.slice(0, -1); return; }
      const term = c.search(/[\r\n]/);
      if (term >= 0) {
        value += c.slice(0, term);
        stdin.setRawMode?.(false); stdin.pause(); stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else { value += c; }
    };
    stdin.on('data', onData);
  });
}

export function copyToClipboard(text: string): void {
  const p = execFile('pbcopy');
  p.stdin?.write(text); p.stdin?.end();
}
