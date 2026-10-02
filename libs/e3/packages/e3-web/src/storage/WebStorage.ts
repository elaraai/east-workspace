/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `WebStorage`: e3's storage backend over the four adapters — records, blobs,
 * locks and files — so e3 keeps its repositories in a browser: records in
 * IndexedDB, objects as OPFS files, locks through Web Locks and files as OPFS
 * files; or in memory, for Node's test pass and a page that keeps nothing past
 * a reload.
 *
 * Every record is an East value, in beast2, under a key of the records
 * adapter's ({@link recordKeys}). An object is a blob of its own, which a
 * record of the object catalogue names by its hash, beside its size, when it
 * was last written and gc's unreachable note. Each write of an object's bytes
 * is a new blob, so a delete that races a write takes the version the note
 * stood over, never the one the write stored.
 *
 * @packageDocumentation
 */

import {
  DateTimeType,
  IntegerType,
  OptionType,
  StringType,
  StructType,
  decodeBeast2For,
  encodeBeast2For,
  equalFor,
  none,
  some,
  variant,
  type ValueTypeOf,
} from '@elaraai/east';
import {
  DataflowRunType,
  DatasetRefType,
  ExecutionOwnerType,
  ExecutionStatusType,
  LockHolderVariantType,
  LockProgressType,
  LockStateType,
  RepoMetadataType,
  RepositoryRecordType,
  decodeExecutionStatus,
  type DataflowRun,
  type DatasetRef,
  type ExecutionOwner,
  type ExecutionStatus,
  type LockHolderVariant,
  type LockProgress,
  type RepositoryRecord,
} from '@elaraai/e3-types';
import {
  DatasetRefConflictError,
  ExecutionCorruptError,
  ObjectNotFoundError,
  RepoAlreadyExistsError,
  RepoNotFoundError,
  RepoStatusConflictError,
  checkName,
  completeUtf8Length,
  computeHash,
  executionRoots,
  isObjectHash,
  isUuidv7,
  newRepositoryRecord,
  packageRoots,
  workspaceRoots,
  type BatchResult,
  type DatasetRefStore,
  type GcBackendSweepOptions,
  type GcBackendSweepResult,
  type GcObjectEntry,
  type GcObjectScanResult,
  type GcRootScanResult,
  type LockHandle,
  type LockOperation,
  type LockService,
  type LockState,
  type LogChunk,
  type LogStore,
  type ObjectStore,
  type RefStore,
  type RepoMetadata,
  type RepoStatusName,
  type RepoStore,
  type RepositoryUpgrade,
  type StorageBackend,
} from '@elaraai/e3-core/portable';
import type { BlobKey, BlobsAdapter, FilesAdapter, LocksAdapter, RecordKey, RecordsAdapter, RecordsRead, RecordsTransaction } from './adapters.js';
import { openIndexedDbRecords } from './indexeddb.js';
import { MemoryBlobs, MemoryFiles, MemoryLockSpace, openMemoryRecords } from './memory.js';
import { OpfsBlobs, OpfsFiles, opfsDirectory } from './opfs.js';
import { openWebLocks } from './web-locks.js';

// =============================================================================
// Where each record is
// =============================================================================

/**
 * The key of each record `WebStorage` keeps, in its records adapter.
 *
 * @remarks
 * A repository's metadata is `['repos', name]`, and everything else of it is
 * under `['repo', name]`, so its records scan and delete by that prefix. The
 * execution state store over the same records keeps a run's state at
 * {@link recordKeys.state}, which a workspace's removal deletes with its
 * other records.
 */
export const recordKeys = {
  /** A repository's metadata */
  repository: (repo: string): RecordKey => ['repos', repo],
  /** Every repository's metadata */
  repositories: (): RecordKey => ['repos'],
  /** Everything of a repository but its metadata */
  of: (repo: string): RecordKey => ['repo', repo],
  /** A kind of a repository's records */
  kind: (repo: string, kind: string): RecordKey => ['repo', repo, kind],
  /** The repository record */
  record: (repo: string): RecordKey => ['repo', repo, 'record'],
  /** A package's ref: the package object's hash */
  package: (repo: string, name: string, version: string): RecordKey => ['repo', repo, 'package', name, version],
  /** A workspace's record */
  workspace: (repo: string, name: string): RecordKey => ['repo', repo, 'workspace', name],
  /** An execution attempt's status */
  execution: (repo: string, task: string, inputs: string, id: string): RecordKey => ['repo', repo, 'execution', task, inputs, id],
  /** An execution attempt's owner */
  owner: (repo: string, task: string, inputs: string, id: string): RecordKey => ['repo', repo, 'owner', task, inputs, id],
  /** The `$plan` a split task's execution is in */
  plan: (repo: string, task: string, inputs: string): RecordKey => ['repo', repo, 'plan', task, inputs],
  /** An entry of the adoption memo */
  adoption: (repo: string, source: string): RecordKey => ['repo', repo, 'adoption', source],
  /** A dataflow run's record */
  run: (repo: string, workspace: string, runId: string): RecordKey => ['repo', repo, 'run', workspace, runId],
  /** A dataset's ref, and the revision its write minted */
  dataset: (repo: string, workspace: string, path: string): RecordKey => ['repo', repo, 'dataset', workspace, path],
  /** A chunk of an execution attempt's log, by the byte of the log it starts
   *  at, in decimal zero-padded to sixteen digits */
  log: (repo: string, task: string, inputs: string, id: string, stream: string, start: string): RecordKey =>
    ['repo', repo, 'log', task, inputs, id, stream, start],
  /** The state of a resource's exclusive lock */
  lock: (repo: string, resource: string): RecordKey => ['repo', repo, 'lock', resource],
  /** What a resource's exclusive holder last reported of its progress */
  progress: (repo: string, resource: string): RecordKey => ['repo', repo, 'progress', resource],
  /** An object's entry in the catalogue */
  object: (repo: string, hash: string): RecordKey => ['repo', repo, 'object', hash],
  /** A write of an object's blob in flight */
  pending: (repo: string, blob: string): RecordKey => ['repo', repo, 'pending', blob],
  /** A part of a gc run in steps */
  gcRun: (repo: string, run: string, name: string): RecordKey => ['repo', repo, 'gc', run, name],
  /** A dataflow run's state, as `WebStateStore` keeps it */
  state: (repo: string, workspace: string, id: string): RecordKey => ['repo', repo, 'state', workspace, id],
};

/** The blob of an object: one per write of its bytes. */
function blobKey(repo: string, blob: string): BlobKey {
  return [repo, 'objects', blob.slice(0, 2), blob];
}

// =============================================================================
// Where each transfer is
// =============================================================================

/** The kinds of record a transfer backend over a `WebStorage` keeps. */
export type TransferKind = 'upload' | 'download' | 'import' | 'export' | 'deploy' | 'gc' | 'split';

/**
 * The key of each record a transfer backend over a `WebStorage` keeps, in its
 * records adapter: `['transfer', <kind>, <id>]`.
 *
 * @remarks
 * A job is found by its id alone, as a route asks for it, and its record names
 * the repository that started it, which the route checks. gc's sweep reads
 * which transfers have a record ({@link WebRepoStore.gcSweepBackend}).
 */
export const transferKeys = {
  /** Every transfer's record */
  all: (): RecordKey => ['transfer'],
  /** Every record of a kind */
  kind: (kind: TransferKind): RecordKey => ['transfer', kind],
  /** A record of a kind */
  of: (kind: TransferKind, id: string): RecordKey => ['transfer', kind, id],
};

/**
 * The key of each blob a transfer stages, in the blobs adapter: under its
 * repository, which takes them with it when it is removed.
 */
