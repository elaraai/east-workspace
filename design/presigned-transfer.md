# Presigned Object Transfer

## Summary

Replace inline HTTP body transfer for large payloads with a presigned URL protocol. The client uploads/downloads directly to/from object storage (S3, GCS, Azure Blob) using time-limited URLs provided by the API server. Package operations become asynchronous with polling. The protocol is cloud-agnostic — the local `e3-api-server` implements the same endpoints, returning URLs pointing back to itself.

## Problem

AWS API Gateway enforces a **10 MB payload limit** (non-negotiable) and a **29-second response timeout**. Four operations exceed these limits:

| Operation | Direction | Potential size |
|-----------|-----------|----------------|
| `e3 set` (dataset) | Upload | GBs |
| `e3 get` (dataset) | Download | GBs |
| `e3 package import` | Upload | 100s MB – GBs |
| `e3 package export` | Download | 100s MB – GBs |

All other API operations fit within the 10 MB limit and are unchanged.

## Goals

1. Support objects up to **5 GB** (single-part presigned PUT/GET across all clouds)
2. **One client** — `e3-api-client` uses the same code for local, AWS, GCP, and Azure servers
3. **Cloud-agnostic interfaces** in `e3-core` with concrete implementations per cloud
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

---

## The Four Transfer Types

| # | Name | Direction | Payload | Async? |
|---|------|-----------|---------|--------|
| 1 | **DatasetUpload** | client → server | Single BEAST2 object | No — completes in commit step |
| 2 | **DatasetDownload** | server → client | Single BEAST2 object | No — 307 redirect |
| 3 | **PackageImport** | client → server | Zip archive → many objects | Yes — poll for completion |
| 4 | **PackageExport** | server → client | Many objects → zip archive | Yes — poll then download |

---

## Object Storage Model

Objects are stored at `{repo}/objects/{hash}/{uploadId}`, where `uploadId` is a server-assigned UUID. This ensures concurrent uploads of the same hash are unambiguously addressable — no reliance on cloud-specific versioning or "most recent" semantics.

A catalogue entry in the metadata store (`OBJ/{repo}#{hash}`) records which `uploadId` is the committed version. An object doesn't "exist" until the catalogue says it does. Reads look up the catalogue entry and fetch by the exact key.

