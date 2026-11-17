/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Test helpers for e3-core
 * Provides utilities for setting up and tearing down test repositories
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DateTimeType, StringType, carveBeast2, compareFor, encodeBeast2For, encodeBeast2FenceFor, encodeBeast2SegmentsFor, isVariant, openBeast2PagesFor,
  parseFor, printType, readBeast2Extents, readBeast2Type, segmentKeyTypeOf, toEastTypeValue, variant, type EastType, type EastTypeValue,
  type ValueTypeOf,
} from '@elaraai/east';
import type { PartRunner } from '@elaraai/e3';
import {
  COLLECTION_MANIFEST_KIND, encodeCollectionManifest, type CollectionManifestEntry, type ExecutionStatus, type Structure,
} from '@elaraai/e3-types';
import type { BackendDamage } from './contract/index.js';
import { checkHash, checkId } from './errors.js';
import type { DetachedResult } from './execution/interfaces.js';
import { openZip } from './package-files.js';
import type { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { executionPath } from './storage/local/localHelpers.js';
import { repoInit } from './storage/local/repository.js';
import type { LogChunk, LogStore, RefStore, StorageBackend } from './storage/interfaces.js';
import { ZipWriter } from './zip.js';

// Re-export InMemoryStorage for test consumers
export { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';

// The contract suites every storage backend runs over itself
export * from './contract/index.js';

// The runner the dataflow loop's suite replays a run's interleavings on
export { GatedTaskRunner, type GatedLaunch } from './execution/GatedTaskRunner.js';

// The walk a portable entry is held to: e3-core's own, and one built on it
export { PORTABLE_PACKAGES, portableWalker, type PortableGraph, type PortableWalk } from './portable-graph.js';

/**
 * Builds an encoder that writes a collection as a blob of `size`-element
 * segments, in canonical order.
 *
 * @remarks
 * The geometry is the test's, not the cut rule's, which would hold a small
 * fixture in one segment: partition planning, paged windows and key searches
 * need several segments to have anything to decide. The blob is a valid
 * canonical-order collection that is not cut canonically — what a writer
 * outside e3 may hand the store.
 *
 * @param type - the collection type (Array, Set or Dict)
 * @param size - elements (pairs, for a Dict) per segment
 * @returns a function encoding a collection value; a plain Set or Map is
 *   sorted into canonical order first
 */
export function encodeInSegmentsOf(type: EastType | EastTypeValue, size: number): (value: unknown) => Uint8Array {
  const typeValue = isVariant(type) ? (type as EastTypeValue) : toEastTypeValue(type as EastType);
  const encode = encodeBeast2SegmentsFor(typeValue);
  const kind = typeValue.type;
  const cmp = kind === 'Array' ? null : compareFor((kind === 'Set' ? typeValue.value : (typeValue.value as { key: EastTypeValue }).key) as never) as (a: unknown, b: unknown) => number;
  return (value) => {
    const items = kind === 'Array' ? [...(value as unknown[])]
      : kind === 'Set' ? [...(value as Set<unknown>)].sort(cmp!)
      : [...(value as Map<unknown, unknown>)].sort((a, b) => cmp!(a[0], b[0]));
    const batches: unknown[] = [];
    for (let i = 0; i < items.length; i += size) {
      const chunk = items.slice(i, i + size);
      batches.push(kind === 'Dict' ? new Map(chunk as [unknown, unknown][]) : kind === 'Set' ? new Set(chunk) : chunk);
    }
    return encode(batches as never);
  };
}

/**
 * Stores a segmented blob's segments as objects, under a manifest naming them
 * as they stand.
 *
 * @remarks
 * For a stored fixture whose geometry is the test's, as
 * {@link encodeInSegmentsOf}'s is. The readers take any manifest, and the
 * store's door refuses one the current rule did not cut, so the manifest names
 * its rule `test/as-encoded`: a fixture never passes for the Writer's.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param blob - a segmented, indexed collection blob
 * @returns the manifest's hash
 */
export async function storeSegmentsOf(storage: StorageBackend, repo: string, blob: Uint8Array): Promise<string> {
  const extents = readBeast2Extents(blob);
  const type = readBeast2Type(blob);
  const keyType = segmentKeyTypeOf(type);
  const pages = openBeast2PagesFor(type)(blob);
  const entries: CollectionManifestEntry[] = [];
  for (let i = 0; i < extents.counts.length; i++) {
    const segment = carveBeast2(blob, i, i + 1, extents);
    entries.push({
      hash: await storage.objects.write(repo, segment),
      fence: keyType === null ? new Uint8Array(0) : encodeBeast2FenceFor(keyType)(pages.fence(i)),
      count: BigInt(extents.counts[i]!),
      bytes: BigInt(segment.byteLength),
    });
  }
  return storage.objects.write(repo, encodeCollectionManifest({
    kind: COLLECTION_MANIFEST_KIND,
    level: 0n,
    type,
    rule: 'test/as-encoded',
    header: await storage.objects.write(repo, blob.subarray(0, extents.prefixEnd)),
    entries,
  }));
}

/** The key an attempt's log is held under. */
function attemptKey(repo: string, taskHash: string, inputsHash: string, executionId: string): string {
  return JSON.stringify([repo, taskHash, inputsHash, executionId]);
}

/**
 * A log store that holds every append until its attempt's log is flushed, as
 * a store that gathers appends into fewer, larger writes does, and then
 * writes what it held to the store it wraps.
 *
 * @remarks
 * A read is the wrapped store's: what a reader elsewhere reads, which an
 * append reaches only once its log is flushed. A test of the order e3 writes
 * an execution in runs over it: a record of an execution's end written before
 * its log was flushed finds the log without what was held.
 */
export class HeldLogStore implements LogStore {
  /** What each attempt's log holds unflushed, in the order it was appended. */
  private readonly held = new Map<string, { stream: 'stdout' | 'stderr'; data: string }[]>();
  /** Everything appended to each attempt's streams since its log was last
   *  removed, flushed or not. */
  private readonly written = new Map<string, { stdout: string; stderr: string }>();

  /**
   * @param inner - The store a flush writes to, and a read reads
   */
  constructor(readonly inner: LogStore) {}

  /**
   * Everything appended to a stream of an attempt's log since it was last
   * removed, flushed or not: what a read of it finds once the log is flushed.
   *
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @param stream - The stream
   * @returns The stream's text
   */
  appended(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: 'stdout' | 'stderr'): string {
    return this.written.get(attemptKey(repo, taskHash, inputsHash, executionId))?.[stream] ?? '';
  }

  /** Holds an append, its attempt's names checked first, as a store that
   *  gathers appends checks them before it keys anything by them. */
  async append(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: 'stdout' | 'stderr', data: string): Promise<void> {
    checkHash('task hash', taskHash);
    checkHash('inputs hash', inputsHash);
    checkId('execution id', executionId);
    const key = attemptKey(repo, taskHash, inputsHash, executionId);
    this.held.set(key, [...(this.held.get(key) ?? []), { stream, data }]);
    const written = this.written.get(key) ?? { stdout: '', stderr: '' };
    this.written.set(key, { ...written, [stream]: written[stream] + data });
    return Promise.resolve();
  }

  read(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    options?: { offset?: number; limit?: number },
  ): Promise<LogChunk> {
    return this.inner.read(repo, taskHash, inputsHash, executionId, stream, options);
  }

  /** Writes what the attempt's log holds to the wrapped store, in the order
   *  it was appended, and flushes the wrapped store's. */
  async flush(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void> {
    const key = attemptKey(repo, taskHash, inputsHash, executionId);
    const held = this.held.get(key) ?? [];
    this.held.delete(key);
    for (const { stream, data } of held) await this.inner.append(repo, taskHash, inputsHash, executionId, stream, data);
    await this.inner.flush(repo, taskHash, inputsHash, executionId);
  }

  async remove(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void> {
    const key = attemptKey(repo, taskHash, inputsHash, executionId);
    this.held.delete(key);
    this.written.delete(key);
    await this.inner.remove(repo, taskHash, inputsHash, executionId);
  }
}

/**
 * A backend that is `storage` with its logs kept by another log store.
 *
 * @param storage - The backend
 * @param logs - The log store it keeps its logs in
 * @returns The backend
 */
export function withLogStore(storage: StorageBackend, logs: LogStore): StorageBackend {
  return {
    upgrades: storage.upgrades,
    objects: storage.objects,
    refs: storage.refs,
    locks: storage.locks,
    logs,
    repos: storage.repos,
    datasets: storage.datasets,
    calls: storage.calls,
    runStates: (repo) => storage.runStates(repo),
    validateRepository: (repo) => storage.validateRepository(repo),
  };
}

/**
 * A backend that is `storage`, telling `asked` each object its object store
 * is asked about by hash: the method asked, and the hash.
 *
 * @remarks
 * A test of what a path reads counts by it: an object read once, or never
 * asked for. A method that takes no single hash (`writeMany`, `touch`) is not
 * told.
 *
 * @param storage - The backend
 * @param asked - Told the object store's method and the object's hash, before
 *   the method runs
 * @returns The backend
 */
export function watchObjects(storage: StorageBackend, asked: (method: string, hash: string) => void): StorageBackend {
  const objects = new Proxy(storage.objects, {
    get(target, key) {
      const member: unknown = Reflect.get(target, key, target);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]): unknown => {
        if (typeof key === 'string' && typeof args[1] === 'string') asked(key, args[1]);
        return Reflect.apply(member, target, args);
      };
    },
  });
  return new Proxy(storage, { get: (target, key) => (key === 'objects' ? objects : Reflect.get(target, key, target) as unknown) });
}

/**
 * What a reader read of an execution's log as a record of how it ended was
 * written.
 */
export interface LogAtEnd {
  /** Task object hash */
  readonly taskHash: string;
  /** Combined input hashes */
  readonly inputsHash: string;
  /** Execution ID (UUIDv7) */
  readonly executionId: string;
  /** How it ended, as the record written says */
  readonly status: ExecutionStatus['type'];
  /** Its stdout log, whole, as the reader read it */
  readonly stdout: string;
  /** Its stderr log, whole, as the reader read it */
  readonly stderr: string;
}

/**
 * Has each write of an execution's record but a `running` one first read the
 * execution's log, as a reader elsewhere reads it then.
 *
 * @param refs - The ref store whose writes are watched: its `executionWrite`
 *   is replaced
 * @param logs - The log store the reader reads
 * @returns What each write found, in the order the writes were made
 */
export function logsAtEachEnd(refs: RefStore, logs: LogStore): LogAtEnd[] {
  const found: LogAtEnd[] = [];
  const write = refs.executionWrite.bind(refs);
  refs.executionWrite = async (repo, taskHash, inputsHash, executionId, status) => {
    if (status.type !== 'running') {
      const read = async (stream: 'stdout' | 'stderr'): Promise<string> =>
        (await logs.read(repo, taskHash, inputsHash, executionId, stream, { limit: 1 << 24 })).data;
      found.push({ taskHash, inputsHash, executionId, status: status.type, stdout: await read('stdout'), stderr: await read('stderr') });
    }
    return write(repo, taskHash, inputsHash, executionId, status);
  };
  return found;
}

/**
 * Leaves a local repository's execution records in bytes of a test's
 * choosing, as a crash, a hand edit or an earlier release leaves a status
 * file: what the contract suites' cases of such a record need of a local
 * repository.
 *
 * @param repo - The repository's path
 * @returns What leaves its records so
 */
export function localDamage(repo: string): BackendDamage {
  return {
    execution: (taskHash, inputsHash, executionId, bytes) => {
      const dir = executionPath(repo, taskHash, inputsHash, executionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'status.beast2'), bytes ?? 'not a record');
      return Promise.resolve();
    },
  };
}

/**
 * Leaves an in-memory repository's execution records in bytes of a test's
 * choosing (`damageExecution`): what the contract suites' cases of such a
 * record need of the in-memory backend.
 *
 * @param storage - The backend
 * @param repo - The repository
 * @returns What leaves its records so
 */
export function inMemoryDamage(storage: InMemoryStorage, repo: string): BackendDamage {
  return {
    execution: (taskHash, inputsHash, executionId, bytes) => {
      storage.refs.damageExecution(repo, taskHash, inputsHash, executionId, bytes);
      return Promise.resolve();
    },
  };
}

/**
 * A tree of writable String datasets, by name: the structure many specs'
 * packages share.
 *
 * @param names - The datasets, by name
 * @returns The structure
 */
export function writableStrings(names: readonly string[]): Structure {
  return variant('struct', new Map(names.map((name): [string, Structure] => [
    name, variant('value', { type: toEastTypeValue(StringType), writable: true }),
  ])));
}

/**
 * Creates a temporary directory for testing
 * @returns Path to temporary directory
 */
export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'e3-test-'));
}

