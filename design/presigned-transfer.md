# Presigned Object Transfer

## Summary

Replace inline HTTP body transfer for large payloads with a presigned URL protocol. The client uploads/downloads directly to/from object storage (S3, GCS, Azure Blob) using time-limited URLs provided by the API server. Package operations become asynchronous with job polling. The protocol is cloud-agnostic — the local `e3-api-server` implements the same endpoints, returning URLs pointing back to itself.

## Problem

AWS API Gateway enforces a **10 MB payload limit** (non-negotiable) and a **29-second response timeout**. Four operations exceed these limits:

| Operation | Current flow | Direction | Potential size |
|-----------|-------------|-----------|----------------|
| `e3 package import` | `POST /packages` (zip body) | Upload | 100s MB – GBs |
| `e3 package export` | `GET /packages/:name/:version/export` (zip response) | Download | 100s MB – GBs |
| `e3 get` (dataset) | `GET /datasets/*` (raw BEAST2 response) | Download | GBs |
| `e3 set` (dataset) | `PUT /datasets/*` (raw BEAST2 body) | Upload | GBs |

All other API operations (repo CRUD, admin, dataflow, schedules, task configs, GC, user settings) fit within the 10 MB limit and are unchanged.

## Goals

1. Support objects up to **5 GB** (single-part presigned PUT/GET across all clouds)
2. **One protocol** — the `e3-api-client` uses the same code for local, AWS, GCP, and Azure servers
3. **Cloud-agnostic interfaces** in `e3-core` / `e3-cloud-core` with concrete implementations per cloud
4. **Cleanup** — abandoned uploads are garbage-collected automatically

## Non-goals

- Multipart upload for objects > 5 GB (future enhancement, same protocol shape)
- Resumable uploads (can be added later by extending the protocol)
- Streaming/chunked responses through API Gateway

## Cloud presigned URL equivalents

| | AWS | Azure | GCP |
|---|---|---|---|
| Upload | S3 presigned PUT | Blob Storage SAS token (write) | GCS signed URL |
| Download | S3 presigned GET | Blob Storage SAS token (read) | GCS signed URL |
| Single upload limit | 5 GB | ~4.88 GB (5000 MiB) | 5 TB |
| URL expiry | Configurable | Configurable | Configurable |

## Completed Phases

### Phase 0: BEAST2 Headers (completed)

- Added `Content-Type: application/vnd.elara.beast2` MIME type to dataset GET responses
- Added `Content-Length` and `X-Content-SHA256` headers to dataset GET responses
- `datasetGet` client returns `{ data, hash, size }` instead of raw bytes
- All datasets are BEAST2-encoded regardless of East type (including BlobType)

### Phase 0.5: Local Dataset Transfer (completed)

Implemented the dataset transfer protocol for the local `e3-api-server`:

**GET redirect for large objects:**
- `getDataset()` checks object size via `stat()`; returns 307 redirect for objects > 1MB
- Redirect `Location` points to `GET /api/repos/:repo/objects/:hash` (same origin)
- Response includes `X-Content-Length` and `X-Content-SHA256` headers
- Clients follow the redirect automatically via `fetch`

**New endpoints on `e3-api-server`:**
- `GET /api/repos/:repo/objects/:hash` — Serves raw BEAST2 bytes by content hash
- `POST /api/repos/:repo/transfer/upload` — Init upload (dedup check or staging slot)
- `PUT /api/repos/:repo/transfer/:id/data` — Upload bytes to staging area
- `POST /api/repos/:repo/transfer/:id/done` — Verify hash, atomic move, update dataset ref

**Upload flow:**
- Client computes SHA-256 locally before initiating transfer
- **Dedup path (1 round-trip):** If object hash already exists in store, server updates dataset ref immediately and returns `{ status: "completed" }`
- **Upload path (3 round-trips):** Init → upload to staging → complete (verify hash + atomic rename + ref update)
- **Staging area:** `objects/_staging/{transferId}.beast2.partial` — same filesystem as content-addressed store for atomic `rename()`
- **Hash verification:** Server reads staging file, computes SHA-256, rejects on mismatch (400)