export const stagedKeys = {
  /** Everything every transfer of a repository staged */
  all: (repo: string): BlobKey => [repo, 'transfer'],
  /** Everything a transfer staged */
  of: (repo: string, id: string): BlobKey => [repo, 'transfer', id],
  /** A part of a dataset upload, from 1 */
  part: (repo: string, id: string, part: number): BlobKey => [repo, 'transfer', id, `part-${String(part).padStart(6, '0')}`],
  /** A package import's zip */
  zip: (repo: string, id: string): BlobKey => [repo, 'transfer', id, 'zip'],
  /** A round of an export's zip, from 0: the bytes one round wrote */
  exported: (repo: string, id: string, round: number): BlobKey => [repo, 'transfer', id, `export-${String(round).padStart(6, '0')}`],
};

/**
 * How long what a transfer staged is kept, however its record stands: a day,
 * the longest a transfer backend keeps a record nothing finished or fetched.
 * gc sweeps what is older, as it sweeps what no record names.
 */
export const TRANSFER_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Runs writes that read nothing as one transaction. */
function writeRecords(records: RecordsAdapter, writes: (tx: RecordsTransaction) => void): Promise<void> {
  return records.transact((tx) => {
    writes(tx);
    return Promise.resolve();
  });
}

// =============================================================================
// Record forms
// =============================================================================

const encodeHash = encodeBeast2For(StringType);
const decodeHash = decodeBeast2For(StringType);

/** A hash record's hash, or `null` when it does not decode as one. */
function hashOf(data: Uint8Array | null): string | null {
  if (data === null) return null;
  try {
    const hash = decodeHash(data);
    return isObjectHash(hash) ? hash : null;
  } catch {
    return null;
  }
}

/**
 * An object's entry in the catalogue: the blob its bytes are, their size, when
 * it was last written or re-referenced, and gc's unreachable note.
 */
const ObjectRecordType = StructType({
  /** The blob its bytes are */
  blob: StringType,
  /** Its size in bytes */
  size: IntegerType,
  /** When it was last written or re-referenced, in epoch milliseconds */
  writtenAt: IntegerType,
  /** When a sweep beside running work first saw it unreachable, while the note stands */
  unreachableSince: OptionType(IntegerType),
});
type ObjectRecord = ValueTypeOf<typeof ObjectRecordType>;
const encodeObject = encodeBeast2For(ObjectRecordType);
const decodeObject = decodeBeast2For(ObjectRecordType);

/** A write of an object's blob in flight: the object, and when it began. */
const PendingRecordType = StructType({
  /** The object's hash */
  hash: StringType,
  /** When the write began, in epoch milliseconds */
  at: IntegerType,
});
const encodePending = encodeBeast2For(PendingRecordType);
const decodePending = decodeBeast2For(PendingRecordType);

/** A dataset's ref, and the revision its write minted. */
const RevisionedRefType = StructType({ revision: StringType, ref: DatasetRefType });
const encodeRevisioned = encodeBeast2For(RevisionedRefType);
const decodeRevisioned = decodeBeast2For(RevisionedRefType);

/** A lock's holder, and when it acquired the lock: what stamps a progress
 *  report as the holder's. */
const HolderStampType = StructType({ holder: LockHolderVariantType, acquiredAt: DateTimeType });
const sameHolder = equalFor(HolderStampType);

/** What an exclusive holder last reported, stamped with the holder. */
const ProgressRecordType = StructType({ holder: LockHolderVariantType, acquiredAt: DateTimeType, progress: LockProgressType });
const encodeProgress = encodeBeast2For(ProgressRecordType);
const decodeProgress = decodeBeast2For(ProgressRecordType);

const encodeRepositoryRecord = encodeBeast2For(RepositoryRecordType);
const decodeRepositoryRecord = decodeBeast2For(RepositoryRecordType);
const encodeMetadata = encodeBeast2For(RepoMetadataType);
const decodeMetadata = decodeBeast2For(RepoMetadataType);
const encodeStatus = encodeBeast2For(ExecutionStatusType);
const encodeOwner = encodeBeast2For(ExecutionOwnerType);
const decodeOwner = decodeBeast2For(ExecutionOwnerType);
const encodeRun = encodeBeast2For(DataflowRunType);
const decodeRun = decodeBeast2For(DataflowRunType);
const encodeLockState = encodeBeast2For(LockStateType);
const decodeLockState = decodeBeast2For(LockStateType);

/**
 * Whether a lock's state record is the one a holder wrote: of its holder, and
 * of when it acquired the lock. One that does not decode is no holder's.
 */
function writtenBy(data: Uint8Array | null, stamp: ValueTypeOf<typeof HolderStampType>): boolean {
  if (data === null) return false;
  let state: LockState;
  try {
    state = decodeLockState(data);
  } catch {
    return false;
  }
  return sameHolder({ holder: state.holder, acquiredAt: state.acquiredAt }, stamp);
}

/** An object's entry, read in a transaction or outside one. */
async function readObject(read: RecordsRead, repo: string, hash: string): Promise<ObjectRecord | null> {
  const data = await read.get(recordKeys.object(repo, hash));
  return data === null ? null : decodeObject(data);
}

/** An object's entry once written or re-referenced now: its note cleared. */
function referenced(record: ObjectRecord, now: number): Uint8Array {
  return encodeObject({ ...record, writtenAt: BigInt(now), unreachableSince: none });
}

/**
 * Checks an execution's names are of the forms e3 writes, as a local
 * repository checks them before it makes a path of them.
 *
 * @throws {Error} When a hash is not a SHA-256 in lowercase hex, or the id is
 *   not a UUIDv7
 */
function checkExecution(taskHash: string, inputsHash: string, executionId?: string): void {
  if (!isObjectHash(taskHash)) throw new Error(`'${taskHash}' is not a task hash`);
  if (!isObjectHash(inputsHash)) throw new Error(`'${inputsHash}' is not an inputs hash`);
  if (executionId !== undefined && !isUuidv7(executionId)) throw new Error(`'${executionId}' is not an execution id`);
}

/** A source's bytes, gathered whole from its chunks. */
async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    chunks.push(chunk.slice());
    size += chunk.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

// =============================================================================
// Objects
// =============================================================================

/** How many bytes a placement reads of an object at a time. */
const PLACE_CHUNK = 1024 * 1024;

/**
 * Objects as blobs, named by their catalogue's entries.
 *
 * @remarks
 * A write of bytes the store does not hold records its write in flight, writes
 * a new blob, and then names it in the catalogue, in two transactions around
 * the blob's write; one of bytes it holds re-references them instead. Every
 * write and {@link touch} clears the object's unreachable note in the
 * transaction that finds it.
 *
 * East's SHA-256 names bytes whole, so a streamed write, and a file adopted,
 * are held whole to be named.
 */
export class WebObjectStore implements ObjectStore {
  /** Objects are blobs apart from any file: placing one copies its bytes. */
  readonly placement = 'download';

  constructor(
    private readonly records: RecordsAdapter,
    private readonly blobs: BlobsAdapter,
    private readonly files: FilesAdapter,
  ) {}

  async write(repo: string, data: Uint8Array): Promise<string> {
    const hash = computeHash(data);
    await this.store(repo, hash, data);
    return hash;
  }

  async writeStream(repo: string, stream: AsyncIterable<Uint8Array>): Promise<string> {
    return this.write(repo, await collect(stream));
  }

  /**
   * Stores bytes the caller has hashed, under that hash, without hashing them
   * again: what a transfer's commit stores once it has checked the bytes it
   * staged against the hash its upload declared.
   *
   * @param repo - Repository identifier
   * @param hash - The bytes' SHA-256, as the caller computed it
   * @param data - The bytes
   * @returns The hash
   * @throws {Error} When a sweep took the write in flight for abandoned:
   *   nothing is stored
   * @internal
   */
  async writeHashed(repo: string, hash: string, data: Uint8Array): Promise<string> {
    await this.store(repo, hash, data);
    return hash;
  }

