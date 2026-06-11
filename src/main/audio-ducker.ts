import { execFile } from 'node:child_process';

export type OsaExec = (script: string) => Promise<string>;

const DUCK_LEVEL = 20;

function defaultOsaExec(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Parses `get volume settings` output, e.g. "output volume:64, input volume:90, alert volume:100, output muted:false". */
export function parseVolumeSettings(reply: string): { volume: number; muted: boolean } | null {
  const vol = /output volume:(\d+)/.exec(reply);
  const muted = /output muted:(true|false)/.exec(reply);
  if (!vol || !muted) return null;
  return { volume: Number(vol[1]), muted: muted[1] === 'true' };
}

/**
 * Lowers the system output volume while a recording is in flight.
 * duck/restore are serialized through a promise chain — a restore issued while
 * a duck is still talking to osascript runs after it, so a quick hotkey tap
 * can't strand the volume low. Failures are logged, never thrown: ducking
 * must never break or delay a dictation cycle.
 */
export class AudioDucker {
  private previousVolume: number | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(private exec: OsaExec = defaultOsaExec) {}

  duck(): Promise<void> {
    this.chain = this.chain.then(() => this.doDuck());
    return this.chain;
  }

  restore(): Promise<void> {
    this.chain = this.chain.then(() => this.doRestore());
    return this.chain;
  }

  private async doDuck(): Promise<void> {
    if (this.previousVolume !== null) return; // already ducked
    try {
      const parsed = parseVolumeSettings(await this.exec('get volume settings'));
      if (!parsed || parsed.muted || parsed.volume <= DUCK_LEVEL) return;
      this.previousVolume = parsed.volume;
      await this.exec(`set volume output volume ${DUCK_LEVEL}`);
    } catch (e) {
      this.previousVolume = null;
      console.warn('audio duck failed:', e instanceof Error ? e.message : e);
    }
  }

  private async doRestore(): Promise<void> {
    if (this.previousVolume === null) return;
    const prev = this.previousVolume;
    this.previousVolume = null;
    try {
      await this.exec(`set volume output volume ${prev}`);
    } catch (e) {
      console.warn('audio restore failed:', e instanceof Error ? e.message : e);
    }
  }
}
