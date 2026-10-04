/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `WebTransferBackend`: e3's transfer backend in a browser — the uploads and
 * downloads a client sends and fetches, and the jobs that outlast a request,
 * kept beside a {@link WebStorage}'s repositories.
 *
 * Every record is an East value, in beast2, in the storage's records adapter:
 * IndexedDB in a browser, so a job one tab started is polled from another, as
 * a request may reach any instance of a server. What a job stages — an
 * upload's parts, a package's zip, an export's zip — is blobs of the storage's
 * blobs adapter, OPFS files in a browser, under the repository, so its
 * removal takes them. Every job runs through e3-core's shared handlers, on the
 * {@link TaskRunner} the host gives each repository.
 *
 * A job, and an upload's commit, records the session that runs it — the
 * tab's, as `WebStorage`'s lock holders do — until it ends. What a tab that
 * closed left unfinished is never run again: the next tab records it failed,
 * naming why, and removes what it staged, since the client that knew it was
 * in the tab that closed, and the repository may have changed since. What a
 * tab that lives runs is left to it.
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
  type option,
  type ValueTypeOf,
} from '@elaraai/east';
import { transferPartCount, transferPartRange, urlPathToTreePath } from '@elaraai/e3-types';
import {
  DatasetCommitStatusType,
  DatasetTypeMismatchError,
  DatasetUploadType,
  ExportStoppedError,
  PackageExportType,
  PackageImportType,
  RepoGcJobType,
  SplitCallJobType,
  WorkspaceDeployJobType,
  WorkspaceLockError,
  adoptProgressToIntakeFile,
  computeHash,
  datasetAdoptObject,
  handleProcessDeploy,
  handleProcessExport,
  handleProcessGc,
  handleProcessImport,
  handleProcessSplitCall,
  lockStateToHolderInfo,
  type DatasetAdoptProgress,
  type DatasetCommitStatus,
  type DatasetDownloadStore,
  type DatasetPartUpload,
  type DatasetUpload,
  type DatasetUploadStore,
  type LockHandle,
  type PackageExport,
  type PackageExportStore,
  type PackageImport,
  type PackageImportStore,
  type PackageZipCheckpoint,
  type RepoGcJob,
  type RepoGcStore,
  type SplitCallJob,
  type SplitCallStore,
  type TaskRunner,
  type TransferBackend,
  type WorkspaceDeployJob,
  type WorkspaceDeployStore,
  type ZipSource,
} from '@elaraai/e3-core/portable';
import type { BlobsAdapter, ByteSource, LocksAdapter, RecordKey, RecordsAdapter, RecordsRead } from '../storage/adapters.js';
import { stagedKeys, transferKeys, type TransferKind, type WebStorage } from '../storage/WebStorage.js';

export type { TransferKind } from '../storage/WebStorage.js';

// =============================================================================
// Record forms
// =============================================================================

/** A dataset upload: the upload, its plan as parts, and its commit. */
const UploadRecordType = StructType({
  upload: DatasetUploadType,
  /** The size of every part but the last, once planned */
  partBytes: OptionType(IntegerType),
  /** How its commit stands, once asked for */
  commit: OptionType(DatasetCommitStatusType),
  /** The session running its commit, while one does */
  owner: OptionType(StringType),
  createdAt: DateTimeType,
  /** When its commit finished */
  finishedAt: OptionType(DateTimeType),
});
type UploadRecord = ValueTypeOf<typeof UploadRecordType>;

/** A download URL's object. */
const DownloadRecordType = StructType({ repo: StringType, hash: StringType, createdAt: DateTimeType });
type DownloadRecord = ValueTypeOf<typeof DownloadRecordType>;

/** A job: the job as e3-core's stores keep it, the session that runs it until
 *  it ends, and when it ended. */
const ImportRecordType = StructType({ job: PackageImportType, owner: OptionType(StringType), finishedAt: OptionType(DateTimeType) });
type ImportRecord = ValueTypeOf<typeof ImportRecordType>;
const DeployRecordType = StructType({ job: WorkspaceDeployJobType, owner: OptionType(StringType), finishedAt: OptionType(DateTimeType) });
type DeployRecord = ValueTypeOf<typeof DeployRecordType>;
const GcRecordType = StructType({ job: RepoGcJobType, owner: OptionType(StringType), finishedAt: OptionType(DateTimeType) });
type GcRecord = ValueTypeOf<typeof GcRecordType>;
const SplitRecordType = StructType({ job: SplitCallJobType, owner: OptionType(StringType), finishedAt: OptionType(DateTimeType) });
type SplitRecord = ValueTypeOf<typeof SplitRecordType>;

/** An export: the job, and how many rounds of its zip are written. The
 *  checkpoint a round goes on from is the job's own, in memory: a progress
 *  report writes the record, and the checkpoint grows with the zip. */
const ExportRecordType = StructType({
  job: PackageExportType,
  owner: OptionType(StringType),
  finishedAt: OptionType(DateTimeType),
  /** How many rounds of the zip are written, each a blob */
  rounds: IntegerType,
});
type ExportRecord = ValueTypeOf<typeof ExportRecordType>;

/** How a kind of record is written and read. */
interface RecordForm<T> {
  readonly encode: (value: T) => Uint8Array;
  readonly decode: (bytes: Uint8Array) => T;
}

const uploadForm: RecordForm<UploadRecord> = { encode: encodeBeast2For(UploadRecordType), decode: decodeBeast2For(UploadRecordType) };
const downloadForm: RecordForm<DownloadRecord> = { encode: encodeBeast2For(DownloadRecordType), decode: decodeBeast2For(DownloadRecordType) };
const importForm: RecordForm<ImportRecord> = { encode: encodeBeast2For(ImportRecordType), decode: decodeBeast2For(ImportRecordType) };
const exportForm: RecordForm<ExportRecord> = { encode: encodeBeast2For(ExportRecordType), decode: decodeBeast2For(ExportRecordType) };
const deployForm: RecordForm<DeployRecord> = { encode: encodeBeast2For(DeployRecordType), decode: decodeBeast2For(DeployRecordType) };
const gcForm: RecordForm<GcRecord> = { encode: encodeBeast2For(GcRecordType), decode: decodeBeast2For(GcRecordType) };
const splitForm: RecordForm<SplitRecord> = { encode: encodeBeast2For(SplitRecordType), decode: decodeBeast2For(SplitRecordType) };

