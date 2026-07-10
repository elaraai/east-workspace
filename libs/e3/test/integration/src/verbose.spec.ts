/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Runner `-v/--verbose` output — one canonical format across every runner.
 *
 * e3's `-v` flag (on `e3 run` / `e3 dataflow run`) is a runtime toggle that
 * splices `-v` into a known runtime's argv just before spawn (see
 * `withRunnerVerbose` in e3-types). All three runners then print the SAME
 * timing/perf block to **stderr** — east-c/main.c, east-node-cli/runner.ts and
 * east-py-cli/runner.py are kept in lockstep on purpose so tooling and users
 * see identical output regardless of runtime.
 *
 * This suite pins that contract:
 *  - each runner, with `-v`, prints the exact canonical block (and still runs);
 *  - each runner, without `-v`, prints none of it (control: `-v` is the trigger);
 *  - every available runner's verbose output is byte-identical once the
 *    runtime-variable values (paths, sizes, counts, timings) are masked.
 *
 * Self-contained like error-locations.spec.ts: it locates the built runner
 * binaries and symlinks the built `@elaraai/east` + `@elaraai/east-node-std`
 * into a scratch `node_modules`, so the east-node runner resolves its stdlib
 * without a global `make link`. Each runner self-skips when its binary/venv is
 * not built (east-c is the self-contained local baseline; east-node/east-py are
 * additionally covered in CI).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, existsSync, symlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { East, IntegerType, encodeEastIR, encodeBeast2For, decodeBeast2For } from '@elaraai/east';

// From dist/verbose.spec.js: dist → integration → test → e3 → libs → root.
const WS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const EAST_DIST = join(WS, 'libs', 'east');
const EAST_NODE_STD = join(WS, 'libs', 'east-node', 'packages', 'east-node-std');

const EAST_C = join(WS, 'libs', 'east-c', 'build', 'packages', 'east-c-cli', 'east-c');
const EAST_NODE_BIN = join(WS, 'libs', 'east-node', 'packages', 'east-node-cli', 'bin', 'east-node.mjs');
const EAST_PY = join(WS, 'libs', 'east-py', '.venv', 'bin', 'east-py');

let dir: string;         // scratch dir with the IR + input + output
let searchDir: string;   // E3_RUNNER_SEARCH_DIRS root (node_modules with the stdlib)

interface RunResult { status: number | null; stderr: string; }

// spawnSync (not execFileSync): the verbose block goes to STDERR and the runner
// exits 0, so we must capture stderr on SUCCESS — execFileSync only returns
// stdout, silently dropping the very output under test.
function runRunner(cmd: string, args: string[], env: Record<string, string> = {}): RunResult {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', env: { ...process.env, ...env } });
  return { status: r.status, stderr: r.stderr ?? '' };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'e3-verbose-'));

  searchDir = join(dir, 'search');
  const nm = join(searchDir, 'node_modules', '@elaraai');
  mkdirSync(nm, { recursive: true });
  if (existsSync(EAST_DIST)) symlinkSync(EAST_DIST, join(nm, 'east'), 'dir');
  if (existsSync(EAST_NODE_STD)) symlinkSync(EAST_NODE_STD, join(nm, 'east-node-std'), 'dir');

  // A trivial, always-succeeding program: double the input (5 → 10). Verbose
  // output must never depend on the program erroring.
  const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
  writeFileSync(join(dir, 'double.beast2'), encodeEastIR(double.toIR()));
  writeFileSync(join(dir, 'in.beast2'), encodeBeast2For(IntegerType)(5n));
});

/**
 * The exact canonical verbose block, line by line. These regexes are the SAME
 * for every runner — the three CLIs are kept byte-for-byte aligned, so any
 * drift (a renamed label, a changed column) is a red test. A label is followed
 * by `+` spaces because the value is right-justified in a fixed-width field, so
 * its leading-space count tracks the magnitude (not the format).
 */
const CANON: Array<[string, RegExp]> = [
  ['Running header', /^Running: .+\(.+\)$/m],
  ['Platform line', /^Platform: \d+ package\(s\), \d+ function\(s\)$/m],
  ['Function line', /^Function: \d+ inputs, (sync|async)$/m],
  ['Timing header', /^Timing:$/m],
  ['Load timing', /^ {2}Load: +\d+\.\d ms$/m],
  ['Compile timing', /^ {2}Compile: +\d+\.\d ms$/m],
  ['Execute timing', /^ {2}Execute: +\d+\.\d ms$/m],
  ['Output timing', /^ {2}Output: +\d+\.\d ms$/m],
  ['Total timing', /^ {2}Total: +\d+\.\d ms$/m],
  ['Memory header', /^Memory:$/m],
  ['Peak RSS', /^ {2}Peak RSS: +\d+\.\d MB$/m],
];