**Client changes (`e3-api-client`):**
- `datasetSet()` checks payload size; uses inline PUT for ≤ 1MB, transfer flow for > 1MB
- Transfer flow: compute hash → POST init → PUT upload → POST done

**Threshold:** 1MB (down from originally planned 6MB). This is conservative but safe for all backends.

**Note:** `stat()` is efficient on all backends — `fs.stat` locally, DynamoDB catalogue for S3.

### Phase 1: Local Package Transfer (in progress)

Implement the package transfer protocol for the local `e3-api-server`:

**New endpoints on `e3-api-server`:**
- `POST /api/repos/:repo/packages/transfer/upload` — Init upload, returns `{ transferId, uploadUrl }`
- `PUT /api/repos/:repo/packages/transfer/:id/data` — Upload zip bytes to staging
- `POST /api/repos/:repo/packages/transfer/:id/import` — Trigger import processing (sync on local server)
- `POST /api/repos/:repo/packages/transfer/export` — Trigger export processing (sync on local server)
- `GET /api/repos/:repo/packages/transfer/jobs/:jobId` — Poll job status
- `GET /api/repos/:repo/packages/transfer/download/:jobId` — Download export zip (local server only; cloud uses presigned S3 URL)

**Import flow:**
1. Client calls init with `{ size }` — server creates staging slot in `os.tmpdir()/e3-transfers/`, returns `{ transferId, uploadUrl }`
2. Client PUTs raw zip bytes to uploadUrl (staging endpoint)
3. Client calls import trigger — server validates size, reads zip from staging, calls `packageImport()`, returns `{ jobId }` with completed result
4. Client polls job status — on local server, first poll returns completed with `PackageImportResult`

**Export flow:**
1. Client calls export with `{ name, version }` — server runs `packageExport()` synchronously, writes zip to tmpdir, returns `{ jobId }`
2. Client polls job status — returns completed with `{ downloadUrl, size }`
3. Client GETs downloadUrl — serves zip bytes from staging, cleans up after

**No dedup at the zip level** — packages are non-deterministic zips. Object-level dedup is handled by `storage.objects.write()` being content-addressed (writing an existing hash is idempotent).

**Staging cleanup:** GC cleans orphaned transfer staging files from temp directory (already implemented for dataset transfers).

**Old inline endpoints (`POST /packages`, `GET /packages/:name/:version/export`) are removed** — all package I/O goes through the transfer flow. This is pre-MVP, no backward compatibility needed.

## Protocol Design

### Dataset GET (307 redirect)

The existing `GET /datasets/*` endpoint is modified to return a **307 redirect** instead of inline bytes. Lambda resolves the dataset path to an object hash, looks up the object size, and returns a redirect to a presigned GET URL. The client's `fetch` follows the redirect automatically.

```
Client                         API Server (Lambda)           Object Storage
  │                               │                               │
  │─ GET /datasets/* ────────────>│                               │
  │                               │── resolve path → hash ───────>│
  │                               │── lookup object size ────────>│
  │                               │── generate presigned GET ────>│
  │<─ 307 Location: <presigned> ─│                               │
  │   X-Content-Length: <size>     │                               │
  │                               │                               │
  │─ GET <presigned URL> ────────────────────────────────────────>│
  │<─ raw BEAST2 bytes ──────────────────────────────────────────│
```

**Size hint:** The 307 response includes an `X-Content-Length` header with the object size in bytes. This lets the client display progress bars, pre-allocate buffers, or decide whether to stream to disk vs. hold in memory — before the actual download begins.

The redirect itself is tiny (just headers), so no payload limits apply. The large payload flows directly from object storage to the client.

**Local server:** The local `e3-api-server` can either return the bytes inline (no size limits locally) or use the same 307 pattern pointing to a local blob endpoint. For consistency and to exercise the same client code path, we use 307 for all servers.

### Dataset SET (size-based routing)

Small datasets (≤ 1 MB) continue to use the existing inline `PUT /datasets/*` endpoint — one round-trip, no protocol change. Large datasets use the transfer flow.

The client decides the path based on the payload size — no server round-trip needed for the size check.

**Inline path (≤ 1 MB):**