**The server never trusts the client's SHA-256.** Each implementation verifies integrity in whatever way its cloud supports:
- **Local:** Server reads back the uploaded bytes, computes SHA-256, rejects mismatches.
- **Cloud:** May use cloud-native checksums (e.g. S3's `x-amz-checksum-sha256`), or fall back to server-side read-back.

The interface is cloud-agnostic — `commitObject(repo, hash, uploadId)` handles verification internally.

**Commit is a metadata-only operation.** After successful upload and verification, the server writes the catalogue entry. Until committed, the uploaded object is invisible to the system and will be cleaned up.

**Dedup check:** The init step looks up `storage.objects.exists(hash)` in the catalogue. If true, the object was previously verified and committed — safe to skip the upload entirely.

## Concurrency Model

**Object writes are safe.** Two concurrent uploads of the same hash write to separate keys (`{hash}/{uploadId1}` vs `{hash}/{uploadId2}`). Both contain identical bytes (integrity-verified by the backend). The catalogue commit is idempotent — both writers set `OBJ/{repo}#{hash}` to point to a valid copy of the same data. Whichever upload ID isn't committed is cleaned up by GC.

**Dataset ref updates are atomic, last-writer-wins.** The commit step writes a single metadata entry (`DREF/{repo}#{ws}#{path}`). If two clients race to set the same dataset, the last commit wins. Both objects are safely stored (content-addressed), and GC cleans up unreferenced ones.

**The transfer flow widens the race window** compared to inline PUT (minutes vs milliseconds), but the *outcome* is the same — one writer wins, no corruption.

**Future: optimistic concurrency.** When collaborative editing demands conflict detection, the commit step can use a conditional write. The init step snapshots the current ref; commit rejects if it changed. The client retries from scratch. This is cheap (no locks, no deadlocks) and can be added without protocol changes — just an optional `expectedHash` field on the commit request.

---

## Protocol Design

### 1. DatasetUpload

**Client flow:** `POST init` → `PUT data` (no auth) → `POST commit`

Auth endpoints are scoped to the dataset path (future per-dataset ACLs work naturally). Data endpoints use capability-URL auth (UUID) under `/transfer/`.

**URLs:**
```
POST /api/repos/:repo/workspaces/:ws/datasets/*/upload       — init (auth)
PUT  /api/repos/:repo/transfer/dataset-upload/:id/data       — upload bytes (no auth)
POST /api/repos/:repo/workspaces/:ws/datasets/*/upload/:id   — verify + commit (auth)
```

**Inline shortcut:** Datasets ≤ 1 MB use the existing inline `PUT /datasets/*` endpoint — one round-trip, no transfer protocol. The client decides based on payload size.

**Dedup shortcut:** If `storage.objects.exists(hash)` → skip upload, update ref immediately, return `completed`.

```
Client                         API Server                    Object Storage
  │                               │                               │
  │─ POST /.../datasets/*/upload >│                               │
  │  { hash, size }               │── check object exists? ──────>│
  │                               │<── yes/no ───────────────────│
  │                               │                               │
  │<─ { id, uploadUrl }  ────────│   (or { completed })          │
  │   (or { completed })          │                               │
  │                               │                               │
  │─ PUT uploadUrl ──────────────────────────────────────────────>│
  │  (raw BEAST2 bytes, no auth)  │   {repo}/objects/{hash}/{id}  │
  │<─ 200 ───────────────────────────────────────────────────────│
  │                               │                               │
  │─ POST /.../datasets/*/       ─>│                               │
  │      upload/:id                │── verify + commit object ───>│
  │                               │── update dataset ref ────────>│
  │<─ { completed } ─────────────│                               │
```

**Stored state:**
```typescript
const DatasetUploadType = StructType({
  repo:        StringType,
  workspace:   StringType,
  path:        StringType,      // dataset path e.g. "inputs.sales"
  hash:        StringType,      // expected SHA-256, computed by client
  size:        IntegerType,     // expected byte count
});
```

**Storage interface:**
```typescript
interface DatasetUploadStore {
  create(id: string, record: DatasetUpload): Promise<void>;
  get(id: string): Promise<DatasetUpload | null>;
  delete(id: string): Promise<void>;

  /**
   * URL the client PUTs bytes to. The upload ID is embedded in the URL
   * so concurrent uploads to the same hash are unambiguous.
   */
  getUploadUrl(id: string, repo: string, hash: string): Promise<string>;

  /**
   * Verify the upload and make the object visible in the catalogue.
   * On success, the object is queryable via storage.objects.read(repo, hash).
   * On failure, throws — caller should clean up the transfer record.
   */
  commitObject(repo: string, hash: string, uploadId: string): Promise<void>;
}
```

### 2. DatasetDownload

**Client flow:** `GET /datasets/*` → follow 307 redirect → `GET data` (no auth)

**URLs:**
```
GET /api/repos/:repo/workspaces/:ws/datasets/*               — resolve hash, return 307 (auth)
GET /api/repos/:repo/transfer/dataset-download/:hash          — serve bytes (no auth)
```

**Inline shortcut:** Objects ≤ 1 MB are returned inline (no redirect).

**No stored state** — stateless redirect. The hash in the URL is the capability token.

```
Client                         API Server                    Object Storage
  │                               │                               │
  │─ GET /datasets/* ────────────>│                               │
  │                               │── resolve path → hash ───────>│
  │                               │── lookup object size ────────>│
  │                               │── generate download URL ─────>│
  │<─ 307 Location: <url> ───────│                               │
  │   X-Content-Length: <size>     │                               │
  │                               │                               │
  │─ GET <url> (no auth) ─────────────────────────────────────── >│
  │<─ raw BEAST2 bytes ──────────────────────────────────────────│
```

**Storage interface:**
```typescript
interface DatasetDownloadStore {
  /** URL the client GETs bytes from. */
  getDownloadUrl(repo: string, hash: string): Promise<string>;
}
```

### 3. PackageImport

**Client flow:** `POST init` → `PUT data` (no auth) → `POST trigger` → poll `GET` until complete

One resource, one ID. The `id` returned by init is used for upload, trigger, and polling.

**URLs:**
```
POST /api/repos/:repo/packages/import                        — init (auth), returns { id, uploadUrl }
PUT  /api/repos/:repo/transfer/package-import/:id/data       — upload zip (no auth)
POST /api/repos/:repo/packages/import/:id                    — trigger processing (auth)
GET  /api/repos/:repo/packages/import/:id                    — poll status (auth)
```

```
Client                         API Server                    Object Storage
  │                               │                               │
  │─ POST /.../packages/import ──>│                               │
  │  { size }                     │── create record (created) ───>│
  │<─ { id, uploadUrl }  ────────│                               │
  │                               │                               │
  │─ PUT uploadUrl ──────────────────────────────────────────────>│
  │  (zip bytes, no auth)         │   {repo}/_transfer/{id}/zip   │
  │<─ 200 ───────────────────────────────────────────────────────│
  │                               │                               │
  │─ POST /.../packages/import/:id>│                               │
  │                               │── update (processing) ───────│
  │<─ { status: processing }  ────│── dispatch async ────────────│
  │                               │         ┌──────────────────┐  │
  │─ GET /.../packages/import/:id >│         │ Async processor  │  │
  │<─ { status: processing }  ────│         │ reads zip,       │  │
  │                               │         │ extracts objects, │  │
  │─ GET /.../packages/import/:id >│         │ registers pkg    │  │
  │<─ { status: completed,  ──────│         └──────────────────┘  │
  │     name, version, ... }       │                               │
```

**Why async:** Processing a large zip (extract objects, write each to storage, register package metadata) can take minutes. The local server processes inline (trigger returns completed immediately). Cloud dispatches to a background processor.

**Stored state (single record per import):**
```typescript
const PackageImportType = StructType({
  repo:        StringType,
  size:        IntegerType,
  status:      VariantType({
    created:    NullType,       // waiting for upload
    uploaded:   NullType,       // waiting for trigger
    processing: NullType,       // async work in progress
    completed:  StructType({
      name:         StringType,
      version:      StringType,
      packageHash:  StringType,
      objectCount:  IntegerType,
    }),
    failed: StructType({ message: StringType }),
  }),
  createdAt:   DateTimeType,
});
```

**Storage interface:**
```typescript
interface PackageImportStore {
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
```

**Note:** Package zips aren't content-addressed (the same package can produce different zips). They go to a temporary location (`_transfer/{id}/pkg.zip`), not the `objects/` prefix.

### 4. PackageExport

**Client flow:** `POST trigger` → poll `GET` until complete → `GET data` (no auth)

Same single-resource pattern as import.

**URLs:**
```
POST /api/repos/:repo/packages/:name/:version/export         — start export (auth), returns { id }
GET  /api/repos/:repo/packages/export/:id                    — poll status (auth)
GET  /api/repos/:repo/transfer/package-export/:id/data       — download zip (no auth)
```

```
Client                         API Server                    Object Storage
  │                               │                               │
  │─ POST /.../packages/         ─>│                               │
  │    :name/:version/export       │── create record (processing) │
  │<─ { id }  ────────────────────│── dispatch async ────────────│
  │                               │         ┌──────────────────┐  │
  │─ GET /.../packages/export/:id >│         │ Async processor  │  │
  │<─ { status: processing }  ────│         │ reads objects,    │  │
  │                               │         │ creates zip,     │  │
  │─ GET /.../packages/export/:id >│         │ writes to temp   │  │
  │<─ { status: completed,  ──────│         └──────────────────┘  │
  │     downloadUrl, size }        │                               │
  │                               │                               │
  │─ GET downloadUrl (no auth)───────────────────────────────────>│
  │<─ zip bytes ─────────────────────────────────────────────────│
```

**Stored state (single record per export):**
```typescript
const PackageExportType = StructType({
  repo:         StringType,
  name:         StringType,
  version:      StringType,
  status:       VariantType({
    processing: NullType,
    completed:  StructType({
      size:        IntegerType,
    }),
    failed: StructType({ message: StringType }),
  }),
  createdAt:    DateTimeType,
});
```

**Storage interface:**
```typescript
interface PackageExportStore {
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
```

### Status Lifecycle

**Package import:**
```
created → uploaded → processing → completed
                                → failed
```

**Package export:**
```
processing → completed
           → failed
```

**Timeout:** If a record remains in `processing` for longer than 15 minutes, the polling endpoint returns `failed` with a timeout error.

---

## TransferBackend Interface

```
StorageBackend (existing, e3-core)
├── objects        — content-addressed blob store
├── refs           — metadata refs (packages, workspaces, datasets, executions)
├── repos          — repo lifecycle
├── locks          — distributed locking
└── logs           — execution logs

TransferBackend (new, e3-core)
├── datasetUpload    : DatasetUploadStore
├── datasetDownload  : DatasetDownloadStore
├── packageImport    : PackageImportStore
└── packageExport    : PackageExportStore
```

`TransferBackend` is a separate top-level interface — not bolted onto `StorageBackend`. It depends on `StorageBackend` for actual object/ref operations but has its own lifecycle (staging, jobs, URLs).

### Implementations

| Interface | Local (`InMemoryTransferBackend`) | AWS (`S3DynamoTransferBackend`) |
|-----------|----------------------------------|--------------------------------|
| `DatasetUploadStore` | In-memory map + tmpdir + server-side SHA256 verify | DynamoDB + presigned PUT to `{repo}/objects/{hash}/{uploadId}` + catalogue commit |
| `DatasetDownloadStore` | Self-referencing URL to local endpoint | Presigned GET for object key from catalogue |
| `PackageImportStore` | In-memory map + tmpdir + inline `packageImport()` | DynamoDB + presigned PUT to `_transfer/{id}/pkg.zip` + async Lambda/SFN |
| `PackageExportStore` | In-memory map + tmpdir + inline `packageExport()` | DynamoDB + export in Lambda + presigned GET for download |

---

## Data Endpoints and Auth Split

Data endpoints (upload/download of raw bytes) use **capability-URL auth** — the unguessable UUID in the URL path is the credential. These endpoints:
- Live under `/api/repos/:repo/transfer/` (separate from resource-scoped auth endpoints)
- Are mounted before auth middleware so they bypass JWT/ACL validation
- **Reject** `Authorization` headers (enforces the same contract as cloud presigned URLs)
- Route factories return `{ api, data }` — `api` routes mount behind auth, `data` routes mount before

## Cleanup

**Uncommitted dataset uploads** (`{repo}/objects/{hash}/{uploadId}`): GC scans for objects without a catalogue reference.

**Package zips** (`{repo}/_transfer/{id}/...`): Ephemeral — deleted after processing. Abandoned uploads cleaned up by implementation-specific means (lifecycle rules, GC, TTL).

**Transfer/job records**: Implementation-specific TTL or in-memory expiry.

**Orphaned content-addressed objects**: Failed package imports may leave partial objects. Handled by existing repo GC.

## Client Behavior

**Size threshold:** Dataset SET uses inline PUT for ≤ 1 MB, transfer flow for > 1 MB.

**Polling:** Package import/export poll with exponential backoff (1s initial, 5s max, 15 min timeout).

**Error handling:**

| Scenario | Client behavior |
|----------|----------------|
| Init fails | Return error (auth, not found, etc.) |
| Upload fails | Retry once, then return error |
| Commit/trigger fails | Return error (server will GC) |
| Polling returns `failed` | Return error with server message |
| Polling times out | Return timeout error |
| Download fails | Retry once, then return error |

---

## Implementation Phases

### Completed

- **Phase 0: BEAST2 Headers** — `Content-Type`, `Content-Length`, `X-Content-SHA256` on dataset GET responses
- **Phase 0.5: Local Dataset Transfer** — 307 redirect for large GET, staged upload flow for large SET, objects endpoint
- **Phase 1: Local Package Transfer** — Transfer flow for package import/export with staging, polling, `{ api, data }` auth split
- **Phase 1.5: Auth Split** — Route factories return `{ api, data }`, data endpoints reject `Authorization` header, client uses plain `fetch` for data URLs
- **Phase 2: TransferBackend Interfaces** — `e3-core/src/transfer/`: `TransferBackend` interface with 4 sub-store interfaces (`DatasetUploadStore`, `DatasetDownloadStore`, `PackageImportStore`, `PackageExportStore`), East types for stored state, `InMemoryTransferBackend` implementation. Exported from `@elaraai/e3-core`.
- **Phase 3: Clean Up Interfaces + Refactor Routes** — Two parts:
  - **Part A: Interface cleanup + InMemory fix.** Removed filesystem-specific methods (`getZipPath`, `deleteZip`) from `PackageImportStore` and `PackageExportStore` interfaces. Rewrote `InMemoryTransferBackend` as pure in-memory (no `fs` imports, no `tmpdir`, no `StorageBackend` dependency). Constructor simplified to `{ baseUrl?: string }`. `commitObject` and `execute` are simplified mocks — real transfer flows tested via integration tests.
  - **Part B: Route refactoring.** `createTransferRoutes` and `createPackageTransferRoutes` now accept `TransferBackend` as 3rd parameter. Routes delegate metadata tracking (create/get/delete/updateStatus) to the backend while handling filesystem staging and inline execution directly (local server concern). Staging paths derived by convention from transfer ID: `join(tmpdir(), 'e3-transfers', '${id}.<ext>')`. Job ID simplified to reuse transfer/export ID (external behavior unchanged). `server.ts` creates `InMemoryTransferBackend({ baseUrl: '' })` and passes it to both route factories.
  - **Learnings:** East variant types use `.type`/`.value` properties (not tuple `[0]`/`[1]`). The jobs polling endpoint now looks up both `packageImport.get` and `packageExport.get` and maps status variants to the response type.

### Phase 4: URL restructuring (e3-api-server + e3-api-client) — DONE

Resource-scoped URLs for auth routes, `/transfer/` prefix for data routes.

**Changes:**
- **Types:** `TransferUploadRequestType` simplified to `{ hash, size }` (workspace/path now in URL). `transferId`→`id`, `jobId`→`id`. `PackageExportRequestType` removed. `PackageJobStatusType` split into `PackageImportStatusType` + `PackageExportStatusType`.
- **Dataset routes:** Init at `POST .../datasets/*/upload`, commit at `POST .../datasets/*/upload/:id`. Data upload at `PUT /transfer/dataset-upload/:id/data`. New no-auth download endpoint at `GET /transfer/dataset-download/:hash`.
- **Package routes:** Init at `POST /packages/import`, trigger at `POST /packages/import/:id`, poll at `GET /packages/import/:id`. Export trigger at `POST /packages/:name/:version/export`, poll at `GET /packages/export/:id`. Data upload at `PUT /transfer/package-import/:id/data`, download at `GET /transfer/package-export/:id/data`.
- **Client:** `datasetGet` uses `redirect: 'manual'` and follows 307 without auth. `datasetSetTransfer` uses resource-scoped URLs. `packageImport`/`packageExport` use separate poll functions with typed status types.
- **Server mounting:** Dataset transfer api routes at datasets scope, package transfer api routes before general package routes.

**Deliverable:** All 170 e3 tests pass, e3-cloud builds clean.

### Phase 5: Wire into e3-cloud (e3-aws api.ts)

Minimal bridge — correct mounting with InMemory (temporary).

**Scope:**
- `npm update` e3 packages
- Import route factories + `InMemoryTransferBackend` in `api.ts`
- Mount `.data` routes before authz middleware, `.api` routes after
- Mount dataset transfer routes (currently missing)

**Deliverable:** `npm run build` passes. Cloud deployment works for non-transfer endpoints; transfers use InMemory (state lost on cold start — acceptable for dev).

### Phase 6: AWS TransferBackend (e3-aws)

The real cloud implementation.

**Scope:**
- `S3DynamoTransferBackend` (all 4 stores):
  - DynamoDB for transfer/job metadata
  - Presigned PUT/GET URLs for data
  - SHA256 enforcement via cloud-native checksums
  - Async Lambda dispatch for package import/export
- Processing Lambda handlers for package import/export
- Wire `S3DynamoTransferBackend` in `api.ts` replacing InMemory

### Phase 7: CDK + Deploy + Test

Infrastructure and end-to-end validation.

**Scope:**
- S3 lifecycle rule on `_transfer/` prefix (1 day expiry)
- DynamoDB TTL on transfer/job records
- New Lambda functions for package processing
- IAM permissions (presigned URLs, Lambda invoke)
- Deploy to dev, run cloud integration tests

### Phase 8 (future): Multipart Upload

For objects > 5 GB. Same protocol shape — init returns multiple URLs instead of one.

## Open Questions

1. **Presigned URL expiry duration** — 1 hour should be sufficient for upload + processing. Too short risks timeout on slow connections; too long is a security concern.
2. **Lambda vs Fargate for package processing** — Lambda has a 15-minute timeout and 10 GB ephemeral storage. For extreme packages this may not be enough. Start with Lambda, add Fargate fallback if needed.
3. **Export zip streaming** — For very large exports, the processor needs to stream objects → zip → cloud storage. This requires streaming zip creation, not buffering in memory.
4. **`packageImport` file path vs stream** — Currently takes a filesystem path. Cloud processor downloads zip to `/tmp` first. Starting with download-to-tmp is simplest (Lambda has up to 10 GB ephemeral storage).
5. **Object key migration** — Existing objects use flat keys (`{repo}/objects/{hash}`). New uploads use `{repo}/objects/{hash}/{uploadId}`. The catalogue stores the full key, so reads work for both. GC needs to handle both structures. Since we're pre-GA, a migration script is acceptable.
