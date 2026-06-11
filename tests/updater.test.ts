import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bundlePathFromExecPath, checkForUpdate, compareVersions, downloadFile,
  installUpdate, parseChecksums, parseLatestRelease,
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
  test('ignores prerelease/build suffixes', () => {
    expect(compareVersions('0.3.0-beta.1', '0.3.0')).toBe(0);
    expect(compareVersions('0.3.0+build.5', '0.3.0')).toBe(0);
    expect(compareVersions('v0.3.1-rc.1', '0.3.0')).toBeGreaterThan(0);
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
  test('dev Electron binary IS inside a bundle — dev mode is guarded by app.isPackaged, not here', () => {
    expect(bundlePathFromExecPath('/p/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'))
      .toBe('/p/node_modules/electron/dist/Electron.app');
  });
});

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