```
Client                         API Server                    Object Storage
  │                               │                               │
  │─ PUT /datasets/* ────────────>│                               │
  │  X-Content-Length: 4096       │── compute hash, store ───────>│
  │  (raw BEAST2 bytes)           │── update dataset ref ────────>│
  │<─ 200 OK ────────────────────│                               │
```

**Transfer path (> 1 MB):**

```
Client                         API Server                    Object Storage
  │                               │                               │
  │─ POST /transfer/upload ──────>│                               │
  │  { purpose: "dataset",        │                               │
  │    workspace, path,           │── check object exists? ──────>│
  │    hash, size }               │<── yes/no ───────────────────│
  │                               │                               │
  │<─ { transferId, uploadUrl }──│   (or { exists: true })       │
  │   (or { exists: true })       │                               │
  │                               │                               │
  │─ PUT uploadUrl ──────────────────────────────────────────────>│
  │  (raw BEAST2 bytes)           │                               │
  │<─ 200 ───────────────────────────────────────────────────────│
  │                               │                               │
  │─ POST /transfer/:id/complete─>│                               │
  │                               │── update dataset ref ────────>│
  │<─ { status: "completed" } ───│                               │
```

**Client-side hashing:** The client computes the SHA-256 hash of the BEAST2 bytes before initiating the upload. This enables:

1. **Deduplication** — if the object already exists in the store, the server returns `{ status: "completed" }` and the client skips the upload entirely. The server updates the dataset ref immediately. Done in one round-trip.
2. **Staging + verification** — uploads go to a staging area (`objects/_staging/{transferId}.beast2.partial`), NOT directly to the content-addressed store. The server verifies the hash after upload, then performs an atomic rename to the final location. This prevents corrupted data from being stored at the wrong hash path.
3. **Integrity** — the server computes SHA-256 on the uploaded bytes and rejects on mismatch (400 error). For cloud, the upload goes directly to S3 via presigned URL, so verification happens at the completion step.

The `e3-api-client` already has the BEAST2 bytes in hand before calling `datasetSet()`, and `computeHash` (SHA-256) is already exported from `e3-core/src/objects.ts`.

**Completion step:** Updates the dataset ref to point to the new hash. This is a metadata-only operation (DynamoDB write) and completes in milliseconds, well within the 29-second API Gateway timeout.

### Transfer Endpoints

New endpoints for upload and async package operations. All scoped per-repo with the same authorization as existing operations.

```
POST /api/repos/:repo/transfer/upload              — init a large upload
POST /api/repos/:repo/transfer/:transferId/complete — complete an upload
POST /api/repos/:repo/transfer/export               — start async package export
GET  /api/repos/:repo/transfer/jobs/:jobId          — poll async job status
```

Request/response bodies use BEAST2 encoding, consistent with the rest of the API.

### Package Import (asynchronous)

```
Client                         API Server                    Object Storage
  │                               │                               │
  │─ POST /transfer/upload ──────>│                               │
  │  { purpose: "package-import", │── generate presigned PUT ───>│
  │    size }                     │   (_transfer/{id}/pkg.zip)    │
  │<─ { transferId, uploadUrl } ─│                               │
  │                               │                               │
  │─ PUT uploadUrl ──────────────────────────────────────────────>│
  │  (zip bytes)                  │                               │
  │<─ 200 ───────────────────────────────────────────────────────│
  │                               │                               │
  │─ POST /transfer/:id/complete─>│                               │
  │                               │── trigger async processing ──│
  │<─ { status: "processing",  ──│                               │
  │     jobId }                   │         ┌──────────────────┐  │
  │                               │         │ Async processor  │  │
  │─ GET /transfer/jobs/:jobId ──>│         │ reads zip from   │  │
  │<─ { status: "processing" } ──│         │ temp location,   │  │
  │                               │         │ extracts objects, │  │
  │─ GET /transfer/jobs/:jobId ──>│         │ registers pkg    │  │
  │<─ { status: "completed",  ───│         └──────────────────┘  │
  │     result: { name,           │                               │
  │       version, hash } }       │                               │
```

**Why async:** Processing a large zip (extract objects, write each to storage, register package metadata) can take minutes. The 29-second API Gateway timeout makes synchronous processing impossible. The client polls for completion.

