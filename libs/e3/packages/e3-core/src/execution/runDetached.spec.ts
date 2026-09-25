/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the graph-free execution primitive (runDetached) and the
 * persistence-free process helpers it composes.
 *
 * Functions run on the real east-node runner, which e3-core's tests reach
 * through its node_modules: a value returned inline, a collection spliced back
 * from the manifest `exec` writes, a failure, and the size cap. A fake runner
 * planted in a temp node_modules/.bin, and reached via runnerSearchDir, drives
 * what depends only on the process: the command line and the stdin lifeline,
 * a runner that writes nothing, and slow runs.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  DictType, East, IntegerType, StringType,
  decodeBeast2For, encodeBeast2For, encodeEastIR, readBeast2Extents, variant,
} from '@elaraai/east';
import { collectVenvBins, spawnAndCapture } from './processExec.js';
import { runDetached } from './runDetached.js';

const isWindows = process.platform === 'win32';
const venvBinSubdir = isWindows ? 'Scripts' : 'bin';

/**
 * Plants an executable `name` in `binDir` running the node script `js`: a
 * `#!/usr/bin/env node` file on POSIX; on Windows, where a script is no
 * executable, the script beside a `.cmd` shim — the shape pnpm gives the real
 * runners' bins, run through cmd.exe.
 *
 * @returns The path to run it by
 */
function plantNodeBin(binDir: string, name: string, js: string): string {
  if (isWindows) {
    writeFileSync(path.join(binDir, `${name}.cjs`), js);
    writeFileSync(path.join(binDir, `${name}.cmd`), `@node "%~dp0\\${name}.cjs" %*\r\n`);
    return path.join(binDir, `${name}.cmd`);
  }
  writeFileSync(path.join(binDir, name), `#!/usr/bin/env node\n${js}`, { mode: 0o755 });
  return path.join(binDir, name);
}

/** Plants an executable `name` in `binDir` that prints `text`. */
function plantEcho(binDir: string, name: string, text: string): void {
  if (isWindows) writeFileSync(path.join(binDir, `${name}.cmd`), `@echo ${text}\r\n`);
  else writeFileSync(path.join(binDir, name), `#!/bin/sh\necho ${text}\n`, { mode: 0o755 });
}

/** A node script printing whether its stdin is a pipe — neither a
 *  character device (an ignored stdin is the null device) nor a file. */
const STDIN_IS_PIPE = 'const s = require("fs").fstatSync(0); process.stdout.write(String(!s.isCharacterDevice() && !s.isFile()))';

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

