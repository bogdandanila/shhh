export type SttProvider = 'unset' | 'local' | 'openai' | 'groq' | 'deepgram';
export type LlmProvider = 'none' | 'anthropic' | 'openai';

export interface Settings {
  sttProvider: SttProvider;
  sttModel: string;            // local model name (e.g. "base.en") or cloud model id
  llmProvider: LlmProvider;
  llmModel: string;
  hotkey: string;              // named key (fn, rcmd, lalt, …) or a macOS virtual keycode as string
  maxRecordingMs: number;
  historyRetentionMs: number | null;  // null = keep forever
  loginLaunch: boolean;
  duckAudio: boolean;          // lower system volume while recording
  systemPrompt: string;
  deviceId: string;
}

export interface HistoryEntry {
  id: string;                  // UUIDv7
  rawText: string;
  formattedText: string;
  createdAt: string;           // ISO 8601
  updatedAt: string;
  deletedAt: string | null;
  deviceId: string;
  sttProvider: string;
  sttModel: string;
  llmProvider: string;
  llmModel: string;
  durationMs: number;
  unformatted: boolean;
}

export interface AudioData {
  pcm: Int16Array;             // 16kHz mono
  sampleRate: number;          // always 16000 in v1
}

export interface RpcRequest { id: number; method: string; params?: unknown }
export interface RpcResponse { id: number; result?: unknown; error?: string }
