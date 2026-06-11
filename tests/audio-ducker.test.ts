import { expect, test, vi } from 'vitest';
import { AudioDucker, parseVolumeSettings } from '../src/main/audio-ducker';

const SETTINGS_REPLY = 'output volume:64, input volume:90, alert volume:100, output muted:false';

function fakeExec(settingsReply: string = SETTINGS_REPLY) {
  const calls: string[] = [];
  const exec = vi.fn(async (script: string): Promise<string> => {
    calls.push(script);
    return script === 'get volume settings' ? settingsReply : '';
  });
  return { exec, calls };
}

test('parseVolumeSettings parses the osascript reply shape', () => {
  expect(parseVolumeSettings(SETTINGS_REPLY)).toEqual({ volume: 64, muted: false });
  expect(parseVolumeSettings('output volume:7, input volume:0, alert volume:9, output muted:true'))
    .toEqual({ volume: 7, muted: true });
  expect(parseVolumeSettings('garbage')).toBeNull();
});

test('duck lowers volume to 20, restore puts it back and clears state', async () => {
  const { exec, calls } = fakeExec();
  const d = new AudioDucker(exec);
  await d.duck();
  expect(calls).toEqual(['get volume settings', 'set volume output volume 20']);
  await d.restore();
  expect(calls).toEqual(['get volume settings', 'set volume output volume 20', 'set volume output volume 64']);
  await d.restore(); // second restore is a no-op
  expect(calls).toHaveLength(3);
});

test('muted output -> duck is a no-op', async () => {
  const { exec, calls } = fakeExec('output volume:64, input volume:90, alert volume:100, output muted:true');
  const d = new AudioDucker(exec);
  await d.duck();
  await d.restore();
  expect(calls).toEqual(['get volume settings']); // read but never set
});

test('volume already at or below 20 -> duck is a no-op', async () => {
  const { exec, calls } = fakeExec('output volume:15, input volume:90, alert volume:100, output muted:false');
  const d = new AudioDucker(exec);
  await d.duck();
  await d.restore();
  expect(calls).toEqual(['get volume settings']);
});

test('double duck keeps the original level', async () => {
  const { exec, calls } = fakeExec();
  const d = new AudioDucker(exec);
  await d.duck();
  await d.duck(); // re-entrant: must not re-read (would remember 20)
  await d.restore();
  expect(calls).toEqual(['get volume settings', 'set volume output volume 20', 'set volume output volume 64']);
});

test('exec failure never throws out of duck or restore', async () => {
  const exec = vi.fn(async (): Promise<string> => { throw new Error('osascript missing'); });
  const d = new AudioDucker(exec);
  await expect(d.duck()).resolves.toBeUndefined();
  await expect(d.restore()).resolves.toBeUndefined();
});

test('quick tap: restore queued behind an in-flight duck still restores', async () => {
  let release!: (v: string) => void;
  const gate = new Promise<string>((r) => { release = r; });
  const calls: string[] = [];
  const exec = vi.fn(async (script: string): Promise<string> => {
    calls.push(script);
    return script === 'get volume settings' ? gate : '';
  });
  const d = new AudioDucker(exec);
  const duckP = d.duck();
  const restoreP = d.restore(); // fn released before osascript replied
  release(SETTINGS_REPLY);
  await Promise.all([duckP, restoreP]);
  expect(calls).toEqual(['get volume settings', 'set volume output volume 20', 'set volume output volume 64']);
});

test('failed set during duck clears state: restore no-ops, retry duck re-reads', async () => {
  const calls: string[] = [];
  let failSet = true;
  const exec = vi.fn(async (script: string): Promise<string> => {
    calls.push(script);
    if (script === 'get volume settings') return SETTINGS_REPLY;
    if (failSet) throw new Error('set failed');
    return '';
  });
  const d = new AudioDucker(exec);
  await d.duck();             // get + set (set fails, state cleared)
  await d.restore();          // no-op — nothing remembered
  expect(calls).toEqual(['get volume settings', 'set volume output volume 20']);
  failSet = false;
  await d.duck();             // re-reads and ducks cleanly
  expect(calls).toEqual([
    'get volume settings', 'set volume output volume 20',
    'get volume settings', 'set volume output volume 20',
  ]);
});
