import { AudioData } from '../../shared/types';

export interface Transcriber {
  transcribe(audio: AudioData): Promise<string>;
}

export const STT_TIMEOUT_MS = 30_000; // per request/chunk — processing wait, not a recording cap
