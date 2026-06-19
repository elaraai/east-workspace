/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the graph-free execution primitive (runDetached) and the
 * persistence-free process helpers it composes.
 *
 * A fake `east-node` runner script (planted in a temp node_modules/.bin and
 * reached via runnerSearchDir) drives the runner-facing behaviour
 * deterministically: echo, oversized output, non-zero exit, slow runs.
 * End-to-end runs against the real east-node runner live in e3-api-tests.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { variant } from '@elaraai/east';
import { buildRunnerArgv, collectVenvBins, marshalBytesToDir, spawnAndCapture } from './processExec.js';
import { runDetached } from './runDetached.js';

const isWindows = process.platform === 'win32';
const venvBinSubdir = isWindows ? 'Scripts' : 'bin';

describe('buildRunnerArgv', () => {
  it('builds the runner argv from the wire variant', () => {
    const argv = buildRunnerArgv(
      variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
      ['/tmp/a.beast2', '/tmp/b.beast2'],
      '/tmp/out.beast2',
      '/tmp/fn.beast2'
    );
    assert.deepEqual(argv, [
      'east-node', 'run', '-p', '@elaraai/east-node-std',
      '-i', '/tmp/a.beast2', '-i', '/tmp/b.beast2',
      '-o', '/tmp/out.beast2',
      '/tmp/fn.beast2',
    ]);
  });

  it('maps each runtime tag to its binary name', () => {
    assert.equal(buildRunnerArgv(variant('east_py', { platforms: [] }), [], 'o', 'f')[0], 'east-py');
    assert.equal(buildRunnerArgv(variant('east_c', { platforms: [] }), [], 'o', 'f')[0], 'east-c');
  });
});

