/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Transfer backend interfaces for presigned URL object transfer.
 *
 * TransferBackend is a separate top-level interface (not part of StorageBackend).
 * It provides cloud-agnostic abstractions for uploading/downloading datasets and
 * packages via presigned URLs. Implementations:
 * - InMemoryTransferBackend (local server, tests)
 * - S3DynamoTransferBackend (AWS cloud, future)
 */

import type { FunctionCallCancel, FunctionCallStatus } from '@elaraai/e3-types';
import type {
  DatasetCommitStatus, DatasetUpload, ObjectCommitStatus, ObjectUploadJob, PackageImport, PackageExport, RecordLoadJob, RepoGcJob, SplitCallJob,
  WorkspaceDeployJob,
} from './types.js';

// =============================================================================
// Dataset Upload Store
// =============================================================================

/**
 * Where and how a client sends one part of an upload planned as parts.
 */
export interface DatasetPartUpload {
  /** The URL the client PUTs the part's bytes to, with no `Authorization` header. */
  url: string;
  /** Request headers the PUT must carry exactly as given (e.g. a signed checksum). */
  headers: Record<string, string>;
}

/**
 * Manages staged dataset uploads, and their commits.
 *
 * Flow: create → createParts → getPartUpload per part → (client uploads the
 * parts) → commit → poll getCommitStatus. The store forgets an upload a while
 * after its commit finishes.
 */
export interface DatasetUploadStore {
  create(id: string, record: DatasetUpload): Promise<void>;
  get(id: string): Promise<DatasetUpload | null>;
  delete(id: string): Promise<void>;

  /**
   * Plan a created upload as parts, and make ready where they are staged.
   *
   * @remarks
   * Every part but the last is exactly the returned size, and an upload no
   * larger than it is one part. The plan is the backend's to choose and to
   * remember: a local store takes its configured part size, and makes the
   * staging directory in the repository, while an object store may send an
   * upload it can take in one PUT as a single part carrying a checksum header,
   * and a larger one as a multipart upload whose part size keeps the part count
   * within its limits.
   *
   * @param id - The upload's id
   * @param record - The upload, as created
   * @returns The byte size of every part but the last
   */
  createParts(id: string, record: DatasetUpload): Promise<bigint>;

  /**
   * The part size {@link createParts} planned for an upload.
   *
   * @param id - The upload's id
   * @returns The part size, or `null` when the upload was not planned as parts
   */
  getPartBytes(id: string): Promise<bigint | null>;

  /**
   * Where and how the client sends one part of an upload planned as parts.
   *
   * @param id - The upload's id
   * @param record - The upload, as created
   * @param part - The part's number, from 1
   * @returns The part's URL and the headers its PUT must carry
   */
  getPartUpload(id: string, record: DatasetUpload, part: number): Promise<DatasetPartUpload>;

  /**
   * Commit an upload whose parts have all been sent: check the staged bytes are
   * the upload's size and hash, take them into the store through its door — a
   * collection split into the store's own segments — checking them against the
   * type the dataset declares, and point the dataset at them.
   *
   * @remarks
   * The commit runs where the store runs it — a local store in its own
   * process, a cloud's on its own compute — and outlives the request that asked
   * for it. Asked for again, while it runs or once it has finished, it starts
   * nothing new and answers as it did. Once it has been asked for, the upload
   * takes no more parts. It never rejects for the bytes' sake: how it finished
   * is its status.
   *
   * @param id - The upload's id
   * @param record - The upload, as created
   * @returns How the commit finished, once it has; a store that runs it
   *   elsewhere may answer `processing` at once, for the client to poll
   */
  commit(id: string, record: DatasetUpload): Promise<DatasetCommitStatus>;

