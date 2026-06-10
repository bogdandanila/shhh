import { beforeEach, expect, test, vi } from 'vitest';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: createMock }; constructor(public opts: unknown) {} },
}));

import { AnthropicFormatter } from '../src/core/formatter/anthropic';
import { buildFormatter } from '../src/core/formatter/factory';
import { InMemoryApiKeyStore } from '../src/core/api-keys';
import { DEFAULT_SETTINGS } from '../src/core/settings';

beforeEach(() => createMock.mockReset());

test('AnthropicFormatter sends system prompt + raw text, joins text blocks', async () => {
  createMock.mockResolvedValue({ content: [{ type: 'text', text: 'Clean.' }] });
  const f = new AnthropicFormatter('sk-test', 'claude-haiku-4-5', 'SYSTEM');
  const out = await f.format('um raw');
  expect(out).toBe('Clean.');
  const arg = createMock.mock.calls[0][0];
  expect(arg.model).toBe('claude-haiku-4-5');
  expect(arg.system).toBe('SYSTEM');
  expect(arg.messages).toEqual([{ role: 'user', content: 'um raw' }]);
});

test('factory: llmProvider none -> null; anthropic without key -> null; with key -> formatter', () => {
  const keys = new InMemoryApiKeyStore();
  expect(buildFormatter(DEFAULT_SETTINGS, keys)).toBeNull();
  const s = { ...DEFAULT_SETTINGS, llmProvider: 'anthropic' as const, llmModel: 'claude-haiku-4-5' };
  expect(buildFormatter(s, keys)).toBeNull(); // no key stored
  keys.set('anthropic', 'sk-ant-x');
  expect(buildFormatter(s, keys)).toBeInstanceOf(AnthropicFormatter);
});
