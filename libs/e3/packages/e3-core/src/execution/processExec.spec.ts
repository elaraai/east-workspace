/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Staging inputs and adopting outputs without reading them (issue #767).
 *
 * Every task execution used to move its inputs and its output through the
 * orchestrator's heap, whole: `objects.read` then `writeFile` per input,
 * `readFile` then `objects.write` for the output. Measured on a 2 GB
 * collection input, the e3 process peaked at 2.1 GB on every run — for bytes
 * the runner then opened lazily anyway.
 *
 * So the properties here are about WHAT TOUCHED WHAT, not about values: a
 * staged input shares the object's storage (or is exactly its bytes), a
 * `custom` runner never gets a link it could write through, an adopted output
 * lands on the hash `objects.write` would have produced, and neither path
 * calls the whole-object read.
 *
 * Real filesystem only — an inode assertion has no meaning against a mock.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { East, FunctionType, IntegerType, NullType, encodeEastIR } from '@elaraai/east';
import { adoptOutputFile, marshalInputsToDir } from './processExec.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import { objectPath } from '../storage/local/localHelpers.js';
import type { ObjectStore, StorageBackend } from '../storage/interfaces.js';

/** Counts the whole-object reads a marshal makes; the point of #767 is that
 *  there are none. */
function countWholeReads(storage: StorageBackend): { reads: () => number } {
  const objects = storage.objects as ObjectStore;
  const original = objects.read.bind(objects);
  let reads = 0;
  objects.read = async (repo: string, hash: string): Promise<Uint8Array> => {
    reads++;
    return original(repo, hash);
  };
  return { reads: () => reads };
}

describe('staging by link or kernel copy', () => {
  let testRepo: string;
  let scratch: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepo = createTestRepo();
    scratch = join(createTempDir(), 'scratch');
    mkdirSync(scratch, { recursive: true });
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
    removeTempDir(join(scratch, '..'));
  });

  /** A stored object of `n` distinguishable bytes. */
  async function store(n: number, fill: number): Promise<{ hash: string; bytes: Uint8Array }> {
    const bytes = new Uint8Array(n).fill(fill);
    return { hash: await storage.objects.write(testRepo, bytes), bytes };
  }

  it('stages inputs without reading an object whole', async () => {
    const a = await store(4096, 0x41);
    const b = await store(2048, 0x42);
    const spy = countWholeReads(storage);

    const paths = await marshalInputsToDir(storage, testRepo, scratch, [a.hash, b.hash]);

    assert.deepEqual(paths, [join(scratch, 'input-0.beast2'), join(scratch, 'input-1.beast2')]);
    assert.deepEqual(readFileSync(paths[0]!), Buffer.from(a.bytes));
    assert.deepEqual(readFileSync(paths[1]!), Buffer.from(b.bytes));
    assert.equal(spy.reads(), 0, 'the whole-object read is what #767 removed');
  });

  it('shares the object\'s storage for a stock runner', async () => {
    const { hash } = await store(4096, 0x43);
    const [staged] = await marshalInputsToDir(storage, testRepo, scratch, [hash]);

    const object = statSync(objectPath(testRepo, hash));
    const input = statSync(staged!);
    // A hard link on one volume, a reflink where the file system has them:
    // either way the bytes were never copied through this process.
    assert.ok(
      (input.ino === object.ino && input.dev === object.dev) || input.size === object.size,
      'the staged input is the object, or exactly its bytes'
    );
  });

  it('never links an input a custom runner could write through', async () => {
    const { hash } = await store(4096, 0x44);
    const [staged] = await marshalInputsToDir(storage, testRepo, scratch, [hash], { link: false });

    const object = statSync(objectPath(testRepo, hash));
    const input = statSync(staged!);
    assert.notEqual(input.ino, object.ino, 'a custom runner gets a copy: it may mv or truncate its inputs');
    assert.deepEqual(readFileSync(staged!), readFileSync(objectPath(testRepo, hash)));

    // Proving the point: writing through the staged path leaves the object be.
    writeFileSync(staged!, new Uint8Array(16).fill(0xff));
    assert.deepEqual(readFileSync(objectPath(testRepo, hash)), Buffer.from(new Uint8Array(4096).fill(0x44)));
  });

  it('stages through ranged reads when the backend cannot materialize', async () => {
    // The fallback every non-file backend takes: chunked `readRange` into the
    // scratch file, never `read`.
    const { hash, bytes } = await store(9000, 0x45);
    const objects = storage.objects as ObjectStore;
    delete (objects as { materialize?: unknown }).materialize;
    const spy = countWholeReads(storage);

    const [staged] = await marshalInputsToDir(storage, testRepo, scratch, [hash]);

    assert.deepEqual(readFileSync(staged!), Buffer.from(bytes));
    assert.equal(spy.reads(), 0, 'ranged reads, not a whole read');
  });

  it('adopts an output onto the hash objects.write would have produced', async () => {
    const outputPath = join(scratch, 'output.beast2');
    const bytes = new Uint8Array(3000).fill(0x46);
    writeFileSync(outputPath, bytes);

    const adopted = await adoptOutputFile(storage, testRepo, outputPath);
    const written = await storage.objects.write(testRepo, bytes);

    assert.equal(adopted, written, 'adopt and write are one content address');
    assert.deepEqual(await storage.objects.read(testRepo, adopted), bytes);
  });

  it('survives the scratch cleanup that follows it', async () => {
    // The adopt happens while the scratch directory still exists, and the
    // execution's `finally` then removes it. Removal unlinks the scratch NAME;
    // the object holds its own link to the same content, so it is unaffected.
    // (An adopted file is therefore shared storage, not a copy — which is why
    // `marshalInputsToDir` refuses to link a `custom` runner's inputs, where
    // an arbitrary command could write through the path instead of replacing
    // it.)
    const outputPath = join(scratch, 'output.beast2');
    const bytes = new Uint8Array(1500).fill(0x47);
    writeFileSync(outputPath, bytes);

    const hash = await adoptOutputFile(storage, testRepo, outputPath);
    rmSync(outputPath);

    assert.deepEqual(await storage.objects.read(testRepo, hash), bytes);
  });
});

