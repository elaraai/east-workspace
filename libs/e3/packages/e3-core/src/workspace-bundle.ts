/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A workspace's bundle (`WorkspaceBundleType`): a workspace written out as it
 * is, in one stream of beast2 ({@link workspaceBundleExport}), and a workspace
 * made from one in a repository of any store ({@link workspaceBundleImport}).
 *
 * A bundle carries what reading the workspace reads: the package deployed to
 * it, every dataset's ref, the executions its tasks' outputs come from, and
 * every object those reach, as gc's mark finds them. Its runs, the attempts
 * that made nothing it holds, and their logs stay in the repository it was
 * written from: the workspace an import makes names no run of its own, as a
 * copy's does.
 */

import { Beast2ElementWriter, decodeBeast2ElementsFor, encodeBeast2For, none, some, variant } from '@elaraai/east';
import {
  WorkspaceBundleType, WorkspaceRecordType, executionStatusRoots,
  type DatasetRef, type WorkspaceBundleEntry, type WorkspaceBundleHead,
} from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, TOUCH_BATCH, eachAtMost, readInOrder } from './concurrency.js';
import { dataflowGetGraph } from './dataflow.js';
import { collectLeafPaths, keypathToRefPath, refPathToKeypath } from './dataset-refs.js';
import {
  InvalidNameError, ObjectNotFoundError, PackageExistsError, WorkspaceBundleInvalidError, WorkspaceExistsError,
  WorkspaceLockError, checkHash, checkId, checkName, lockStateToHolderInfo,
} from './errors.js';
import { inputsHash } from './executions.js';
import { gcObjectReaders, markReachable, touchReachable } from './gc-graph.js';
import { packageObjectRead } from './packages.js';
import { withRunningWork } from './running-work.js';
import type { StorageBackend } from './storage/interfaces.js';
import { readStateOrThrow } from './workspaces.js';

/**
 * The most bytes of an object one entry of a bundle carries: a larger object
 * travels in pieces of this many, an entry each, so a bundle is written and
 * read in the memory of a few entries whatever its objects' sizes.
 */
export const BUNDLE_PIECE_BYTES = 4 * 1024 * 1024;

/**
 * Options for {@link workspaceBundleExport}.
 */
export interface WorkspaceBundleExportOptions {
  /**
   * Which of the objects the bundle would carry the repository it is for holds
   * already, asked a batch at a time: those it holds are left out. Unless
   * given, every object the workspace reaches travels.
   *
   * @remarks
   * An answer only saves bytes: the import makes the workspace only once the
   * repository holds every object the workspace names, and every object each
   * of those names, so an object said to be held that is not refuses the
   * import.
   */
  readonly have?: (hashes: readonly string[]) => Promise<readonly boolean[]>;
  /**
   * The most bytes of an object one entry carries: {@link BUNDLE_PIECE_BYTES},
   * unless a test lowers it.
   *
   * @internal
   */
  readonly pieceBytes?: number;
}

/**
 * What {@link workspaceBundleExport} wrote.
 */
export interface WorkspaceBundleExportResult {
  /** The package deployed to the workspace */
  readonly package: { readonly name: string; readonly version: string };
  /** How many objects the bundle carries */
  readonly objects: number;
  /** The bundle's size, in bytes */
  readonly bytes: number;
}

/**
 * What {@link workspaceBundleImport} made.
 */
export interface WorkspaceBundleImportResult {
  /** The package deployed to the workspace made */
  readonly package: { readonly name: string; readonly version: string };
  /** How many objects the bundle carried */
  readonly objects: number;
}

/** A bundle's bytes: a stream, or chunks in order. */
export type WorkspaceBundleSource = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

