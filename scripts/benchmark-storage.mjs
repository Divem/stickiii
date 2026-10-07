import { readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compile current storage against the cached release dependencies. Fixtures and
// binaries stay in an isolated temporary directory, never the user's library.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dependencies = join(root, 'src-tauri/target/release/deps');
const files = await readdir(dependencies);
const temporary = await mkdtemp(join(tmpdir(), 'stickiii-storage-benchmark-'));
try {
  const args = ['--edition=2021', '-C', 'opt-level=3', '-C', 'panic=abort', '-A', 'dead_code', '-L', `dependency=${dependencies}`];
  for (const name of ['base64', 'serde', 'serde_json', 'uuid', 'chrono', 'tempfile', 'image']) {
    const matches = await Promise.all(files.filter((file) => file.startsWith(`lib${name}-`) && file.endsWith('.rlib')).map(async (file) => ({ path: join(dependencies, file), time: (await stat(join(dependencies, file))).mtimeMs })));
    matches.sort((a, b) => b.time - a.time);
    if (!matches.length) throw Error(`Missing ${name} release dependency; run npm run build first.`);
    args.push('--extern', `${name}=${matches[0].path}`);
  }
  const binary = join(temporary, process.platform === 'win32' ? 'benchmark.exe' : 'benchmark');
  args.push(join(root, 'scripts/benchmark-storage.rs'), '-o', binary);
  const compiled = spawnSync('rustc', args, { stdio: 'inherit' });
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0) throw Error(`Benchmark compilation failed: ${compiled.status}`);
  const result = spawnSync(binary, [], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Benchmark failed: ${result.status}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
