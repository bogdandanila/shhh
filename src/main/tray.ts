import { Menu, app, nativeImage, Tray } from 'electron';

/**
 * Persistent menu-bar entry point — the only always-visible UI of a
 * background app (no dock icon, overlay hides itself after each dictation).
 * Empty image + emoji title renders fine; if the icon seems missing, it's
 * macOS hiding overcrowded items under the notch (see README troubleshooting).
 * Drawn-glyph alternative lives in renderer/trayTemplate.png (gen-tray-icon.mjs).
 */
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
