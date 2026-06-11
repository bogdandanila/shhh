# Tray "Check for Updates" — Design

**Date:** 2026-06-11
**Status:** Approved

## Problem

Updating shhh today is manual: download the release zip, replace the app
bundle, relaunch. There is no in-app way to discover that a newer version
exists or to install it.

## Goal

A "Check for Updates…" item in the tray menu that, on click, checks the
latest GitHub release and — if newer — downloads it, verifies it, swaps the
installed app bundle, and relaunches.

## Non-Goals

- `electron-updater` / Squirrel.Mac — requires a Developer-ID-signed app;
  shhh is ad-hoc signed (`identity: null` in `electron-builder.yml`).
- Background/automatic update checks. The check runs only on explicit click
  (fits the privacy-first positioning; no periodic phoning home).
- Delta updates, release channels, downgrade protection beyond "not newer →
  up to date".
- Fixing the TCC re-grant (see Consequences).

## Update source

GitHub Releases on `bogdandanila/shhh`:

- `GET https://api.github.com/repos/bogdandanila/shhh/releases/latest` —
  excludes drafts/prereleases. Unauthenticated rate limit (60/hr/IP) is
  ample for manual clicks.
- Each release carries `shhh-<version>-universal-mac.zip` (one universal
  binary — no arch selection) and `checksums.txt` in `shasum -a 256` format:
  `<64-hex>␣␣<filename>`.

## Components

### `src/main/updater.ts` — pure logic, NO electron imports (unit-tested)

Electron-free so vitest can test it (same reason `paster.ts` injects its
keystroke function). All I/O is injected.

- `compareVersions(a, b)`: numeric semver compare of dotted tags, tolerant
  of a leading `v` and unequal segment counts. Malformed segments compare
  as 0.
- `parseLatestRelease(json)`: extracts `{version, zipName, zipUrl,
  checksumsUrl}` from the API response — the asset whose name ends with
  `-universal-mac.zip` plus the `checksums.txt` asset. Returns an error
  result when assets are missing.
- `parseChecksums(text, filename)`: returns the sha256 hex for `filename`
  from shasum-format text, or null.
- `checkForUpdate(currentVersion, fetchFn)`: fetches + parses the latest
  release; returns `{kind: 'up-to-date'}` or `{kind: 'update', …release info}`.
  Network/HTTP errors throw (caller shows the error dialog).
- `downloadFile(url, dest, fetchFn)`: streams to disk (same
  `Readable.fromWeb` + `pipeline` pattern as `core/models.ts`).
- `installUpdate(zipPath, appPath, deps)`: verify + extract + swap with
  rollback (see Install mechanics). `deps` injects `exec` and the checksum
  verifier (reuses `verifyChecksum` from `core/models.ts`).
- `bundlePathFromExecPath(execPath)`: derives `/Applications/shhh.app` from
  `…/shhh.app/Contents/MacOS/shhh`; null when the executable isn't inside
  an `.app` bundle.

### `src/main/update-flow.ts` — electron glue (smoke-tested, not unit-tested)

`runUpdateFlow()` orchestrates: dev-mode guard (`!app.isPackaged` → info
dialog "updates require the installed app") → `checkForUpdate` → dialogs
(`dialog.showMessageBox`, works without windows in this LSUIElement app):

- Up to date → "shhh X.Y.Z is the latest version."
- Update found → "shhh A.B.C is available (you have X.Y.Z). Install and
  relaunch?" [Install / Cancel]
- Install → download zip + checksums to a fresh `mkdtemp` dir → verify →
  `installUpdate` → `app.relaunch(); app.exit(0)`.
- Any thrown error → error dialog with the message. Reentrancy-guarded
  (a second click while a check/install runs is ignored).

### Tray + wiring

- `tray.ts`: new `onCheckUpdates` callback; menu item "Check for Updates…"
  between "Settings…" and the separator before Quit.
- `index.ts`: passes `onCheckUpdates: () => void runUpdateFlow()` (lazy
  import, matching the `setup-window` pattern).

## Install mechanics

1. `ditto -xk <zip> <extractDir>` — Apple's tool; preserves signatures,
   resource forks, xattrs.
2. Verify `<extractDir>/shhh.app` exists.
3. `mv <appPath> <appPath>.old` — same-directory rename, atomic; the
   running process survives (open inodes).
4. `ditto <extractDir>/shhh.app <appPath>` — copy (cross-volume safe:
   extract dir lives in tmpfs, app usually in /Applications).
5. Success → `rm -rf <appPath>.old` + temp dir. Failure at step 4 →
   `rm -rf` the partial copy, `mv` the `.old` back (rollback), rethrow.

The zip's sha256 is verified against `checksums.txt` BEFORE extraction;
mismatch aborts with an error dialog and nothing is touched.

## Consequences (accepted)

- **TCC re-grant after every update.** Ad-hoc signatures are unique per
  build, so the swap invalidates Accessibility (and possibly mic) grants.
  The existing launch flow already handles it: `wireSession` detects the
  missing permission and opens the Setup window. Already documented
  app behavior for manual updates; unavoidable without a paid Apple
  Developer identity.
- A dictation in progress when the user confirms "Install and relaunch"
  is lost at relaunch. The user explicitly clicked the button; recordings
  are seconds long.
- If the user renamed or moved the app bundle, the swap still works — the
  path is derived from `process.execPath`, not hardcoded.

## Edge cases

| Case | Behavior |
|---|---|
| No network / GitHub down / rate-limited | Error dialog; nothing modified |
| Release missing zip or checksums asset | Error dialog ("release is missing expected assets") |
| Checksum mismatch | Error dialog; abort before extraction |
| Extracted zip missing `shhh.app` | Error dialog; abort before swap |
| Copy into place fails | Rollback `.old` → original path; error dialog |
| Running unpackaged (`npm start`) | Info dialog; no install attempted |
| Local version newer than latest release (dev) | Treated as up to date (`compareVersions <= 0`) |
| Second click while running | Ignored (reentrancy guard) |

## Testing

- Unit (`tests/updater.test.ts`, injected fetch/exec/fs-temp):
  - `compareVersions`: newer/older/equal, `v` prefix, `0.10.0 > 0.9.9`,
    unequal lengths, malformed.
  - `parseLatestRelease`: happy path from a real-shaped API payload;
    missing zip asset; missing checksums asset.
  - `parseChecksums`: real shasum line; multiple lines; missing filename.
  - `checkForUpdate`: up-to-date, update available, HTTP error throws.
  - `bundlePathFromExecPath`: packaged path → `.app` root; bare
    (non-bundle) executable → null; dev Electron binary → its Electron.app
    (dev mode is guarded by `app.isPackaged`, not here).
  - `installUpdate`: happy-path exec call sequence; rollback sequence when
    the copy step fails; abort (no mv) when `shhh.app` missing from zip.
- Manual smoke checklist: up-to-date dialog on current version; dev-mode
  dialog via `npm start`; full update path testable only when a newer
  release exists (note added to checklist).