/** Whether two owners are the same session, or both none. */
const sameOwner = equalFor(OptionType(StringType));
const sameString = equalFor(StringType);

/** What a record holds, read as a record of its kind. */
type Read<T> = { readonly kind: 'none' } | { readonly kind: 'undecodable' } | { readonly kind: 'record'; readonly value: T };

/** A record, as it reads: none, one that does not decode — an earlier
 *  release's — or its value. */
async function readAs<T>(read: RecordsRead, key: RecordKey, form: RecordForm<T>): Promise<Read<T>> {
  const bytes = await read.get(key);
  if (bytes === null) return { kind: 'none' };
  try {
    return { kind: 'record', value: form.decode(bytes) };
  } catch {
    return { kind: 'undecodable' };
  }
}

/** A record's value; `null` when there is none, or it does not decode. */
async function readRecord<T>(read: RecordsRead, key: RecordKey, form: RecordForm<T>): Promise<T | null> {
  const found = await readAs(read, key, form);
  return found.kind === 'record' ? found.value : null;
}

/**
 * Changes a record in one transaction: what `next` makes of it is written,
 * unless it gives `null`, which leaves it as it is.
 *
 * @returns What the record holds after: `null` when there is none
 */
function changeRecord<T>(records: RecordsAdapter, key: RecordKey, form: RecordForm<T>, next: (current: T) => T | null): Promise<T | null> {
  return records.transact(async (tx) => {
    const current = await readRecord(tx, key, form);
    if (current === null) return null;
    const changed = next(current);
    if (changed === null) return current;
    tx.put(key, form.encode(changed));
    return changed;
  });
}

/** Writes a record whole. */
async function putRecord<T>(records: RecordsAdapter, key: RecordKey, form: RecordForm<T>, value: T): Promise<void> {
  await records.transact((tx) => {
    tx.put(key, form.encode(value));
    return Promise.resolve();
  });
}

/** Deletes a record. */
async function deleteRecord(records: RecordsAdapter, key: RecordKey): Promise<void> {
  await records.transact((tx) => {
    tx.delete(key);
    return Promise.resolve();
  });
}

// =============================================================================
// Shared
// =============================================================================

/** The part size a dataset upload is planned with unless the host sets one:
 *  8 MiB, since a part crosses between the page and its e3 worker whole. */
export const DEFAULT_WEB_PART_BYTES = 8 * 1024 * 1024;

/** The most bytes of a zip an export round writes before it stops at the
 *  next entry: 16 MiB unless the host sets it. */
export const DEFAULT_EXPORT_ROUND_BYTES = 16 * 1024 * 1024;

/** How long a finished job's status and a finished commit's stay readable for
 *  a poll, as the local server keeps a split call's, unless the host sets
 *  it: ten minutes. */
export const DEFAULT_RESULT_TTL_MS = 10 * 60 * 1000;

/** How long a record nothing finished or fetched is kept, with what it
 *  staged, unless the host sets it: a day. */
export const DEFAULT_RECORD_RETENTION_MS = 24 * 60 * 60 * 1000;

/** How often a live tab forgets what is past its retention, unless the host
 *  sets it: every ten minutes. */
export const DEFAULT_RETENTION_INTERVAL_MS = 10 * 60 * 1000;

/** Why a job or a commit a closed tab left is recorded failed. */
const CLOSED_TAB = 'its tab closed before it finished';

/** Why one no tab runs, which nothing will, is recorded failed. */
const STOPPED = 'it stopped before it finished';

/** The least time between two writes of a commit's progress to its record. */
const PROGRESS_INTERVAL_MS = 500;