/** Sleeps without yielding: a teardown has no turn of the loop to give. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Removes a temporary directory and all its contents.
 *
 * @remarks
 * Windows holds a directory that is any live process's working directory,
 * and releases it on its own schedule once that process goes. A suite that
 * runs a child with the directory as its cwd — which every spawn gate here
 * does — therefore races the kernel at teardown and gets
 * `EBUSY: resource busy or locked, rmdir`.
 *
 * `rmSync`'s own `maxRetries` does not cover it: Node's `rimrafSync` enters
 * its retry loop only for `ENOTEMPTY`/`EEXIST`/`EPERM`, and an `EBUSY` from
 * the top-level `rmdir` is rethrown at once. So the wait is here.
 *
 * A directory that is still held after all that is left where it is, for the
 * OS to sweep, rather than failing a suite whose assertions have already
 * passed: nothing is being tested about whether a temp directory can be
 * deleted. Every other platform unlinks on the first attempt.
 *
 * @param dir Path to directory to remove
 */
export function removeTempDir(dir: string): void {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'ENOTEMPTY' && code !== 'EPERM') throw err;
      sleepSync(50);
    }
  }
}

/**
 * Creates a temporary e3 repository for testing
 * @returns Path to the repository directory
 */
export function createTestRepo(): string {
  const dir = createTempDir();
  const result = repoInit(dir);
  if (!result.success) {
    throw new Error(`Failed to create test repository: ${result.error?.message}`);
  }
  return result.repoPath;
}