**Temp storage:** The zip is uploaded to a temporary location (`_transfer/{transferId}/pkg.zip`) in the object store. After processing, the temp object is deleted. Abandoned uploads are cleaned up by lifecycle rules (see [Cleanup](#cleanup)).

**Async processor:** On AWS, the completion endpoint invokes a Lambda function asynchronously (`InvocationType: 'Event'`). The Lambda reads the zip from S3, calls the existing `packageImport()` logic from `e3-core`, and updates the job status in the job store. On the local server, processing is synchronous — the completion endpoint processes inline and returns `{ status: "completed" }` directly.

### Package Export (asynchronous)

```
Client                         API Server                    Object Storage
  │                               │                               │
  │─ POST /transfer/export ──────>│                               │
  │  { name, version }           │── trigger async export ──────│
  │<─ { jobId } ─────────────────│                               │
  │                               │         ┌──────────────────┐  │
  │─ GET /transfer/jobs/:jobId ──>│         │ Async processor  │  │
  │<─ { status: "processing" } ──│         │ reads objects,    │  │
  │                               │         │ creates zip,     │  │
  │─ GET /transfer/jobs/:jobId ──>│         │ writes to temp   │  │
  │<─ { status: "completed",  ───│         └──────────────────┘  │
  │     downloadUrl, size }       │                               │
  │                               │                               │
  │─ GET downloadUrl ────────────────────────────────────────────>│
  │<─ zip bytes ─────────────────────────────────────────────────│
```

**Size hint:** The completed job status includes a `size` field so the client can display download progress.

**Async processor:** Generates the zip using existing `packageExport()` from `e3-core`, writes to temp location, records size, generates presigned GET URL, updates job status. On the local server, the export is processed synchronously.

### Job Status

Job status is a simple state machine:

```
processing → completed
processing → failed
```

```typescript
interface TransferJob {
  jobId: string;
  repo: string;
  type: 'package-import' | 'package-export';
  status: 'processing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  result?: {
    // package-import: { name, version, packageHash, objectCount }
    // package-export: { downloadUrl, size }
  };
  error?: string;
}
```

Jobs have a **timeout** — if a job remains in `processing` state for longer than 15 minutes, the polling endpoint returns `failed` with a timeout error. This handles the case where the async processor crashes.

## Types

### Dataset Transfer Types (implemented)

Defined in `e3-api-server/src/types.ts` and mirrored in `e3-api-client/src/types.ts`:

```typescript
// Dataset upload init request
export const TransferUploadRequestType = StructType({
  workspace: StringType,
  path: StringType,
  hash: StringType,       // SHA-256 hex, computed by client
  size: IntegerType,      // bytes
});

// Dataset upload init response
export const TransferUploadResponseType = VariantType({
  completed: NullType,    // Object already in store (dedup), ref updated
  upload: StructType({
    transferId: StringType,
    uploadUrl: StringType,
  }),
});

// Dataset upload done response
export const TransferDoneResponseType = VariantType({
  completed: NullType,    // Hash verified, object stored, ref updated
  error: StructType({ message: StringType }),
});
```

### Package Transfer Types (new)

```typescript
// Package upload init request — just size (no hash, can't dedup zips)
export const PackageTransferInitRequestType = StructType({
  size: IntegerType,
});

// Package upload init response
export const PackageTransferInitResponseType = StructType({
  transferId: StringType,
  uploadUrl: StringType,
});

// Package export request
export const PackageExportRequestType = StructType({
  name: StringType,
  version: StringType,
});

// Job response (returned by import trigger and export trigger)
export const PackageJobResponseType = StructType({
  jobId: StringType,
});

// Job status (shared for import and export, poll endpoint)
export const PackageJobStatusType = VariantType({
  processing: NullType,
  completed: VariantType({
    import: PackageImportResultType,   // { name, version, packageHash, objectCount }
    export: StructType({
      downloadUrl: StringType,
      size: IntegerType,
    }),
  }),
  failed: StructType({
    message: StringType,
  }),
});
```

## Interfaces

### TransferService (e3-core)

Abstracts presigned URL generation. Implemented by each backend.

```typescript
/** Generates presigned URLs for direct object storage access. */
interface TransferService {
  /** Generate a presigned PUT URL for uploading an object. */
  createUploadUrl(
    bucket: string,
    key: string,
    options: { expiresInSeconds: number; contentType?: string }
  ): Promise<{ url: string }>;

  /** Generate a presigned GET URL for downloading an object. */
  createDownloadUrl(
    bucket: string,
    key: string,
    options: { expiresInSeconds: number }
  ): Promise<{ url: string }>;

  /** Get the size of an object in bytes. Returns null if not found. */
  getObjectSize(bucket: string, key: string): Promise<number | null>;
}
```

### TransferJobStore (e3-cloud-core)

Tracks async job state. Implemented per cloud backend.

```typescript
interface TransferJobStore {
  create(job: TransferJob): Promise<void>;
  get(repo: string, jobId: string): Promise<TransferJob | null>;
  update(jobId: string, updates: Partial<TransferJob>): Promise<void>;
}
```

### TransferJobExecutor (e3-cloud-core)

Triggers async processing. Implemented per cloud backend.

```typescript
interface TransferJobExecutor {
  /** Trigger async package import processing. */
  startPackageImport(repo: string, jobId: string, tempKey: string): Promise<void>;

  /** Trigger async package export processing. */
  startPackageExport(repo: string, jobId: string, name: string, version: string): Promise<void>;
}
```

## Cleanup

### Temp objects (`_transfer/` prefix)

Uploads and exports write temp objects under `_transfer/{transferId}/` in the data bucket.

**AWS:** S3 lifecycle rule on the `_transfer/` prefix — auto-delete objects after 1 day. This handles:
- Abandoned uploads (client started but never completed)
- Processed imports (zip no longer needed)
- Export zips after download
- No custom GC code required

**Local:** Temp directory, cleaned up on server start or after configurable TTL.

**GCP/Azure:** Equivalent lifecycle/management policies on the temp prefix.

### Job records

**AWS:** DynamoDB TTL on job records — auto-delete after 7 days.

**Local:** In-memory map, entries expire naturally.

### Orphaned objects

Failed package imports may leave orphaned objects in permanent storage. These are handled by the existing repo GC (`e3 repo gc`), which already scans for unreferenced objects.

## Changes by Layer

### `../e3` (upstream)

| Package | Change |
|---------|--------|
| **e3-api-server** (types.ts) | Add `PackageTransferInitRequestType`, `PackageTransferInitResponseType`, `PackageExportRequestType`, `PackageJobResponseType`, `PackageJobStatusType` |
| **e3-api-server** (routes/) | New `createPackageTransferRoutes()` — upload init, data staging, import trigger, export trigger, job poll, download. Remove inline import/export from `createPackageRoutes()` |
| **e3-api-client** (types.ts) | Mirror package transfer types |
| **e3-api-client** (packages.ts) | Rewrite `packageImport` to use transfer flow (init → upload → import → poll). Rewrite `packageExport` to use transfer flow (export → poll → download) |
| **e3-api-tests** | New `package-transfer.ts` test suite |

### `e3-cloud-core` (cloud-agnostic)

| File | Change |
|------|--------|
| `transfer-service.ts` | Re-export `TransferService` interface from e3-core |
| `transfer-job-store.ts` | `TransferJobStore` interface |
| `transfer-job-executor.ts` | `TransferJobExecutor` interface |
| `routes/dataset-routes.ts` | Modify `GET /datasets/*` handler to return 307 with presigned URL + `X-Content-Length` header |
| `routes/transfer-routes.ts` | Route handlers for upload init, complete, export, and job polling. Inject `TransferService`, `TransferJobStore`, `TransferJobExecutor`, and `DataflowStorage`. |
| `testing/in-memory.ts` | `InMemoryTransferJobStore`, `InMemoryTransferJobExecutor`, `InMemoryTransferService` |
| `routes/transfer-routes.spec.ts` | Unit tests using in-memory implementations |

### `e3-aws` (AWS-specific)

| File | Change |
|------|--------|
| `services/s3-transfer-service.ts` | `S3TransferService` — `@aws-sdk/s3-request-presigner` for presigned URL generation, `HeadObject` for size lookup |
| `storage/dynamo-transfer-job-store.ts` | `DynamoTransferJobStore` — DynamoDB with TTL. PK: `TJOB/{repo}`, SK: `{jobId}` |
| `services/lambda-transfer-executor.ts` | `LambdaTransferJobExecutor` — invokes processing Lambda with `InvocationType: 'Event'` |
| `handlers/transfer/process-import.ts` | Lambda: read zip from S3 temp key, call `packageImportFromStorage()`, update job status |
| `handlers/transfer/process-export.ts` | Lambda: call `packageExport()` to temp key, record size, generate presigned GET URL, update job status |
| `handlers/api.ts` | Wire transfer routes into API Lambda composition root |

### CDK (`cdk/platform`)

| Change |
|--------|
| S3 lifecycle rule: delete `_transfer/*` objects after 1 day |
| DynamoDB TTL attribute on job records |
| New Lambda functions: `e3-{id}-process-import`, `e3-{id}-process-export` |
| IAM: Lambda invoke permission from API Lambda to processing Lambdas |
| IAM: S3 presigned URL generation permissions for API Lambda |

## Client Behavior

### Size Threshold

The client uses a **1 MB threshold** for dataset SET:
- **≤ 1 MB:** Inline PUT to existing endpoint (1 round-trip)
- **> 1 MB:** Transfer flow (init → upload → complete, 3 round-trips, or 1 round-trip if dedup)

This threshold is well below both the Lambda synchronous payload limit (6 MB) and API Gateway limit (10 MB). A lower threshold means more operations use the transfer flow, which is safer and enables dedup.

### Polling

For async jobs, the client polls with exponential backoff:
- Initial interval: 1 second
- Max interval: 5 seconds
- Timeout: 15 minutes (matches Lambda max execution time)

### Error Handling

| Scenario | Client behavior |
|----------|----------------|
| Upload init fails | Return error (auth, not found, etc.) |
| Presigned PUT fails | Retry once, then return error |
| Completion fails | Return error (server will GC temp object) |
| Job polling returns `failed` | Return error with server message |
| Job polling times out | Return timeout error |
| Presigned GET fails (download) | Retry once, then return error |

## Implementation Phases

### Phase 0.5: Local Dataset Transfer (completed)

See "Completed Phases" section above.

### Phase 1: Local Package Transfer (in progress)

Local server implementation for package import/export via transfer protocol.

**Scope:**
- `e3-api-server` (types.ts): Package transfer types (`PackageTransferInit*`, `PackageExport*`, `PackageJob*`)
- `e3-api-server` (routes/package-transfer.ts): New `createPackageTransferRoutes()` — upload init, data staging, import trigger, export trigger, job poll, download
- `e3-api-server` (routes/packages.ts): Remove inline `POST /` (import) and `GET /:name/:version/export` endpoints
- `e3-api-client` (types.ts): Mirror package transfer types
- `e3-api-client` (packages.ts): Rewrite `packageImport`/`packageExport` to use transfer flow + polling
- `e3-api-tests`: New `package-transfer.ts` test suite

### Phase 2: Cloud Dataset + Package Transfer

Unblocks dataset and package operations in AWS cloud deployment.

**Scope:**
- `e3-cloud-core`: 307 redirect in dataset GET handler, dataset transfer routes, `PackageJobStore`/`PackageJobExecutor` interfaces, package transfer routes, in-memory impls
- `e3-aws`: `S3TransferService` (presigned URLs), `DynamoPackageJobStore`, `LambdaPackageJobExecutor`, processing Lambdas
- CDK: S3 presigned URL IAM permissions, new Lambdas, DynamoDB TTL, S3 lifecycle rule

### Phase 3 (future): Multipart Upload

For objects > 5 GB. Same protocol shape — init returns multiple URLs instead of one.

## Open Questions

1. **Presigned URL expiry duration** — 1 hour should be sufficient for upload + processing. Too short risks timeout on slow connections; too long is a security concern.
2. **Lambda vs Fargate for package processing** — Lambda has a 15-minute timeout and 10 GB memory. For extreme packages this may not be enough. Fargate is an option but adds complexity. Start with Lambda, add Fargate fallback if needed.
3. **Export zip streaming** — For very large exports, the Lambda needs to stream objects from S3 → zip → S3 multipart upload. This requires streaming zip creation, not buffering the entire zip in memory.