  /**
   * Stores bytes under their hash, or re-references the object when the store
   * holds it.
   *
   * @throws {Error} When a sweep took the write in flight for abandoned, as
   *   one with no age gate beside running work may: nothing is stored
   */
  private async store(repo: string, hash: string, data: Uint8Array): Promise<void> {
    const blob = crypto.randomUUID();
    const held = await this.records.transact(async (tx) => {
      const record = await readObject(tx, repo, hash);
      if (record !== null) {
        tx.put(recordKeys.object(repo, hash), referenced(record, Date.now()));
        return true;
      }
      tx.put(recordKeys.pending(repo, blob), encodePending({ hash, at: BigInt(Date.now()) }));
      return false;
    });
    if (held) return;
    try {
      await this.blobs.write(blobKey(repo, blob), data);
    } catch (err) {
      // The blob store kept nothing of it; the record in flight goes too, or
      // else gc's sweep takes it once it is past the age gate.
      await writeRecords(this.records, (tx) => tx.delete(recordKeys.pending(repo, blob))).catch(() => undefined);
      throw err;
    }
    const redundant = await this.records.transact(async (tx) => {
      if ((await tx.get(recordKeys.pending(repo, blob))) === null) {
        throw new Error(`the write of object ${hash} was taken for abandoned by gc's sweep before it finished: write it again`);
      }
      tx.delete(recordKeys.pending(repo, blob));
      const record = await readObject(tx, repo, hash);
      if (record !== null) {
        tx.put(recordKeys.object(repo, hash), referenced(record, Date.now()));
        return true;
      }
      tx.put(recordKeys.object(repo, hash), encodeObject({
        blob, size: BigInt(data.length), writtenAt: BigInt(Date.now()), unreachableSince: none,
      }));
      return false;
    });
    // Another write stored the same bytes first: this one's blob names nothing.
    if (redundant) await this.blobs.delete(blobKey(repo, blob));
  }

  async touch(repo: string, hashes: readonly string[]): Promise<boolean[]> {
    if (hashes.length === 0) return [];
    return this.records.transact(async (tx) => {
      const now = Date.now();
      const held: boolean[] = [];
      for (const hash of hashes) {
        const record = await readObject(tx, repo, hash);
        if (record !== null) tx.put(recordKeys.object(repo, hash), referenced(record, now));
        held.push(record !== null);
      }
      return held;
    });
  }

  /** An object's entry, or `ObjectNotFoundError`. */
  private async entry(repo: string, hash: string): Promise<ObjectRecord> {
    const record = await readObject(this.records, repo, hash);
    if (record === null) throw new ObjectNotFoundError(hash);
    return record;
  }

  async read(repo: string, hash: string): Promise<Uint8Array> {
    const data = await this.blobs.read(blobKey(repo, (await this.entry(repo, hash)).blob));
    // Deleted between its entry's read and its blob's
    if (data === null) throw new ObjectNotFoundError(hash);
    return data;
  }

  async readRange(repo: string, hash: string, offset: number, length: number): Promise<Uint8Array> {
    const data = await this.blobs.readRange(blobKey(repo, (await this.entry(repo, hash)).blob), offset, length);
    if (data === null) throw new ObjectNotFoundError(hash);
    return data;
  }

  async adoptFile(repo: string, file: string, hash?: string): Promise<{ hash: string; size: number }> {
    if (hash !== undefined && (await this.touch(repo, [hash]))[0] === true) {
      const record = await readObject(this.records, repo, hash);
      // Deleted meanwhile: the file, which is at hand, is stored again below
      if (record !== null) return { hash, size: Number(record.size) };
    }
    const data = await collect(this.files.read(file));
    const digest = computeHash(data);
    if (hash !== undefined && digest !== hash) {
      throw new Error(`adoptFile: ${file} holds ${digest}, not the ${hash} it was adopted as`);
    }
    await this.store(repo, digest, data);
    return { hash: digest, size: data.length };
  }

  async materialize(repo: string, hash: string, destPath: string): Promise<void> {
    const record = await this.entry(repo, hash);
    const key = blobKey(repo, record.blob);
    const size = Number(record.size);
    const blobs = this.blobs;
    async function* ranges(): AsyncIterable<Uint8Array> {
      for (let offset = 0; offset < size; offset += PLACE_CHUNK) {
        const chunk = await blobs.readRange(key, offset, Math.min(PLACE_CHUNK, size - offset));
        if (chunk === null) throw new ObjectNotFoundError(hash);
        yield chunk;
      }
    }
    await this.files.write(destPath, ranges());
  }

  async exists(repo: string, hash: string): Promise<boolean> {
    return (await readObject(this.records, repo, hash)) !== null;
  }

  async stat(repo: string, hash: string): Promise<{ size: number }> {
    return { size: Number((await this.entry(repo, hash)).size) };
  }

  async list(repo: string): Promise<string[]> {
    return (await this.records.keys(recordKeys.kind(repo, 'object'))).map((key) => key[3]!);
  }

  async count(repo: string): Promise<number> {
    return (await this.records.keys(recordKeys.kind(repo, 'object'))).length;
  }
}

// =============================================================================
// Refs
// =============================================================================

/**
 * The repository record, package and workspace refs, execution attempts with
 * their owners and plans, the adoption memo and dataflow runs, each a record.
 */
class WebRefStore implements RefStore {
  constructor(private readonly records: RecordsAdapter) {}

  async repositoryRead(repo: string): Promise<RepositoryRecord | null> {
    const data = await this.records.get(recordKeys.record(repo));
    if (data === null) return null;
    // One that does not decode is none this e3 reads: an older e3 wrote it.
    try {
      return decodeRepositoryRecord(data);
    } catch {
      return null;
    }
  }

  async repositoryWrite(repo: string, record: RepositoryRecord): Promise<void> {
    await writeRecords(this.records, (tx) => tx.put(recordKeys.record(repo), encodeRepositoryRecord(record)));
  }

  async packageList(repo: string): Promise<{ name: string; version: string }[]> {
    return (await this.records.keys(recordKeys.kind(repo, 'package'))).map((key) => ({ name: key[3]!, version: key[4]! }));
  }

  async packageResolve(repo: string, name: string, version: string): Promise<string | null> {
    checkName('package', name);
    checkName('package version', version);
    return hashOf(await this.records.get(recordKeys.package(repo, name, version)));
  }

  async packageWrite(repo: string, name: string, version: string, hash: string): Promise<void> {
    checkName('package', name);
    checkName('package version', version);
    await writeRecords(this.records, (tx) => tx.put(recordKeys.package(repo, name, version), encodeHash(hash)));
  }

  async packageRemove(repo: string, name: string, version: string): Promise<void> {
    checkName('package', name);
    checkName('package version', version);
    await writeRecords(this.records, (tx) => tx.delete(recordKeys.package(repo, name, version)));
  }

  async workspaceList(repo: string): Promise<string[]> {
    return (await this.records.keys(recordKeys.kind(repo, 'workspace'))).map((key) => key[3]!);
  }

  async workspaceRead(repo: string, name: string): Promise<Uint8Array | null> {
    checkName('workspace', name);
    return this.records.get(recordKeys.workspace(repo, name));
  }

  async workspaceWrite(repo: string, name: string, state: Uint8Array): Promise<void> {
    checkName('workspace', name);
    await writeRecords(this.records, (tx) => tx.put(recordKeys.workspace(repo, name), state));
  }

  /**
   * Removes a workspace's record, and with it everything kept under its name:
   * its dataset refs, its runs' records and its runs' state. Its locks are the
   * lock service's, which takes the state a closed tab left for no one's, and
   * writes over it when the lock is next held.
   */
  async workspaceRemove(repo: string, name: string): Promise<void> {
    checkName('workspace', name);
    await writeRecords(this.records, (tx) => {
      tx.delete(recordKeys.workspace(repo, name));
      tx.deletePrefix([...recordKeys.kind(repo, 'dataset'), name]);
      tx.deletePrefix([...recordKeys.kind(repo, 'run'), name]);
      tx.deletePrefix([...recordKeys.kind(repo, 'state'), name]);
    });
  }

