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
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import crossSpawn from 'cross-spawn';
import { DictType, East, FunctionType, IntegerType, NullType, SortedMap, StringType, UnitType, compareFor, decodeBeast2For, encodeBeast2For, encodeEastIR, variant } from '@elaraai/east';
import { decodeCollectionManifest } from '@elaraai/e3-types';
import { jobLauncher, marshalInputsToDir, quoteWindowsArgument, spawnAndCapture } from './processExec.js';
import { unitArgv } from './units.js';
import { storeDatasetFile } from '../store-collection.js';
import { datasetWrite } from '../trees.js';
import { writeRecordState } from '../records.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir, processTree } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import { objectPath } from '../storage/local/localHelpers.js';
import type { ObjectStore, StorageBackend } from '../storage/interfaces.js';

/** Counts the whole-object reads a marshal makes; the point of #767 is that
 *  there are none. `counts` narrows to the objects that matter — for a
 *  manifest-backed input, its segments, since the manifest itself is the
 *  index and is meant to be read. */
function countWholeReads(storage: StorageBackend, counts?: (hash: string) => boolean): { reads: () => number } {
  const objects = storage.objects as ObjectStore;
  const original = objects.read.bind(objects);
  let reads = 0;
  objects.read = async (repo: string, hash: string): Promise<Uint8Array> => {
    if (counts === undefined || counts(hash)) reads++;
    return original(repo, hash);
  };
  return { reads: () => reads };
}

/** Asserts a staged file IS its object — one inode — wherever the scratch
 *  directory is on the object's volume, as a test's scratch and repository
 *  are, both under the system temp directory. Across volumes a stage can only
 *  copy, and then it must hold exactly the object's bytes. */