/**
 * Writes a workspace out as it is, as a bundle: its package, every dataset's
 * ref, the executions its tasks' outputs come from, and every object those
 * reach — what {@link workspaceBundleImport} makes the workspace from again,
 * in a repository of any store.
 *
 * @remarks
 * The workspace is read once, held shared as a copy holds its source: a write
 * beside the export lands after what it read, and the bundle does not carry
 * it. The executions are each task's latest attempt over its current inputs,
 * where it succeeded and made the output the workspace holds: the workspace an
 * import makes reads as up to date as this one, and a run of it finds them.
 * The objects are those gc keeps for the workspace, found as gc's mark finds
 * them ({@link markReachable}), each read as it is written, a few ahead; one
 * larger than an entry carries goes in pieces ({@link BUNDLE_PIECE_BYTES}).
 *
 * The stream is closed once the bundle is whole, and aborted with the failure
 * when the export fails, so a reader never takes a bundle cut short for a
 * whole one.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - The workspace
 * @param destination - The stream the bundle's bytes go to
 * @param options - What the repository the bundle is for holds already
 * @returns The package, and how many objects and bytes the bundle holds
 * @throws {InvalidNameError} When `ws` is no workspace's name, before a lock is
 *   taken
 * @throws {WorkspaceNotFoundError} When the workspace does not exist
 * @throws {WorkspaceNotDeployedError} When no package is deployed to it
 * @throws {WorkspaceLockError} When something holds it exclusively: a deploy,
 *   a removal, a copy onto it
 * @throws {ObjectNotFoundError} When it names an object its repository does
 *   not hold
 * @throws {Error} When a garbage collection or an upgrade holds the repository
 */
export async function workspaceBundleExport(
  storage: StorageBackend,
  repo: string,
  ws: string,
  destination: WritableStream<Uint8Array>,
  options: WorkspaceBundleExportOptions = {},
): Promise<WorkspaceBundleExportResult> {
  try {
    // Checked before the repository's running work is held, and the
    // workspace's lock taken: a lock's name may hold the `#` and `~` no
    // workspace's may.
    checkName('workspace', ws);
    return await withRunningWork(storage, repo, () => exportBundle(storage, repo, ws, destination, options));
  } catch (err) {
    await destination.abort(err).catch(() => undefined);
    throw err;
  }
}

/** The export of {@link workspaceBundleExport}, holding the repository's
 *  running work. */
async function exportBundle(
  storage: StorageBackend,
  repo: string,
  ws: string,
  destination: WritableStream<Uint8Array>,
  options: WorkspaceBundleExportOptions,
): Promise<WorkspaceBundleExportResult> {
  const lock = await storage.locks.acquire(repo, ws, variant('export', null), { mode: 'shared' });
  if (lock === null) {
    const state = await storage.locks.getState(repo, ws);
    throw new WorkspaceLockError(ws, state ? lockStateToHolderInfo(state) : undefined);
  }
  try {
    const head = await headOf(storage, repo, ws);
    const roots = bundleRoots(head);
    const { readObject, readHead } = gcObjectReaders(storage, repo);
    const reached = await markReachable(readObject, new Set(roots), { readHead });
    // A root the mark found missing is read with the rest, and refused there
    for (const root of roots) reached.add(root);
    const objects = [...reached].sort();
    const carried = options.have === undefined ? objects : await unheld(objects, options.have);
    const bytes = await writeEntries(storage, repo, head, carried, destination, options.pieceBytes ?? BUNDLE_PIECE_BYTES);
    return { package: { name: head.package.name, version: head.package.version }, objects: carried.length, bytes };
  } finally {
    await lock.release();
  }
}

/**
 * The workspace as a bundle says it: its package, the ref of each dataset
 * its package declares, and the executions its tasks' outputs come from.
 */
