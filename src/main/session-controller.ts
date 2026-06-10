import { PermissionStatus } from '../core/rpc-handlers';
export async function wireSession(_w: unknown): Promise<() => Promise<PermissionStatus>> {
  // Replaced in Task 15 with the real key-listener/session wiring.
  return async () => ({ microphone: false, accessibility: false, inputMonitoring: false });
}