describe('marshalBytesToDir', () => {
  it('stages each blob as input-<i>.beast2 in order', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'e3-marshal-'));
    try {
      const paths = await marshalBytesToDir(dir, [new Uint8Array([1]), new Uint8Array([2, 3])]);
      assert.deepEqual(paths.map((p) => path.basename(p)), ['input-0.beast2', 'input-1.beast2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('collectVenvBins', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'e3-venv-'));
    // Plant both layouts so the assertion is platform-agnostic — only the
    // current platform's subdir should be returned.
    mkdirSync(path.join(root, '.venv', 'bin'), { recursive: true });
    mkdirSync(path.join(root, '.venv', 'Scripts'), { recursive: true });
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the platform venv bin dir for a project root', () => {
    assert.deepEqual(collectVenvBins(root), [path.join(root, '.venv', venvBinSubdir)]);
  });

  it('walks up to find an ancestor .venv', () => {
    const nested = path.join(root, 'a', 'b', 'c');
    assert.deepEqual(collectVenvBins(nested), [path.join(root, '.venv', venvBinSubdir)]);
  });

  it('returns [] when no .venv exists above the start dir', () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'e3-no-venv-'));
    try {
      assert.deepEqual(collectVenvBins(bare), []);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

// A fake `east-py` planted in BOTH a project's `.venv/bin` and its
// `node_modules/.bin` proves the PATH ordering: the venv binary must win.
// Skipped on Windows where these POSIX shell shims are not executable (the
// venv-bin/shim precedence is exercised by collectVenvBins above + CI runners).
describe('venv PATH precedence', { skip: isWindows }, () => {
  let proj: string;
  let scratch: string;

  before(() => {
    proj = mkdtempSync(path.join(tmpdir(), 'e3-venv-path-'));
    scratch = mkdtempSync(path.join(tmpdir(), 'e3-venv-scratch-'));
    const venvBin = path.join(proj, '.venv', 'bin');
    const nmBin = path.join(proj, 'node_modules', '.bin');
    mkdirSync(venvBin, { recursive: true });
    mkdirSync(nmBin, { recursive: true });
    writeFileSync(path.join(venvBin, 'east-py'), '#!/bin/sh\necho FROM_VENV\n', { mode: 0o755 });
    writeFileSync(path.join(nmBin, 'east-py'), '#!/bin/sh\necho FROM_NODE_MODULES\n', { mode: 0o755 });
  });

  after(() => {
    rmSync(proj, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  it('resolves east-py from .venv/bin ahead of node_modules/.bin', async () => {
    const result = await spawnAndCapture(['east-py'], scratch, { searchDirs: [proj] });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdoutTail, /FROM_VENV/);
    assert.doesNotMatch(result.stdoutTail, /FROM_NODE_MODULES/);
  });

  it('falls back to node_modules/.bin when there is no venv binary', async () => {
    const nmOnly = mkdtempSync(path.join(tmpdir(), 'e3-nm-only-'));
    try {
      const nmBin = path.join(nmOnly, 'node_modules', '.bin');
      mkdirSync(nmBin, { recursive: true });
      writeFileSync(path.join(nmBin, 'east-py'), '#!/bin/sh\necho FROM_NODE_MODULES\n', { mode: 0o755 });
      const result = await spawnAndCapture(['east-py'], scratch, { searchDirs: [nmOnly] });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdoutTail, /FROM_NODE_MODULES/);
    } finally {
      rmSync(nmOnly, { recursive: true, force: true });
    }
  });
});

// e3 spawns runners in a scratch cwd, so it must hand the project root to the
// runner another way: the E3_RUNNER_SEARCH_DIRS env var (read by east-node-cli's
// loader to self-resolve a project's own platform package).
describe('E3_RUNNER_SEARCH_DIRS propagation', { skip: isWindows }, () => {
  let scratch: string;
  before(() => { scratch = mkdtempSync(path.join(tmpdir(), 'e3-envprop-')); });
  after(() => { rmSync(scratch, { recursive: true, force: true }); });

  it('passes the (deduped) searchDirs to the child via E3_RUNNER_SEARCH_DIRS', async () => {
    const result = await spawnAndCapture(
      ['node', '-e', 'process.stdout.write(process.env.E3_RUNNER_SEARCH_DIRS || "UNSET")'],
      scratch,
      { searchDirs: ['/proj/a', '/proj/a', '/proj/b'] },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdoutTail, ['/proj/a', '/proj/b'].join(path.delimiter));
  });

  it('leaves E3_RUNNER_SEARCH_DIRS unset when no searchDirs are given', async () => {
    const result = await spawnAndCapture(
      ['node', '-e', 'process.stdout.write(process.env.E3_RUNNER_SEARCH_DIRS || "UNSET")'],
      scratch,
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdoutTail, 'UNSET');
  });
});

describe('spawnAndCapture', { skip: isWindows }, () => {
  let scratch: string;

  before(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'e3-spawn-'));
  });

  after(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('captures exit code 0 and stdout', async () => {
    const result = await spawnAndCapture(
      ['node', '-e', 'console.log("hello out"); console.error("hello err");'],
      scratch
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.error, null);
    assert.equal(result.timedOut, false);
    assert.match(result.stdoutTail, /hello out/);
    assert.match(result.stderrTail, /hello err/);
    assert.equal(result.stdoutTruncated, false);
  });

  it('reports a non-zero exit with the stderr tail in the error', async () => {
    const result = await spawnAndCapture(
      ['node', '-e', 'console.error("boom"); process.exit(3);'],
      scratch
    );
    assert.equal(result.exitCode, 3);
    assert.match(result.error ?? '', /Exit code: 3/);
    assert.match(result.error ?? '', /boom/);
  });

  it('bounds stream tails and sets truncated flags', async () => {
    const result = await spawnAndCapture(
      ['node', '-e', 'process.stdout.write("x".repeat(5000));'],
      scratch,
      { maxLogBytes: 100 }
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdoutTail.length, 100);
    assert.equal(result.stdoutTruncated, true);
  });

  it('kills the process group on timeout', async () => {
    const start = Date.now();
    const result = await spawnAndCapture(
      ['node', '-e', 'setTimeout(() => {}, 30000);'],
      scratch,
      { timeoutMs: 300 }
    );
    assert.equal(result.timedOut, true);
    assert.notEqual(result.exitCode, 0);
    assert.ok(Date.now() - start < 10_000, 'timeout did not kill the process promptly');
  });

  it('reports spawn failures as an error with null exit code', async () => {
    const result = await spawnAndCapture(
      ['definitely-not-a-real-binary-xyz', 'run'],
      scratch
    );
    assert.equal(result.exitCode, null);
    assert.match(result.error ?? '', /Failed to spawn/);
  });
});

describe('runDetached', { skip: isWindows }, () => {
  let searchDir: string;

  // A fake `east-node` runner with the real CLI contract:
  //   east-node run [-p name]... [-i input]... -o output <bodyIr>
  // Behaviour is selected by FAKE_RUNNER_MODE (inherited env):
  //   echo (default) - copy input-0 (or the bodyIr) to the output
  //   big            - write 4 KiB to the output
  //   fail           - print to stderr, exit 3, no output
  //   sleep          - sleep 30 s
  //   silent-ok      - exit 0 WITHOUT writing the output file
  const FAKE_RUNNER = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const inputs = [];
let output = null;
let bodyIr = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === 'run') continue;
  else if (args[i] === '-p') i++;
  else if (args[i] === '-i') inputs.push(args[++i]);
  else if (args[i] === '-o') output = args[++i];
  else bodyIr = args[i];
}
const mode = process.env.FAKE_RUNNER_MODE || 'echo';
if (mode === 'fail') { console.error('fake runner failure'); process.exit(3); }
if (mode === 'sleep') { setTimeout(() => {}, 30000); }
else if (mode === 'big') { fs.writeFileSync(output, Buffer.alloc(4096, 7)); }
else if (mode === 'silent-ok') { /* exit 0, no output */ }
else { fs.copyFileSync(inputs[0] ?? bodyIr, output); }
`;

  const limits = { timeoutMs: 60_000, maxResultBytes: 1024, maxLogBytes: 64 * 1024 };
  const runner = variant('east_node', { platforms: [] as string[] });

  const withMode = async <T>(mode: string | undefined, fn: () => Promise<T>): Promise<T> => {
    const prev = process.env.FAKE_RUNNER_MODE;
    if (mode === undefined) delete process.env.FAKE_RUNNER_MODE;
    else process.env.FAKE_RUNNER_MODE = mode;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.FAKE_RUNNER_MODE;
      else process.env.FAKE_RUNNER_MODE = prev;
    }
  };

  before(() => {
    searchDir = mkdtempSync(path.join(tmpdir(), 'e3-fake-runner-'));
    const binDir = path.join(searchDir, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, 'east-node'), FAKE_RUNNER, { mode: 0o755 });
  });

  after(() => {
    rmSync(searchDir, { recursive: true, force: true });
  });

  it('returns the output bytes inline on success', async () => {
    const payload = new Uint8Array([10, 20, 30]);
    const result = await withMode(undefined, () => runDetached(
      { bodyIr: new Uint8Array([0]), args: [payload], runner, limits },
      { runnerSearchDir: searchDir }
    ));
    assert.equal(result.kind, 'success');
    assert.deepEqual(new Uint8Array((result as { value: Uint8Array }).value), payload);
  });

  it('cleans up its scratch directory', async () => {
    const before = readdirSync(tmpdir()).filter((d) => d.startsWith('e3-call-')).length;
    await withMode(undefined, () => runDetached(
      { bodyIr: new Uint8Array([0]), args: [new Uint8Array([1])], runner, limits },
      { runnerSearchDir: searchDir }
    ));
    const after = readdirSync(tmpdir()).filter((d) => d.startsWith('e3-call-')).length;
    assert.ok(after <= before, 'scratch directory leaked');
  });

  it('fails closed with too_large when the output exceeds maxResultBytes', async () => {
    const result = await withMode('big', () => runDetached(
      { bodyIr: new Uint8Array([0]), args: [], runner, limits: { ...limits, maxResultBytes: 100 } },
      { runnerSearchDir: searchDir }
    ));
    assert.equal(result.kind, 'too_large');
    const tooLarge = result as { bytes: number; limit: number };
    assert.equal(tooLarge.bytes, 4096);
    assert.equal(tooLarge.limit, 100);
  });

  it('reports non-zero exits as failed with the stderr tail', async () => {
    const result = await withMode('fail', () => runDetached(
      { bodyIr: new Uint8Array([0]), args: [], runner, limits },
      { runnerSearchDir: searchDir }
    ));
    assert.equal(result.kind, 'failed');
    assert.equal((result as { exitCode: number }).exitCode, 3);
    assert.match(result.stderr, /fake runner failure/);
  });

  it('reports exit-0-without-output as failed', async () => {
    const result = await withMode('silent-ok', () => runDetached(
      { bodyIr: new Uint8Array([0]), args: [], runner, limits },
      { runnerSearchDir: searchDir }
    ));
    assert.equal(result.kind, 'failed');
    assert.match(result.stderr, /no output file/);
  });

  it('times out long runs via process-group kill', async () => {
    const result = await withMode('sleep', () => runDetached(
      { bodyIr: new Uint8Array([0]), args: [], runner, limits: { ...limits, timeoutMs: 300 } },
      { runnerSearchDir: searchDir }
    ));
    assert.equal(result.kind, 'timed_out');
    assert.equal((result as { ms: number }).ms, 300);
  });

  it('is cancellable via AbortSignal', async () => {
    const abort = new AbortController();
    const promise = withMode('sleep', () => runDetached(
      { bodyIr: new Uint8Array([0]), args: [], runner, limits },
      { runnerSearchDir: searchDir, signal: abort.signal }
    ));
    setTimeout(() => abort.abort(), 200);
    const result = await promise;
    // Killed by signal → non-success; exact kind is failed (exit by signal)
    assert.notEqual(result.kind, 'success');
  });
});
