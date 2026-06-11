import { execFile } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { verifyChecksum } from '../core/models';

/**
 * Electron-free update logic (testable; the dialog/relaunch glue lives in
 * update-flow.ts). Updates come from GitHub Releases: a universal-mac zip
 * plus a shasum-format checksums.txt. electron-updater can't be used — the
 * app is ad-hoc signed (identity: null), which Squirrel.Mac rejects.
 */

export const REPO = 'bogdandanila/shhh';

export interface ReleaseInfo {
  version: string;       // tag without the leading "v"
  zipName: string;
  zipUrl: string;
  checksumsUrl: string;
}

export type UpdateCheck = { kind: 'up-to-date'; latest: string } | ({ kind: 'update' } & ReleaseInfo);

/**
 * Numeric dotted-version compare; tolerates a leading "v" and unequal lengths.
 * Prerelease/build suffixes are ignored ("0.3.0-beta.1" == "0.3.0") — releases
 * come from /releases/latest, which excludes anything marked prerelease.
 * Returns <0, 0, >0.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (s: string) => s.replace(/^v/, '').split(/[-+]/)[0].split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface ApiAsset { name: string; browser_download_url: string }
interface ApiRelease { tag_name: string; assets: ApiAsset[] }

/** Extracts what the updater needs from a GitHub /releases/latest payload. */
export function parseLatestRelease(json: unknown): ReleaseInfo {
  const rel = json as ApiRelease | null;
  if (!rel || typeof rel.tag_name !== 'string' || !Array.isArray(rel.assets)) {
    throw new Error('Unexpected GitHub release response');
  }
  const zip = rel.assets.find((a) => a.name.endsWith('-universal-mac.zip'));
  const sums = rel.assets.find((a) => a.name === 'checksums.txt');
  if (!zip || !sums) throw new Error('Latest release is missing expected assets');
  return {
    version: rel.tag_name.replace(/^v/, ''),
    zipName: zip.name,
    zipUrl: zip.browser_download_url,
    checksumsUrl: sums.browser_download_url,
  };
}

/** Finds the sha256 for `filename` in `shasum -a 256` output ("<hex>  <name>"). */
export function parseChecksums(text: string, filename: string): string | null {
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (m && m[2] === filename) return m[1];
  }
  return null;
}

/** …/Foo.app/Contents/MacOS/foo -> …/Foo.app; null when not inside an .app bundle. */
export function bundlePathFromExecPath(execPath: string): string | null {
  const macos = dirname(execPath);
  const contents = dirname(macos);
  const bundle = dirname(contents);
  if (basename(macos) !== 'MacOS' || basename(contents) !== 'Contents' || !bundle.endsWith('.app')) return null;
  return bundle;
}

export type FetchLike = (url: string) => Promise<Response>;
export type ExecLike = (cmd: string, args: string[]) => Promise<void>;

const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Fetches the latest release and compares against the running version. Throws on network/API errors. */
export async function checkForUpdate(currentVersion: string, fetchFn: FetchLike = fetch): Promise<UpdateCheck> {
  const res = await fetchFn(LATEST_RELEASE_URL);
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  const info = parseLatestRelease(await res.json());
  if (compareVersions(info.version, currentVersion) <= 0) return { kind: 'up-to-date', latest: info.version };
  return { kind: 'update', ...info };
}

/** Streams a URL to disk (same pattern as core/models.downloadModel). */
export async function downloadFile(url: string, dest: string, fetchFn: FetchLike = fetch): Promise<void> {
  const res = await fetchFn(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

export function defaultExec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()));
  });
}

export interface InstallDeps {
  exec: ExecLike;
  verify?: (file: string, sha256: string) => boolean;  // defaults to core/models.verifyChecksum
  exists?: (path: string) => boolean;                  // defaults to fs.existsSync
}

/**
 * Verify → extract → swap, with rollback. The running app survives the swap
 * (open inodes); the caller relaunches afterwards. ditto preserves the
 * bundle's signature/xattrs and copies safely across volumes (tmp → /Applications).
 */
export async function installUpdate(
  opts: { zipPath: string; sha256: string; extractDir: string; appPath: string },
  deps: InstallDeps,
): Promise<void> {
  const verify = deps.verify ?? verifyChecksum;
  const exists = deps.exists ?? existsSync;
  if (!verify(opts.zipPath, opts.sha256)) throw new Error('Checksum mismatch — download corrupted');
  await deps.exec('ditto', ['-xk', opts.zipPath, opts.extractDir]);
  const newApp = join(opts.extractDir, 'shhh.app');
  if (!exists(newApp)) throw new Error('Update zip did not contain shhh.app');
  const backup = `${opts.appPath}.old`;
  await deps.exec('mv', [opts.appPath, backup]);
  try {
    await deps.exec('ditto', [newApp, opts.appPath]);
  } catch (e) {
    await deps.exec('rm', ['-rf', opts.appPath]);   // clear any partial copy
    await deps.exec('mv', [backup, opts.appPath]);  // rollback
    throw e;
  }
  await deps.exec('rm', ['-rf', backup]);
}