/**
 * Remove a test repository
 * @param repoPath Path to repository directory
 */
export function removeTestRepo(repoPath: string): void {
  removeTempDir(repoPath);
}

/**
 * Runs `fn` with environment variables set, and restores each as it was after,
 * whether `fn` resolves or throws.
 *
 * @param vars - Each variable's value while `fn` runs: a string sets it, and
 *   `undefined` unsets it
 * @param fn - What runs under them
 * @returns What `fn` resolves to
 */
export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev = Object.keys(vars).map((k) => [k, process.env[k]] as const);
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * A detached run's end, as a runner reports it: the end given, with log tails
 * of `out\n` and `err\n`, neither cut, unless the end gives its own.
 *
 * @param result - The end: its `kind`, the fields that kind carries, and any
 *   log tail to give instead
 * @returns The run's end
 */
export function ran(result: Partial<DetachedResult> & Pick<DetachedResult, 'kind'>): DetachedResult {
  return { stdout: 'out\n', stderr: 'err\n', stdoutTruncated: false, stderrTruncated: false, ...result } as DetachedResult;
}

/**
 * The stock runtimes a test that holds every runner to one behaviour runs
 * over: east-node, which every checkout has, then east-c and east-py, each
 * where its runner's CLI is on PATH and answers `version`, as CI's are.
 *
 * @returns The runtimes, east-node first
 */
