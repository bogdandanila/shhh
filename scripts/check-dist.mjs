// Requires the compiled CJS output in a plain node process (what Electron main does).
// Catches ERR_REQUIRE_ESM and similar boot-time module failures that vitest's transform hides.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const m of ['../dist/core/audio.js', '../dist/core/pipeline.js', '../dist/core/rpc-handlers.js', '../dist/cli/index.js']) {
  require(m);
  console.log('ok', m);
}