// A fake `east-py` planted in BOTH a project's `.venv/bin` (`.venv/Scripts`
// on Windows) and its `node_modules/.bin` proves the PATH ordering: the venv
// binary must win.
describe('venv PATH precedence', () => {
  let proj: string;
  let scratch: string;

  before(() => {
    proj = mkdtempSync(path.join(tmpdir(), 'e3-venv-path-'));
    scratch = mkdtempSync(path.join(tmpdir(), 'e3-venv-scratch-'));
    const venvBin = path.join(proj, '.venv', venvBinSubdir);
    const nmBin = path.join(proj, 'node_modules', '.bin');
    mkdirSync(venvBin, { recursive: true });
    mkdirSync(nmBin, { recursive: true });
    plantEcho(venvBin, 'east-py', 'FROM_VENV');
    plantEcho(nmBin, 'east-py', 'FROM_NODE_MODULES');
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
      plantEcho(nmBin, 'east-py', 'FROM_NODE_MODULES');
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
describe('E3_RUNNER_SEARCH_DIRS propagation', () => {
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

describe('spawnAndCapture', () => {
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
    assert.equal(result.stoppedByE3, true);
    // A stop is Node's own kill — of the process group on POSIX, of the job
    // launcher on Windows — reported as the signal it sent.
    assert.equal(result.signal, 'SIGKILL');
    assert.notEqual(result.exitCode, 0);
    assert.ok(Date.now() - start < 10_000, 'timeout did not kill the process promptly');
  });

  it('reports the signal that ended a process, and whether this process sent it', async () => {
    const exited = await spawnAndCapture(['node', '-e', 'process.exit(0)'], scratch);
    assert.equal(exited.signal, null);
    assert.equal(exited.stoppedByE3, false);

    const abort = new AbortController();
    const aborted = await spawnAndCapture(['node', '-e', 'setTimeout(() => {}, 30000);'], scratch, {
      signal: abort.signal,
      onSpawned: () => abort.abort(),
    });
    // Node's own kill, on every platform (see the timeout test above).
    assert.equal(aborted.exitCode, null);
    assert.equal(aborted.signal, 'SIGKILL');
    assert.equal(aborted.stoppedByE3, true);
    assert.equal(aborted.timedOut, false);
  });

  it('does not take a signal from elsewhere for a stop by e3', { skip: isWindows ? 'Windows has no signals: a process ended from elsewhere leaves only its exit code' : false }, async () => {
    const signalled = await spawnAndCapture(['node', '-e', 'process.kill(process.pid, "SIGTERM"); setTimeout(() => {}, 30000);'], scratch);
    assert.equal(signalled.exitCode, null);
    assert.equal(signalled.signal, 'SIGTERM');
    assert.equal(signalled.stoppedByE3, false, 'a signal from elsewhere is not a stop by e3');
  });

  it('gives the child a stdin lifeline pipe only when asked', async () => {
    // The lifeline is the pipe and the `--exit-with-parent` flag the caller
    // splices into the argv — nothing rides the environment.
    const withLifeline = await spawnAndCapture(['node', '-e', STDIN_IS_PIPE], scratch, { stdinLifeline: true });
    assert.equal(withLifeline.stdoutTail, 'true', withLifeline.stderrTail);
    const without = await spawnAndCapture(['node', '-e', STDIN_IS_PIPE], scratch);
    assert.equal(without.stdoutTail, 'false', without.stderrTail);
  });

  it('hands the callbacks whole characters however the output is split', async () => {
    // Three-byte characters written seven bytes at a time, pausing between
    // writes, so the pipe's reads end inside characters.
    const text = '€'.repeat(300);
    const writer = [
      `const bytes = Buffer.from(${JSON.stringify(text)});`,
      'const pause = new Int32Array(new SharedArrayBuffer(4));',
      'for (let i = 0; i < bytes.length; i += 7) { process.stdout.write(bytes.subarray(i, i + 7)); Atomics.wait(pause, 0, 0, 2); }',
    ].join('\n');
    const chunks: string[] = [];
    const result = await spawnAndCapture(['node', '-e', writer], scratch, { onStdout: (data) => { chunks.push(data); } });
    assert.equal(result.exitCode, 0);
    assert.ok(chunks.every((chunk) => !chunk.includes('�')), 'no chunk carries a split character');
    assert.equal(chunks.join(''), text);
  });

  it('pauses a stream while its callback holds more than maxPendingBytes, and resumes it', async () => {
    const total = 4 * 1024 * 1024;
    const cap = 256 * 1024;
    // A slow consumer: nothing settles until more than the cap is pending,
    // and then everything settles on a later turn.
    const outstanding: { bytes: number; settle: () => void }[] = [];
    let pending = 0;
    let peak = 0;
    let largestChunk = 0;
    let received = 0;
    const result = await spawnAndCapture(
      ['node', '-e', `process.stdout.write(Buffer.alloc(${total}, 120))`],
      scratch,
      {
        maxPendingBytes: cap,
        onStdout: (data) => new Promise<void>((settle) => {
          const bytes = Buffer.byteLength(data);
          received += bytes;
          largestChunk = Math.max(largestChunk, bytes);
          pending += bytes;
          peak = Math.max(peak, pending);
          outstanding.push({ bytes, settle });
          if (pending > cap) {
            setTimeout(() => {
              for (const chunk of outstanding.splice(0)) {
                pending -= chunk.bytes;
                chunk.settle();
              }
            }, 0);
          }
        }),
      },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(received, total, 'every byte reaches the callback once the stream resumes');
    assert.ok(peak <= cap + largestChunk, `pending bytes peaked at ${peak}, over the cap ${cap} plus one chunk ${largestChunk}`);
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

describe('runDetached', () => {
  let searchDir: string;

  const limits = { timeoutMs: 60_000, maxResultBytes: 1024, maxLogBytes: 64 * 1024 };
  const runner = variant('east_node', { platforms: [] as string[] });
  const encodeInt = encodeBeast2For(IntegerType);
  const TableType = DictType(IntegerType, IntegerType);
  // A table of `n` rows, keyed 0 to n - 1, each valued twice its key.
  const table = encodeEastIR(East.function([IntegerType], TableType,
    ($, n) => East.Dict.generate(n, IntegerType, IntegerType, ($, i) => i, ($, i) => i.multiply(2n))).toIR());

  // A fake runner for what depends only on the process. Behaviour is selected
  // by FAKE_RUNNER_MODE (inherited env):
  //   sleep     - sleep 30 s
  //   silent-ok - exit 0 without writing the output
  const FAKE_RUNNER = `const mode = process.env.FAKE_RUNNER_MODE;
if (mode === 'sleep') setTimeout(() => {}, 30000);
`;

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
    plantNodeBin(binDir, 'east-node', FAKE_RUNNER);
  });

  after(() => {
    rmSync(searchDir, { recursive: true, force: true });
  });

  it('runs a function as a unit and returns its value inline', async () => {
    const add = East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b));
    const result = await runDetached({ bodyIr: encodeEastIR(add.toIR()), args: [encodeInt(2n), encodeInt(3n)], runner, limits });
    assert.equal(result.kind, 'success', result.stderr);
    assert.equal(decodeBeast2For(IntegerType)((result as { value: Uint8Array }).value), 5n);
  });

  it('splices a collection result back into one blob, over any number of segments', async () => {
    // `exec` writes a collection as a manifest naming its segments; the call
    // returns the value they splice into, and an empty one names none.
    for (const rows of [0n, 3n, 10_000n]) {
      const result = await runDetached({ bodyIr: table, args: [encodeInt(rows)], runner, limits: { ...limits, maxResultBytes: 1 << 24 } });
      assert.equal(result.kind, 'success', result.stderr);
      const value = (result as { value: Uint8Array }).value;
      const dict = decodeBeast2For(TableType)(value);
      assert.equal(dict.size, Number(rows));
      if (rows > 0n) assert.equal(dict.get(rows - 1n), 2n * (rows - 1n));
      if (rows === 10_000n) {
        assert.ok(readBeast2Extents(value).offsets.length > 1, 'ten thousand rows span several segments');
      }
    }
  });

  it('reports a failure as failed, with the runner\'s error on stderr', async () => {
    const lookup = East.function([IntegerType], IntegerType, ($, x) => $.error(East.str`no price for ${x}`));
    const result = await runDetached({ bodyIr: encodeEastIR(lookup.toIR()), args: [encodeInt(7n)], runner, limits });
    assert.equal(result.kind, 'failed');
    assert.equal((result as { exitCode: number }).exitCode, 1);
    assert.match(result.stderr, /no price for 7/);
  });

  it('fails closed with too_large when the value exceeds maxResultBytes, and never loads it', async () => {
    // Random characters, which the output's deflate cannot shrink under the cap.
    const echo = East.function([StringType], StringType, ($, s) => s);
    const value = await runDetached({
      bodyIr: encodeEastIR(echo.toIR()),
      args: [encodeBeast2For(StringType)(randomBytes(3072).toString('base64'))],
      runner,
      limits: { ...limits, maxResultBytes: 1024 },
    });
    assert.equal(value.kind, 'too_large', value.stderr);
    assert.ok((value as { bytes: number }).bytes > 1024);
    assert.equal((value as { limit: number }).limit, 1024);

    // A collection is sized by the segments its manifest names: fifty thousand
    // rows take far more than 16 KiB, in some fifty segments whose manifest
    // takes far less.
    const collection = await runDetached({ bodyIr: table, args: [encodeInt(50_000n)], runner, limits: { ...limits, maxResultBytes: 16 * 1024 } });
    assert.equal(collection.kind, 'too_large', collection.stderr);
    assert.ok((collection as { bytes: number }).bytes > 16 * 1024);
  });

  it('cleans up its scratch directory', async () => {
    const before = readdirSync(tmpdir()).filter((d) => d.startsWith('e3-call-')).length;
    const result = await runDetached({ bodyIr: table, args: [encodeInt(3n)], runner, limits });
    assert.equal(result.kind, 'success', result.stderr);
    const after = readdirSync(tmpdir()).filter((d) => d.startsWith('e3-call-')).length;
    assert.ok(after <= before, 'scratch directory leaked');
  });

  it('runs a stock runner\'s exec with the lifeline flag and pipe, and a custom command with run\'s arguments', async () => {
    // The fake reports its arguments by file name and whether stdin is a
    // pipe, and writes an output where each form puts it: after `-o`, or
    // beside the unit.
    const reporter = plantNodeBin(path.join(searchDir, 'node_modules', '.bin'), 'east-c', [
      'const fs = require("fs");',
      'const path = require("path");',
      'const args = process.argv.slice(2);',
      'const s = fs.fstatSync(0);',
      'const o = args.indexOf("-o");',
      'const unit = args.find((a) => a.endsWith("unit.beast2"));',
      'fs.writeFileSync(o >= 0 ? args[o + 1] : path.join(path.dirname(unit), "output.beast2"), Buffer.from([1]));',
      'process.stdout.write(args.map((a) => path.basename(a)).join(" ") + " | stdin pipe " + (!s.isCharacterDevice() && !s.isFile()));',
    ].join('\n'));
    const stock = await runDetached(
      { bodyIr: new Uint8Array([0]), args: [encodeInt(1n)], runner: variant('east_c', { platforms: [] }), limits },
      { runnerSearchDir: searchDir },
    );
    assert.equal(stock.kind, 'success', stock.stderr);
    assert.equal(stock.stdout, 'exec --exit-with-parent unit.beast2 | stdin pipe true');
    const verbose = await runDetached(
      { bodyIr: new Uint8Array([0]), args: [], runner: variant('east_c', { platforms: [] }), limits },
      { runnerSearchDir: searchDir, verbose: true },
    );
    assert.equal(verbose.stdout, 'exec --exit-with-parent unit.beast2 -v | stdin pipe true');
    const custom = await runDetached(
      { bodyIr: new Uint8Array([0]), args: [encodeInt(1n)], runner: variant('custom', { command: [reporter, 'run'] }), limits },
      { runnerSearchDir: searchDir, verbose: true },
    );
    assert.equal(custom.kind, 'success', custom.stderr);
    assert.equal(custom.stdout, 'run -i input-0.beast2 -o output.beast2 program.beast2 | stdin pipe false');
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
    // A stopped call fails with exit code -1 on every platform.
    assert.equal(result.kind, 'failed');
    assert.equal((result as { exitCode: number }).exitCode, -1);
  });
});
