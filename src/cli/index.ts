#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { readFileSync } from 'node:fs';
import { rpc as realRpc, promptHidden as realPromptHidden, copyToClipboard as realCopy, DATA_DIR } from './client';

export interface CliIo {
  rpc(method: string, params?: unknown): Promise<unknown>;
  print(s: string): void;
  promptHidden(q: string): Promise<string>;
  copyToClipboard(text: string): void;
}

export function buildProgram(io: CliIo): Command {
  const program = new Command('shhh').description('Privacy-first hold-to-talk dictation for macOS');
  program.exitOverride(); // throw instead of process.exit in tests

  const config = program.command('config');
  config.command('set').argument('<key>').argument('[value]').action(async (key: string, value?: string) => {
    if (key.endsWith('.api-key')) {
      if (value !== undefined) { io.print('Refusing to take an API key as an argument (shell history). Enter it below.'); }
      value = await io.promptHidden(`${key}: `);
    }
    if (value === undefined) throw new Error(`Missing value for ${key}`);
    await io.rpc('config.set', { key, value });
    io.print('ok');
  });
  config.command('get').argument('[key]').action(async (key?: string) => {
    const view = (await io.rpc('config.get', key ? { key } : {})) as Record<string, string>;
    for (const [k, v] of Object.entries(view)) io.print(`${k}=${v}`);
  });

  const prompt = program.command('prompt');
  prompt.command('show').action(async () => io.print(String(await io.rpc('prompt.get', {}))));
  prompt.command('set').argument('[file]').action(async (file?: string) => {
    const text = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8'); // file or stdin
    await io.rpc('prompt.set', { prompt: text.trim() });
    io.print('ok');
  });
  prompt.command('reset').action(async () => { await io.rpc('prompt.reset', {}); io.print('ok'); });

  const history = program.command('history');
  history.command('list').option('-n, --limit <n>', 'max entries', '20').option('--search <q>').action(async (opts) => {
    const list = (await io.rpc('history.list', { limit: Number(opts.limit), search: opts.search })) as
      { id: string; formattedText: string; createdAt: string; unformatted: boolean }[];
    for (const e of list) io.print(`${e.id.slice(0, 8)}  ${e.createdAt}  ${e.unformatted ? '[raw] ' : ''}${e.formattedText}`);
  });
  history.command('copy').argument('<id>').action(async (id: string) => {
    const e = (await io.rpc('history.get', { id })) as { formattedText: string };
    io.copyToClipboard(e.formattedText);
    io.print('copied');
  });
  history.command('clear').action(async () => { await io.rpc('history.clear', {}); io.print('ok'); });

  const model = program.command('model');
  model.command('list').action(async () => {
    const { WHISPER_MODELS, isModelPresent } = await import('../core/models');
    for (const name of Object.keys(WHISPER_MODELS)) {
      io.print(`${name}  ${isModelPresent(DATA_DIR, name) ? '[downloaded]' : ''}`);
    }
  });
  model.command('download').argument('<name>').action(async (name: string) => {
    const { downloadModel, WHISPER_MODELS } = await import('../core/models');
    if (!(name in WHISPER_MODELS)) throw new Error(`Unknown model. Options: ${Object.keys(WHISPER_MODELS).join(', ')}`);
    io.print(`Downloading ${name} (${WHISPER_MODELS[name as keyof typeof WHISPER_MODELS].sizeMB}MB)…`);
    await downloadModel(DATA_DIR, name as never, (pct) => process.stdout.write(`\r${pct}%`));
    io.print('\ndone');
  });

  program.command('status').action(async () => {
    const s = (await io.rpc('status', {})) as Record<string, unknown>;
    for (const [k, v] of Object.entries(s)) io.print(`${k}: ${v}`);
  });
  program.command('doctor').action(async () => {
    const d = (await io.rpc('doctor', {})) as Record<string, unknown>;
    for (const [k, v] of Object.entries(d)) io.print(`${v === true ? '✅' : v === false ? '❌' : '·'} ${k}: ${v}`);
  });
  program.command('nuke').action(async () => { await io.rpc('nuke', {}); io.print('All shhh data wiped.'); });
  program.command('setup').action(async () => { await io.rpc('setup.open', {}); io.print('Setup window opened.'); });

  program.command('install').description('Download and install shhh.app').action(async () => {
    const { installApp } = await import('./install');
    await installApp(io.print);
  });
  program.command('update').description('Update shhh.app and re-run permission setup').action(async () => {
    const { installApp } = await import('./install');
    await installApp(io.print);
    await io.rpc('setup.open', {}).catch(() => io.print('Start the app and run `shhh setup` to re-grant permissions.'));
  });
  program.command('start').action(async () => { await io.rpc('status', {}); io.print('running'); });
  program.command('stop').action(async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('pkill', ['-x', 'shhh']); io.print('stopped');
  });
  program.command('restart').action(async () => {
    const { execFileSync, execFile } = await import('node:child_process');
    try { execFileSync('pkill', ['-x', 'shhh']); } catch { /* not running */ }
    await new Promise((r) => setTimeout(r, 500));
    execFile('open', ['-g', '/Applications/shhh.app']);
    io.print('restarted');
  });

  return program;
}

/* c8 ignore start — wired only when run as a binary */
if (require.main === module) {
  const io: CliIo = { rpc: realRpc, print: console.log, promptHidden: realPromptHidden, copyToClipboard: realCopy };
  buildProgram(io).parseAsync(process.argv).catch((e) => {
    if (e instanceof CommanderError) process.exit(e.exitCode);
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
/* c8 ignore stop */
