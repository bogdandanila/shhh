import { app, dialog } from 'electron';
import { mkdtempSync, rmSync } from 'node:fs';
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
  let work: string | null = null;
  let installed = false;
  try {
    app.focus({ steal: true }); // LSUIElement app: without this, dialogs open behind the active app
    const current = app.getVersion();
    const check = await checkForUpdate(current);
    if (check.kind === 'up-to-date') {
      await dialog.showMessageBox({ type: 'info', message: `You're up to date (latest release: ${check.latest}, you have ${current}).` });
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
    work = mkdtempSync(join(tmpdir(), 'shhh-update-'));
    const zipPath = join(work, check.zipName);
    await downloadFile(check.zipUrl, zipPath);
    const sumsRes = await fetch(check.checksumsUrl);
    if (!sumsRes.ok) throw new Error(`Checksums download failed (${sumsRes.status})`);
    const sha256 = parseChecksums(await sumsRes.text(), check.zipName);
    if (!sha256) throw new Error('checksums.txt has no entry for the update zip');
    await installUpdate({ zipPath, sha256, extractDir: join(work, 'extract'), appPath }, { exec: defaultExec });
    installed = true;
  } catch (e) {
    console.error('update flow failed:', e);
    app.focus({ steal: true }); // LSUIElement app: without this, dialogs open behind the active app
    await dialog.showMessageBox({
      type: 'error', message: 'Update failed',
      detail: e instanceof Error ? e.message : String(e),
    });
  } finally {
    try {
      if (work) rmSync(work, { recursive: true, force: true });
    } catch { /* tmp is purged by macOS eventually */ }
    running = false;
  }
  if (installed) {
    // After cleanup: relaunch into the swapped bundle. app.exit() skips
    // finally blocks of in-flight async fns, so nothing may follow it.
    app.relaunch();
    app.exit(0);
  }
}