export function stockRuntimesOnPath(): Array<'east-node' | 'east-c' | 'east-py'> {
  const runs = (command: string): boolean =>
    spawnSync(command, ['version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
  return ['east-node', ...(['east-c', 'east-py'] as const).filter(runs)];
}

/**
 * The name a spec gives a function or a task it declares once for each stock
 * runtime: what it does, then the runtime, as a definition's name may spell it.
 *
 * @param name - What the definition does
 * @param runtime - The runtime it runs on: `east-node`, `east-c` or `east-py`
 * @returns The name: `count_east_node` for `count` on east-node
 */
export function onRuntime(name: string, runtime: string): string {
  return `${name}_${runtime.replace('-', '_')}`;
}

/**
 * What a runner's verbose account says its pager decoded of an input: how many
 * of the input's segments, a count that a read's cost is held to, never a
 * clock. The account's line is `input <i>: <decoded> of <segments> segments
 * decoded`.
 *
 * @param stderr - The run's log, which a verbose run writes the account to
 * @param input - The input's place among the unit's inputs, from 0
 * @returns The segments decoded, and the segments the input is stored in
 * @throws {Error} When the account names no lazy read of the input, giving the log
 */
export function decodedOf(stderr: string, input: number): { decoded: number; segments: number } {
  const said = new RegExp(`input ${input}: (\\d+) of (\\d+) segments decoded`).exec(stderr);
  if (said === null) throw new Error(`the runner's account names no lazy read of input ${input}:\n${stderr}`);
  return { decoded: Number(said[1]), segments: Number(said[2]) };
}

/** A stock runtime a spec holds to one behaviour on every runtime: the workspace it runs in, and the runner it is given. */
export interface StockRunner {
  /** The workspace it runs in: `node`, `c` or `py`. */
  readonly ws: string;
  /** The runner its tasks, records' writes and indexes are given. */
  readonly runner: PartRunner;
}

/**
 * The stock runtimes a spec holds to one behaviour on every runtime
 * ({@link stockRuntimesOnPath}), each with the workspace it runs in and its
 * runner, and why a comparison of them skips: it needs two, and a machine with
 * east-node alone skips it rather than fails.
 *
 * @returns `runtimes`, east-node first; `missing`, the skip's reason where fewer than two are on PATH, else `false`
 */
export function stockRunners(): { readonly runtimes: StockRunner[]; readonly missing: string | false } {
  const installed = stockRuntimesOnPath();
  const runtimes: StockRunner[] = [
    { ws: 'node', runner: { runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] } } },
    ...(installed.includes('east-c') ? [{ ws: 'c', runner: { runner: { runtime: 'east-c' as const, platforms: [] } } }] : []),
    ...(installed.includes('east-py') ? [{ ws: 'py', runner: { runner: { runtime: 'east-py' as const, platforms: [] } } }] : []),
  ];
  const missing = runtimes.length < 2
    ? `needs east-c or east-py on PATH beside east-node; have ${runtimes.map((r) => r.ws).join(', ')}`
    : false;
  return { runtimes, missing };
}

