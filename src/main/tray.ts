import { Menu, app, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import { rendererDir } from './paths';

/**
 * Persistent menu-bar entry point — the only always-visible UI of a
 * background app (no dock icon, overlay hides itself after each dictation).
 * Drawn mic glyph (template image; regenerate via scripts/gen-tray-icon.mjs) —
 * empty-image/title-only trays don't render on recent macOS.
 */
export function createTray(opts: { onHistory: () => void; onSetup: () => void }): Tray {
  const icon = nativeImage.createFromPath(join(rendererDir(), 'trayTemplate.png')); // picks up @2x sibling
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('shhh — hold right ⌘ to dictate');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'History', click: opts.onHistory },
    { label: 'Settings…', click: opts.onSetup },
    { type: 'separator' },
    { label: 'Quit shhh', click: () => app.quit() },
  ]));
  return tray;
}
