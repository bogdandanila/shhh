import { describe, expect, test } from 'vitest';
import { pcmToWav, pcmToMp3, splitOnSilence, prepareUploads } from '../src/core/audio';

function tone(seconds: number, freq = 440, sampleRate = 16000): Int16Array {
  const out = new Int16Array(seconds * sampleRate);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000);
  return out;
}

describe('pcmToWav', () => {
  test('produces a valid RIFF/WAVE header with correct sizes', () => {
    const pcm = tone(1);
    const wav = pcmToWav(pcm, 16000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16000);          // sample rate
    expect(wav.readUInt16LE(22)).toBe(1);               // mono
    expect(wav.length).toBe(44 + pcm.length * 2);
  });
});

describe('pcmToMp3', () => {
  test('encodes and is much smaller than WAV', () => {
    const pcm = tone(2);
    const mp3 = pcmToMp3(pcm, 16000);
    expect(mp3.length).toBeGreaterThan(0);
    expect(mp3.length).toBeLessThan(pcm.length * 2 * 0.5);
  });
});

describe('splitOnSilence', () => {
  test('splits at quiet gaps, keeps everything', () => {
    const sr = 16000;
    const silence = new Int16Array(sr); // 1s of silence
    const pcm = new Int16Array([...tone(2), ...silence, ...tone(2)]);
    const parts = splitOnSilence(pcm, sr, { maxPartSamples: 3 * sr });
    expect(parts.length).toBe(2);
    expect(parts.reduce((n, p) => n + p.length, 0)).toBe(pcm.length);
  });
  test('returns single part when under max', () => {
    const parts = splitOnSilence(tone(1), 16000, { maxPartSamples: 16000 * 60 });
    expect(parts).toHaveLength(1);
  });
});

describe('prepareUploads', () => {
  test('short audio -> one wav part; respects byte limit by chunking+mp3', () => {
    const short = prepareUploads(tone(2), 16000, 25 * 1024 * 1024);
    expect(short).toHaveLength(1);
    expect(short[0].filename.endsWith('.wav')).toBe(true);
    const tiny = prepareUploads(tone(10), 16000, 40_000); // force chunked mp3
    expect(tiny.length).toBeGreaterThan(1);
    expect(tiny[0].filename.endsWith('.mp3')).toBe(true);
  });
});
