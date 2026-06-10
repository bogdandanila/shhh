import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function dataDir(): string {
  const dir = app.getPath('userData'); // ~/Library/Application Support/shhh
  mkdirSync(dir, { recursive: true });
  return dir;
}
export const rendererDir = () => join(__dirname, '..', 'renderer');
export const socketPath = () => join(dataDir(), 'shhh.sock');
