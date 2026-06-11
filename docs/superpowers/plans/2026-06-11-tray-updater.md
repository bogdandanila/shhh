# Tray "Check for Updates" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Check for Updates…" tray menu item that checks the latest GitHub release and, when newer, downloads the zip, verifies its checksum, swaps the installed `.app` bundle, and relaunches.

**Architecture:** All logic lives in a new electron-free `src/main/updater.ts` (unit-tested with injected fetch/exec, same pattern as `paster.ts`/`audio-ducker.ts`). A thin `src/main/update-flow.ts` holds the Electron glue (dialogs, `app.relaunch`) and is exercised via the manual smoke checklist. The tray gains one callback. `electron-updater` is ruled out: the app is ad-hoc signed (`identity: null`), which Squirrel.Mac rejects.

**Tech Stack:** TypeScript, Electron main process, GitHub Releases REST API, global `fetch` (Node 22), `ditto`/`mv` via `execFile`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-tray-updater-design.md`

---

### Task 1: Pure updater helpers (parse + compare)

**Files:**
- Create: `src/main/updater.ts`
- Test: `tests/updater.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/updater.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import {
  bundlePathFromExecPath, compareVersions, parseChecksums, parseLatestRelease,
} from '../src/main/updater';

export const RELEASE_JSON = {
  tag_name: 'v0.3.0',
  assets: [
    { name: 'checksums.txt', browser_download_url: 'https://example.com/checksums.txt' },
    { name: 'shhh-0.3.0-universal-mac.zip', browser_download_url: 'https://example.com/shhh-0.3.0-universal-mac.zip' },
  ],
};

