import { Settings } from '../../shared/types';
import { ApiKeyStore } from '../api-keys';
import { Formatter } from './index';
import { AnthropicFormatter } from './anthropic';
import { OpenAIFormatter } from './openai';

/** Returns null when unconfigured — pipeline then pastes raw text (spec: useful with zero LLM config). */
export function buildFormatter(settings: Settings, keys: ApiKeyStore): Formatter | null {
  if (settings.llmProvider === 'none' || !settings.llmModel) return null;
  const key = keys.get(settings.llmProvider);
  if (!key) return null;
  if (settings.llmProvider === 'anthropic') return new AnthropicFormatter(key, settings.llmModel, settings.systemPrompt);
  return new OpenAIFormatter(key, settings.llmModel, settings.systemPrompt);
}
