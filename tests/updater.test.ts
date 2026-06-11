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