  async executionGet(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionStatus | null> {
    checkExecution(taskHash, inputsHash, executionId);
    const data = await this.records.get(recordKeys.execution(repo, taskHash, inputsHash, executionId));
    return data === null ? null : statusOf(taskHash, inputsHash, data);
  }

  async executionWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, status: ExecutionStatus): Promise<void> {
    checkExecution(taskHash, inputsHash, executionId);
    await writeRecords(this.records, (tx) => tx.put(recordKeys.execution(repo, taskHash, inputsHash, executionId), encodeStatus(status)));
  }

  async executionDelete(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void> {
    checkExecution(taskHash, inputsHash, executionId);
    await writeRecords(this.records, (tx) => {
      tx.delete(recordKeys.execution(repo, taskHash, inputsHash, executionId));
      tx.delete(recordKeys.owner(repo, taskHash, inputsHash, executionId));
    });
  }

  async executionListIds(repo: string, taskHash: string, inputsHash: string): Promise<string[]> {
    checkExecution(taskHash, inputsHash);
    const keys = await this.records.keys([...recordKeys.kind(repo, 'execution'), taskHash, inputsHash]);
    return keys.map((key) => key[5]!).filter(isUuidv7);
  }

  async executionGetLatest(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null> {
    checkExecution(taskHash, inputsHash);
    const [latest] = await this.records.scan([...recordKeys.kind(repo, 'execution'), taskHash, inputsHash], { reverse: true, limit: 1 });
    return latest === undefined ? null : statusOf(taskHash, inputsHash, latest.value);
  }

  /** Lists every execution: each task and inputs an attempt or a plan is recorded under. */
  async executionList(repo: string): Promise<{ taskHash: string; inputsHash: string }[]> {
    const found = new Map<string, { taskHash: string; inputsHash: string }>();
    for (const kind of ['execution', 'plan']) {
      for (const key of await this.records.keys(recordKeys.kind(repo, kind))) {
        const [taskHash, inputsHash] = [key[3]!, key[4]!];
        found.set(JSON.stringify([taskHash, inputsHash]), { taskHash, inputsHash });
      }
    }
    return [...found.values()];
  }

  async executionListForTask(repo: string, taskHash: string): Promise<string[]> {
    if (!isObjectHash(taskHash)) throw new Error(`'${taskHash}' is not a task hash`);
    const found = new Set<string>();
    for (const kind of ['execution', 'plan']) {
      for (const key of await this.records.keys([...recordKeys.kind(repo, kind), taskHash])) found.add(key[4]!);
    }
    return [...found];
  }

  /** Lists the latest attempt of each of a task's inputs, in one scan of its attempts. */
  async executionListLatest(repo: string, taskHash: string): Promise<Array<{ inputsHash: string; status: ExecutionStatus }>> {
    if (!isObjectHash(taskHash)) throw new Error(`'${taskHash}' is not a task hash`);
    const latest = new Map<string, Uint8Array>();
    // In key order, so an inputs' last attempt is its latest.
    for (const { key, value } of await this.records.scan([...recordKeys.kind(repo, 'execution'), taskHash])) latest.set(key[4]!, value);
    return [...latest].map(([inputsHash, data]) => ({ inputsHash, status: statusOf(taskHash, inputsHash, data) }));
  }

  async executionOwnerWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, owner: ExecutionOwner): Promise<void> {
    checkExecution(taskHash, inputsHash, executionId);
    await writeRecords(this.records, (tx) => tx.put(recordKeys.owner(repo, taskHash, inputsHash, executionId), encodeOwner(owner)));
  }

  async executionOwnerRead(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionOwner | null> {
    checkExecution(taskHash, inputsHash, executionId);
    const data = await this.records.get(recordKeys.owner(repo, taskHash, inputsHash, executionId));
    if (data === null) return null;
    // The owner is advisory: one that does not decode is none recorded, so a
    // stale `running` record, which a dead owner's is, is left alone.
    try {
      return decodeOwner(data);
    } catch {
      return null;
    }
  }

  async executionPlanWrite(repo: string, taskHash: string, inputsHash: string, planHash: string | null): Promise<void> {
    checkExecution(taskHash, inputsHash);
    await writeRecords(this.records, (tx) => {
      if (planHash === null) tx.delete(recordKeys.plan(repo, taskHash, inputsHash));
      else tx.put(recordKeys.plan(repo, taskHash, inputsHash), encodeHash(planHash));
    });
  }

  async executionPlanRead(repo: string, taskHash: string, inputsHash: string): Promise<string | null> {
    checkExecution(taskHash, inputsHash);
    return hashOf(await this.records.get(recordKeys.plan(repo, taskHash, inputsHash)));
  }

  async adoptionWrite(repo: string, sourceHash: string, manifestHash: string): Promise<void> {
    if (!isObjectHash(sourceHash)) throw new Error(`adoption memo: '${sourceHash}' is not a SHA-256`);
    await writeRecords(this.records, (tx) => tx.put(recordKeys.adoption(repo, sourceHash), encodeHash(manifestHash)));
  }

  async adoptionRead(repo: string, sourceHash: string): Promise<string | null> {
    if (!isObjectHash(sourceHash)) return null;
    return hashOf(await this.records.get(recordKeys.adoption(repo, sourceHash)));
  }

  async adoptionList(repo: string): Promise<Array<{ sourceHash: string; manifestHash: string | null }>> {
    return (await this.records.scan(recordKeys.kind(repo, 'adoption'))).map(({ key, value }) => ({ sourceHash: key[3]!, manifestHash: hashOf(value) }));
  }

  async adoptionDelete(repo: string, sourceHash: string): Promise<void> {
    if (!isObjectHash(sourceHash)) return;
    await writeRecords(this.records, (tx) => tx.delete(recordKeys.adoption(repo, sourceHash)));
  }

  /** A run's key, its workspace and id checked. */
  private runKey(repo: string, workspace: string, runId: string): RecordKey {
    checkName('workspace', workspace);
    if (!isUuidv7(runId)) throw new Error(`'${runId}' is not a run id`);
    return recordKeys.run(repo, workspace, runId);
  }

  async dataflowRunGet(repo: string, workspace: string, runId: string): Promise<DataflowRun | null> {
    const data = await this.records.get(this.runKey(repo, workspace, runId));
    return data === null ? null : decodeRun(data);
  }

  async dataflowRunWrite(repo: string, workspace: string, run: DataflowRun): Promise<void> {
    const key = this.runKey(repo, workspace, run.runId);
    await writeRecords(this.records, (tx) => tx.put(key, encodeRun(run)));
  }

  async dataflowRunList(repo: string, workspace: string): Promise<string[]> {
    checkName('workspace', workspace);
    return (await this.records.keys([...recordKeys.kind(repo, 'run'), workspace])).map((key) => key[4]!).filter(isUuidv7);
  }

  async dataflowRunGetLatest(repo: string, workspace: string): Promise<DataflowRun | null> {
    checkName('workspace', workspace);
    const [latest] = await this.records.scan([...recordKeys.kind(repo, 'run'), workspace], { reverse: true, limit: 1 });
    return latest === undefined ? null : decodeRun(latest.value);
  }

  async dataflowRunDelete(repo: string, workspace: string, runId: string): Promise<void> {
    const key = this.runKey(repo, workspace, runId);
    await writeRecords(this.records, (tx) => tx.delete(key));
  }
}

/** An attempt's status, or `ExecutionCorruptError` for one that does not decode. */
function statusOf(taskHash: string, inputsHash: string, data: Uint8Array): ExecutionStatus {
  try {
    return decodeExecutionStatus(data);
  } catch (err) {
    throw new ExecutionCorruptError(taskHash, inputsHash, err instanceof Error ? err : new Error(`${err as string}`));
  }
}

// =============================================================================
// Locks
// =============================================================================

/**
 * Locks through the locks adapter — Web Locks in a browser — whose state
 * another tab reads from the records.
 *
 * @remarks
 * The lock itself is the adapter's: a Web Lock, which the browser frees when
 * the tab that holds it closes. An exclusive holder writes its state, and its
 * progress reports, as records while it holds the lock, and deletes them before
 * it lets the lock go. A state is the holder's only while the lock is held and
 * its session alive, so a tab closed mid-hold leaves a state no reader takes
 * for held, and the next holder writes over.
 *
 * A holder is this tab's session: a `process` with pid 0 and the session's id
 * as its `bootId`.
 */
class WebLockService implements LockService {
  constructor(private readonly records: RecordsAdapter, private readonly locks: LocksAdapter) {}

  /** The adapter's name for a repository's resource. */
  private nameOf(repo: string, resource: string): string {
    return JSON.stringify([repo, resource]);
  }

  /** This session, as a lock's holder. */
  private holder(): LockHolderVariant {
    return variant('process', { pid: 0n, bootId: this.locks.session, startTime: 0n, command: 'e3-web' });
  }

  async acquire(
    repo: string,
    resource: string,
    operation: LockOperation,
    options?: { wait?: boolean; timeout?: number; mode?: 'shared' | 'exclusive' },
  ): Promise<LockHandle | null> {
    checkName('lock', resource);
    const mode = options?.mode ?? 'exclusive';
    // A waiting acquire waits 30 s unless told otherwise, as every service's does.
    const wait = options?.wait === true ? { wait: true, timeout: options.timeout ?? 30_000 } : {};
    const hold = await this.locks.acquire(this.nameOf(repo, resource), mode, wait);
    if (hold === null) return null;
    if (mode === 'shared') {
      // A shared holder's report is not kept: progress is the exclusive holder's.
      return { resource, report: () => Promise.resolve(), release: () => hold.release() };
    }
    const state: LockState = { operation, holder: this.holder(), acquiredAt: new Date(), expiresAt: none };
    try {
      await writeRecords(this.records, (tx) => {
        tx.put(recordKeys.lock(repo, resource), encodeLockState(state));
        tx.delete(recordKeys.progress(repo, resource));
      });
    } catch (err) {
      await hold.release();
      throw err;
    }
    const stamp = { holder: state.holder, acquiredAt: state.acquiredAt };
    let released = false;
    // Reports land in order, one at a time, and the release waits for the last.
    let reporting: Promise<void> = Promise.resolve();
    return {
      resource,
      report: (progress: LockProgress): Promise<void> => {
        if (released) return Promise.resolve();
        reporting = reporting.catch(() => undefined).then(() =>
          writeRecords(this.records, (tx) => tx.put(recordKeys.progress(repo, resource), encodeProgress({ ...stamp, progress }))));
        return reporting;
      },
      release: async (): Promise<void> => {
        if (released) return;
        released = true;
        await reporting.catch(() => undefined);
        try {
          await this.records.transact(async (tx) => {
            if (writtenBy(await tx.get(recordKeys.lock(repo, resource)), stamp)) tx.delete(recordKeys.lock(repo, resource));
            tx.delete(recordKeys.progress(repo, resource));
          });
        } finally {
          await hold.release();
        }
      },
    };
  }

  async getState(repo: string, resource: string): Promise<LockState | null> {
    checkName('lock', resource);
    const data = await this.records.get(recordKeys.lock(repo, resource));
    if (data === null) return null;
    let state: LockState;
    try {
      state = decodeLockState(data);
    } catch {
      return null;
    }
    // A state is a holder's only while the lock is held, and the holder alive.
    if (!(await this.locks.held(this.nameOf(repo, resource))).includes('exclusive')) return null;
    return (await this.isHolderAlive(state.holder)) ? state : null;
  }

  async getProgress(repo: string, resource: string): Promise<LockProgress | null> {
    const state = await this.getState(repo, resource);
    if (state === null) return null;
    const data = await this.records.get(recordKeys.progress(repo, resource));
    if (data === null) return null;
    let record: ValueTypeOf<typeof ProgressRecordType>;
    try {
      record = decodeProgress(data);
    } catch {
      return null; // a report is advisory: one that does not decode is none
    }
    // Only the live holder's report: a closed tab's is no one's.
    return sameHolder({ holder: record.holder, acquiredAt: record.acquiredAt }, { holder: state.holder, acquiredAt: state.acquiredAt })
      ? record.progress
      : null;
  }

  /**
   * Whether a lock's holder is alive: a tab's session, pid 0, whose session
   * Web Locks holds. No other holder takes a lock over these stores.
   */
  async isHolderAlive(holder: LockHolderVariant): Promise<boolean> {
    if (holder.type !== 'process' || holder.value.pid !== 0n) return false;
    return this.locks.isAlive(holder.value.bootId);
  }
}

// =============================================================================
// Logs
// =============================================================================

/**
 * How a log chunk's key names the byte of the log it starts at: in decimal,
 * zero-padded to the sixteen digits any safe integer fits in, so keys order as
 * the bytes do.
 */
function logStartName(start: number): string {
  return start.toString().padStart(16, '0');
}

/** The byte of the log a chunk starts at, as its key names it. */
function logStartOf(key: RecordKey): number {
  return Number(key[key.length - 1]);
}

/** The log a read finds no chunk of: never written, or removed. */
const EMPTY_LOG: LogChunk = { data: '', offset: 0, size: 0, totalSize: 0, complete: true };

/**
 * Execution logs, each append a record of its own under the attempt's
 * stream, keyed by the byte of the log it starts at, so a read cuts a window
 * of bytes from the few chunks it covers, as a local log file's read seeks to
 * it, however many appends the log took.
 */
class WebLogStore implements LogStore {
  constructor(private readonly records: RecordsAdapter) {}

  /** The prefix of the records an attempt's stream is kept in, a chunk each. */
  private streamKey(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: 'stdout' | 'stderr'): RecordKey {
    checkExecution(taskHash, inputsHash, executionId);
    return [...recordKeys.kind(repo, 'log'), taskHash, inputsHash, executionId, stream];
  }

  /** Appends a chunk where the stream's last chunk ends, in the transaction
   *  that reads the last chunk, so two appends never take one place. */
  async append(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: 'stdout' | 'stderr', data: string): Promise<void> {
    const prefix = this.streamKey(repo, taskHash, inputsHash, executionId, stream);
    const bytes = new TextEncoder().encode(data);
    if (bytes.length === 0) return;
    await this.records.transact(async (tx) => {
      const [last] = await tx.scan(prefix, { reverse: true, limit: 1 });
      tx.put([...prefix, logStartName(last === undefined ? 0 : logStartOf(last.key) + last.value.length)], bytes);
    });
  }

  /**
   * Reads a window of a stream's bytes from the chunks it covers: the log's
   * size from its last chunk, the chunk holding the window's first byte, and
   * the chunks that start inside the window.
   *
   * @remarks
   * A chunk, once appended, never changes, and an append only adds one after
   * the last, so the three reads answer as of the first: a chunk appended
   * meanwhile starts past the window.
   *
   * @throws {RangeError} When the offset or the limit is not a whole number of
   *   zero or more
   */
  async read(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    options?: { offset?: number; limit?: number },
  ): Promise<LogChunk> {
    const prefix = this.streamKey(repo, taskHash, inputsHash, executionId, stream);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 65536;
    for (const [what, value] of [['offset', offset], ['limit', limit]] as const) {
      if (!(Number.isSafeInteger(value) && value >= 0)) throw new RangeError(`a log window's ${what} is a whole number of zero or more, not ${value}`);
    }
    const [last] = await this.records.scan(prefix, { reverse: true, limit: 1 });
    if (last === undefined) return EMPTY_LOG;
    const totalSize = logStartOf(last.key) + last.value.length;
    const window = new Uint8Array(Math.max(0, Math.min(limit, totalSize - offset)));
    if (window.length > 0) {
      const [first] = await this.records.scan(prefix, { before: [...prefix, logStartName(offset + 1)], reverse: true, limit: 1 });
      if (first === undefined) return EMPTY_LOG; // removed meanwhile
      const rest = await this.records.scan(prefix, { after: first.key, before: [...prefix, logStartName(offset + window.length)] });
      for (const { key, value } of [first, ...rest]) {
        const start = logStartOf(key);
        const from = Math.max(offset, start);
        const to = Math.min(offset + window.length, start + value.length);
        if (from < to) window.set(value.subarray(from - start, to - start), from - offset);
      }
    }
    // Stop short of a split character, unless the window reaches the log's end.
    const size = offset + window.length >= totalSize ? window.length : completeUtf8Length(window) || window.length;
    return {
      data: new TextDecoder().decode(window.subarray(0, size)),
      offset,
      size,
      totalSize,
      complete: offset + size >= totalSize,
    };
  }

  /** Holds nothing to flush: an append is a record of the transaction that
   *  wrote it, readable by every tab once the append resolves. */
  flush(): Promise<void> {
    return Promise.resolve();
  }

  async remove(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void> {
    checkExecution(taskHash, inputsHash, executionId);
    await writeRecords(this.records, (tx) => tx.deletePrefix([...recordKeys.kind(repo, 'log'), taskHash, inputsHash, executionId]));
  }
}

// =============================================================================
// Dataset refs
// =============================================================================

/**
 * Per-dataset refs, each a record beside the revision its write minted — a
 * fresh UUID per write, so two byte-identical refs still differ — compared and
 * swapped in one transaction.
 */
class WebDatasetRefStore implements DatasetRefStore {
  constructor(private readonly records: RecordsAdapter) {}

  /** A ref's key, its workspace checked. */
  private key(repo: string, ws: string, path: string): RecordKey {
    checkName('workspace', ws);
    return recordKeys.dataset(repo, ws, path);
  }

  async read(repo: string, ws: string, path: string): Promise<DatasetRef | null> {
    const data = await this.records.get(this.key(repo, ws, path));
    return data === null ? null : decodeRevisioned(data).ref;
  }

  async write(repo: string, ws: string, path: string, ref: DatasetRef): Promise<void> {
    const key = this.key(repo, ws, path);
    await writeRecords(this.records, (tx) => tx.put(key, encodeRevisioned({ revision: crypto.randomUUID(), ref })));
  }

  async readVersioned(repo: string, ws: string, path: string): Promise<{ ref: DatasetRef; revision: string } | null> {
    const data = await this.records.get(this.key(repo, ws, path));
    return data === null ? null : decodeRevisioned(data);
  }

  async writeIf(repo: string, ws: string, path: string, ref: DatasetRef, expectedRevision: string | null): Promise<{ revision: string }> {
    const key = this.key(repo, ws, path);
    return this.records.transact(async (tx) => {
      const current = await tx.get(key);
      const currentRevision = current === null ? null : decodeRevisioned(current).revision;
      if (currentRevision !== expectedRevision) throw new DatasetRefConflictError(ws, path, expectedRevision, currentRevision);
      const revision = crypto.randomUUID();
      tx.put(key, encodeRevisioned({ revision, ref }));
      return { revision };
    });
  }

  async list(repo: string, ws: string): Promise<string[]> {
    checkName('workspace', ws);
    return (await this.records.keys([...recordKeys.kind(repo, 'dataset'), ws])).map((key) => key[4]!);
  }

  async remove(repo: string, ws: string, path: string): Promise<void> {
    const key = this.key(repo, ws, path);
    await writeRecords(this.records, (tx) => tx.delete(key));
  }

  async removeAll(repo: string, ws: string): Promise<void> {
    checkName('workspace', ws);
    await writeRecords(this.records, (tx) => tx.deletePrefix([...recordKeys.kind(repo, 'dataset'), ws]));
  }
}

// =============================================================================
// Repositories and gc's primitives
// =============================================================================

/** How many objects a page of gc's object scan lists. */
const SCAN_PAGE = 1000;

/** The kinds of a repository's records that are its objects: the catalogue,
 *  and the writes of blobs in flight. */
const OBJECT_KINDS = new Set(['object', 'pending']);

/**
 * Repositories — each a metadata record, with its records under its name and
 * its blobs under its name — and gc's primitives over the catalogue.
 */
class WebRepoStore implements RepoStore {
  constructor(
    private readonly records: RecordsAdapter,
    private readonly blobs: BlobsAdapter,
    private readonly refs: RefStore,
    private readonly datasets: DatasetRefStore,
    private readonly upgrades: readonly RepositoryUpgrade[],
  ) {}

  async list(): Promise<string[]> {
    return (await this.records.keys(recordKeys.repositories())).map((key) => key[1]!);
  }

  async exists(repo: string): Promise<boolean> {
    checkName('repository', repo);
    return (await this.records.get(recordKeys.repository(repo))) !== null;
  }

  async getMetadata(repo: string): Promise<RepoMetadata | null> {
    checkName('repository', repo);
    const data = await this.records.get(recordKeys.repository(repo));
    return data === null ? null : decodeMetadata(data);
  }

  /** Creates a repository: its metadata and its record, in one transaction. */
  async create(repo: string): Promise<void> {
    checkName('repository', repo);
    const now = new Date();
    await this.records.transact(async (tx) => {
      if ((await tx.get(recordKeys.repository(repo))) !== null) throw new RepoAlreadyExistsError(repo);
      tx.put(recordKeys.record(repo), encodeRepositoryRecord(newRepositoryRecord(this.upgrades)));
      tx.put(recordKeys.repository(repo), encodeMetadata({ name: repo, status: variant('active', null), createdAt: now, statusChangedAt: now }));
    });
  }

  async setStatus(repo: string, status: RepoStatusName, expected?: RepoStatusName | RepoStatusName[]): Promise<void> {
    checkName('repository', repo);
    await this.records.transact(async (tx) => {
      const data = await tx.get(recordKeys.repository(repo));
      if (data === null) throw new RepoNotFoundError(repo);
      const current = decodeMetadata(data);
      if (expected !== undefined && !(Array.isArray(expected) ? expected : [expected]).includes(current.status.type)) {
        throw new RepoStatusConflictError(repo, expected, current.status.type);
      }
      tx.put(recordKeys.repository(repo), encodeMetadata({ ...current, status: variant(status, null), statusChangedAt: new Date() }));
    });
  }

  async remove(repo: string): Promise<void> {
    checkName('repository', repo);
    // Whatever the batches left goes with it.
    await this.deleteRefsBatch(repo);
    await this.deleteObjectsBatch(repo);
    await writeRecords(this.records, (tx) => tx.delete(recordKeys.repository(repo)));
  }

  async deleteRefsBatch(repo: string, _cursor?: string): Promise<BatchResult> {
    checkName('repository', repo);
    return this.records.transact(async (tx) => {
      const keys = (await tx.keys(recordKeys.of(repo))).filter((key) => !OBJECT_KINDS.has(key[2]!));
      for (const kind of new Set(keys.map((key) => key[2]!))) tx.deletePrefix(recordKeys.kind(repo, kind));
      return { status: 'done', deleted: keys.length };
    });
  }

  async deleteObjectsBatch(repo: string, _cursor?: string): Promise<BatchResult> {
    checkName('repository', repo);
    const deleted = await this.records.transact(async (tx) => {
      const count = (await tx.keys(recordKeys.kind(repo, 'object'))).length;
      for (const kind of OBJECT_KINDS) tx.deletePrefix(recordKeys.kind(repo, kind));
      return count;
    });
    await this.blobs.deletePrefix([repo]);
    return { status: 'done', deleted };
  }

  async gcScanPackageRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: await packageRoots(this.refs, repo) };
  }

  async gcScanWorkspaceRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: await workspaceRoots(this.refs, this.datasets, repo) };
  }

  async gcScanExecutionRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: await executionRoots(this.refs, repo) };
  }

  /** A page of the catalogue, a thousand objects at a time; the cursor is the
   *  last page's last hash. */
  async gcScanObjects(repo: string, cursor?: string): Promise<GcObjectScanResult> {
    const entries = await this.records.scan(recordKeys.kind(repo, 'object'), {
      ...(cursor !== undefined && { after: recordKeys.object(repo, cursor) }),
      limit: SCAN_PAGE + 1,
    });
    const objects: GcObjectEntry[] = entries.slice(0, SCAN_PAGE).map(({ key, value }) => {
      const record = decodeObject(value);
      return {
        hash: key[3]!,
        lastModified: Number(record.writtenAt),
        size: Number(record.size),
        unreachableSince: record.unreachableSince.type === 'some' ? Number(record.unreachableSince.value) : null,
      };
    });
    return entries.length > SCAN_PAGE ? { objects, cursor: objects[objects.length - 1]!.hash } : { objects };
  }

  /** Deletes objects' entries, and then their blobs: a blob a failure leaves
   *  is the backend's sweep's. */
  async gcDeleteObjects(repo: string, hashes: string[]): Promise<void> {
    const blobs = await this.records.transact(async (tx) => {
      const gone: string[] = [];
      for (const hash of hashes) {
        const record = await readObject(tx, repo, hash);
        if (record === null) continue;
        tx.delete(recordKeys.object(repo, hash));
        gone.push(record.blob);
      }
      return gone;
    });
    for (const blob of blobs) await this.blobs.delete(blobKey(repo, blob));
  }

  async gcNoteUnreachable(repo: string, hashes: readonly string[], at: number): Promise<number[]> {
    if (hashes.length === 0) return [];
    return this.records.transact(async (tx) => {
      const sinces: number[] = [];
      for (const hash of hashes) {
        const record = await readObject(tx, repo, hash);
        if (record === null) {
          sinces.push(at);
        } else if (record.unreachableSince.type === 'some') {
          sinces.push(Number(record.unreachableSince.value));
        } else {
          tx.put(recordKeys.object(repo, hash), encodeObject({ ...record, unreachableSince: some(BigInt(at)) }));
          sinces.push(at);
        }
      }
      return sinces;
    });
  }

  async gcClearUnreachable(repo: string, hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) return;
    await this.records.transact(async (tx) => {
      for (const hash of hashes) {
        const record = await readObject(tx, repo, hash);
        if (record !== null && record.unreachableSince.type === 'some') {
          tx.put(recordKeys.object(repo, hash), encodeObject({ ...record, unreachableSince: none }));
        }
      }
    });
  }

  /**
   * Deletes an object while its note stands at `since`: its entry in the
   * transaction that finds the note, and then the blob the entry named. A
   * write after that stores its bytes as a blob of its own, which the delete
   * never takes.
   */
  async gcDeleteUnreachable(repo: string, hash: string, since: number): Promise<boolean> {
    const blob = await this.records.transact(async (tx) => {
      const record = await readObject(tx, repo, hash);
      if (record === null || record.unreachableSince.type !== 'some' || Number(record.unreachableSince.value) !== since) return null;
      tx.delete(recordKeys.object(repo, hash));
      return record.blob;
    });
    if (blob === null) return false;
    await this.blobs.delete(blobKey(repo, blob));
    return true;
  }

  /** A gc run's part's key, its run and name checked. */
  private gcRunKey(repo: string, run: string, name: string): RecordKey {
    if (!isUuidv7(run)) throw new Error(`'${run}' is not a gc run's id`);
    if (!/^[a-z0-9][a-z0-9.]*$/.test(name)) throw new Error(`'${name}' is not the name of a gc run's part`);
    return recordKeys.gcRun(repo, run, name);
  }

  async gcRunWrite(repo: string, run: string, name: string, data: Uint8Array): Promise<void> {
    const key = this.gcRunKey(repo, run, name);
    await writeRecords(this.records, (tx) => tx.put(key, data));
  }

  async gcRunRead(repo: string, run: string, name: string): Promise<Uint8Array | null> {
    return this.records.get(this.gcRunKey(repo, run, name));
  }

  async gcRunDelete(repo: string, run: string): Promise<void> {
    if (!isUuidv7(run)) throw new Error(`'${run}' is not a gc run's id`);
    await writeRecords(this.records, (tx) => tx.deletePrefix([...recordKeys.kind(repo, 'gc'), run]));
  }

  /**
   * Sweeps what writes and deletes that never finished left: what the blob
   * store staged (a tab closed mid-write), a write in flight recorded longer
   * ago than the age gate, with its blob, and the blobs nothing names — a
   * delete cut short between an entry and its blob, or a write's blob that
   * another write of the same bytes beat to the catalogue — and what transfers
   * staged ({@link stagedKeys}) that no transfer's record names, past the age
   * gate, or that is older than {@link TRANSFER_RETENTION_MS}.
   *
   * @remarks
   * A write in flight younger than the age gate is left; one older is taken
   * for abandoned, and if it is still going it fails rather than store
   * anything, as a local repository's write does when a sweep takes its
   * staging file.
   *
   * The blobs are listed before the records that name them are read, and the
   * writes in flight before the entries: a blob is there only once its write
   * has recorded itself in flight, and a write's record in flight goes in the
   * transaction that names its blob in the catalogue, so a blob a write has
   * not finished with is named by one read or the other.
   */
  async gcSweepBackend(repo: string, _reachable: ReadonlySet<string>, options: GcBackendSweepOptions): Promise<GcBackendSweepResult> {
    const { minAge, dryRun } = options;
    const staged = await this.blobs.sweep({ minAge, dryRun });
    let deletedPartials = staged.deleted;
    let skippedYoung = staged.skippedYoung;

    // Writes in flight longer than the age gate: abandoned
    const now = Date.now();
    for (const { key, value } of await this.records.scan(recordKeys.kind(repo, 'pending'))) {
      if (minAge > 0 && now - Number(decodePending(value).at) < minAge) {
        skippedYoung++;
        continue;
      }
      if (!dryRun) {
        const taken = await this.records.transact(async (tx) => {
          if ((await tx.get(key)) === null) return false; // finished meanwhile
          tx.delete(key);
          return true;
        });
        if (!taken) continue;
        await this.blobs.delete(blobKey(repo, key[3]!));
      }
      deletedPartials++;
    }

    // Blobs nothing names
    const listed = await this.blobs.list([repo, 'objects']);
    const named = new Set<string>();
    for (const key of await this.records.keys(recordKeys.kind(repo, 'pending'))) named.add(key[3]!);
    for (const { value } of await this.records.scan(recordKeys.kind(repo, 'object'))) named.add(decodeObject(value).blob);
    for (const { key } of listed) {
      if (named.has(key[key.length - 1]!)) continue;
      if (!dryRun) await this.blobs.delete(key);
      deletedPartials++;
    }

    // What transfers staged that no record names — a tab closed between a
    // transfer's record going and its staging — or that is past its
    // retention, as a local repository's sweep takes its staged transfers.
    // The blobs are listed before the records are read, so a transfer
    // staging now is named by its record.
    const transfers = new Map<string, { count: number; newest: number }>();
    for (const { key, lastModified } of await this.blobs.list(stagedKeys.all(repo))) {
      const id = key[2];
      if (id === undefined) continue;
      const seen = transfers.get(id) ?? { count: 0, newest: 0 };
      transfers.set(id, { count: seen.count + 1, newest: Math.max(seen.newest, lastModified) });
    }
    if (transfers.size > 0) {
      const recorded = new Set((await this.records.keys(transferKeys.all())).map((key) => key[2]!));
      for (const [id, { count, newest }] of transfers) {
        const stale = now - newest > TRANSFER_RETENTION_MS;
        if (recorded.has(id) && !stale) continue;
        if (!stale && minAge > 0 && now - newest < minAge) {
          skippedYoung += count;
          continue;
        }
        if (!dryRun) await this.blobs.deletePrefix(stagedKeys.of(repo, id));
        deletedPartials += count;
      }
    }
    return { deletedPartials, skippedYoung };
  }
}

