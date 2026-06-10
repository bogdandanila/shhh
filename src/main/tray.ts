import { app, Menu, nativeImage, Tray } from 'electron';

/**
 * Persistent menu-bar entry point — the only always-visible UI of a
 * background app (no dock icon, overlay hides itself after each dictation).
 */
// 1x1 transparent PNG, resized to menu-bar size: a valid image object so Tray
// construction can't reject it, while the emoji title remains the visible part.
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function createTray(opts: { onHistory: () => void; onSetup: () => void }): Tray {
  const icon = nativeImage.createFromDataURL(BLANK_PNG).resize({ width: 16, height: 16 });
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
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
