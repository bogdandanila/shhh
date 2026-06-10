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

export async function requestPermission(which: keyof typeof PANES): Promise<void> {
  if (which === 'microphone') { await systemPreferences.askForMediaAccess('microphone'); return; }
  // isTrustedAccessibilityClient(true) triggers the system prompt; the deep link below opens the exact Settings pane
  systemPreferences.isTrustedAccessibilityClient(true);
  await shell.openExternal(PANES[which]);
}

export function allGranted(p: PermissionStatus): boolean {
  return p.microphone && p.accessibility;
}