// =============================================================================
// The backend
// =============================================================================

/**
 * The upgrades of e3-web's own layout — its records' keys and its blobs — in
 * the order they apply: none yet. A release that changes the layout appends
 * its step here, and never edits, reorders or removes one a release shipped.
 */
export const WEB_REPOSITORY_UPGRADES: RepositoryUpgrade[] = [];

/**
 * The adapters a {@link WebStorage} keeps its repositories over.
 */
export interface WebAdapters {
  /** The records: refs, dataset refs, executions, lock states, the catalogue */
  readonly records: RecordsAdapter;
  /** The objects' blobs */
  readonly blobs: BlobsAdapter;
  /** The locks, taken by this tab's session */
  readonly locks: LocksAdapter;
  /** The files `adoptFile` and `materialize` name */
  readonly files: FilesAdapter;
}

/**
 * e3's storage backend over the four adapters: a browser's IndexedDB, OPFS
 * and Web Locks, or memory.
 *
 * @remarks
 * A repository is named, as the in-memory backend's is: every store takes its
 * name. Two tabs over one origin's adapters share its repositories as two
 * processes share a directory of local ones: records change in transactions,
 * locks exclude across tabs, and a closed tab's locks are free.
 *
 * @example
 * ```ts
 * const storage = await openWebStorage();
 * await storage.repos.create('default');
 * const hash = await storage.objects.write('default', bytes);
 * ```
 */
