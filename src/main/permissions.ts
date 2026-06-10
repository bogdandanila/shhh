import { shell, systemPreferences } from 'electron';
import { PermissionStatus } from '../core/rpc-handlers';

const PANES = {
  inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
} as const;

let inputMonitoringSeen = false;
export function markInputMonitoringWorking(): void { inputMonitoringSeen = true; }

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
  if (which === 'accessibility') { systemPreferences.isTrustedAccessibilityClient(true); }
  await shell.openExternal(PANES[which]);
}

export function allGranted(p: PermissionStatus): boolean {
  return p.microphone && p.accessibility && p.inputMonitoring;
}