interface RunnerCase {
  name: string;
  has: boolean;
  argv: (verbose: boolean) => { cmd: string; args: string[]; env?: Record<string, string> };
}

const OUT = () => join(dir, 'out.beast2');
const base = (out: string) => ['run', join(dir, 'double.beast2'), '-i', join(dir, 'in.beast2'), '-o', out];

const CASES: RunnerCase[] = [
  {
    name: 'east-c',
    has: existsSync(EAST_C),
    argv: (v) => ({ cmd: EAST_C, args: [...base(OUT()), '-p', 'east-c-std', ...(v ? ['-v'] : [])] }),
  },
  {
    name: 'east-node',
    has: existsSync(EAST_NODE_BIN) && existsSync(EAST_NODE_STD),
    argv: (v) => ({
      cmd: 'node',
      args: [EAST_NODE_BIN, ...base(OUT()), '-p', '@elaraai/east-node-std', ...(v ? ['-v'] : [])],
      env: { E3_RUNNER_SEARCH_DIRS: searchDir },
    }),
  },
  {
    name: 'east-py',
    has: existsSync(EAST_PY),
    argv: (v) => ({ cmd: EAST_PY, args: [...base(OUT()), '-p', 'east-py-std', ...(v ? ['-v'] : [])] }),
  },
];

/** Replace the runtime-variable parts so only the shared FORMAT remains. */
function maskVariable(s: string): string {
  return s
    .replace(/ +[0-9.]+ (ms|MB|KB)/g, ' <NUM> $1')                 // right-justified timing/mem values
    .replace(/\d+ (package|function|inputs)/g, 'N $1')             // platform/function/input counts
    .replace(/east-c-std|@elaraai\/east-node-std|east-py-std/g, '<PLATFORM>');
}

// ===========================================================================
// Per runner: -v prints the exact canonical block; no -v prints none of it.
// ===========================================================================
describe('runner -v output (canonical format)', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it('-v prints the exact canonical verbose block to stderr (and still runs correctly)',
        { skip: c.has ? false : `${c.name} not built` }, () => {
          const { cmd, args, env } = c.argv(true);
          const r = runRunner(cmd, args, env);
          assert.strictEqual(r.status, 0, `runner should exit 0, stderr:\n${r.stderr}`);

          for (const [label, re] of CANON) {
            assert.match(r.stderr, re, `missing canonical ${label}, stderr:\n${r.stderr}`);
          }
          // Verbose must not corrupt execution: the doubled result is 10.
          assert.strictEqual(decodeBeast2For(IntegerType)(readFileSync(OUT())), 10n);
        });

      it('without -v the verbose block is absent (control: -v is what triggers it)',
        { skip: c.has ? false : `${c.name} not built` }, () => {
          const { cmd, args, env } = c.argv(false);
          const r = runRunner(cmd, args, env);
          assert.strictEqual(r.status, 0, `runner should exit 0, stderr:\n${r.stderr}`);
          assert.doesNotMatch(r.stderr, /^Timing:$/m, `Timing block must be absent without -v:\n${r.stderr}`);
          assert.doesNotMatch(r.stderr, /^Running: /m, `Running header must be absent without -v:\n${r.stderr}`);
          assert.strictEqual(decodeBeast2For(IntegerType)(readFileSync(OUT())), 10n);
        });
    });
  }
});

// ===========================================================================
// Cross-runner: every available runner's verbose output is byte-identical
// once the runtime-variable values are masked. This is the lockstep contract.
// ===========================================================================
describe('runner -v output is identical across runners', () => {
  it('every built runner emits the same masked verbose block', () => {
    const available = CASES.filter((c) => c.has);
    if (available.length < 2) {
      // Nothing to compare against (only east-c local); CI has all three.
      return;
    }
    const masked = available.map((c) => {
      const { cmd, args, env } = c.argv(true);
      const r = runRunner(cmd, args, env);
      assert.strictEqual(r.status, 0, `${c.name} should exit 0, stderr:\n${r.stderr}`);
      return { name: c.name, out: maskVariable(r.stderr) };
    });
    const [ref, ...rest] = masked;
    for (const m of rest) {
      assert.strictEqual(m.out, ref!.out,
        `${m.name} verbose format differs from ${ref!.name}:\n--- ${ref!.name} ---\n${ref!.out}\n--- ${m.name} ---\n${m.out}`);
    }
  });
});