export class WebStorage implements StorageBackend {
  readonly upgrades: readonly RepositoryUpgrade[] = WEB_REPOSITORY_UPGRADES;
  readonly objects: WebObjectStore;
  readonly refs: RefStore;
  readonly locks: LockService;
  readonly logs: LogStore;
  readonly repos: RepoStore;
  readonly datasets: DatasetRefStore;

  /**
   * @param adapters - The adapters the repositories are kept over
   */
  constructor(readonly adapters: WebAdapters) {
    const { records, blobs, locks, files } = adapters;
    this.objects = new WebObjectStore(records, blobs, files);
    this.refs = new WebRefStore(records);
    this.locks = new WebLockService(records, locks);
    this.logs = new WebLogStore(records);
    this.datasets = new WebDatasetRefStore(records);
    this.repos = new WebRepoStore(records, blobs, this.refs, this.datasets, this.upgrades);
  }

  async validateRepository(repo: string): Promise<void> {
    if (!(await this.repos.exists(repo))) throw new RepoNotFoundError(repo);
  }

  /**
   * Closes the backend: its records' connection, and its session's locks.
   * What it keeps stays for the next backend over the same adapters.
   */
  async close(): Promise<void> {
    await this.adapters.records.close();
    await this.adapters.locks.close();
  }
}

