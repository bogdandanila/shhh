import { expect, test, vi } from 'vitest';
import { buildProgram, CliIo } from '../src/cli/index';

function run(argv: string[], rpcResult: unknown = 'ok') {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const out: string[] = [];
  const io: CliIo = {
    rpc,
    print: (s) => out.push(s),
    promptHidden: vi.fn().mockResolvedValue('sk-secret-entered'),
    copyToClipboard: vi.fn(),
  };
  const program = buildProgram(io);
  return program.parseAsync(['node', 'shhh', ...argv]).then(() => ({ rpc, out, io }));
}

test('config set forwards to RPC', async () => {
  const { rpc } = await run(['config', 'set', 'stt.provider', 'local']);
  expect(rpc).toHaveBeenCalledWith('config.set', { key: 'stt.provider', value: 'local' });
});

test('api keys use hidden prompt, never argv', async () => {
  const { rpc, io } = await run(['config', 'set', 'anthropic.api-key']);
  expect(io.promptHidden).toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith('config.set', { key: 'anthropic.api-key', value: 'sk-secret-entered' });
});

test('config get prints key=value lines', async () => {
  const { out } = await run(['config', 'get'], { 'stt.provider': 'local', 'anthropic.api-key': 'sk-ant-…7f2k' });
  expect(out.join('\n')).toContain('stt.provider=local');
  expect(out.join('\n')).toContain('anthropic.api-key=sk-ant-…7f2k');
});

test('history list prints entries; history copy puts text on clipboard', async () => {
  const entry = { id: 'abc123', formattedText: 'Hello world.', createdAt: '2026-06-10T10:00:00Z', unformatted: false };
  const { out } = await run(['history', 'list'], [entry]);
  expect(out.join('\n')).toContain('Hello world.');
  const { io } = await run(['history', 'copy', 'abc123'], entry);
  expect(io.copyToClipboard).toHaveBeenCalledWith('Hello world.');
});

test('prompt reset forwards to RPC', async () => {
  const { rpc } = await run(['prompt', 'reset']);
  expect(rpc).toHaveBeenCalledWith('prompt.reset', {});
});

test('prompt set from file forwards file content to RPC', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const tmpDir = mkdtempSync(join(tmpdir(), 'shhh-test-'));
  const tmpfile = join(tmpDir, 'prompt.txt');
  writeFileSync(tmpfile, 'My custom prompt');
  const { rpc } = await run(['prompt', 'set', tmpfile]);
  expect(rpc).toHaveBeenCalledWith('prompt.set', { prompt: 'My custom prompt' });
});