// A seeded stream of numbers in [0, 1) (mulberry32), the same rows on every
// run of a spec that draws them: East's own, which its fuzz generator draws from
export { randomStream as seededStream } from '@elaraai/east/internal';

/**
 * A value written as East prints one, read by East's parser: how a spec
 * writes rows that nest.
 *
 * @param type - The value's type
 * @param text - The value, as East prints it
 * @returns The value
 * @throws {Error} When the text is no value of the type, naming the type and why
 */
export function parsedValue<T extends EastType>(type: T, text: string): ValueTypeOf<T> {
  const read = parseFor(type)(text);
  if (!read.success) throw new Error(`not a ${printType(type)}: ${read.error}`);
  return read.value;
}

/**
 * An instant written as East prints one, read by East's parser.
 *
 * @param text - The instant, as East prints it: `2026-01-05T00:00:00.000`
 * @returns The instant
 * @throws {Error} When the text is no instant East reads, saying why
 */
export function at(text: string): ValueTypeOf<typeof DateTimeType> {
  return parsedValue(DateTimeType, text);
}

/**
 * A Dict as East prints one, from its entries' texts.
 *
 * @param entries - Each entry, as East prints it: `key:value`
 * @returns The Dict's text: `{:}` with no entry
 */
export function dictText(entries: readonly string[]): string {
  return entries.length === 0 ? '{:}' : `{${entries.join(', ')}}`;
}