/**
 * How {@link openWebStorage} keeps its repositories.
 */
export interface WebStorageOptions {
  /**
   * Whether repositories outlive the page: in IndexedDB, OPFS and Web Locks
   * (`true`, unless given), or in memory, starting fresh on every load
   * (`false`).
   */
  readonly persist?: boolean;
  /**
   * What the IndexedDB database, the OPFS directory and the Web Locks are
   * named after: `e3` unless given. Two storages of one name, in one tab or
   * two, share their repositories; two of different names share nothing.
   */
  readonly name?: string;
}

/**
 * The browser APIs a persisted storage keeps its repositories with, in the
 * order {@link openWebStorage} checks them: each by the name a refusal gives
 * it, and its path from the global object.
 *
 * @remarks
 * A write moves the file it staged into place, and only ever a file, so
 * `move` is looked for on a file handle: Chromium defines it on
 * `FileSystemFileHandle.prototype` alone, and a browser that defines it on
 * `FileSystemHandle.prototype` gives it to file handles through the prototype
 * chain the path is read along.
 */
const PERSISTED_APIS: ReadonlyArray<{ readonly name: string; readonly path: readonly string[] }> = [
  { name: 'IndexedDB', path: ['indexedDB'] },
  { name: 'navigator.storage.getDirectory', path: ['navigator', 'storage', 'getDirectory'] },
  { name: 'FileSystemFileHandle.createWritable', path: ['FileSystemFileHandle', 'prototype', 'createWritable'] },
  { name: 'FileSystemFileHandle.move', path: ['FileSystemFileHandle', 'prototype', 'move'] },
  { name: 'navigator.locks', path: ['navigator', 'locks'] },
];

