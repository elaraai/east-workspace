/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 dataflow run -v` end-to-end: the flag flows through the orchestrator to a
 * real runner, and it is cache-safe.
 *
 * `-v` is a pure runtime toggle (see `withRunnerVerbose` in e3-types): it
 * splices `-v` into a known runtime's argv immediately before spawn, AFTER the
 * cache decision, and never touches the task's `commandIr` or any hash. This
 * suite proves both halves through the actual CLI + orchestrator:
 *
 *   1. cache-safety — a first run executes the task; a `-v` re-run reports
 *      `[CACHED]` (identical task hash + inputs ⇒ same cache key). `-v` did not
 *      bust the cache.
 *   2. reach — a `-v --force` run makes the runner spawn again, and the runner's
 *      verbose block lands in the task's captured logs. A no-`-v` run's logs
 *      carry none of it (control).
 *
 * Uses east-c: a self-contained runner binary (east-c-std is compiled in), so
 * the whole flow runs locally by prepending east-c's dir to PATH — no
 * node_modules / venv / `make link`. Skips when east-c is not built.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';
import e3 from '@elaraai/e3';
import { IntegerType, East } from '@elaraai/east';

const WS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const EAST_C = join(WS, 'libs', 'east-c', 'build', 'packages', 'east-c-cli', 'east-c');
const EAST_C_DIR = dirname(EAST_C);
const hasEastC = existsSync(EAST_C);

describe('e3 dataflow run -v (east-c)', () => {
  let testDir: string;
  let repoDir: string;
  let zip: string;
  /** PATH with the self-contained east-c binary prepended, so `east-c` resolves. */
  let runEnv: { PATH: string };

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');
    zip = join(testDir, 'verbose-c.zip');
    runEnv = { PATH: `${EAST_C_DIR}${delimiter}${process.env.PATH ?? ''}` };
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  it('-v is cache-safe and its verbose output reaches the task logs',
    { skip: hasEastC ? false : 'east-c not built' }, async () => {
      // --- deploy a single east-c task: doubled = n * 2 ---------------------
      const n = e3.input('n', IntegerType, 5n);
      const doubled = e3.task(
        'doubled', [n],
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
        { runner: { runtime: 'east-c', platforms: ['east-c-std'] } },
      );
      await e3.export(e3.package('verbose-c', '1.0.0', doubled), zip);

      assert.strictEqual((await runE3Command(['repo', 'create', repoDir], testDir)).exitCode, 0);
      assert.strictEqual((await runE3Command(['package', 'import', repoDir, zip], testDir)).exitCode, 0);
      assert.strictEqual((await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir)).exitCode, 0);
      assert.strictEqual((await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'verbose-c@1.0.0'], testDir)).exitCode, 0);

      const run = (args: string[]) => runE3Command(['dataflow', 'run', repoDir, 'ws', ...args], testDir, { env: runEnv });
      const logs = () => runE3Command(['task', 'logs', repoDir, 'ws.doubled'], testDir);

      // --- run 1: first execution (no -v) -----------------------------------
      const first = await run([]);
      assert.strictEqual(first.exitCode, 0, `run 1 failed: ${first.stderr}\n${first.stdout}`);
      assert.match(first.stdout, /\[DONE\] doubled/, `run 1 should execute the task:\n${first.stdout}`);

      // control: a no-verbose execution's logs carry NO timing block.
      const quietLogs = await logs();
      assert.doesNotMatch(quietLogs.stdout, /^Timing:$/m,
        `logs must have no verbose block after a no-v run:\n${quietLogs.stdout}`);

      // --- run 2: -v, NO force → must be CACHED (the cache-safety proof) -----
      const cached = await run(['-v']);
      assert.strictEqual(cached.exitCode, 0, `run 2 failed: ${cached.stderr}\n${cached.stdout}`);
      assert.match(cached.stdout, /\[CACHED\] doubled/,
        `-v must NOT bust the cache — the task should be CACHED:\n${cached.stdout}`);

      // --- run 3: -v --force → spawns again; verbose reaches the logs --------
      const forced = await run(['-v', '--force']);
      assert.strictEqual(forced.exitCode, 0, `run 3 failed: ${forced.stderr}\n${forced.stdout}`);
      assert.match(forced.stdout, /\[DONE\] doubled/, `run 3 should re-execute:\n${forced.stdout}`);

      const verboseLogs = await logs();
      assert.strictEqual(verboseLogs.exitCode, 0, `logs failed: ${verboseLogs.stderr}`);
      // The runner's canonical verbose block, captured by e3 into the task logs.
      for (const re of [/^Running: /m, /^Timing:$/m, /^ {2}Execute: +\d+\.\d ms$/m, /^ {2}Peak RSS: +\d+\.\d MB$/m]) {
        assert.match(verboseLogs.stdout, re, `-v output must reach the task logs (${re}):\n${verboseLogs.stdout}`);
      }
    });
});
