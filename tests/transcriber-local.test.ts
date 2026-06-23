import { expect, test } from 'vitest';
import { isNonSpeechSegment, isLikelyHallucination, cleanTranscript, HALLUCINATION_CONFIDENCE } from '../src/core/transcriber/local-whisper';

const LOW = HALLUCINATION_CONFIDENCE - 0.1;
const HIGH = HALLUCINATION_CONFIDENCE + 0.1;

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

test('low-confidence pleasantries are flagged as hallucinations', () => {
  expect(isLikelyHallucination(' Thank you.', LOW)).toBe(true);
  expect(isLikelyHallucination('Thanks for watching!', LOW)).toBe(true);
  expect(isLikelyHallucination('Please subscribe', LOW)).toBe(true);
  expect(isLikelyHallucination('you', LOW)).toBe(true);
});

test('high-confidence pleasantries (genuinely spoken) are kept', () => {
  expect(isLikelyHallucination('Thank you.', HIGH)).toBe(false);
  expect(isLikelyHallucination('Thanks for watching!', HIGH)).toBe(false);
});

test('non-pleasantry text is never a hallucination, even at low confidence', () => {
  expect(isLikelyHallucination('Send the report by Friday.', LOW)).toBe(false);
  expect(isLikelyHallucination('Thank you for the detailed report.', LOW)).toBe(false);
});

test('cleanTranscript peels trailing/leading low-confidence pleasantries', () => {
  expect(cleanTranscript([
    { text: 'Send the invoice today.', confidence: 0.95 },
    { text: ' Thank you.', confidence: 0.3 },
  ])).toBe('Send the invoice today.');

  expect(cleanTranscript([
    { text: 'Thank you.', confidence: 0.25 },
    { text: ' The meeting is at noon.', confidence: 0.9 },
  ])).toBe('The meeting is at noon.');
});

test('cleanTranscript keeps a genuinely-spoken closing thank you', () => {
  expect(cleanTranscript([
    { text: 'Please review the draft.', confidence: 0.92 },
    { text: ' Thank you.', confidence: 0.88 },
  ])).toBe('Please review the draft. Thank you.');
});

test('cleanTranscript leaves mid-stream pleasantries alone', () => {
  expect(cleanTranscript([
    { text: 'I said thank you and then left.', confidence: 0.3 },
  ])).toBe('I said thank you and then left.');
});

test('cleanTranscript still drops non-speech annotations', () => {
  expect(cleanTranscript([
    { text: '[BLANK_AUDIO]', confidence: 0.1 },
    { text: 'Hello there.', confidence: 0.9 },
    { text: ' Thank you.', confidence: 0.2 },
  ])).toBe('Hello there.');
});
