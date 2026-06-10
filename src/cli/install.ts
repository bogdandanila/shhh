import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = 'bogdandanila/shhh'; // adjust when the real GitHub repo exists
const APP_DEST = '/Applications/shhh.app';

interface ReleaseAsset { name: string; browser_download_url: string }

/** Parse the expected SHA-256 hash for `assetName` from a shasum -a 256 output. */
export function parseChecksum(sumText: string, assetName: string): string | undefined {
  return sumText.split('\n').find((l) => l.includes(assetName))?.split(/\s+/)[0];
}

/** Return true iff the SHA-256 of `buf` equals `expected` (hex). */
export function verifyBuffer(buf: Buffer, expected: string): boolean {
  return createHash('sha256').update(buf).digest('hex') === expected;
}

export async function installApp(print: (s: string) => void): Promise<void> {
  print('Fetching latest release…');
  const rel = (await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)).json()) as
    { tag_name: string; assets: ReleaseAsset[] };
  const zip = rel.assets.find((a) => a.name.endsWith('.zip'));
  const sums = rel.assets.find((a) => a.name === 'checksums.txt');
  if (!zip || !sums) throw new Error('Release is missing app zip or checksums.txt');

  const tmp = join(tmpdir(), `shhh-${rel.tag_name}.zip`);
  print(`Downloading ${zip.name}…`);
  writeFileSync(tmp, Buffer.from(await (await fetch(zip.browser_download_url)).arrayBuffer()));

  const sumText = await (await fetch(sums.browser_download_url)).text();
  const expected = parseChecksum(sumText, zip.name);
  const buf = readFileSync(tmp);
  if (!expected || !verifyBuffer(buf, expected)) {
    throw new Error(`Checksum mismatch (expected ${expected}, got ${createHash('sha256').update(buf).digest('hex')})`);
  }
  print('Checksum verified ✅');

  // Downloaded via Node -> no quarantine attribute -> Gatekeeper never engages.
  if (existsSync(APP_DEST)) rmSync(APP_DEST, { recursive: true });
  mkdirSync('/Applications', { recursive: true });
  execFileSync('ditto', ['-xk', tmp, '/Applications']);
  rmSync(tmp);
  print(`Installed ${rel.tag_name} to ${APP_DEST}`);
  print('Note: updating resets Input Monitoring/Accessibility permissions (unsigned build) — run `shhh setup` after updates.');
}