/**
 * Something a test waits for, and the call that brings it: a test that must
 * act once another step has happened — a runner handed its run — awaits
 * `opened`, where it would otherwise count on the order two steps are
 * scheduled in.
 *
 * @typeParam T - What the wait is given
 * @returns `opened`, which settles once `open` is called, with what it was
 *   given
 *
 * @example
 * ```ts
 * const running = gated<void>();
 * const run = start(() => running.open());
 * await running.opened; // started, wherever its own reads fell
 * ```
 */
export function gated<T>(): { readonly opened: Promise<T>; open(value: T): void } {
  let open!: (value: T) => void;
  const opened = new Promise<T>((resolve) => { open = resolve; });
  return { opened, open };
}

/**
 * The pid of a process that has certainly exited.
 *
 * @remarks
 * Spawning and reaping a process that does nothing leaves its pid free — the
 * one reliable way to name a dead process on every platform. A made-up pid
 * can be in use, and a fabricated start time is not a substitute either:
 * `getPidStartTime` answers 0 wherever the platform cannot tell (Windows),
 * so an "impossible" start time reads the same as a live process's unknown
 * one and the liveness check falls through to the pid's existence.
 *
 * @returns A pid whose process has exited
 */
export function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid!;
}

/**
 * A live process and every process beneath it, the process first.
 *
 * @remarks
 * The pid e3 records for a runner is its direct child's, and on Windows that
 * is not the runner: cross-spawn runs a pnpm `.cmd` shim through cmd.exe, and
 * the runner is cmd.exe's child. cmd.exe dies with the job object e3's
 * children are placed in whatever the runner does, so an assertion that a
 * runner exited must follow the whole tree. The tree is read from `ps` on
 * POSIX and from `Win32_Process` on Windows, while the process lives. Windows
 * keeps an exited parent's pid as a child's parent, and reuses pids, so there
 * a process is only taken as a child when it was created after its parent.
 *
 * @param pid - The root of the tree
 * @returns The pids of the tree, the root first
 */
export function processTree(pid: number): number[] {
  const listing = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 })" }'],
      { encoding: 'utf8' })
    : spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  if (listing.status !== 0) throw new Error(`listing processes failed: ${listing.error?.message ?? listing.stderr}`);
  const processes = listing.stdout.split(/\r?\n/).flatMap((line) => {
    const [child, parent, created] = line.trim().split(/\s+/).map(Number);
    return child && parent !== undefined && child !== parent ? [{ child, parent, created: created ?? 0 }] : [];
  });
  const created = new Map(processes.map((p) => [p.child, p.created]));
  const children = new Map<number, number[]>();
  for (const p of processes) {
    if (p.created < (created.get(p.parent) ?? 0)) continue;
    children.set(p.parent, [...(children.get(p.parent) ?? []), p.child]);
  }
  const tree = [pid];
  for (let i = 0; i < tree.length; i++) tree.push(...(children.get(tree[i]!) ?? []));
  return tree;
}

/**
 * Whether `uv` is on this machine's path: what a test that installs a python
 * environment needs, and is skipped without.
 *
 * @returns Whether it is
 */
export function uvOnPath(): boolean {
  return spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0;
}

/** The script a runtime image writes its tier manifest with: a file of this
 *  package (`tier/tier-manifest.py`), which these helpers, run from
 *  `dist/src`, find in the repository and in an installed package alike. */
const TIER_MANIFEST_SCRIPT = fileURLToPath(new URL('../../tier/tier-manifest.py', import.meta.url));

/**
 * The manifest of a tier whose interpreter is `python`, as a runtime image's
 * build writes its own: what the image's script
 * (`tier/tier-manifest.py`) writes when that interpreter runs it.
 *
 * @param python - The interpreter, a virtualenv's as an image's is
 * @returns The manifest's text
 * @throws {Error} When the script fails
 */