async function headOf(storage: StorageBackend, repo: string, ws: string): Promise<WorkspaceBundleHead> {
  const state = await readStateOrThrow(storage, repo, ws);
  const pkg = await packageObjectRead(storage, repo, state.packageHash);
  const declared = new Set(collectLeafPaths(pkg.data.structure).map(keypathToRefPath));
  const refs = await storage.datasets.readAll(repo, ws);
  const datasets = new Map([...refs].filter(([path]) => declared.has(path)));

  // Each task's latest attempt over its current inputs, kept where it made the
  // output the workspace holds: what the workspace's status reads it up to
  // date by
  const current: { taskHash: string; inputsHash: string; output: string }[] = [];
  for (const task of (await dataflowGetGraph(storage, repo, ws)).tasks) {
    const output = valueHash(datasets.get(keypathToRefPath(task.output)));
    const inputs: string[] = [];
    for (const keypath of task.inputs) {
      const hash = valueHash(datasets.get(keypathToRefPath(keypath)));
      if (hash !== null) inputs.push(hash);
    }
    if (output === null || inputs.length !== task.inputs.length) continue;
    current.push({ taskHash: task.hash, inputsHash: inputsHash(inputs), output });
  }
  const latest = await storage.refs.executionGetLatestMany(repo, current.map(({ taskHash, inputsHash }) => ({ taskHash, inputsHash })));
  const executions = current.flatMap(({ taskHash, inputsHash, output }, i) => {
    const status = latest[i] ?? null;
    return status?.type === 'success' && status.value.outputHash === output ? [{ taskHash, inputsHash, status }] : [];
  });

  return {
    package: { name: state.packageName, version: state.packageVersion, hash: state.packageHash },
    deployedAt: state.deployedAt,
    datasets,
    executions,
  };
}

/** A ref's value's hash: `null` for one that is unassigned or null, or none. */
function valueHash(ref: DatasetRef | undefined): string | null {
  return ref?.type === 'value' ? ref.value.hash : null;
}

/**
 * What a bundle's workspace names, as gc roots a deployed workspace and its
 * executions: its package, each dataset's value and the head of each
 * record's history, and each execution's output and plan.
 */
function bundleRoots(head: WorkspaceBundleHead): string[] {
  const roots = [head.package.hash];
  for (const [path, ref] of head.datasets) {
    if (ref.type !== 'value') continue;
    roots.push(ref.value.hash);
    // The version vector's self-entry: a record's head commit, the root of
    // its history; a plain value's own hash again
    const self = ref.value.versions.get(refPathToKeypath(path));
    if (self !== undefined) roots.push(self);
  }
  for (const { status } of head.executions) roots.push(...executionStatusRoots(status));
  return [...new Set(roots)];
}

/** The objects the repository a bundle is for does not hold, asked a batch at
 *  a time. */
async function unheld(objects: readonly string[], have: (hashes: readonly string[]) => Promise<readonly boolean[]>): Promise<string[]> {
  const carried: string[] = [];
  for (let from = 0; from < objects.length; from += TOUCH_BATCH) {
    const batch = objects.slice(from, from + TOUCH_BATCH);
    const held = await have(batch);
    if (held.length !== batch.length) {
      throw new Error(`asked which of ${batch.length} objects the repository holds, the answer said ${held.length}`);
    }
    batch.forEach((hash, i) => {
      if (held[i] !== true) carried.push(hash);
    });
  }
  return carried;
}

/**
 * Writes a bundle's entries to a stream, an entry at a time, and closes it:
 * the workspace, then each object, read a few ahead of the one written. A read
 * of one byte more than an entry carries says whether an object goes in
 * pieces.
 *
 * @returns The bytes written
 */
async function writeEntries(
  storage: StorageBackend,
  repo: string,
  head: WorkspaceBundleHead,
  objects: readonly string[],
  destination: WritableStream<Uint8Array>,
  pieceBytes: number,
): Promise<number> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const entries = new Beast2ElementWriter(WorkspaceBundleType, (chunk) => {
    chunks.push(chunk);
  });
  // The stream is taken only while a chunk is written, so a failure finds it
  // free to abort
  const add = async (entry: WorkspaceBundleEntry): Promise<void> => {
    entries.add(entry);
    await flush();
  };
  const flush = async (): Promise<void> => {
    for (const chunk of chunks.splice(0)) {
      const writer = destination.getWriter();
      try {
        await writer.write(chunk);
      } finally {
        writer.releaseLock();
      }
      bytes += chunk.byteLength;
    }
  };

  await add(variant('workspace', head));
  const reads = readInOrder(objects.length, OBJECT_CONCURRENCY, async (i) => ({
    hash: objects[i]!,
    first: await storage.objects.readRange(repo, objects[i]!, 0, pieceBytes + 1),
  }));
  for await (const { hash, first } of reads) {
    let piece = first;
    for (let at = 0; piece.byteLength > pieceBytes;) {
      await add(variant('piece', piece.subarray(0, pieceBytes)));
      at += pieceBytes;
      piece = await storage.objects.readRange(repo, hash, at, pieceBytes + 1);
    }
    await add(variant('object', piece));
  }
  entries.finish();
  await flush();
  await destination.close();
  return bytes;
}

