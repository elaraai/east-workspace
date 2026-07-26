/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Error source locations across every runner.
 *
 * When an East program fails at runtime — either an East IR error (e.g. an
 * out-of-bounds index) or a plain error thrown inside a custom platform
 * function — the runner must surface the **source-mapped stack**, not just the
 * message. The East IR carries a `source_map`, so every runner (east-c,
 * east-node, east-py) resolves the failing expression back to a `file:line:col`
 * location. This suite runs each runner on the same erroring programs and
 * asserts the resolved location appears in the error output.
 *
 * Regression guard: east-node-cli used to print only `err.message` for a
 * non-East error (what a throwing platform function produces), dropping the
 * whole stack — so a platform crash had NO location. See the
 * `throwing platform function` case.
 *
 * Self-contained: it locates the built runner binaries and symlinks the built
 * `@elaraai/east` + `@elaraai/east-node-std` into a scratch `node_modules` so
 * the east-node runner resolves its stdlib without a global `make link`. Each
 * runner self-skips when its binary/venv is not built.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, existsSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { East, IntegerType, ArrayType, encodeEastIR, encodeBeast2For } from '@elaraai/east';

// From dist/error-locations.spec.js: dist → integration → test → e3 → libs → root.
const WS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const EAST_DIST = join(WS, 'libs', 'east');
const EAST_NODE_STD = join(WS, 'libs', 'east-node', 'packages', 'east-node-std');

/** Runner invocations, each self-skipping when the binary/venv is absent. */
const EAST_C = join(WS, 'libs', 'east-c', 'build', 'packages', 'east-c-cli', 'east-c');
const EAST_NODE_BIN = join(WS, 'libs', 'east-node', 'packages', 'east-node-cli', 'bin', 'east-node.mjs');
const EAST_PY = join(WS, 'libs', 'east-py', '.venv', 'bin', 'east-py');

let dir: string;              // scratch dir with IRs, inputs, platforms
let searchDir: string;        // E3_RUNNER_SEARCH_DIRS root (node_modules with stdlib + platform)
let boomNodePkg: string;      // node platform package name
let boomPyModule: string;     // python platform module name

/** Run a runner and return its combined stderr+stdout (the error text on failure). */
function runRunner(cmd: string, args: string[], env: Record<string, string> = {}): string {
  try {
    execFileSync(cmd, args, { encoding: 'utf-8', stdio: 'pipe', env: { ...process.env, ...env } });
    return ''; // no error
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
  }
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'e3-errloc-'));

  // A scratch node_modules so the east-node runner resolves @elaraai/east +
  // @elaraai/east-node-std + our throwing platform package by name.
  searchDir = join(dir, 'search');
  const nm = join(searchDir, 'node_modules', '@elaraai');
  mkdirSync(nm, { recursive: true });
  if (existsSync(EAST_DIST)) symlinkSync(EAST_DIST, join(nm, 'east'), 'dir');
  if (existsSync(EAST_NODE_STD)) symlinkSync(EAST_NODE_STD, join(nm, 'east-node-std'), 'dir');

  // --- East IR runtime error: out-of-bounds index (authored HERE) ----------
  const oob = East.function([IntegerType], IntegerType, ($, i) => {
    const arr = $.const([1n, 2n, 3n], ArrayType(IntegerType));
    return arr.get(i.add(10n));               // out of bounds at runtime
  });
  writeFileSync(join(dir, 'oob.beast2'), encodeEastIR(oob.toIR()));
  writeFileSync(join(dir, 'in.beast2'), encodeBeast2For(IntegerType)(5n));

  // --- Throwing custom platform (node): a plain Error from platform code ----
  boomNodePkg = '@errtest/boom';
  const boomDir = join(searchDir, 'node_modules', '@errtest', 'boom');
  mkdirSync(boomDir, { recursive: true });
  writeFileSync(join(boomDir, 'package.json'), JSON.stringify({
    name: boomNodePkg, type: 'module',
    exports: { './platform': './platform.mjs', './package.json': './package.json' },
  }));
  writeFileSync(join(boomDir, 'platform.mjs'),
    `import { East, IntegerType } from '@elaraai/east';\n` +
    `const boom = East.platform('boom.fn', [IntegerType], IntegerType);\n` +
    `export default [boom.implement((x) => { throw new Error('kaboom from the node platform'); })];\n`);

  // --- Raising custom platform (python) ------------------------------------
  boomPyModule = 'boom_platform';
  writeFileSync(join(dir, `${boomPyModule}.py`),
    `from east.runtime.platform import platform_function, platform_functions\n` +
    `from east.types.types import IntegerType\n\n\n` +
    `@platform_function(inputs=[IntegerType], output=IntegerType, name="boom.fn")\n` +
    `def fn(x):\n    raise ValueError("kaboom from the python platform")\n\n\n` +
    `boom_impl = platform_functions(__name__)\nplatform = [*boom_impl]\n`);

  // An IR that calls boom.fn (shared by the node + python platform cases).
  const boom = East.platform('boom.fn', [IntegerType], IntegerType);
  const callsBoom = East.function([IntegerType], IntegerType, ($, i) => boom(i));
  writeFileSync(join(dir, 'callboom.beast2'), encodeEastIR(callsBoom.toIR()));
});

