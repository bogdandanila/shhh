import { app, Menu, nativeImage, Tray } from 'electron';

/**
 * Persistent menu-bar entry point — the only always-visible UI of a
 * background app (no dock icon, overlay hides itself after each dictation).
 */
export function createTray(opts: { onHistory: () => void; onSetup: () => void }): Tray {
  const tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🤫'); // emoji-as-icon: zero assets, good enough for v1
  tray.setToolTip('shhh — hold right ⌘ to dictate');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'History', click: opts.onHistory },
    { label: 'Settings…', click: opts.onSetup },
    { type: 'separator' },
    { label: 'Quit shhh', click: () => app.quit() },
  ]));
  return tray;
}