/**
 * Makes a workspace from a bundle ({@link workspaceBundleExport}): the
 * workspace the bundle was written from, as it was, under a name no workspace
 * of the repository has.
 *
 * @remarks
 * The name is held as a deploy holds a workspace, from before it is found free
 * until the workspace's record is written. The bundle is read an entry at a
 * time, each object stored as it comes and one that comes in pieces streamed
 * into the store, so a bundle of any size is read in the memory of a few
 * entries. Once the last is in, the repository must hold every object the
 * workspace names and every object each of those names
 * ({@link touchReachable}), and the bundle's refs must be of datasets its
 * package declares and its executions of its package's tasks. Then the
 * package's ref is written where the repository has none of its name and
 * version, each execution the repository does not record, each dataset's ref,
 * and the workspace's record last, as a deploy writes it. So a bundle refused,
 * cut short or leaving an object out makes no workspace, and what it stored is
 * left for gc.
 *
 * The workspace's history starts at the import: it names no run of its own,
 * and its package's deployment is the one the bundle carries.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - The workspace to make: a name no workspace has
 * @param source - The bundle's bytes
 * @returns The package deployed, and how many objects the bundle carried
 * @throws {InvalidNameError} When `ws` is no workspace's name, before a lock is
 *   taken
 * @throws {WorkspaceExistsError} When a workspace of the name exists
 * @throws {WorkspaceLockError} When something holds the name
 * @throws {PackageExistsError} When the repository has the bundle's package's
 *   name and version as another package
 * @throws {WorkspaceBundleInvalidError} When the bytes are no bundle or are cut
 *   short, when it names what its package does not have, and when it leaves
 *   out an object the repository does not hold
 * @throws {Error} When a garbage collection or an upgrade holds the repository
 */
export async function workspaceBundleImport(
  storage: StorageBackend,
  repo: string,
  ws: string,
  source: WorkspaceBundleSource,
): Promise<WorkspaceBundleImportResult> {
  // Checked before the repository's running work is held, and the name's lock
  // taken
  checkName('workspace', ws);
  return withRunningWork(storage, repo, () => importBundle(storage, repo, ws, source));
}

/** The import of {@link workspaceBundleImport}, holding the repository's
 *  running work. */
async function importBundle(storage: StorageBackend, repo: string, ws: string, source: WorkspaceBundleSource): Promise<WorkspaceBundleImportResult> {
  const lock = await storage.locks.acquire(repo, ws, variant('deployment', null));
  if (lock === null) {
    const state = await storage.locks.getState(repo, ws);
    throw new WorkspaceLockError(ws, state ? lockStateToHolderInfo(state) : undefined);
  }
  try {
    if (await storage.refs.workspaceRead(repo, ws) !== null) throw new WorkspaceExistsError(ws);
    const { head, objects } = await storeEntries(storage, repo, source);
    await checkHeld(storage, repo, head);

    // The package's ref, where the repository has none of its name and version
    const { name, version, hash } = head.package;
    if (await packageHeldAs(storage, repo, head) === null) await storage.refs.packageWrite(repo, name, version, hash);
    // Each execution the repository does not record
    await eachAtMost(head.executions, OBJECT_CONCURRENCY, async ({ taskHash, inputsHash, status }) => {
      const executionId = status.value.executionId;
      if (await storage.refs.executionGet(repo, taskHash, inputsHash, executionId) === null) {
        await storage.refs.executionWrite(repo, taskHash, inputsHash, executionId, status);
      }
    });
    // The refs, once those an import or a copy cut short left under the name
    // are gone
    await storage.datasets.removeAll(repo, ws);
    await eachAtMost([...head.datasets], OBJECT_CONCURRENCY, ([path, ref]) => storage.datasets.write(repo, ws, path, ref));
    // The record last, as a deploy writes it: an import cut short leaves no
    // workspace that reads as whole
    await storage.refs.workspaceWrite(repo, ws, encodeBeast2For(WorkspaceRecordType)(some({
      packageName: name,
      packageVersion: version,
      packageHash: hash,
      deployedAt: head.deployedAt,
      currentRunId: none,
    })));
    return { package: { name, version }, objects };
  } finally {
    await lock.release();
  }
}