/** A resolved location looks like `<file>:<line>:<col>` (an `at …:12:5` frame). */
const LOCATION = /:\d+:\d+/;

/** The `at <file>:<line>:<col>` frames of a runner's error output, innermost first. */
function stackFrames(out: string): string[] {
  return [...out.matchAll(/^\s*at\s+(\S.*:\d+:\d+)\s*$/gm)].map(m => m[1]!);
}

/**
 * Every runner must resolve an East IR runtime error identically: the message,
 * then a stack that descends past the enclosing East function to the operation
 * that actually threw.
 *
 * Two frames IS that property — one would mean the stack stopped at the
 * function entry and never reached the failing op. (This replaces a grep for
 * the literal word "array", which no runner emits: frames carry the file that
 * authored the IR, so it only ever matched if that file was itself named
 * something like `array.ts`.)
 */
function assertOutOfBoundsError(out: string, runner: string): void {
  assert.match(out, /Array index \d+ out of bounds/, `${runner}: the message is present`);
  assert.match(out, LOCATION, `${runner}: the error must carry a source location, got:\n${out}`);
  const frames = stackFrames(out);
  assert.ok(frames.length >= 2,
    `${runner}: the stack should reach the array op frame, got:\n${out}`);
  assert.match(frames[0]!, /error-locations\.spec\./,
    `${runner}: the innermost frame is where the array op was authored, got:\n${out}`);
}

// ===========================================================================
// east-c
// ===========================================================================
describe('error locations — east-c runner', () => {
  const has = existsSync(EAST_C);

  it('an East IR runtime error resolves to a source location',
    { skip: has ? false : 'east-c not built' }, () => {
      const out = runRunner(EAST_C, ['run', join(dir, 'oob.beast2'), '-p', 'east-c-std', '-i', join(dir, 'in.beast2'), '-o', join(dir, 'o.beast2')]);
      assertOutOfBoundsError(out, 'east-c');
    });
});

// ===========================================================================
// east-node
// ===========================================================================
describe('error locations — east-node runner', () => {
  const has = existsSync(EAST_NODE_BIN) && existsSync(EAST_NODE_STD);
  const nodeArgs = (ir: string, pkg: string) =>
    ['run', join(dir, ir), '-p', pkg, '-i', join(dir, 'in.beast2'), '-o', join(dir, 'o.beast2')];

  it('an East IR runtime error resolves to a source location',
    { skip: has ? false : 'east-node / east-node-std not built' }, () => {
      const out = runRunner('node', [EAST_NODE_BIN, ...nodeArgs('oob.beast2', '@elaraai/east-node-std')], { E3_RUNNER_SEARCH_DIRS: searchDir });
      assertOutOfBoundsError(out, 'east-node');
    });

  it('a throwing custom platform function resolves to the platform source location (regression: was message-only)',
    { skip: has ? false : 'east-node / east-node-std not built' }, () => {
      const out = runRunner('node', [EAST_NODE_BIN, ...nodeArgs('callboom.beast2', boomNodePkg)], { E3_RUNNER_SEARCH_DIRS: searchDir });
      assert.match(out, /kaboom from the node platform/, 'the message is present');
      assert.match(out, LOCATION, `platform error must carry a source location (not message-only), got:\n${out}`);
      assert.match(out, /platform\.mjs/, 'the stack must point at the throwing platform file');
    });
});

// ===========================================================================
// east-py
// ===========================================================================
describe('error locations — east-py runner', () => {
  const has = existsSync(EAST_PY);
  const pyArgs = (ir: string, pkg: string) =>
    ['run', join(dir, ir), '-p', pkg, '-i', join(dir, 'in.beast2'), '-o', join(dir, 'o.beast2')];

  it('an East IR runtime error resolves to a source location',
    { skip: has ? false : 'east-py venv not built' }, () => {
      const out = runRunner(EAST_PY, pyArgs('oob.beast2', 'east-py-std'));
      assertOutOfBoundsError(out, 'east-py');
    });

  it('a raising custom platform function resolves to a source location',
    { skip: has ? false : 'east-py venv not built' }, () => {
      const out = runRunner(EAST_PY, pyArgs('callboom.beast2', boomPyModule), { PYTHONPATH: dir });
      assert.match(out, /kaboom from the python platform/, 'the message is present');
      assert.match(out, LOCATION, `platform error must carry a source location, got:\n${out}`);
    });
});
