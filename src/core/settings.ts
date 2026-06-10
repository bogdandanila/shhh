import { Settings } from '../shared/types';
import { DEFAULT_SYSTEM_PROMPT } from './formatter/default-prompt';

const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(input: string): number {
  const m = /^(\d+)([smhd])$/.exec(input.trim());
  if (!m) throw new Error(`Invalid duration "${input}" — use e.g. 45s, 10m, 2h, 30d`);
  return Number(m[1]) * UNITS[m[2]];
}

export function formatDuration(ms: number): string {
  const order: Array<[string, number]> = [
    ['d', UNITS.d],
    ['h', UNITS.h],
    ['m', UNITS.m],
    ['s', UNITS.s],
  ];
  for (const [u, f] of order) {
    if (ms % f === 0 && ms >= f) return `${ms / f}${u}`;
  }
  return `${ms}ms`;
}

export const DEFAULT_SETTINGS: Settings = {
  sttProvider: 'unset',
  sttModel: '',
  llmProvider: 'none',
  llmModel: '',
  hotkey: 'fn',
  maxRecordingMs: 600_000,
  historyRetentionMs: null,
  loginLaunch: false,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  deviceId: '',
};

export function mergeSettings(base: Settings, partial: Partial<Settings>): Settings {
  return { ...base, ...partial };
}