  /**
   * How an upload's commit stands, which a poll reads whichever instance
   * answers it. A finished commit's status stays readable for a while, with the
   * upload's record, so a client whose answer was lost asks again and hears the
   * same.
   *
   * @param id - The upload's id
   * @returns The status, or `null` when no commit of the upload was asked for
   */
  getCommitStatus(id: string): Promise<DatasetCommitStatus | null>;
}

// =============================================================================
// Dataset Download Store
// =============================================================================

/**
 * Generates download URLs for dataset objects.
 *
 * Local: creates temporary records so `/api/downloads/:id` can look up the object.
 * Cloud: returns presigned S3 URLs directly; `get`/`delete` are never called.
 */
export interface DatasetDownloadStore {
  /** Create a temporary download record and return the URL. */
  getDownloadUrl(repo: string, hash: string): Promise<string>;
  /** Look up a download record by ID (for local server data handlers). */
  get(id: string): Promise<{ repo: string; hash: string } | null>;
  /** Clean up after serving. */
  delete(id: string): Promise<void>;
}

// =============================================================================
// Package Import Store
// =============================================================================

/**
 * Manages package import lifecycle: upload zip → process → poll completion.
 *
 * Flow: create → getUploadUrl → (client uploads) → execute → poll get → delete
 */
export interface PackageImportStore {
  create(id: string, record: PackageImport): Promise<void>;
  get(id: string): Promise<PackageImport | null>;
  updateStatus(id: string, status: PackageImport['status']): Promise<void>;
  delete(id: string): Promise<void>;

  /** URL the client PUTs zip bytes to. */
  getUploadUrl(id: string, repo: string): Promise<string>;

  /**
   * Dispatch processing.
   * Local: calls packageImport() inline, updates status to completed/failed.
   * Cloud: invokes background processor asynchronously.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Package Export Store
// =============================================================================

/**
 * Manages package export lifecycle: trigger → process → poll → download.
 *
 * Flow: create → execute → poll get → getDownloadUrl → delete
 */
export interface PackageExportStore {
  create(id: string, record: PackageExport): Promise<void>;
  get(id: string): Promise<PackageExport | null>;
  updateStatus(id: string, status: PackageExport['status']): Promise<void>;
  delete(id: string): Promise<void>;

  /** URL the client GETs zip bytes from. */
  getDownloadUrl(id: string, repo: string): Promise<string>;

  /**
   * Dispatch processing.
   * Local: calls packageExport() inline, updates status to completed/failed.
   * Cloud: invokes background processor asynchronously.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Workspace Deploy Store
// =============================================================================

/**
 * Manages workspace deploy jobs: trigger → process → poll.
 *
 * @remarks
 * A deploy that migrates a record, or builds an index over one, takes as long
 * as the record is large, which outlasts a request. So it runs as a job in the
 * compute the store dispatches it to, and the client polls its status.
 *
 * Flow: create → execute → poll get → delete
 */
export interface WorkspaceDeployStore {
  create(id: string, record: WorkspaceDeployJob): Promise<void>;
  get(id: string): Promise<WorkspaceDeployJob | null>;
  updateStatus(id: string, status: WorkspaceDeployJob['status']): Promise<void>;
  delete(id: string): Promise<void>;

  /**
   * Dispatch processing.
   * Local: runs `handleProcessDeploy` in the background, on the server's runner.
   * Cloud: invokes its own compute, which runs `handleProcessDeploy` on its runner.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Repository GC Store
// =============================================================================

/**
 * Manages gc jobs: trigger → process → poll.
 *
 * @remarks
 * gc takes as long as the repository is large, which outlasts a request. So
 * it runs as a job in the compute the store dispatches it to, and the client
 * polls its status from the store, whichever instance answers the poll.
 *
 * Flow: create → execute → poll get → delete
 */
export interface RepoGcStore {
  create(id: string, record: RepoGcJob): Promise<void>;
  get(id: string): Promise<RepoGcJob | null>;
  updateStatus(id: string, status: RepoGcJob['status']): Promise<void>;
  delete(id: string): Promise<void>;