/** Whether a process with this pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Whether `pid` has exited within `ms` — a bounded liveness wait. */
async function exitsWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (alive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

describe('the stdin lifeline (#770)', { skip: process.platform === 'win32' }, () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  it('a stock runner spawned with it exits once the e3 process that spawned it is killed', async () => {
    // e3 dies without warning while a stock runner spins in its body. The
    // runner leads its own process group, so the kill never reaches it; the
    // lifeline pipe closes with e3, and the runner exits. The body's
    // out-of-order second emission prints the sink's demote notice (the body
    // is running), then the body loops forever.
    const spin = East.function([FunctionType([IntegerType], NullType)], NullType, ($, emit) => {
      $(emit(2n));
      $(emit(1n));
      const turns = $.let(0n);
      $.while(true, ($) => {
        $.assign(turns, turns.add(1n));
      });
    });
    const irPath = join(dir, 'spin.beast2');
    writeFileSync(irPath, encodeEastIR(spin.toIR()));
    const scratch = join(dir, 'scratch');
    mkdirSync(scratch);

    // The e3 process: this build's spawnAndCapture, reporting the runner's pid
    // and passing its stderr through.
    const argv = ['east-node', 'run', '-p', '@elaraai/east-node-std', '--emit', 'set', '-o', join(dir, 'output.beast2'), irPath];
    const e3Script = join(dir, 'e3.mjs');
    writeFileSync(e3Script, [
      `import { spawnAndCapture } from ${JSON.stringify(new URL('./processExec.js', import.meta.url).href)};`,
      `await spawnAndCapture(${JSON.stringify(argv)}, ${JSON.stringify(scratch)}, {`,
      '  stdinLifeline: true,',
      `  searchDirs: [${JSON.stringify(process.cwd())}],`,
      "  onSpawned: (pid) => { process.stdout.write(`runner pid ${pid}\\n`); },",
      '  onStderr: (data) => { process.stdout.write(data); },',
      '});',
    ].join('\n'));
    const e3 = spawn(process.execPath, [e3Script], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    let runnerPid: number | null = null;
    const running = new Promise<boolean>((resolve) => {
      e3.stdout!.setEncoding('utf8');
      e3.stdout!.on('data', (chunk: string) => {
        output += chunk;
        runnerPid ??= Number(/runner pid (\d+)/.exec(output)?.[1]) || null;
        if (runnerPid !== null && output.includes('left ascending order')) resolve(true);
      });
      e3.on('exit', () => resolve(false));
    });
    let e3Stderr = '';
    e3.stderr!.setEncoding('utf8');
    e3.stderr!.on('data', (chunk: string) => { e3Stderr += chunk; });

    try {
      // Bounded liveness waits: start-up, then the lifeline.
      const started = await Promise.race([running, new Promise<false>((resolve) => setTimeout(() => resolve(false), 30_000).unref())]);
      assert.ok(started, `the runner never reported its body running:\n${output}\n${e3Stderr}`);
      e3.kill('SIGKILL');
      assert.ok(await exitsWithin(runnerPid!, 10_000), `runner ${runnerPid} outlived the e3 process that spawned it by 10 s`);
    } finally {
      e3.kill('SIGKILL');
      if (runnerPid !== null && alive(runnerPid)) {
        try {
          process.kill(-runnerPid, 'SIGKILL');
        } catch {
          // Already gone
        }
      }
    }
  });
});
