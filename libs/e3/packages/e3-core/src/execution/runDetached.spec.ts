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
import { buildRunnerArgv, marshalBytesToDir, spawnAndCapture } from './processExec.js';
import { runDetached } from './runDetached.js';

const isWindows = process.platform === 'win32';

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