  /**
   * Dispatch processing.
   * Local: runs `handleProcessGc` in the background, in the server's process.
   * Cloud: invokes its own compute, which runs `handleProcessGc`.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Split Call Store
// =============================================================================

/**
 * Manages split call jobs: launch → process → poll.
 *
 * @remarks
 * A split call runs a caller's program over a dataset's pieces, and takes as
 * long as the dataset is large, which outlasts a request. So it runs as a job
 * in the compute the store dispatches it to, and the client polls its status
 * from the store, whichever instance answers the poll. A job's record holds
 * hashes, never values, and is forgotten a while after the job finishes. An
 * explain is a job too, which plans the call's pieces and ends `planned`.
 *
 * A job's timeout is one budget for the whole job, counted from its launch
 * (the record's `createdAt`), however many calls run it: a host that runs a
 * job in rounds sets the one-shot routes' `ceilings.timeoutMs` to the budget
 * for the whole job, not for one round. The record keeps whether a caller
 * whose one-shot grant is `platform_free` may poll the job (`platformFree`).
 *
 * A job is cancelled by writing it `cancelled`. The job's processor reads its
 * record as it runs, and stops its units once it finds the job has ended
 * (`handleProcessSplitCall`).
 *
 * Flow: create → execute → poll get (→ cancel) → delete
 */
export interface SplitCallStore {
  create(id: string, record: SplitCallJob): Promise<void>;
  get(id: string): Promise<SplitCallJob | null>;
  /**
   * Records a job's status, unless the job has ended: once it is
   * `completed`, `planned`, `failed` or `cancelled`, the store never moves it
   * to another status. The check and the write are one atomic step, so a
   * cancel never overwrites a result, nor a result a cancel.
   *
   * @param id - The job's id
   * @param status - Its new status
   * @returns Whether the status was recorded: `false` when the job had ended
   * @throws {Error} When there is no such job
   */
  updateStatus(id: string, status: SplitCallJob['status']): Promise<boolean>;
  delete(id: string): Promise<void>;

  /**
   * Dispatch processing.
   * Local: runs `handleProcessSplitCall` in the background, on the server's runner.
   * Cloud: invokes its own compute, which runs `handleProcessSplitCall` on its runner.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Record Load Store
// =============================================================================

/**
 * Manages load jobs: launch → process → poll (→ cancel).
 *
 * @remarks
 * A load of a delivery into an external source of a composite record waits
 * its turn among the source's loads, waits out a deploy, and runs as long as
 * its delivery is large, which outlasts a request. So it runs as a job in the
 * compute the store dispatches it to, and the client polls its status from
 * the store, whichever instance answers the poll. A job's record holds names
 * and hashes, never the delivery, and is forgotten a while after the job ends.
 *
 * Only the job writes its end, `completed`, `failed` or `cancelled`. A cancel
 * records a request ({@link RecordLoadStore.cancel}), which the job reads once
 * a second, as it waits for an earlier load of its source and as it runs
 * (`handleProcessRecordLoad`): it ends `cancelled` when it stops before its
 * commit writes the record's ref, and `completed` once its commit has written,
 * since a commit that has written has landed.
 *
 * One source's loads apply one at a time, in the order asked. The load's turn
 * is a lock (`loadQueueLock`). A store whose jobs run in its own process has
 * each source's jobs ask for it in the order they were filed, by
 * `handleProcessRecordLoadInOrder`: where the storage's lock service queues
 * its waiters, each job waits inside its load, holding its place among the
 * source's waiters, so a job filed before another process asks is given the
 * turn before it; over a lock service that keeps no queue, a job's load starts
 * once the job filed before it has ended. A store with a queue of its own
 * keeps the order there. A job waiting for an earlier load of its source says
 * so (`queued`), and holds the repository's running work from when it is
 * dispatched, so no sweep takes its delivery meanwhile. What a store's jobs do
 * once dispatched is part of its contract (`recordLoadStoreTests`).
 *
 * Flow: create → execute → poll get (→ cancel) → delete
 */
export interface RecordLoadStore {
  create(id: string, record: RecordLoadJob): Promise<void>;
  get(id: string): Promise<RecordLoadJob | null>;
  /**
   * Records a job's status, unless the job has ended: once it is
   * `completed`, `failed` or `cancelled`, the store never moves it to another
   * status. The check and the write are one atomic step.
   *
   * @param id - The job's id
   * @param status - Its new status
   * @returns Whether the status was recorded: `false` when the job had ended
   * @throws {Error} When there is no such job
   */
  updateStatus(id: string, status: RecordLoadJob['status']): Promise<boolean>;
  /**
   * Records a request to cancel a job, which the job acts on. A job that has
   * ended, or that was asked already, is left as it is. The check and the
   * write are one atomic step.
   *
   * @param id - The job's id
   * @param cancel - Who asked, and when
   * @returns The job as it stands; null when there is none
   */
  cancel(id: string, cancel: FunctionCallCancel): Promise<RecordLoadJob | null>;
  delete(id: string): Promise<void>;

