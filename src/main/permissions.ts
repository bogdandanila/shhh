import { shell, systemPreferences } from 'electron';
import { PermissionStatus } from '../core/rpc-handlers';

const PANES = {
  inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
} as const;

// Verified-once state survives restarts via the store; a revoked grant just means
// the hotkey goes dead (macOS offers no query API for Input Monitoring to do better).
let inputMonitoringSeen = false;
let persistSeen: (() => void) | null = null;

export function initInputMonitoring(seen: boolean, persist: () => void): void {
  inputMonitoringSeen = seen;
  persistSeen = persist;
}

export function markInputMonitoringWorking(): void {
  if (inputMonitoringSeen) return;
  inputMonitoringSeen = true;
  persistSeen?.();
}

export async function checkPermissions(): Promise<PermissionStatus> {
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone') === 'granted',
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    // No direct API for Input Monitoring: the uiohook hook delivering events implies it works.
    inputMonitoring: inputMonitoringSeen,
  };
}

export async function requestPermission(which: keyof typeof PANES): Promise<void> {
  if (which === 'microphone') { await systemPreferences.askForMediaAccess('microphone'); return; }
  // isTrustedAccessibilityClient(true) triggers the system prompt; the deep link below opens the exact Settings pane
  if (which === 'accessibility') { systemPreferences.isTrustedAccessibilityClient(true); }
  await shell.openExternal(PANES[which]);
}

export function allGranted(p: PermissionStatus): boolean {
  return p.microphone && p.accessibility && p.inputMonitoring;
}
