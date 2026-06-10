import { shell, systemPreferences } from 'electron';
import { PermissionStatus } from '../core/rpc-handlers';

const PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
} as const;

// Both permissions are queryable live — no cached state, no restart ceremonies.
export async function checkPermissions(): Promise<PermissionStatus> {
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone') === 'granted',
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
  };
}

let axPromptShown = false;

export async function requestPermission(which: keyof typeof PANES): Promise<void> {
  if (which === 'microphone') { await systemPreferences.askForMediaAccess('microphone'); return; }
  // First click: the system prompt registers shhh in the Accessibility list and has
  // its own "Open System Settings" button — opening the pane too would double up.
  // Later clicks (prompt no longer shows): deep-link straight to the pane.
  if (!axPromptShown) {
    axPromptShown = true;
    systemPreferences.isTrustedAccessibilityClient(true);
    return;
  }
  await shell.openExternal(PANES[which]);
}

export function allGranted(p: PermissionStatus): boolean {
  return p.microphone && p.accessibility;
}