  /**
   * Dispatch processing.
   * Local: runs `handleProcessRecordLoadInOrder` in the background, on the
   * server's runner, each source's jobs in the order they were filed.
   * Cloud: invokes its own compute, which runs `handleProcessRecordLoad` on its runner.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Object Upload Store
// =============================================================================

/**
 * Manages staged uploads that write no ref: a file a load delivers, or a split
 * call's `object` argument, stored as the object it hashes to, which the
 * caller then names by its hash.
 *
 * @remarks
 * The dataset upload's protocol ({@link DatasetUploadStore}), with no dataset:
 * create → createParts → getPartUpload per part → (the client uploads the
 * parts) → commit → poll getCommitStatus. The commit checks the staged bytes
 * are the upload's size and hash, and stores them as that object, whole; it
 * points nothing at it. The store forgets an upload a while after its commit
 * finishes.
 */
export interface ObjectUploadStore {
  create(id: string, record: ObjectUploadJob): Promise<void>;
  get(id: string): Promise<ObjectUploadJob | null>;
  delete(id: string): Promise<void>;

  /**
   * Plan a created upload as parts, as {@link DatasetUploadStore.createParts}
   * does.
   *
   * @param id - The upload's id
   * @param record - The upload, as created
   * @returns The byte size of every part but the last
   */
  createParts(id: string, record: ObjectUploadJob): Promise<bigint>;

  /**
   * The part size {@link ObjectUploadStore.createParts} planned for an upload.
   *
   * @param id - The upload's id
   * @returns The part size, or `null` when the upload was not planned as parts
   */
  getPartBytes(id: string): Promise<bigint | null>;

  /**
   * Where and how the client sends one part of an upload planned as parts.
   *
   * @param id - The upload's id
   * @param record - The upload, as created
   * @param part - The part's number, from 1
   * @returns The part's URL and the headers its PUT must carry
   */
  getPartUpload(id: string, record: ObjectUploadJob, part: number): Promise<DatasetPartUpload>;

  /**
   * Commit an upload whose parts have all been sent: check the staged bytes
   * are the upload's size and hash, and store them as the object they are.
   *
   * @remarks
   * As a dataset upload's commit: it runs where the store runs it, outlives
   * the request that asked for it, and asked for again starts nothing new and
   * answers as it did. Once it has been asked for, the upload takes no more
   * parts. It never rejects for the bytes' sake: how it finished is its
   * status.
   *
   * @param id - The upload's id
   * @param record - The upload, as created
   * @returns How the commit finished, once it has; a store that runs it
   *   elsewhere may answer `processing` at once, for the client to poll
   */
  commit(id: string, record: ObjectUploadJob): Promise<ObjectCommitStatus>;