describe('compareVersions', () => {
  test('orders versions numerically', () => {
    expect(compareVersions('0.3.0', '0.2.2')).toBeGreaterThan(0);
    expect(compareVersions('0.2.2', '0.3.0')).toBeLessThan(0);
    expect(compareVersions('0.2.2', '0.2.2')).toBe(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0); // numeric, not lexicographic
  });
  test('tolerates v prefix and unequal lengths', () => {
    expect(compareVersions('v1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
  });
  test('malformed segments compare as 0', () => {
    expect(compareVersions('abc', '0.0.0')).toBe(0);
  });
});

describe('parseLatestRelease', () => {
  test('extracts version and asset urls', () => {
    expect(parseLatestRelease(RELEASE_JSON)).toEqual({
      version: '0.3.0',
      zipName: 'shhh-0.3.0-universal-mac.zip',
      zipUrl: 'https://example.com/shhh-0.3.0-universal-mac.zip',
      checksumsUrl: 'https://example.com/checksums.txt',
    });
  });
  test('throws when the zip asset is missing', () => {
    expect(() => parseLatestRelease({ tag_name: 'v0.3.0', assets: [{ name: 'checksums.txt', browser_download_url: 'x' }] }))
      .toThrow(/missing expected assets/);
  });
  test('throws when checksums.txt is missing', () => {
    expect(() => parseLatestRelease({ tag_name: 'v0.3.0', assets: [{ name: 'shhh-0.3.0-universal-mac.zip', browser_download_url: 'x' }] }))
      .toThrow(/missing expected assets/);
  });
  test('throws on garbage payloads', () => {
    expect(() => parseLatestRelease(null)).toThrow(/Unexpected GitHub release response/);
  });
});

describe('parseChecksums', () => {
  const SUMS = 'deadbeefcaecafe287937835fad7508857c0016e8d10f0119bf421660f304592  other-file.dmg\n'
    + 'abba6923caecafe287937835fad7508857c0016e8d10f0119bf421660f304592  shhh-0.2.2-universal-mac.zip\n';
  test('finds the hash for a filename', () => {
    expect(parseChecksums(SUMS, 'shhh-0.2.2-universal-mac.zip'))
      .toBe('abba6923caecafe287937835fad7508857c0016e8d10f0119bf421660f304592');
  });
  test('returns null for unknown filename', () => {
    expect(parseChecksums(SUMS, 'other.zip')).toBeNull();
  });
});

describe('bundlePathFromExecPath', () => {
  test('derives the .app root from a packaged exec path', () => {
    expect(bundlePathFromExecPath('/Applications/shhh.app/Contents/MacOS/shhh')).toBe('/Applications/shhh.app');
  });
  test('returns null for a bare executable path', () => {
    expect(bundlePathFromExecPath('/usr/local/bin/node')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/updater.test.ts`
Expected: FAIL — `Cannot find module '../src/main/updater'`

- [ ] **Step 3: Implement the helpers**

Create `src/main/updater.ts`:

```typescript
import { basename, dirname } from 'node:path';

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

/** Numeric dotted-version compare; tolerates a leading "v" and unequal lengths. Returns <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const parse = (s: string) => s.replace(/^v/, '').split('.').map((p) => Number.parseInt(p, 10) || 0);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/updater.test.ts`
Expected: 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/updater.ts tests/updater.test.ts
git commit -m "feat: updater helpers — release parsing, version compare, bundle path"
```

---

### Task 2: Network + install with rollback

**Files:**
- Modify: `src/main/updater.ts` (append; new imports at top)
- Test: `tests/updater.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/updater.test.ts` (add `vi` to the vitest import; add fs/os/path imports):

```typescript
import { vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdate, downloadFile, installUpdate } from '../src/main/updater';

describe('checkForUpdate', () => {
  const fetchOk = vi.fn(async () => new Response(JSON.stringify(RELEASE_JSON), { status: 200 }));
  test('reports update when latest is newer', async () => {
    const result = await checkForUpdate('0.2.2', fetchOk);
    expect(result).toMatchObject({ kind: 'update', version: '0.3.0' });
  });
  test('reports up-to-date when current matches or exceeds latest', async () => {
    expect(await checkForUpdate('0.3.0', fetchOk)).toEqual({ kind: 'up-to-date', latest: '0.3.0' });
    expect(await checkForUpdate('0.4.0', fetchOk)).toEqual({ kind: 'up-to-date', latest: '0.3.0' });
  });
  test('throws on HTTP errors', async () => {
    const fetch403 = vi.fn(async () => new Response('rate limited', { status: 403 }));
    await expect(checkForUpdate('0.2.2', fetch403)).rejects.toThrow(/403/);
  });
});

describe('downloadFile', () => {
  test('streams the response body to disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shhh-updater-test-'));
    const dest = join(dir, 'out.bin');
    const fetchFn = vi.fn(async () => new Response('payload', { status: 200 }));
    await downloadFile('https://example.com/x', dest, fetchFn);
    expect(readFileSync(dest, 'utf8')).toBe('payload');
  });
  test('throws on HTTP error without writing', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(downloadFile('https://example.com/x', '/tmp/shhh-never-written', fetchFn)).rejects.toThrow(/404/);
  });
});

describe('installUpdate', () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'shhh-updater-test-'));
    const zipPath = join(dir, 'update.zip');
    writeFileSync(zipPath, 'zip-bytes');
    const calls: string[][] = [];
    const exec = async (cmd: string, args: string[]) => { calls.push([cmd, ...args]); };
    return { dir, zipPath, calls, exec };
  }
  const okVerify = () => true;

  test('happy path: verify, extract, swap, cleanup — in that order', async () => {
    const { dir, zipPath, calls, exec } = setup();
    await installUpdate(
      { zipPath, sha256: 'x', extractDir: join(dir, 'ex'), appPath: '/Applications/shhh.app' },
      { exec, verify: okVerify, exists: () => true },
    );
    expect(calls).toEqual([
      ['ditto', '-xk', zipPath, join(dir, 'ex')],
      ['mv', '/Applications/shhh.app', '/Applications/shhh.app.old'],
      ['ditto', join(dir, 'ex', 'shhh.app'), '/Applications/shhh.app'],
      ['rm', '-rf', '/Applications/shhh.app.old'],
    ]);
  });

  test('checksum mismatch aborts before any exec', async () => {
    const { dir, zipPath, calls, exec } = setup();
    await expect(installUpdate(
      { zipPath, sha256: 'x', extractDir: join(dir, 'ex'), appPath: '/Applications/shhh.app' },
      { exec, verify: () => false, exists: () => true },
    )).rejects.toThrow(/Checksum mismatch/);
    expect(calls).toEqual([]);
  });

  test('missing shhh.app in the zip aborts before the swap', async () => {
    const { dir, zipPath, calls, exec } = setup();
    await expect(installUpdate(
      { zipPath, sha256: 'x', extractDir: join(dir, 'ex'), appPath: '/Applications/shhh.app' },
      { exec, verify: okVerify, exists: () => false },
    )).rejects.toThrow(/did not contain shhh.app/);
    expect(calls).toEqual([['ditto', '-xk', zipPath, join(dir, 'ex')]]);
  });

  test('failed copy rolls the previous bundle back', async () => {
    const { dir, zipPath, calls } = setup();
    const exec = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (cmd === 'ditto' && args[0] !== '-xk') throw new Error('disk full'); // the copy-into-place call
    };
    await expect(installUpdate(
      { zipPath, sha256: 'x', extractDir: join(dir, 'ex'), appPath: '/Applications/shhh.app' },
      { exec, verify: okVerify, exists: () => true },
    )).rejects.toThrow('disk full');
    expect(calls).toEqual([
      ['ditto', '-xk', zipPath, join(dir, 'ex')],
      ['mv', '/Applications/shhh.app', '/Applications/shhh.app.old'],
      ['ditto', join(dir, 'ex', 'shhh.app'), '/Applications/shhh.app'],
      ['rm', '-rf', '/Applications/shhh.app'],
      ['mv', '/Applications/shhh.app.old', '/Applications/shhh.app'],
    ]);
  });
});
```

Note for the implementer: keep `RELEASE_JSON` exported from Task 1's section so these tests reuse it; merge the import lines with the existing ones at the top of the file (single vitest import with `describe, expect, test, vi`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/updater.test.ts`
Expected: FAIL — `checkForUpdate` / `downloadFile` / `installUpdate` not exported

- [ ] **Step 3: Implement**

Update the import block at the top of `src/main/updater.ts` — the `node:path` line REPLACES Task 1's (it gains `join`); the rest are new:

```typescript
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { verifyChecksum } from '../core/models';
```

Append to `src/main/updater.ts`:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/updater.test.ts`
Expected: 20 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/updater.ts tests/updater.test.ts
git commit -m "feat: update check, download, and bundle swap with rollback"
```

---

### Task 3: Electron glue, tray item, wiring

**Files:**
- Create: `src/main/update-flow.ts`
- Modify: `src/main/tray.ts`
- Modify: `src/main/index.ts` (tray wiring, ~line 47)
- Modify: `docs/manual-smoke-checklist.md`

No unit tests (Electron imports, like `session-controller.ts`); covered by the smoke checklist.

- [ ] **Step 1: Create `src/main/update-flow.ts`**

```typescript
import { app, dialog } from 'electron';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bundlePathFromExecPath, checkForUpdate, defaultExec, downloadFile,
  installUpdate, parseChecksums,
} from './updater';

let running = false; // one update flow at a time; extra tray clicks are ignored

/** Tray-triggered: check → confirm → download → verify → swap → relaunch. */
export async function runUpdateFlow(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const current = app.getVersion();
    const check = await checkForUpdate(current);
    if (check.kind === 'up-to-date') {
      await dialog.showMessageBox({ type: 'info', message: `shhh ${current} is the latest version.` });
      return;
    }
    const appPath = app.isPackaged ? bundlePathFromExecPath(process.execPath) : null;
    if (!appPath) {
      await dialog.showMessageBox({
        type: 'info',
        message: `shhh ${check.version} is available`,
        detail: 'Updating from inside the app requires the installed build. Grab the new version from the GitHub releases page.',
      });
      return;
    }
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: ['Install and Relaunch', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `shhh ${check.version} is available (you have ${current}).`,
      detail: 'shhh will download the update, install it, and relaunch. macOS may ask you to re-grant Accessibility afterwards.',
    });
    if (response !== 0) return;
    const work = mkdtempSync(join(tmpdir(), 'shhh-update-'));
    const zipPath = join(work, check.zipName);
    await downloadFile(check.zipUrl, zipPath);
    const sumsRes = await fetch(check.checksumsUrl);
    if (!sumsRes.ok) throw new Error(`Checksums download failed (${sumsRes.status})`);
    const sha256 = parseChecksums(await sumsRes.text(), check.zipName);
    if (!sha256) throw new Error('checksums.txt has no entry for the update zip');
    await installUpdate({ zipPath, sha256, extractDir: join(work, 'extract'), appPath }, { exec: defaultExec });
    app.relaunch();
    app.exit(0);
  } catch (e) {
    await dialog.showMessageBox({
      type: 'error', message: 'Update failed',
      detail: e instanceof Error ? e.message : String(e),
    });
  } finally {
    running = false;
  }
}
```

- [ ] **Step 2: Add the tray item**

In `src/main/tray.ts`, change the options type and menu template:

```typescript
export function createTray(opts: { onHistory: () => void; onSetup: () => void; onCheckUpdates: () => void }): Tray {
  const tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🤫');
  tray.setToolTip('shhh — hold right ⌘ to dictate');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'History', click: opts.onHistory },
    { label: 'Settings…', click: opts.onSetup },
    { label: 'Check for Updates…', click: opts.onCheckUpdates },
    { type: 'separator' },
    { label: 'Quit shhh', click: () => app.quit() },
  ]));
  return tray;
}
```

(Only the `onCheckUpdates` field and the one menu line are new; docstring and the rest stay.)

- [ ] **Step 3: Wire it in `src/main/index.ts`**

In the `createTray` call (~line 47), add the callback after `onSetup`, mirroring the lazy-import pattern:

```typescript
    tray = createTray({
      onHistory: () => history.toggle(),
      onSetup: () => void import('./setup-window').then((m) => m.openSetupWindow({ store, apiKeys, dataDir: dir })),
      onCheckUpdates: () => void import('./update-flow').then((m) => m.runUpdateFlow()),
    });
```

- [ ] **Step 4: Build and run the full test suite**

Run: `npm run build && npm test`
Expected: build green (tsc x2, asset copy, dist check); all suites pass (~123 tests, 1 skipped).

- [ ] **Step 5: Add manual smoke checklist entries**

In `docs/manual-smoke-checklist.md`, append a section (same checkbox style as the Audio ducking section):

```markdown
## Check for Updates

- [ ] On the latest released version: tray → Check for Updates… — "is the latest version" dialog.
- [ ] Dev build (`npm start`) with a newer release published: dialog says updating requires the installed build; nothing is modified.
- [ ] Installed build with a newer release published: Install and Relaunch downloads, swaps `/Applications/shhh.app`, relaunches on the new version (Setup may reopen for the Accessibility re-grant — expected with ad-hoc signing).
- [ ] Double-click Check for Updates… rapidly — only one dialog appears (reentrancy guard).
```

- [ ] **Step 6: Commit**

```bash
git add src/main/update-flow.ts src/main/tray.ts src/main/index.ts docs/manual-smoke-checklist.md
git commit -m "feat: Check for Updates tray item — GitHub release install + relaunch"
```

---

## Verification

`npm run build && npm test` green. Smoke: the "up to date" path works immediately (current version == latest release); the full install path needs a newer published release — note left in the checklist. Reminder: vitest needs the node ABI (`npm run rebuild:node`), running the app needs the Electron ABI (`npm run rebuild:electron`).
