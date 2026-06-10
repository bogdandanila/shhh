import { expect, test } from 'vitest';
import { isNonSpeechSegment } from '../src/core/transcriber/local-whisper';

test('whisper non-speech annotations are detected', () => {
  expect(isNonSpeechSegment(' [BLANK_AUDIO]')).toBe(true);
  expect(isNonSpeechSegment('[MUSIC]')).toBe(true);
  expect(isNonSpeechSegment(' (silence) ')).toBe(true);
  expect(isNonSpeechSegment('(clears throat)')).toBe(true);
});

test('real speech segments are kept, even with inline brackets', () => {
  expect(isNonSpeechSegment(' Hello world.')).toBe(false);
  expect(isNonSpeechSegment(' Use the array [0] syntax.')).toBe(false);
  expect(isNonSpeechSegment(' so (and this matters) listen')).toBe(false);
  expect(isNonSpeechSegment('')).toBe(false);
});