  /**
   * How an upload's commit stands, which a poll reads whichever instance
   * answers it, for a while after it finished.
   *
   * @param id - The upload's id
   * @returns The status, or `null` when no commit of the upload was asked for
   */
  getCommitStatus(id: string): Promise<ObjectCommitStatus | null>;
}

// =============================================================================
// Function Call Dispatch
// =============================================================================

/**
 * Runs the calls of named functions a server files (east-workspace#1554),
 * each where the backend runs calls, outliving the request that filed it: a
 * call is held to its own timeout, never to a request's.
 *
 * @remarks
 * A call is the repository's record (`StorageBackend.calls`), filed by
 * e3-core's `functionCallStart`. A dispatch runs the job every backend shares,
 * `handleProcessFunctionCall`, which records the call's end in that store, and
 * answers what it has of the call's status as it waits for it. A caller reads
 * the store for anything a dispatch cannot say. Its `repo` is the repository's
 * name, as every job store's is.
 *
 * Flow: the call is filed → execute → poll wait → (cancel)
 */
export interface FunctionCallDispatch {
  /**
   * Run a filed call where the backend runs calls, and wait up to `waitMs` for
   * it to end. A call that is running already is not run again.
   *
   * Local: runs `handleProcessFunctionCall` in the background, in the server's
   * process, on its runner.
   * Cloud: invokes its own compute, which runs `handleProcessFunctionCall`.
   *
   * @param repo - The repository's name
   * @param workspace - The workspace the call was made through
   * @param id - The call's id
   * @param options - How long to wait for the call to end, in ms
   * @returns The call's status once it ended within the wait; `null` while it
   *   runs, or when the dispatch cannot say, for the store to answer
   */
  execute(repo: string, workspace: string, id: string, options: { waitMs: number }): Promise<FunctionCallStatus | null>;

  /**
   * Wait up to `waitMs` for a running call to end: until it ends, when the
   * dispatch hears of it, or until the time passes.
   *
   * @param repo - The repository's name
   * @param workspace - The workspace the call was made through
   * @param id - The call's id
   * @param options - How long to wait, in ms
   * @returns The call's status once it ended within the wait, when the
   *   dispatch has it; `null` otherwise, for the store to answer
   */
  wait(repo: string, workspace: string, id: string, options: { waitMs: number }): Promise<FunctionCallStatus | null>;

  /**
   * Tell a running call it was asked to stop, once the request is recorded in
   * its store (`FunctionCallStore.requestCancel`). A dispatch whose runs are in
   * its own process stops one at once; one whose runs look for the request in
   * the store, as every run does, need do nothing.
   *
   * @param repo - The repository's name
   * @param workspace - The workspace the call was made through
   * @param id - The call's id
   */
  cancel(repo: string, workspace: string, id: string): Promise<void>;
}

// =============================================================================
// Transfer Backend
// =============================================================================

/**
 * Cloud-agnostic transfer backend for presigned URL object transfer, and the
 * jobs that outlast a request.
 *
 * Separate from StorageBackend — depends on it for actual object/ref operations
 * but has its own lifecycle (staging, jobs, URLs).
 */
export interface TransferBackend {
  readonly datasetUpload: DatasetUploadStore;
  readonly datasetDownload: DatasetDownloadStore;
  readonly packageImport: PackageImportStore;
  readonly packageExport: PackageExportStore;
  readonly workspaceDeploy: WorkspaceDeployStore;
  readonly repoGc: RepoGcStore;
  readonly splitCall: SplitCallStore;
  /** Runs the loads of deliveries into composite records' external sources */
  readonly recordLoad: RecordLoadStore;
  /** Takes in files uploaded as objects, which no ref names */
  readonly objectUpload: ObjectUploadStore;
  /** Runs the calls of named functions a server files, outliving its requests */
  readonly functionCalls: FunctionCallDispatch;
}