function assertSharesStorage(staged: string, object: string, what: string): void {
  const input = statSync(staged, { bigint: true });
  const stored = statSync(object, { bigint: true });
  if (statSync(dirname(staged), { bigint: true }).dev === stored.dev) {
    assert.ok(input.dev === stored.dev && input.ino === stored.ino, `${what} is the object itself, by a hard link`);
  } else {
    assert.deepEqual(readFileSync(staged), readFileSync(object), `${what} holds exactly the object's bytes`);
  }
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

    assertSharesStorage(staged!, objectPath(testRepo, hash), 'the staged input');
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

  it('stages a manifest-backed input as its manifest plus linked segments', async () => {
    const rows = new SortedMap<string, bigint>(
      Array.from({ length: 20_000 }, (_, i) => [`k${String(i).padStart(7, '0')}`, BigInt(i)] as [string, bigint]),
      compareFor(StringType),
    );
    const type = DictType(StringType, IntegerType);
    const hash = await datasetWrite(storage, testRepo, rows, type);
    const manifest = decodeCollectionManifest(await storage.objects.read(testRepo, hash));
    assert.ok(manifest.entries.length > 1);
    const segmentHashes = new Set(manifest.entries.map((e) => e.hash));
    const spy = countWholeReads(storage, (read) => segmentHashes.has(read));

    const [staged] = await marshalInputsToDir(storage, testRepo, scratch, [hash], { manifests: true });

    // The manifest file, and one file per segment beside it named by hash —
    // the convention every runtime's opener reads.
    assert.deepEqual(readFileSync(staged!), readFileSync(objectPath(testRepo, hash)));
    const segmentDir = `${staged!}.segments`;
    assert.deepEqual(
      readdirSync(segmentDir).sort(),
      manifest.entries.map((e) => `${e.hash}.beast2`).sort(),
    );
    // Not one byte of any segment moved: each staged file IS its object.
    for (const entry of manifest.entries) {
      assertSharesStorage(join(segmentDir, `${entry.hash}.beast2`), objectPath(testRepo, entry.hash), `segment ${entry.hash}`);
    }
    // The manifest is read — it IS the index, and it is a few dozen bytes
    // per segment — but not one segment's bytes pass through this process.
    assert.equal(spy.reads(), 0, 'staging a manifest reads no segment whole');
  });

  it('splices a manifest-backed input for a runner that does not open one', async () => {
    const rows = new SortedMap<string, bigint>(
      Array.from({ length: 20_000 }, (_, i) => [`k${String(i).padStart(7, '0')}`, BigInt(i)] as [string, bigint]),
      compareFor(StringType),
    );
    const type = DictType(StringType, IntegerType);
    const hash = await datasetWrite(storage, testRepo, rows, type);

    const [staged] = await marshalInputsToDir(storage, testRepo, scratch, [hash]);

    // One file, no siblings: the value, exactly as every runner got it
    // before the layout.
    assert.equal(existsSync(`${staged!}.segments`), false);
    const decoded = decodeBeast2For(type)(readFileSync(staged!)) as Map<string, bigint>;
    assert.equal(decoded.size, 20_000);
    assert.equal(decoded.get('k0019999'), 19_999n);
  });

  it('stages an indexed record as its rows, whatever its primary is stored as', async () => {
    // An indexed record's ref names a `$record` state, which names the rows'
    // collection and each index's. A runner is handed the rows: the manifest
    // and its segments, or the value, never the state.
    const type = DictType(StringType, IntegerType);
    const rows = new SortedMap<string, bigint>(
      Array.from({ length: 20_000 }, (_, i) => [`k${String(i).padStart(7, '0')}`, BigInt(i)] as [string, bigint]),
      compareFor(StringType),
    );
    const manifestPrimary = await datasetWrite(storage, testRepo, rows, type);
    const blobPrimary = await storage.objects.write(testRepo, encodeBeast2For(type)(rows));
    const index = {
      manifest: await datasetWrite(storage, testRepo, new SortedMap<string, bigint>([['other', 1n]], compareFor(StringType)), type),
      index: await storage.objects.write(testRepo, new Uint8Array([0])),
    };

    for (const primary of [manifestPrimary, blobPrimary]) {
      const state = await writeRecordState(storage, testRepo, { primary, indexes: new Map([['by_value', index]]) });
      for (const manifests of [true, false]) {
        const dir = join(scratch, `${primary === manifestPrimary ? 'manifest' : 'blob'}-${manifests}`);
        mkdirSync(dir);
        const [staged] = await marshalInputsToDir(storage, testRepo, dir, [state], { manifests });
        if (primary === manifestPrimary && manifests) {
          assert.deepEqual(readFileSync(staged!), readFileSync(objectPath(testRepo, primary)), 'the primary\'s manifest is staged');
          const manifest = decodeCollectionManifest(readFileSync(staged!));
          assert.deepEqual(readdirSync(`${staged!}.segments`).sort(), manifest.entries.map((e) => `${e.hash}.beast2`).sort());
        } else {
          const decoded = decodeBeast2For(type)(readFileSync(staged!)) as Map<string, bigint>;
          assert.equal(decoded.size, 20_000, `a ${dir} input decodes to the rows`);
          assert.equal(decoded.get('k0019999'), 19_999n);
        }
      }
    }
  });

  it('adopts an output onto the hash objects.write would have produced', async () => {
    const outputPath = join(scratch, 'output.beast2');
    const bytes = new Uint8Array(3000).fill(0x46);
    writeFileSync(outputPath, bytes);

    const adopted = await storeDatasetFile(storage, testRepo, outputPath);
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

    const hash = await storeDatasetFile(storage, testRepo, outputPath);
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

/** The number a file holds once something has written it — a bounded wait. */
async function numberIn(file: string, ms: number): Promise<number> {
  const deadline = Date.now() + ms;
  for (;;) {
    const text = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
    if (text !== '') return Number(text);
    if (Date.now() >= deadline) throw new Error(`nothing was written to ${file} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('a stop', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  /** A path as bash takes it on every platform. */
  const bashPath = (p: string): string => p.split(sep).join('/');

  it('ends a process the runner started that its process tree no longer reaches', async () => {
    // The runner runs a second shell, which records its own pid — on Windows
    // its Windows pid, Git Bash's $$ being its own numbering — and loops
    // while the marker exists. On Windows Git Bash leaves a program it runs
    // with an exited parent, out of reach of taskkill /T; on POSIX it shares
    // the runner's process group. Either way the stop must end it.
    const marker = join(dir, 'marker');
    const pidFile = join(dir, 'inner.pid');
    writeFileSync(marker, '');
    const inner = `pid=$$; if [ -r /proc/$$/winpid ]; then pid=$(cat /proc/$$/winpid); fi; echo $pid > '${bashPath(pidFile)}'; ` +
      `while [ -e '${bashPath(marker)}' ]; do sleep 1; done`;
    const abort = new AbortController();
    let innerPid: number | null = null;
    const run = spawnAndCapture(['bash', '-c', 'echo started; bash -c "$0"', inner], dir, { signal: abort.signal });
    try {
      innerPid = await numberIn(pidFile, 30_000);
      abort.abort();
      // Bounded waits: the stop, then the inner shell's exit.
      const result = await Promise.race([run, new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000).unref())]);
      assert.ok(result !== null, 'the stop never finished');
      assert.equal(result.stoppedByE3, true);
      assert.ok(await exitsWithin(innerPid, 10_000), `the inner shell ${innerPid} outlived the stop by 10 s`);
    } finally {
      // A shell the stop missed ends once the marker is gone, and the run with it.
      rmSync(marker, { force: true });
      if (innerPid !== null && alive(innerPid)) process.kill(innerPid, 'SIGKILL');
      await run;
    }
  });

  it('finishes while a process the runner detached holds the output open', async () => {
    // The runner starts a process detached from it that holds the output
    // open, and runs on until it is stopped. On POSIX that process is in a
    // session of its own, out of reach of the stop, which still finishes:
    // once the runner itself is gone the pipes are closed from e3's side. On
    // Windows the job holds even a detached process, and the stop ends it
    // with the runner.
    const pidFile = join(dir, 'escaped.pid');
    const escape = [
      "const escaped = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'],",
      "  { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(escaped.pid));`,
      'escaped.unref();',
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const abort = new AbortController();
    let escapedPid: number | null = null;
    try {
      const run = spawnAndCapture([process.execPath, '-e', escape], dir, { signal: abort.signal });
      escapedPid = await numberIn(pidFile, 30_000);
      abort.abort();
      // A bounded wait: the drain closes the pipes a few seconds after the stop.
      const finished = await Promise.race([run.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 30_000).unref())]);
      assert.ok(finished, 'the stop never finished');
      assert.equal((await run).stoppedByE3, true);
      if (process.platform === 'win32') {
        assert.ok(await exitsWithin(escapedPid, 10_000), `the detached process ${escapedPid} outlived the stop by 10 s`);
      }
    } finally {
      if (escapedPid !== null && alive(escapedPid)) process.kill(escapedPid, 'SIGKILL');
    }
  });
});