/** Settles once what the host has queued before it has run. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** An error's message. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Bytes gathered whole, in order. */
function joined(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  let size = 0;
  for (const chunk of chunks) size += chunk.length;
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** How long what finished, and what did not, is kept. */
interface Retention {
  readonly resultTtlMs: number;
  readonly recordMs: number;
  readonly intervalMs: number;
}

/**
 * What every store of a {@link WebTransferBackend} runs over.
 */
interface TransferHost {
  /** The records: every store's records */
  readonly records: RecordsAdapter;
  /** The blobs: what the stores stage */
  readonly blobs: BlobsAdapter;
  /** This tab's session, which owns each job its backend runs */
  readonly locks: LocksAdapter;
  /** The storage the jobs run over */
  readonly storage: WebStorage;
  /** Each repository's runner */
  readonly getRunner: (repo: string) => TaskRunner;
  /** How long what finished, and what did not, is kept */
  readonly retention: Retention;
}

/**
 * Whose a record's owner is: no session's, this tab's, another tab's that
 * lives, or one that has ended.
 */
async function ownerOf(locks: LocksAdapter, owner: option<string>): Promise<'none' | 'self' | 'alive' | 'dead'> {
  if (owner.type === 'none') return 'none';
  if (sameOwner(owner, some(locks.session))) return 'self';
  return (await locks.isAlive(owner.value)) ? 'alive' : 'dead';
}

/**
 * Removes what a transfer whose record does not decode staged: its record
 * names its repository, so every repository's staging of its id goes.
 */
async function forgetStaged(host: TransferHost, id: string): Promise<void> {
  for (const repo of await host.storage.repos.list()) await host.blobs.deletePrefix(stagedKeys.of(repo, id));
}

/**
 * The jobs this worker runs, or is taking: a job asked to run while it runs,
 * or is being taken, here starts nothing new.
 */
class Running {
  private readonly jobs = new Set<string>();

  /** Whether a job runs, or is being taken, here. */
  has(kind: TransferKind, id: string): boolean {
    return this.jobs.has(`${kind}/${id}`);
  }

  /**
   * Reserves a job for this worker, at once.
   *
   * @returns Whether it was free to reserve: not when it runs, or is being
   *   taken, here already
   */
  reserve(kind: TransferKind, id: string): boolean {
    const job = `${kind}/${id}`;
    if (this.jobs.has(job)) return false;
    this.jobs.add(job);
    return true;
  }

  /** Lets a job go, once it has ended or was not taken. */
  release(kind: TransferKind, id: string): void {
    this.jobs.delete(`${kind}/${id}`);
  }
}

// =============================================================================
// Dataset uploads
// =============================================================================

/**
 * Dataset uploads: each part staged as a blob, and committed as the object the
 * staged bytes hash to.
 *
 * @remarks
 * A part is staged whole, in the blob of its number, so a part sent again
 * replaces itself, and parts arrive in any order. The commit copies every part
 * into one buffer of the upload's size, checking each is there at its planned
 * size, hashes the bytes once, and stores them as the object they hash to —
 * refused, with nothing written, when that is not the upload's hash — then
 * adopts that object (`datasetAdoptObject`): a collection is taken in by
 * intake units on the repository's runner, as the local server's `object`
 * commit takes one in.
 */
class WebDatasetUploadStore implements DatasetUploadStore {
  /** The commits this worker runs, or is taking, by upload: a commit asked
   *  for while one runs here is answered by it */
  private readonly commits = new Map<string, Promise<DatasetCommitStatus>>();

  constructor(private readonly host: TransferHost, private readonly partBytes: bigint) {}

  private key(id: string): RecordKey {
    return transferKeys.of('upload', id);
  }

  async create(id: string, record: DatasetUpload): Promise<void> {
    await putRecord(this.host.records, this.key(id), uploadForm, {
      upload: record, partBytes: none, commit: none, owner: none, createdAt: new Date(), finishedAt: none,
    });
  }

  async get(id: string): Promise<DatasetUpload | null> {
    return (await readRecord(this.host.records, this.key(id), uploadForm))?.upload ?? null;
  }

  /**
   * Forgets an upload: its record and every part it staged.
   *
   * @param id - The upload's id
   */
  async delete(id: string): Promise<void> {
    const record = await readRecord(this.host.records, this.key(id), uploadForm);
    await deleteRecord(this.host.records, this.key(id));
    if (record !== null) await this.host.blobs.deletePrefix(stagedKeys.of(record.upload.repo, id));
  }

  async createParts(id: string, _record: DatasetUpload): Promise<bigint> {
    await changeRecord(this.host.records, this.key(id), uploadForm, (current) => ({ ...current, partBytes: some(this.partBytes) }));
    return this.partBytes;
  }

  async getPartBytes(id: string): Promise<bigint | null> {
    const record = await readRecord(this.host.records, this.key(id), uploadForm);
    return record?.partBytes.type === 'some' ? record.partBytes.value : null;
  }

  getPartUpload(id: string, _record: DatasetUpload, part: number): Promise<DatasetPartUpload> {
    // e3-web's own byte endpoint takes the part whole, so its PUT needs no
    // headers beyond its bytes; the route resolves the URL against its origin.
    return Promise.resolve({ url: `/api/uploads/${id}/parts/${part}`, headers: {} });
  }

  /**
   * Stages one part of an upload, replacing any it staged before.
   *
   * @param id - The upload's id
   * @param repo - The repository the upload is for
   * @param part - The part's number, from 1
   * @param bytes - The part's bytes, whole or a chunk at a time
   * @returns The part's size, as staged
   */
  stagePart(id: string, repo: string, part: number, bytes: ByteSource): Promise<number> {
    return this.host.blobs.write(stagedKeys.part(repo, id, part), bytes);
  }

  /**
   * Commits an upload, or answers how its commit stands.
   *
   * @remarks
   * A commit asked for while one runs here is answered by it, and it is
   * registered as it is asked for, so a poll from then on hears it under
   * way. One a tab that lives runs is answered as it stands. One a tab that
   * closed left is recorded failed, naming why, and what it staged removed:
   * it is never run again.
   */
  commit(id: string, record: DatasetUpload): Promise<DatasetCommitStatus> {
    const running = this.commits.get(id);
    if (running !== undefined) return running;
    const committing = this.commitOnce(id, record);
    this.commits.set(id, committing);
    void committing.finally(() => {
      if (this.commits.get(id) === committing) this.commits.delete(id);
    });
    return committing;
  }

  /** Runs a commit here, or answers how it stands; never rejects. */
  private async commitOnce(id: string, record: DatasetUpload): Promise<DatasetCommitStatus> {
    try {
      const current = await readRecord(this.host.records, this.key(id), uploadForm);
      if (current === null) return variant('failed', { message: `the upload '${id}' is not known` });
      if (current.commit.type === 'some') {
        if (current.commit.value.type !== 'processing') return current.commit.value;
        const owner = await ownerOf(this.host.locks, current.owner);
        if (owner === 'alive') return current.commit.value;
        return await this.abandon(id, owner === 'dead' ? CLOSED_TAB : STOPPED);
      }
      const session = this.host.locks.session;
      const claim = await this.host.records.transact(async (tx): Promise<{ taken: true } | { taken: false; status: DatasetCommitStatus }> => {
        const now = await readRecord(tx, this.key(id), uploadForm);
        if (now === null) return { taken: false, status: variant('failed', { message: `the upload '${id}' is not known` }) };
        // Another tab claimed it meanwhile: how far it has got.
        if (now.commit.type === 'some') return { taken: false, status: now.commit.value };
        tx.put(this.key(id), uploadForm.encode({ ...now, commit: some(variant('processing', none)), owner: some(session) }));
        return { taken: true };
      });
      if (!claim.taken) return claim.status;
      const status = await this.verifyAndAdopt(id, record);
      // Its end is recorded before what it staged goes: a tab that closes
      // between the two leaves the parts to gc's sweep.
      await changeRecord(this.host.records, this.key(id), uploadForm, (now) => ({
        ...now, commit: some(status), owner: none, finishedAt: some(new Date()),
      }));
      await this.host.blobs.deletePrefix(stagedKeys.of(record.repo, id));
      return status;
    } catch (err) {
      return variant('failed', { message: messageOf(err) });
    }
  }

  /**
   * Records a commit no tab will finish failed, and removes what it staged.
   *
   * @returns The commit's status, as recorded
   */
  private async abandon(id: string, why: string): Promise<DatasetCommitStatus> {
    const failed: DatasetCommitStatus = variant('failed', { message: why });
    const record = await changeRecord(this.host.records, this.key(id), uploadForm, (current) =>
      (current.commit.type === 'some' && current.commit.value.type === 'processing'
        ? { ...current, commit: some(failed), owner: none, finishedAt: some(new Date()) }
        : null));
    if (record === null) return failed;
    await this.host.blobs.deletePrefix(stagedKeys.of(record.upload.repo, id));
    return record.commit.type === 'some' ? record.commit.value : failed;
  }

  /**
   * How an upload's commit stands: as its record says, or under way while it
   * is being taken here, before its record says so; `null` before one is
   * asked for.
   */
  async getCommitStatus(id: string): Promise<DatasetCommitStatus | null> {
    const record = await readRecord(this.host.records, this.key(id), uploadForm);
    if (record?.commit.type === 'some') return record.commit.value;
    return this.commits.has(id) ? variant('processing', none) : null;
  }

  /**
   * Checks the staged parts are the upload's bytes, and points the upload's
   * dataset at them; never rejects.
   *
   * @remarks
   * The parts are copied, in order, into one buffer of the upload's size, each
   * checked against its planned range, and the bytes are hashed once: they are
   * stored as the object they hash to only when that is the upload's hash, so
   * a store holds no object of bytes no one asked for. A collection's object
   * is then taken in by intake units, how far they have got written to the
   * upload's record as they go.
   */
  private async verifyAndAdopt(id: string, record: DatasetUpload): Promise<DatasetCommitStatus> {
    const { repo, workspace, path, hash, size } = record;
    try {
      const partBytes = await this.getPartBytes(id);
      if (partBytes === null) return variant('failed', { message: 'the upload was not planned as parts' });
      const count = transferPartCount(size, partBytes);
      const staged = new Uint8Array(Number(size));
      for (let part = 1; part <= count; part++) {
        const range = transferPartRange(size, partBytes, part)!;
        const bytes = await this.host.blobs.read(stagedKeys.part(repo, id, part));
        if (bytes === null) return variant('failed', { message: `part ${part} of ${count} was not sent` });
        if (bytes.length !== range.end - range.start) {
          return variant('failed', { message: `part ${part} of ${count} is ${range.end - range.start} bytes, and ${bytes.length} were staged` });
        }
        staged.set(bytes, range.start);
      }
      const digest = computeHash(staged);
      if (!sameString(digest, hash)) {
        return variant('failed', { message: `the staged bytes hash to ${digest}, not the upload's ${hash}` });
      }
      await this.host.storage.objects.writeHashed(repo, digest, staged);
      let reported = 0;
      const report = (progress: DatasetAdoptProgress): void => {
        const now = Date.now();
        if (now - reported < PROGRESS_INTERVAL_MS) return;
        reported = now;
        const intake = adoptProgressToIntakeFile(path, progress);
        void changeRecord(this.host.records, this.key(id), uploadForm, (current) =>
          (current.commit.type === 'some' && current.commit.value.type === 'processing' ? { ...current, commit: some(variant('processing', some(intake))) } : null),
        ).catch(() => undefined);
      };
      await datasetAdoptObject(this.host.storage, repo, workspace, urlPathToTreePath(path), hash, this.host.getRunner(repo), { onProgress: report });
      return variant('completed', null);
    } catch (err) {
      if (err instanceof DatasetTypeMismatchError) return variant('type_mismatch', { path: err.path, message: err.message });
      return variant('failed', { message: messageOf(err) });
    }
  }

  /**
   * Records the commits closed tabs left failed, and forgets what is past its
   * retention: a finished commit's answer once a poll has had a while to read
   * it, and an upload no one committed, with what each staged.
   */
  async sweep(now: number): Promise<void> {
    const { resultTtlMs, recordMs } = this.host.retention;
    for (const key of await this.host.records.keys(transferKeys.kind('upload'))) {
      const id = key[2]!;
      const found = await readAs(this.host.records, key, uploadForm);
      if (found.kind === 'none') continue;
      if (found.kind === 'undecodable') {
        await deleteRecord(this.host.records, key);
        await forgetStaged(this.host, id);
        continue;
      }
      const record = found.value;
      if (record.finishedAt.type === 'some') {
        if (now - record.finishedAt.value.getTime() > resultTtlMs) await this.delete(id);
        continue;
      }
      if (record.commit.type === 'none') {
        if (now - record.createdAt.getTime() > recordMs) await this.delete(id);
        continue;
      }
      if (this.commits.has(id)) continue;
      const owner = await ownerOf(this.host.locks, record.owner);
      if (owner === 'dead') await this.abandon(id, CLOSED_TAB);
      else if (owner !== 'alive') await this.abandon(id, STOPPED);
    }
  }
}

// =============================================================================
// Downloads
// =============================================================================

/**
 * Download URLs: each names an object of a repository's, which e3-web's own
 * byte endpoint serves from the object store, once.
 */
class WebDatasetDownloadStore implements DatasetDownloadStore {
  constructor(private readonly host: TransferHost) {}

  async getDownloadUrl(repo: string, hash: string): Promise<string> {
    const id = crypto.randomUUID();
    await putRecord(this.host.records, transferKeys.of('download', id), downloadForm, { repo, hash, createdAt: new Date() });
    return `/api/downloads/${id}`;
  }

  async get(id: string): Promise<{ repo: string; hash: string } | null> {
    const record = await readRecord(this.host.records, transferKeys.of('download', id), downloadForm);
    return record === null ? null : { repo: record.repo, hash: record.hash };
  }

  async delete(id: string): Promise<void> {
    await deleteRecord(this.host.records, transferKeys.of('download', id));
  }

  /** Forgets the download URLs no one fetched within the retention. */
  async sweep(now: number): Promise<void> {
    for (const key of await this.host.records.keys(transferKeys.kind('download'))) {
      const record = await readRecord(this.host.records, key, downloadForm);
      if (record === null || now - record.createdAt.getTime() > this.host.retention.recordMs) await deleteRecord(this.host.records, key);
    }
  }
}

// =============================================================================
// The jobs
// =============================================================================

/**
 * What a job store shares: its records, the session that runs each job until
 * it ends, the jobs a closed tab left, recorded failed, and retention.
 *
 * @typeParam J - The job, as e3-core's store interface has it
 * @typeParam R - Its record: the job, the session running it, and when it
 *   ended
 */
abstract class JobStore<
  J extends { readonly repo: string; readonly createdAt: Date; readonly status: unknown },
  R extends { readonly job: J; readonly owner: option<string>; readonly finishedAt: option<Date> },
> {
  constructor(
    protected readonly host: TransferHost,
    protected readonly running: Running,
    private readonly kind: TransferKind,
    private readonly form: RecordForm<R>,
  ) {}

  protected key(id: string): RecordKey {
    return transferKeys.of(this.kind, id);
  }

  /** A new job's record, run by a session or by none. */
  protected abstract fresh(job: J, owner: option<string>): R;

  /** A record with its job in a new status: once the status is its end,
   *  run by no session and ended now. */
  protected abstract withStatus(id: string, record: R, status: J['status'], ended: boolean): R;

  /** A record run by a session, or by none. */
  protected abstract withOwner(record: R, owner: option<string>): R;

  /** Whether a job's status is its end. */
  protected abstract finished(status: J['status']): boolean;

  /** Whether a job's status is its failure. */
  protected abstract failed(status: J['status']): boolean;

  /** A job's failure, naming why. */
  protected abstract failure(message: string): J['status'];

  /** Runs a job, to its end. */
  protected abstract work(id: string, record: R): Promise<void>;

  /** How long a finished job's record stays readable: the result TTL, unless
   *  a kind keeps it longer. */
  protected resultTtl(): number {
    return this.host.retention.resultTtlMs;
  }

  /** Removes what a job staged: once it has failed, or its record goes. */
  protected discard(_id: string, _record: R): Promise<void> {
    return Promise.resolve();
  }

  /** A job's record, or `null`. */
  protected record(id: string): Promise<R | null> {
    return readRecord(this.host.records, this.key(id), this.form);
  }

  /** Files a job, owned by this tab's session until it ends: a job created
   *  ended is no one's. */
  async create(id: string, job: J): Promise<void> {
    const owner = this.finished(job.status) ? none : some(this.host.locks.session);
    await putRecord(this.host.records, this.key(id), this.form, this.fresh(job, owner));
  }

  async get(id: string): Promise<J | null> {
    return (await this.record(id))?.job ?? null;
  }

  /**
   * Records a job's status: one that ends it is run by no session after, and
   * one that fails it removes what it staged.
   *
   * @throws {Error} When there is no such job
   */
  async updateStatus(id: string, status: J['status']): Promise<void> {
    const ended = this.finished(status);
    const changed = await changeRecord(this.host.records, this.key(id), this.form, (current) => this.withStatus(id, current, status, ended));
    if (changed === null) throw new Error(`${this.kind} job ${id} not found`);
    if (this.failed(status)) await this.discard(id, changed);
  }

  async delete(id: string): Promise<void> {
    const record = await this.record(id);
    await deleteRecord(this.host.records, this.key(id));
    if (record !== null) await this.discard(id, record);
  }

  /**
   * Runs a job in this worker, in the background, unless it runs here
   * already, has ended, or a tab that lives runs it. One a tab that closed
   * left is recorded failed, naming why: it is never run again.
   *
   * @remarks
   * The job is reserved for this worker as it is asked for, before anything
   * is awaited, so a job asked to run twice at once runs once.
   *
   * @param id - The job's id
   * @param repo - The repository the route named, which must be the job's
   * @throws {Error} When the repository started no such job
   */
  async execute(id: string, repo: string): Promise<void> {
    const reserved = this.running.reserve(this.kind, id);
    let started = false;
    try {
      const record = await this.record(id);
      if (record === null || !sameString(record.job.repo, repo)) throw new Error(`${this.kind} job ${id} not found`);
      // It runs, or is being taken, here already.
      if (!reserved || this.finished(record.job.status)) return;
      const owner = await ownerOf(this.host.locks, record.owner);
      if (owner === 'alive') return;
      if (owner === 'dead') {
        await this.abandon(id, CLOSED_TAB);
        return;
      }
      const session = some(this.host.locks.session);
      const taken = await changeRecord(this.host.records, this.key(id), this.form, (current) =>
        // Ended, or taken by another session, meanwhile: not this one's.
        (!this.finished(current.job.status) && sameOwner(current.owner, record.owner) ? this.withOwner(current, session) : null));
      if (taken === null || this.finished(taken.job.status) || !sameOwner(taken.owner, session)) return;
      started = true;
      void this.run(id, taken);
    } finally {
      if (reserved && !started) this.running.release(this.kind, id);
    }
  }

  /** Runs a job to its end: one that ends without recording how is recorded
   *  failed, so no tab takes it for running. */
  private async run(id: string, record: R): Promise<void> {
    let thrown: unknown = null;
    try {
      await this.work(id, record);
    } catch (err) {
      thrown = err;
    } finally {
      try {
        const current = await this.record(id);
        if (current !== null && !this.finished(current.job.status)) {
          await this.updateStatus(id, this.failure(thrown === null ? STOPPED : `${STOPPED}: ${messageOf(thrown)}`));
        }
      } catch {
        // The record is gone, or the storage closed: nothing is left to end.
      } finally {
        this.running.release(this.kind, id);
      }
    }
  }

  /** Records a job no tab will finish failed, naming why, and removes what
   *  it staged. */
  private async abandon(id: string, why: string): Promise<void> {
    const failure = this.failure(why);
    const changed = await changeRecord(this.host.records, this.key(id), this.form, (current) =>
      (this.finished(current.job.status) ? null : this.withStatus(id, current, failure, true)));
    if (changed !== null) await this.discard(id, changed);
  }

  /**
   * Records the jobs closed tabs left failed, and forgets the jobs that ended
   * longer ago than their retention, and the records that do not decode, with
   * what each staged.
   *
   * @remarks
   * A job no tab runs and none will — one this tab filed and never ran, say —
   * is recorded failed once it is older than the record retention.
   */
  async sweep(now: number): Promise<void> {
    const { recordMs } = this.host.retention;
    for (const key of await this.host.records.keys(transferKeys.kind(this.kind))) {
      const id = key[2]!;
      const found = await readAs(this.host.records, key, this.form);
      if (found.kind === 'none') continue;
      if (found.kind === 'undecodable') {
        await deleteRecord(this.host.records, key);
        await forgetStaged(this.host, id);
        continue;
      }
      const record = found.value;
      if (record.finishedAt.type === 'some') {
        if (now - record.finishedAt.value.getTime() > this.resultTtl()) await this.delete(id);
        continue;
      }
      if (this.running.has(this.kind, id)) continue;
      const owner = await ownerOf(this.host.locks, record.owner);
      if (owner === 'dead') await this.abandon(id, CLOSED_TAB);
      else if (owner !== 'alive' && now - record.job.createdAt.getTime() > recordMs) await this.abandon(id, STOPPED);
    }
  }
}

/**
 * Package imports: the zip a client uploads is staged as a blob, and the job
 * reads it as a {@link ZipSource}, by ranges where it lies.
 */
class WebPackageImportStore extends JobStore<PackageImport, ImportRecord> implements PackageImportStore {
  constructor(host: TransferHost, running: Running) {
    super(host, running, 'import', importForm);
  }

  protected fresh(job: PackageImport, owner: option<string>): ImportRecord {
    return { job, owner, finishedAt: none };
  }

  protected withStatus(_id: string, record: ImportRecord, status: PackageImport['status'], ended: boolean): ImportRecord {
    return { ...record, job: { ...record.job, status }, ...(ended && { owner: none, finishedAt: some(new Date()) }) };
  }

  protected withOwner(record: ImportRecord, owner: option<string>): ImportRecord {
    return { ...record, owner };
  }

  protected finished(status: PackageImport['status']): boolean {
    return status.type === 'completed' || status.type === 'failed';
  }

  protected failed(status: PackageImport['status']): boolean {
    return status.type === 'failed';
  }

  protected failure(message: string): PackageImport['status'] {
    return variant('failed', { message });
  }

  protected async discard(id: string, record: ImportRecord): Promise<void> {
    await this.host.blobs.deletePrefix(stagedKeys.of(record.job.repo, id));
  }

  getUploadUrl(id: string, _repo: string): Promise<string> {
    return Promise.resolve(`/api/uploads/${id}`);
  }

  /**
   * Stages an import's zip, whole, and marks the import uploaded.
   *
   * @param id - The import's id
   * @param repo - The repository the import is for
   * @param bytes - The zip's bytes, whole or a chunk at a time
   * @returns The zip's size, as staged
   */
  async stageZip(id: string, repo: string, bytes: ByteSource): Promise<number> {
    const size = await this.host.blobs.write(stagedKeys.zip(repo, id), bytes);
    await this.updateStatus(id, variant('uploaded', null));
    return size;
  }

  protected async work(id: string, record: ImportRecord): Promise<void> {
    const repo = record.job.repo;
    const key = stagedKeys.zip(repo, id);
    const stat = await this.host.blobs.stat(key);
    if (stat === null) {
      await this.updateStatus(id, variant('failed', { message: 'the package\'s zip was not uploaded' }));
      return;
    }
    const blobs = this.host.blobs;
    const zip: ZipSource = {
      size: stat.size,
      read: async (offset, length) => {
        const bytes = await blobs.readRange(key, offset, length);
        if (bytes === null) throw new Error(`the staged zip of import ${id} is gone`);
        return bytes;
      },
    };
    try {
      await handleProcessImport({ storage: this.host.storage, importStore: this }, { id, repo, zip });
    } finally {
      // The zip is the job's to remove, once it has ended.
      await blobs.delete(key).catch(() => false);
    }
  }
}

/**
 * Package and workspace exports: the job writes its zip through e3-core's
 * portable sink a round at a time, each round's bytes a blob, and the next
 * round goes on from the checkpoint the last one stopped at.
 *
 * @remarks
 * A round stops at the first entry after it has written its share of bytes,
 * and the worker answers what waits — a page's requests — before the next.
 * A workspace's export holds the workspace's lock across its rounds, as the
 * shared handler asks of a caller that runs one job over several calls, so
 * nothing changes the workspace between them. The last round's blob is
 * counted with the job's completion, in one write. The download serves the
 * rounds' blobs in order: the zip an export never stopped writes. An export
 * that fails removes its rounds.
 */
class WebPackageExportStore extends JobStore<PackageExport, ExportRecord> implements PackageExportStore {
  /** The round each export running here writes, which its completion
   *  counts */
  private readonly writing = new Map<string, number>();

  constructor(host: TransferHost, running: Running, private readonly roundBytes: number) {
    super(host, running, 'export', exportForm);
  }

  protected fresh(job: PackageExport, owner: option<string>): ExportRecord {
    return { job, owner, finishedAt: none, rounds: 0n };
  }

  protected withStatus(id: string, record: ExportRecord, status: PackageExport['status'], ended: boolean): ExportRecord {
    const round = this.writing.get(id);
    return {
      ...record,
      job: { ...record.job, status },
      // The zip is whole once its last round is written, which this counts.
      ...(status.type === 'completed' && round !== undefined && { rounds: BigInt(round + 1) }),
      ...(ended && { owner: none, finishedAt: some(new Date()) }),
    };
  }

  protected withOwner(record: ExportRecord, owner: option<string>): ExportRecord {
    return { ...record, owner };
  }

  protected finished(status: PackageExport['status']): boolean {
    return status.type === 'completed' || status.type === 'failed';
  }

  protected failed(status: PackageExport['status']): boolean {
    return status.type === 'failed';
  }

  protected failure(message: string): PackageExport['status'] {
    return variant('failed', { message });
  }

  protected async discard(id: string, record: ExportRecord): Promise<void> {
    await this.host.blobs.deletePrefix(stagedKeys.of(record.job.repo, id));
  }

  getDownloadUrl(id: string, _repo: string): Promise<string> {
    return Promise.resolve(`/api/downloads/${id}`);
  }

  /**
   * The zip of a completed export: its rounds' blobs, in order.
   *
   * @param id - The export's id
   * @returns The zip, or `null` when the export has not completed, or what it
   *   wrote is gone
   */
  async zipOf(id: string): Promise<Uint8Array | null> {
    const record = await this.record(id);
    if (record === null || record.job.status.type !== 'completed') return null;
    const rounds: Uint8Array[] = [];
    for (let round = 0; round < Number(record.rounds); round++) {
      const bytes = await this.host.blobs.read(stagedKeys.exported(record.job.repo, id, round));
      if (bytes === null) return null;
      rounds.push(bytes);
    }
    return joined(rounds);
  }

  /**
   * How many rounds of its zip an export has written.
   *
   * @param id - The export's id
   * @returns Its rounds, or `null` for no such export
   */
  async progressOf(id: string): Promise<{ rounds: number } | null> {
    const record = await this.record(id);
    return record === null ? null : { rounds: Number(record.rounds) };
  }

  protected async work(id: string, record: ExportRecord): Promise<void> {
    const { repo, workspace } = record.job;
    const blobs = this.host.blobs;
    // A workspace's export holds the workspace from its first round to its
    // last, as one call of the local server's holds it.
    let lock: LockHandle | null = null;
    if (workspace.type === 'some') {
      lock = await this.host.storage.locks.acquire(repo, workspace.value, variant('export', null));
      if (lock === null) {
        // Its holder, as e3-core names a lock's holder wherever a lock refuses.
        const state = await this.host.storage.locks.getState(repo, workspace.value);
        const refused = new WorkspaceLockError(workspace.value, state === null ? undefined : lockStateToHolderInfo(state));
        await this.updateStatus(id, this.failure(refused.message));
        return;
      }
    }
    try {
      let resume: PackageZipCheckpoint | undefined;
      for (let round = 0; ; round++) {
        this.writing.set(id, round);
        const chunks: Uint8Array[] = [];
        let written = 0;
        const stop = new AbortController();
        const key = stagedKeys.exported(repo, id, round);
        const sink = new WritableStream<Uint8Array>({
          // The zip writer hands over each chunk it writes, and keeps none.
          write: (chunk) => {
            chunks.push(chunk);
            written += chunk.length;
            // Past its share, the round stops once the entry it writes is
            // written.
            if (written >= this.roundBytes) stop.abort();
          },
          // The zip is whole: its last round is written before the job is
          // recorded completed, which counts it.
          close: async () => {
            await blobs.write(key, joined(chunks));
          },
        });
        try {
          await handleProcessExport({ storage: this.host.storage, exportStore: this, signal: stop.signal, ...(lock !== null && { lock }) }, {
            id,
            repo,
            zip: sink,
            ...(resume !== undefined && { resume }),
          });
          return;
        } catch (err) {
          if (!(err instanceof ExportStoppedError)) throw err;
          await blobs.write(key, joined(chunks));
          const next = await changeRecord(this.host.records, this.key(id), exportForm, (current) => ({ ...current, rounds: BigInt(round + 1) }));
          if (next === null) return;
          resume = err.checkpoint;
          // The worker answers what waits — a page's requests — before the
          // next round: over storage in memory, a round never leaves the
          // microtask queue, and the rounds of a large export would hold the
          // worker until the last.
          await nextTask();
        }
      }
    } catch (err) {
      // The handler records an export's own failure; one of its rounds' blob
      // or record is recorded here, so the job ends rather than waits.
      const current = await this.record(id);
      if (current !== null && !this.finished(current.job.status)) {
        await this.updateStatus(id, this.failure(messageOf(err)));
      }
      throw err;
    } finally {
      this.writing.delete(id);
      await lock?.release().catch(() => undefined);
    }
  }
}

/** Workspace deploys: run through the shared handler, on the repository's
 *  runner. */
class WebWorkspaceDeployStore extends JobStore<WorkspaceDeployJob, DeployRecord> implements WorkspaceDeployStore {
  constructor(host: TransferHost, running: Running) {
    super(host, running, 'deploy', deployForm);
  }

  protected fresh(job: WorkspaceDeployJob, owner: option<string>): DeployRecord {
    return { job, owner, finishedAt: none };
  }

  protected withStatus(_id: string, record: DeployRecord, status: WorkspaceDeployJob['status'], ended: boolean): DeployRecord {
    return { ...record, job: { ...record.job, status }, ...(ended && { owner: none, finishedAt: some(new Date()) }) };
  }

  protected withOwner(record: DeployRecord, owner: option<string>): DeployRecord {
    return { ...record, owner };
  }

  protected finished(status: WorkspaceDeployJob['status']): boolean {
    return status.type === 'completed' || status.type === 'failed';
  }

  protected failed(status: WorkspaceDeployJob['status']): boolean {
    return status.type === 'failed';
  }

  protected failure(message: string): WorkspaceDeployJob['status'] {
    return variant('failed', { message });
  }

  protected work(id: string, record: DeployRecord): Promise<void> {
    const repo = record.job.repo;
    return handleProcessDeploy({ storage: this.host.storage, deployStore: this, runner: this.host.getRunner(repo) }, { id, repo });
  }
}

/** Repository gc: run through the shared handler, its history's prune taking
 *  the repository's runner's judgement of what still runs. */
class WebRepoGcStore extends JobStore<RepoGcJob, GcRecord> implements RepoGcStore {
  constructor(host: TransferHost, running: Running) {
    super(host, running, 'gc', gcForm);
  }

  protected fresh(job: RepoGcJob, owner: option<string>): GcRecord {
    return { job, owner, finishedAt: none };
  }

  protected withStatus(_id: string, record: GcRecord, status: RepoGcJob['status'], ended: boolean): GcRecord {
    return { ...record, job: { ...record.job, status }, ...(ended && { owner: none, finishedAt: some(new Date()) }) };
  }

  protected withOwner(record: GcRecord, owner: option<string>): GcRecord {
    return { ...record, owner };
  }

  protected finished(status: RepoGcJob['status']): boolean {
    return status.status.type !== 'running';
  }

  protected failed(status: RepoGcJob['status']): boolean {
    return status.status.type === 'failed';
  }

  protected failure(message: string): RepoGcJob['status'] {
    return { status: variant('failed', null), stats: none, error: some(message) };
  }

  protected work(id: string, record: GcRecord): Promise<void> {
    const repo = record.job.repo;
    return handleProcessGc({ storage: this.host.storage, gcStore: this, runner: this.host.getRunner(repo) }, { id, repo });
  }
}

/** Split calls: run through the shared handler, on the repository's runner,
 *  and forgotten a while after they finish, as the local server forgets
 *  them. */
class WebSplitCallStore extends JobStore<SplitCallJob, SplitRecord> implements SplitCallStore {
  constructor(host: TransferHost, running: Running) {
    super(host, running, 'split', splitForm);
  }

  protected fresh(job: SplitCallJob, owner: option<string>): SplitRecord {
    return { job, owner, finishedAt: this.finished(job.status) ? some(new Date()) : none };
  }

  protected withStatus(_id: string, record: SplitRecord, status: SplitCallJob['status'], ended: boolean): SplitRecord {
    return { ...record, job: { ...record.job, status }, ...(ended && { owner: none, finishedAt: some(new Date()) }) };
  }

  protected withOwner(record: SplitRecord, owner: option<string>): SplitRecord {
    return { ...record, owner };
  }

  protected finished(status: SplitCallJob['status']): boolean {
    return status.type !== 'processing';
  }

  protected failed(status: SplitCallJob['status']): boolean {
    return status.type === 'failed';
  }

  protected failure(message: string): SplitCallJob['status'] {
    return variant('failed', { message });
  }

  protected work(id: string, record: SplitRecord): Promise<void> {
    const repo = record.job.repo;
    return handleProcessSplitCall({ storage: this.host.storage, splitCallStore: this, runner: this.host.getRunner(repo) }, { id, repo });
  }
}

// =============================================================================
// The backend
// =============================================================================

/**
 * How a {@link WebTransferBackend} keeps its transfers and runs its jobs.
 */
export interface WebTransferBackendOptions {
  /** The storage whose repositories the transfers are of: its records keep
   *  the transfers', its blobs what they stage, and its session owns each job
   *  the backend runs */
  readonly storage: WebStorage;
  /** Each repository's runner: what a deploy's migrations and index builds,
   *  a commit's intake units and a split call's units run on, and whose
   *  judgement of what still runs gc's history prune takes */
  readonly getRunner: (repo: string) => TaskRunner;
  /** The size of every part of a dataset upload but the last:
   *  {@link DEFAULT_WEB_PART_BYTES} unless set */
  readonly partBytes?: number;
  /** The most bytes of a zip an export round writes before it stops:
   *  {@link DEFAULT_EXPORT_ROUND_BYTES} unless set */
  readonly exportRoundBytes?: number;
  /**
   * How long what finished stays readable ({@link DEFAULT_RESULT_TTL_MS}),
   * how long what nothing finished or fetched is kept
   * ({@link DEFAULT_RECORD_RETENTION_MS}), and how often a live tab forgets
   * what is past both ({@link DEFAULT_RETENTION_INTERVAL_MS}), each in
   * milliseconds, unless set
   */
  readonly retention?: { readonly resultTtlMs?: number; readonly recordMs?: number; readonly intervalMs?: number };
}

/**
 * e3's {@link TransferBackend} in a browser: uploads staged in the storage's
 * blobs, downloads served from its object store, and every job — import,
 * export, deploy, gc, split call — run in this worker through e3-core's shared
 * handlers, its status in the storage's records.
 *
 * @remarks
 * Its URLs are e3-web's own byte endpoints (`createWebDataEndpoints`),
 * root-relative, which the routes resolve against the request's origin.
 * Every job and commit records this tab's session until it ends; {@link start}
 * records what closed tabs left failed — never running it again — and forgets
 * what is past its retention, and goes on doing so while the tab lives.
 *
 * @example
 * ```ts
 * const storage = await openWebStorage();
 * const transfer = new WebTransferBackend({ storage, getRunner });
 * await transfer.start();
 * // …
 * await transfer.close();
 * ```
 */
export class WebTransferBackend implements TransferBackend {
  readonly datasetUpload: WebDatasetUploadStore;
  readonly datasetDownload: WebDatasetDownloadStore;
  readonly packageImport: WebPackageImportStore;
  readonly packageExport: WebPackageExportStore;
  readonly workspaceDeploy: WebWorkspaceDeployStore;
  readonly repoGc: WebRepoGcStore;
  readonly splitCall: WebSplitCallStore;
  private readonly retention: Retention;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping: Promise<void> | null = null;
  private closed = false;

  /**
   * @param options - The storage, each repository's runner, the part size,
   *   the export rounds' size and the retention
   * @throws {RangeError} When a size is not a whole number of bytes greater
   *   than zero, or a retention not a whole number of milliseconds greater
   *   than zero
   */
  constructor(options: WebTransferBackendOptions) {
    const partBytes = options.partBytes ?? DEFAULT_WEB_PART_BYTES;
    const roundBytes = options.exportRoundBytes ?? DEFAULT_EXPORT_ROUND_BYTES;
    for (const [what, value] of [['part size', partBytes], ['export round size', roundBytes]] as const) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`a transfer backend's ${what} is a whole number of bytes greater than zero, not ${value}`);
      }
    }
    this.retention = {
      resultTtlMs: options.retention?.resultTtlMs ?? DEFAULT_RESULT_TTL_MS,
      recordMs: options.retention?.recordMs ?? DEFAULT_RECORD_RETENTION_MS,
      intervalMs: options.retention?.intervalMs ?? DEFAULT_RETENTION_INTERVAL_MS,
    };
    for (const [what, value] of Object.entries(this.retention)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`a transfer backend's retention ${what} is a whole number of milliseconds greater than zero, not ${value}`);
      }
    }
    const { storage, getRunner } = options;
    const host: TransferHost = {
      records: storage.adapters.records,
      blobs: storage.adapters.blobs,
      locks: storage.adapters.locks,
      storage,
      getRunner,
      retention: this.retention,
    };
    const running = new Running();
    this.datasetUpload = new WebDatasetUploadStore(host, BigInt(partBytes));
    this.datasetDownload = new WebDatasetDownloadStore(host);
    this.packageImport = new WebPackageImportStore(host, running);
    this.packageExport = new WebPackageExportStore(host, running, roundBytes);
    this.workspaceDeploy = new WebWorkspaceDeployStore(host, running);
    this.repoGc = new WebRepoGcStore(host, running);
    this.splitCall = new WebSplitCallStore(host, running);
  }

  /**
   * Starts the backend: records what closed tabs left — every job, and every
   * upload's commit, whose session has ended — failed, naming why, and
   * removes what it staged, so nothing a closed tab began runs again over a
   * repository that may have changed since; and forgets what finished longer
   * ago than the result TTL, or that nothing finished or fetched within the
   * record retention, with what it staged. It goes on doing so, every
   * retention interval, while the tab lives, until {@link close}.
   *
   * @remarks
   * A job or a commit a tab that lives runs is left to it.
   */
  async start(): Promise<void> {
    await this.sweep();
    if (this.timer !== null || this.closed) return;
    this.timer = setInterval(() => {
      void this.sweep().catch(() => undefined);
    }, this.retention.intervalMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  /** One pass over every store: one at a time, a pass asked for while one
   *  runs answered by it. */
  private sweep(): Promise<void> {
    this.sweeping ??= (async () => {
      try {
        const now = Date.now();
        await this.datasetUpload.sweep(now);
        await this.datasetDownload.sweep(now);
        await this.packageImport.sweep(now);
        await this.packageExport.sweep(now);
        await this.workspaceDeploy.sweep(now);
        await this.repoGc.sweep(now);
        await this.splitCall.sweep(now);
      } finally {
        this.sweeping = null;
      }
    })();
    return this.sweeping;
  }

  /** Stops the backend's own work: the retention it goes on doing while the
   *  tab lives. What its jobs do stops with the tab. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.sweeping?.catch(() => undefined);
  }
}