/**
 * Stores a bundle's objects as its entries come, and answers its workspace,
 * checked before any object is stored.
 *
 * @throws {WorkspaceBundleInvalidError} When the bytes are no bundle, are cut
 *   short, or do not begin with the workspace
 */
async function storeEntries(storage: StorageBackend, repo: string, source: WorkspaceBundleSource): Promise<{ head: WorkspaceBundleHead; objects: number }> {
  let head: WorkspaceBundleHead | undefined;
  let objects = 0;
  let pieces: ObjectInPieces | undefined;
  try {
    for await (const entry of entriesOf(source)) {
      if (entry.type === 'workspace') {
        if (head !== undefined) throw new WorkspaceBundleInvalidError('it holds a second workspace');
        checkHead(entry.value);
        if (await packageHeldAs(storage, repo, entry.value) === undefined) throw new PackageExistsError(entry.value.package.name, entry.value.package.version);
        head = entry.value;
      } else if (head === undefined) {
        throw new WorkspaceBundleInvalidError('it does not begin with its workspace');
      } else if (entry.type === 'piece') {
        pieces ??= new ObjectInPieces(storage, repo);
        await pieces.add(entry.value);
      } else {
        if (pieces === undefined) await storage.objects.write(repo, entry.value);
        else {
          await pieces.add(entry.value);
          await pieces.end();
          pieces = undefined;
        }
        objects++;
      }
    }
  } catch (err) {
    pieces?.abandon(err);
    throw err;
  }
  if (head === undefined) throw new WorkspaceBundleInvalidError('it holds no workspace');
  if (pieces !== undefined) {
    const err = new WorkspaceBundleInvalidError('it ends partway through an object');
    pieces.abandon(err);
    throw err;
  }
  return { head, objects };
}

/**
 * A bundle's entries, read a segment at a time; bytes that are no bundle, or
 * a bundle cut short, refused as such.
 */
async function* entriesOf(source: WorkspaceBundleSource): AsyncGenerator<WorkspaceBundleEntry> {
  const entries = decodeBeast2ElementsFor(WorkspaceBundleType)(chunksOf(source));
  try {
    for (;;) {
      let next: IteratorResult<WorkspaceBundleEntry>;
      try {
        next = await entries.next();
      } catch (err) {
        throw new WorkspaceBundleInvalidError(err instanceof Error ? err.message : String(err));
      }
      if (next.done === true) return;
      yield next.value;
    }
  } finally {
    await entries.return(undefined);
  }
}

/** Bytes as East's element reader takes them: a stream read a chunk at a
 *  time ({@link streamChunks}), or the chunks given. */
function chunksOf(source: WorkspaceBundleSource): AsyncIterable<Uint8Array> | Iterable<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && source instanceof ReadableStream ? streamChunks(source) : source;
}

/** A stream's chunks, read one at a time; the stream is cancelled when the
 *  reading ends before it does. */