export function tierManifestOf(python: string): string {
  const dir = createTempDir();
  try {
    const out = join(dir, 'tier-manifest.json');
    const ran = spawnSync(python, [TIER_MANIFEST_SCRIPT, out], { encoding: 'utf8' });
    if (ran.status !== 0) throw new Error(`the tier manifest was not written: ${ran.error?.message ?? ran.stderr}`);
    return readFileSync(out, 'utf8');
  } finally {
    removeTempDir(dir);
  }
}

/**
 * Read all entries from a zip file, with e3's own reader: each entry's bytes
 * inflated when the zip deflated them, and checked against their CRC-32.
 *
 * @param zipPath Path to zip file
 * @returns Map of entry path to content buffer, in the zip's directory's
 *   order; a directory's entry is left out
 */
export async function readZipEntries(zipPath: string): Promise<Map<string, Buffer>> {
  const zip = await openZip(zipPath);
  try {
    const entries = new Map<string, Buffer>();
    for await (const entry of zip.entries()) {
      if (entry.fileName.endsWith('/')) continue;
      const bytes = await entry.getData();
      entries.set(entry.fileName, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    }
    return entries;
  } finally {
    zip.close();
  }
}

/**
 * The bytes of a zip of the given entries, in the given order, as e3's
 * {@link ZipWriter} writes it: each entry stored as it stands.
 *
 * @param entries - Each entry's path in the zip, and its bytes
 * @returns The zip's bytes
 */
export async function zipBytes(entries: Iterable<readonly [string, Uint8Array]>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const zip = new ZipWriter(new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  }));
  for (const [name, bytes] of entries) await zip.add(name, bytes);
  await zip.finish();
  return Buffer.concat(chunks);
}

/**
 * Writes a zip of the given entries, in the given order, as e3's
 * {@link ZipWriter} writes it.
 *
 * @param zipPath - Where to write it
 * @param entries - Each entry's path in the zip, and its bytes
 * @returns The zip's path
 */
export async function writeZip(zipPath: string, entries: Iterable<readonly [string, Buffer]>): Promise<string> {
  writeFileSync(zipPath, await zipBytes(entries));
  return zipPath;
}

/**
 * A package zip's entries with its release entry naming `release`, placed
 * last, as a newer e3 might place it; with none when `release` is `null`, as a
 * zip from before zips named their release.
 *
 * @param entries - The zip's entries, as {@link readZipEntries} reads them
 * @param release - The release the zip names, or `null` for none
 * @returns The entries, for {@link writeZip}
 */
export function withRelease(entries: Map<string, Buffer>, release: string | null): Array<readonly [string, Buffer]> {
  const rest = [...entries].filter(([name]) => name !== 'release.beast2');
  return release === null ? rest : [...rest, ['release.beast2', Buffer.from(encodeBeast2For(StringType)(release))]];
}

/**
 * Compare two zip files for content equality.
 * Returns true if both zips have the same entries with the same content.
 * Does not compare timestamps or other metadata.
 *
 * @param zipPath1 Path to first zip file
 * @param zipPath2 Path to second zip file
 * @returns Object with equal flag and optional diff info
 */
export async function zipEqual(
  zipPath1: string,
  zipPath2: string
): Promise<{ equal: boolean; diff?: string }> {
  const entries1 = await readZipEntries(zipPath1);
  const entries2 = await readZipEntries(zipPath2);

  // Check for missing entries
  const keys1 = Array.from(entries1.keys()).sort();
  const keys2 = Array.from(entries2.keys()).sort();

  if (keys1.length !== keys2.length) {
    return {
      equal: false,
      diff: `Entry count differs: ${keys1.length} vs ${keys2.length}`,
    };
  }

  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) {
      return {
        equal: false,
        diff: `Entry paths differ at index ${i}: ${keys1[i]} vs ${keys2[i]}`,
      };
    }
  }

  // Check content equality
  for (const [path, data1] of entries1) {
    const data2 = entries2.get(path)!;
    if (!data1.equals(data2)) {
      return {
        equal: false,
        diff: `Content differs at ${path}: ${data1.length} bytes vs ${data2.length} bytes`,
      };
    }
  }

  return { equal: true };
}