/** Whether the global object leads to something by a path of properties,
 *  each read along its object's prototype chain. */
function reaches(path: readonly string[]): boolean {
  let at: unknown = globalThis;
  for (const name of path) {
    if (at === null || at === undefined) return false;
    at = (at as Record<string, unknown>)[name];
  }
  return at !== null && at !== undefined;
}

/**
 * Opens e3's storage in a browser.
 *
 * @remarks
 * Persisted, the records are the IndexedDB database of its name, the objects
 * are OPFS files under `/<name>/blobs`, the files `adoptFile` and
 * `materialize` name are OPFS files under `/<name>/files`, and the locks are
 * Web Locks whose names begin with `<name>:`. Before it opens any of them it
 * checks the page has every API it keeps repositories with — IndexedDB, OPFS
 * whose file handles have `createWritable` and `move`, and Web Locks — so a
 * browser that lacks one is refused at once, rather than at the first write
 * that needs it. Not persisted, each is in memory, and the page starts with
 * none on every load.
 *
 * @param options - Whether it persists, and its name
 * @returns The storage, over IndexedDB, OPFS and Web Locks, or over memory
 * @throws {Error} When it persists and the page lacks one of the APIs it keeps
 *   repositories with — in order, `IndexedDB`,
 *   `navigator.storage.getDirectory`, `FileSystemFileHandle.createWritable`,
 *   `FileSystemFileHandle.move` and `navigator.locks` — naming the first
 *   missing, having opened nothing
 *
 * @example
 * ```ts
 * const storage = await openWebStorage();
 * if (!(await storage.repos.exists('default'))) await storage.repos.create('default');
 * ```
 */
export async function openWebStorage(options: WebStorageOptions = {}): Promise<WebStorage> {
  if (options.persist === false) {
    return new WebStorage({
      records: openMemoryRecords(),
      blobs: new MemoryBlobs(),
      locks: await new MemoryLockSpace().open(),
      files: new MemoryFiles(),
    });
  }
  const missing = PERSISTED_APIS.find(({ path }) => !reaches(path));
  if (missing !== undefined) {
    throw new Error(
      `e3-web cannot keep repositories in this page: it has no ${missing.name} ` +
      '(OPFS and Web Locks need a secure context: https:, or http://localhost). ' +
      'Open the storage with persist: false to keep repositories in memory instead.',
    );
  }
  const name = options.name ?? 'e3';
  const records = await openIndexedDbRecords(name);
  try {
    const root = await navigator.storage.getDirectory();
    const blobs = new OpfsBlobs(await opfsDirectory(`/${name}/blobs`, root));
    const files = new OpfsFiles(await opfsDirectory(`/${name}/files`, root));
    const locks = await openWebLocks({ prefix: `${name}:` });
    return new WebStorage({ records, blobs, locks, files });
  } catch (err) {
    await records.close();
    throw err;
  }
}