async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  let done = false;
  try {
    for (;;) {
      const read = await reader.read();
      if (read.done) {
        done = true;
        return;
      }
      yield read.value;
    }
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * Refuses a bundle's workspace that names anything it cannot: a name or a
 * hash of no form e3 makes a path or a key of, or an execution its tasks'
 * outputs do not come from.
 *
 * @throws {WorkspaceBundleInvalidError} Naming what it cannot name
 */
function checkHead(head: WorkspaceBundleHead): void {
  try {
    checkName('package', head.package.name);
    checkName('package version', head.package.version);
    for (const root of bundleRoots(head)) checkHash('object hash', root);
    for (const { taskHash, inputsHash, status } of head.executions) {
      checkHash('task hash', taskHash);
      checkHash('inputs hash', inputsHash);
      checkId('execution id', status.value.executionId);
      if (status.type !== 'success') {
        throw new WorkspaceBundleInvalidError(`its execution ${status.value.executionId} is ${status.type}: only an execution a task's output comes from travels`);
      }
    }
  } catch (err) {
    if (err instanceof InvalidNameError) throw new WorkspaceBundleInvalidError(err.message);
    throw err;
  }
}

/**
 * What the repository has at the bundle's package's name and version: `null`
 * for nothing, the package's hash for the bundle's package, and `undefined`
 * for another package.
 */
async function packageHeldAs(storage: StorageBackend, repo: string, head: WorkspaceBundleHead): Promise<string | null | undefined> {
  const held = await storage.refs.packageResolve(repo, head.package.name, head.package.version);
  if (held === null || held === head.package.hash) return held;
  return undefined;
}

/**
 * Refuses a bundle whose workspace the repository cannot hold whole: it names
 * an object the repository does not hold, or one each of those names; or it
 * holds a ref of a dataset its package does not declare, or an execution of a
 * task its package does not have.
 *
 * @throws {WorkspaceBundleInvalidError} Naming what is missing or not its
 *   package's
 */
async function checkHeld(storage: StorageBackend, repo: string, head: WorkspaceBundleHead): Promise<void> {
  if (!(await touchReachable(storage, repo, bundleRoots(head)))) {
    throw new WorkspaceBundleInvalidError('it leaves out an object its workspace names, which the repository does not hold');
  }
  let declared: Set<string>;
  let tasks: Set<string>;
  try {
    const pkg = await packageObjectRead(storage, repo, head.package.hash);
    declared = new Set(collectLeafPaths(pkg.data.structure).map(keypathToRefPath));
    tasks = new Set(pkg.tasks.values());
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw err;
    throw new WorkspaceBundleInvalidError(`its package is no package: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const path of head.datasets.keys()) {
    if (!declared.has(path)) throw new WorkspaceBundleInvalidError(`it holds a ref of '${path}', and its package declares no dataset there`);
  }
  for (const { taskHash } of head.executions) {
    if (!tasks.has(taskHash)) throw new WorkspaceBundleInvalidError(`it holds an execution of task ${taskHash}, which its package does not have`);
  }
}

/**
 * An object that comes in pieces, streamed into the store as they come
 * (`ObjectStore.writeStream`): each piece is taken once the store is ready
 * for it, so no more than a piece or two waits in memory.
 */
class ObjectInPieces {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly written: Promise<string>;

  constructor(storage: StorageBackend, repo: string) {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    this.written = storage.objects.writeStream(repo, streamChunks(readable));
    // Observed where the write is waited on, or by the piece it refuses
    this.written.catch(() => undefined);
    this.writer = writable.getWriter();
  }

  /** Hands the store a piece, once it is ready for one. */
  async add(piece: Uint8Array): Promise<void> {
    try {
      await this.writer.ready;
    } catch {
      // The store's write stopped: its failure is the one to raise
      await this.written;
      throw new Error('the store stopped taking an object it was streamed');
    }
    void this.writer.write(piece).catch(() => undefined);
  }

  /** Ends the object, once its last piece is added, and waits for the store
   *  to hold it. */
  async end(): Promise<string> {
    await this.writer.close().catch(() => undefined);
    return this.written;
  }

  /** Stops the store's write: the object goes no further. */
  abandon(reason: unknown): void {
    void this.writer.abort(reason).catch(() => undefined);
  }
}