/** Arguments a command line must carry intact: blanks, quotes, backslashes
 *  before a quote and at the end, the empty argument, cmd.exe's
 *  metacharacters and text beyond ASCII. */
const AWKWARD_ARGUMENTS = [
  'plain', 'with space', 'tab\there', 'quote"inside', '"quoted"', 'trailing\\', 'back\\\\slash',
  'slash before quote\\"', '', '%PATH%', '^&|<>()', '!bang!', 'semi;colon,comma', 'é ✓ 😀',
];

describe('a runner\'s command line', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  it('carries every argument intact', async () => {
    const result = await spawnAndCapture(
      [process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...AWKWARD_ARGUMENTS], dir);
    assert.equal(result.exitCode, 0, result.stderrTail);
    assert.deepEqual(JSON.parse(result.stdoutTail), AWKWARD_ARGUMENTS);
  });

  it('gives a runner behind a .cmd shim the arguments a direct spawn gives it', {
    skip: process.platform !== 'win32' ? 'a .cmd shim is the Windows route' : false,
  }, async () => {
    // Where pnpm puts its shims, so cross-spawn escapes cmd.exe's
    // metacharacters twice, as it does for a stock runner. The reference is
    // cross-spawn itself, spawning the shim directly.
    const bin = join(dir, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    const script = join(dir, 'argv-echo.cjs');
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    writeFileSync(join(bin, 'argv-echo.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
    const direct = crossSpawn.sync('argv-echo', AWKWARD_ARGUMENTS, {
      cwd: dir,
      env: { ...process.env, PATH: `${bin};${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    });
    assert.equal(direct.status, 0, direct.stderr);

    const result = await spawnAndCapture(['argv-echo', ...AWKWARD_ARGUMENTS], dir, { extraBins: [bin] });
    assert.equal(result.exitCode, 0, result.stderrTail);
    assert.deepEqual(JSON.parse(result.stdoutTail), JSON.parse(direct.stdout));
  });

  it('reports the runner\'s own exit code', async () => {
    const result = await spawnAndCapture([process.execPath, '-e', 'process.exit(7)'], dir);
    assert.equal(result.exitCode, 7);
    assert.equal(result.signal, null);
    assert.equal(result.stoppedByE3, false);
  });
});

describe('output held for a callback that has not settled', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  it('stays paused when the child exits and Node resumes the stream to drain it', {
    skip: process.platform === 'win32' ? 'POSIX pipes: the child finishes writing while its output is held' : false,
  }, async () => {
    // Three blocks written apart, so each reaches e3 as its own chunk, then
    // the child exits. The first chunk takes the capture over its one-byte cap
    // and pauses the stream; the other two wait in the pipe and the stream.
    // Once the child has exited, Node resumes the stream to drain it: one
    // chunk arrives before the capture pauses it again, and the last waits
    // until the chunks held settle.
    const block = 8192;
    let pid: number | null = null;
    let holding = true;
    const held: (() => void)[] = [];
    let delivered = 0;
    let deliveredWhileHeld = 0;
    const run = spawnAndCapture(['bash', '-c', `for i in 1 2 3; do head -c ${block} /dev/zero | tr "\\0" x; sleep 0.1; done`], dir, {
      maxPendingBytes: 1,
      onSpawned: (spawned) => {
        pid = spawned;
      },
      onStdout: (data) => {
        delivered += Buffer.byteLength(data);
        if (!holding) return Promise.resolve();
        deliveredWhileHeld++;
        return new Promise<void>((resolve) => {
          held.push(resolve);
        });
      },
    });
    try {
      assert.ok(pid !== null && await exitsWithin(pid, 10_000), 'the child exited while its output was held');
      // Node's drain runs as the exit is handled; a turn more lets it land.
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(deliveredWhileHeld, 2, 'the chunk that crossed the cap, and the one Node resumed with before the pause was renewed');
    } finally {
      holding = false;
      for (const settle of held) settle();
    }
    const result = await run;
    assert.equal(result.exitCode, 0, result.stderrTail);
    assert.equal(delivered, 3 * block, 'every byte reached the callback once the held chunks settled');
  });
});

describe('a Windows command-line argument', () => {
  it('is quoted and escaped exactly as libuv quotes it', () => {
    // libuv's own table (quote_cmd_arg, src/win/process.c), and its shortcuts.
    const cases: Array<[string, string]> = [
      ['', '""'],
      ['hello', 'hello'],
      ['hello world', '"hello world"'],
      ['hello\tworld', '"hello\tworld"'],
      ['hello"world', '"hello\\"world"'],
      ['hello""world', '"hello\\"\\"world"'],
      ['hello\\world', 'hello\\world'],
      ['hello\\\\world', 'hello\\\\world'],
      ['hello\\"world', '"hello\\\\\\"world"'],
      ['hello\\\\"world', '"hello\\\\\\\\\\"world"'],
      ['hello world\\', '"hello world\\\\"'],
      ['C:\\Program Files\\node.exe', '"C:\\Program Files\\node.exe"'],
    ];
    for (const [arg, quoted] of cases) assert.equal(quoteWindowsArgument(arg), quoted, JSON.stringify(arg));
  });
});

describe('the Windows job launcher', { skip: process.platform !== 'win32' ? 'Windows only: POSIX process groups do its job' : false }, () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  /** The installed launcher; in a checkout, `make -C libs/e3 install-job` installs it. */
  function installedLauncher(): string {
    const launcher = jobLauncher();
    assert.ok(launcher !== null && existsSync(launcher), 'the job launcher is installed (in a checkout: make -C libs/e3 install-job)');
    return launcher;
  }

  /** Runs the launcher on a command line of its own. */
  function launch(commandLine: string): { status: number | null; stderr: string } {
    const launcher = installedLauncher();
    const result = spawnSync(launcher, commandLine === '' ? [] : [commandLine], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
      argv0: `"${launcher}"`,
    });
    return { status: result.status, stderr: result.stderr };
  }

  it('is where each runner runs', async () => {
    installedLauncher();
    let spawned: number | null = null;
    const result = await spawnAndCapture([process.execPath, '-e', 'process.stdout.write(String(process.ppid))'], dir, {
      onSpawned: (pid) => {
        spawned = pid;
      },
    });
    assert.equal(result.exitCode, 0, result.stderrTail);
    assert.equal(result.stdoutTail, String(spawned), 'the runner\'s parent is the process e3 spawned: the launcher');
  });

  it('ends what a runner leaves running when it exits', async () => {
    // The job ends with the launcher, which exits with the runner.
    const pidFile = join(dir, 'left.pid');
    const leave = [
      "const left = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'],",
      "  { detached: true, stdio: 'ignore' });",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(left.pid));`,
      'left.unref();',
    ].join('\n');
    installedLauncher();
    let leftPid: number | null = null;
    try {
      const result = await spawnAndCapture([process.execPath, '-e', leave], dir);
      assert.equal(result.exitCode, 0, result.stderrTail);
      leftPid = await numberIn(pidFile, 10_000);
      assert.ok(await exitsWithin(leftPid, 10_000), `the process ${leftPid} the runner left running outlived it by 10 s`);
    } finally {
      if (leftPid !== null && alive(leftPid)) process.kill(leftPid, 'SIGKILL');
    }
  });

  it('exits with the command\'s exit code', () => {
    const { status, stderr } = launch(`"${process.execPath}" node -e "process.exit(9)"`);
    assert.equal(status, 9, stderr);
  });

  it('reports a program it cannot find as 127, one it cannot run as 126, and misuse as 125', () => {
    // A name beyond ASCII, which the launcher's message must carry whole.
    const missing = join(dir, 'missing-é✓.exe');
    const notFound = launch(`"${missing}" missing.exe`);
    assert.equal(notFound.status, 127, notFound.stderr);
    assert.ok(notFound.stderr.startsWith(`e3-job: cannot start ${missing}: `), notFound.stderr);

    const text = join(dir, 'text.exe');
    writeFileSync(text, 'not a program');
    const cannotRun = launch(`"${text}" text.exe`);
    assert.equal(cannotRun.status, 126, cannotRun.stderr);
    assert.match(cannotRun.stderr, /^e3-job: cannot start .*text\.exe: /);

    for (const misuse of ['', `"${process.execPath}"`]) {
      const usage = launch(misuse);
      assert.equal(usage.status, 125, usage.stderr);
      assert.match(usage.stderr, /^e3-job: usage: /);
    }
  });
});

describe('a spawn whose caller cannot record the runner', () => {
  it('stops the runner and waits for it before rejecting', async () => {
    // The tracked path writes the `running` record from onSpawned. When that
    // fails, the spawn fails with it — and the runner, which nothing would
    // then track, must not be left running.
    const dir = createTempDir();
    let pid: number | null = null;
    try {
      await assert.rejects(
        spawnAndCapture([process.execPath, '-e', 'setInterval(() => {}, 1000)'], dir, {
          onSpawned: (spawned) => {
            pid = spawned;
            throw new Error('the running record cannot be written');
          },
        }),
        { message: 'the running record cannot be written' },
      );
      assert.ok(pid !== null, 'the runner spawned');
      assert.equal(alive(pid), false, 'the runner was stopped before the spawn rejected');
    } finally {
      if (pid !== null && alive(pid)) process.kill(pid, 'SIGKILL');
      removeTempDir(dir);
    }
  });
});

describe('the stdin lifeline (#770)', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  it('a runner reads it on a thread of its own and keeps full use of its stdin meanwhile', async () => {
    // A runner's watcher reads the lifeline on a worker thread for as long as
    // the runner runs; two seconds in, the main thread opens stdin, as a
    // runner's first ESM import of `node:process` does (the builtin's facade
    // reads every export). On Windows a read pending on a synchronous pipe
    // holds the pipe's file-object lock, and that open waited for it forever;
    // the lifeline is an overlapped pipe, whose reads take no such lock.
    const script = [
      "const { Worker } = require('node:worker_threads');",
      'new Worker(`',
      "  const stdin = new (require('node:net').Socket)({ fd: 0, readable: true, writable: false });",
      "  stdin.on('error', () => {});",
      '  stdin.resume();',
      '`, { eval: true }).unref();',
      "setTimeout(() => { process.stdin; process.stdout.write('stdin opened'); }, 2000);",
    ].join('\n');
    let pid: number | null = null;
    const run = spawnAndCapture([process.execPath, '-e', script], dir, {
      stdinLifeline: true,
      onSpawned: (spawned) => {
        pid = spawned;
      },
    });
    try {
      // A bounded wait: the open either returns or waits for this process.
      const result = await Promise.race([run, new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000).unref())]);
      assert.ok(result !== null, 'opening stdin waited on the lifeline read');
      assert.equal(result.exitCode, 0, result.stderrTail);
      assert.equal(result.stdoutTail, 'stdin opened');
    } finally {
      if (pid !== null && alive(pid)) process.kill(pid, 'SIGKILL');
      await run;
    }
  });

  it('a stock runner spawned with it exits once the e3 process that spawned it is killed', async () => {
    // e3 dies without warning while a stock runner spins in its body. On
    // POSIX the kill never reaches the runner, which leads its own process
    // group: the lifeline pipe closes with e3, and the runner — spawned with
    // `--exit-with-parent` — exits. On Windows Node ends its direct child,
    // the job launcher, with e3, and the launcher's job ends the runner
    // beneath the pnpm shim; the lifeline would end it too, as it does where
    // the launcher is not installed (east-node-cli's own tests pin that on
    // Windows). A unit's set output directory is made before the body runs,
    // so its existence is the sign the runner is up and computing; the body
    // loops forever after one emission.
    const spin = East.function([FunctionType([IntegerType], NullType)], NullType, ($, emit) => {
      $(emit(1n));
      const turns = $.let(0n);
      $.while(true, ($) => {
        $.assign(turns, turns.add(1n));
      });
    });
    const scratch = join(dir, 'scratch');
    mkdirSync(scratch);
    writeFileSync(join(scratch, 'spin.beast2'), encodeEastIR(spin.toIR()));
    const unitPath = join(scratch, 'unit.beast2');
    writeFileSync(unitPath, encodeBeast2For(UnitType)({
      work: variant('run', { program: 'spin.beast2', inputs: [], output: variant('set', 'output') }),
      platforms: [],
      threads: 1n,
      result: 'result.beast2',
    }));
    const outputPath = join(scratch, 'output');

    // The e3 process: this build's spawnAndCapture of a unit's command line,
    // reporting the runner's pid and passing its stderr through.
    const argv = unitArgv(variant('east_node', { platforms: [] }), { file: unitPath, result: join(scratch, 'result.beast2') });
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
      });
      e3.on('exit', () => resolve(false));
      const poll = setInterval(() => {
        if (runnerPid !== null && existsSync(outputPath)) {
          clearInterval(poll);
          resolve(true);
        }
      }, 50);
      poll.unref();
    });
    let e3Stderr = '';
    e3.stderr!.setEncoding('utf8');
    e3.stderr!.on('data', (chunk: string) => { e3Stderr += chunk; });

    // Every process of the runner's tree: on Windows the launcher, the shim
    // and the runner.
    let tree: number[] = [];
    try {
      // Bounded liveness waits: start-up, then the lifeline.
      const started = await Promise.race([running, new Promise<false>((resolve) => setTimeout(() => resolve(false), 30_000).unref())]);
      assert.ok(started, `the runner never reported its body running:\n${output}\n${e3Stderr}`);
      tree = processTree(runnerPid!);
      if (process.platform === 'win32') assert.ok(tree.length > 1, `the runner beneath ${runnerPid} is found: ${tree.join(', ')}`);
      e3.kill('SIGKILL');
      for (const pid of tree) {
        assert.ok(await exitsWithin(pid, 10_000), `runner process ${pid} (of ${tree.join(', ')}) outlived the e3 process that spawned it by 10 s`);
      }
    } finally {
      e3.kill('SIGKILL');
      if (tree.length === 0 && runnerPid !== null) tree = processTree(runnerPid);
      for (const pid of tree) {
        if (!alive(pid)) continue;
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone
        }
      }
    }
  });
});
