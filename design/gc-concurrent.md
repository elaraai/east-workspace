# Concurrent Garbage Collection Design

This document describes the garbage collection (GC) system for e3-aws that operates safely alongside concurrent user operations.

## Goals

1. **Never lose user data** - Enterprise users depend on data integrity
2. **Don't block users** - GC runs in background without impacting operations
3. **Support hash reuse** - Content-addressed storage enables deduplication
4. **Eventually delete unreachable data** - Clean up garbage within reasonable time (24-48h)

## Architecture Overview

The GC system uses:
- **Object Catalogue** in DynamoDB - tracks current version and metadata for each hash
- **S3 Versioning** - provides immutable history of all object writes
- **Two-phase deletion** - mark then cleanup after MIN_AGE delay

```
┌─────────────────────────────────────────────────────────────────┐
│                        Object Lifecycle                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Write Object          GC Mark           GC Cleanup             │
│   ────────────          ───────           ──────────             │
│                                                                  │
│   1. Upload to S3       1. Walk roots     1. List S3 versions    │
│      (gets versionId)   2. Mark live      2. For each version:   │
│   2. Update catalogue      hashes            - Skip if current   │
│      currentVersion     3. Delete            - Skip if < 24h     │
│                            unmarked          - Delete version    │
│                            catalogue                             │
│                            entries                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Object Catalogue Schema

The object catalogue uses the existing DynamoDB single-table design.

### Partition Key Pattern

```
PK: OBJ/{repo}
SK: {hash}
```

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `currentVersion` | String | S3 version ID of the current object |
| `lastReferencedAt` | String (ISO8601) | Last time this hash was written/touched |
| `size` | Number | Object size in bytes |
| `inline` | Binary (optional) | Object data if size ≤ 4KB |

### Example Items

```json
// Large object (stored in S3)
{
  "PK": "OBJ/myrepo",
  "SK": "a1b2c3d4e5f6...",
  "currentVersion": "abc123def456",
  "lastReferencedAt": "2024-01-15T10:30:00Z",
  "size": 1048576
}

// Small object (stored inline)
{
  "PK": "OBJ/myrepo",
  "SK": "f6e5d4c3b2a1...",
  "currentVersion": null,
  "lastReferencedAt": "2024-01-15T10:30:00Z",
  "size": 256,
  "inline": "<binary data>"
}
```

## Object Write Flow

When writing an object:

```typescript
async function objectWrite(repo: string, hash: string, data: Buffer): Promise<void> {
  const now = new Date().toISOString();

  if (data.length <= 4096) {
    // Small object: store inline in DynamoDB
    await dynamo.updateItem({
      Key: { PK: `OBJ/${repo}`, SK: hash },
      UpdateExpression: 'SET #inline = :data, #size = :size, #ref = :now',
      ExpressionAttributeNames: {
        '#inline': 'inline',
        '#size': 'size',
        '#ref': 'lastReferencedAt'
      },
      ExpressionAttributeValues: {
        ':data': data,
        ':size': data.length,
        ':now': now
      }
    });
  } else {
    // Large object: upload to S3, record version in catalogue
    const result = await s3.putObject({
      Bucket: bucket,
      Key: `objects/${repo}/${hash}`,
      Body: data
    });

    await dynamo.updateItem({
      Key: { PK: `OBJ/${repo}`, SK: hash },
      UpdateExpression: 'SET #ver = :ver, #size = :size, #ref = :now REMOVE #inline',
      ExpressionAttributeNames: {
        '#ver': 'currentVersion',
        '#size': 'size',
        '#ref': 'lastReferencedAt',
        '#inline': 'inline'
      },
      ExpressionAttributeValues: {
        ':ver': result.VersionId,
        ':size': data.length,
        ':now': now
      }
    });
  }
}
```

### Concurrent Writes

When multiple writers upload the same hash concurrently:

1. Each upload creates a new S3 version
2. `UpdateItem` operations are atomic - last write wins for `currentVersion`
3. **This is safe** because SHA256 collision resistance guarantees identical hashes have identical content
4. GC cleanup will eventually delete the "losing" S3 versions

## Object Read Flow

```typescript
async function objectRead(repo: string, hash: string): Promise<Buffer | null> {
  const item = await dynamo.getItem({
    Key: { PK: `OBJ/${repo}`, SK: hash }
  });

  if (!item) return null;

  if (item.inline) {
    // Small object: return inline data
    return item.inline;
  } else {
    // Large object: fetch from S3 using specific version
    const result = await s3.getObject({
      Bucket: bucket,
      Key: `objects/${repo}/${hash}`,
      VersionId: item.currentVersion
    });
    return result.Body;
  }
}
```

## GC Mark Phase

The mark phase identifies all reachable hashes by walking from roots.

### Roots

For each repo, roots include:
- Package manifest hashes (from `PKG/{repo}`)
- Workspace state hashes (from `WS/{repo}`)
- In-progress execution outputs (from `EXEC/{repo}`)

### Mark Algorithm

```typescript
async function gcMark(repo: string): Promise<Set<string>> {
  const liveHashes = new Set<string>();

  // Collect root hashes
  const roots = await collectRoots(repo);

  // BFS/DFS walk from each root
  const queue = [...roots];
  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (liveHashes.has(hash)) continue;

    liveHashes.add(hash);

    // Parse object and find child references
    const data = await objectRead(repo, hash);
    const children = extractChildHashes(data);
    queue.push(...children);
  }

  return liveHashes;
}
```

## GC Sweep Phase

The sweep phase deletes catalogue entries for unreachable hashes.

```typescript
async function gcSweep(repo: string, liveHashes: Set<string>): Promise<number> {
  let deletedCount = 0;

  // Query all catalogue entries for this repo
  const entries = await queryByPk(`OBJ/${repo}`);

  for (const entry of entries) {
    const hash = entry.SK;
    if (!liveHashes.has(hash)) {
      // Delete catalogue entry - this "marks" all S3 versions for cleanup
      await dynamo.deleteItem({
        Key: { PK: `OBJ/${repo}`, SK: hash }
      });
      deletedCount++;
    }
  }

  return deletedCount;
}
```

### Atomicity

Deleting the catalogue entry is **atomic**:
- If a concurrent write recreates the entry, the new `currentVersion` becomes the live version
- GC cleanup will only delete S3 versions that don't match any `currentVersion`

## GC Cleanup Phase

The cleanup phase scans S3 and deletes orphaned versions.

### MIN_AGE Protection

**Critical**: Only delete S3 versions older than MIN_AGE (24 hours).

This protects against the race condition:
1. Writer uploads object to S3 (gets versionId)
2. GC runs, doesn't see catalogue entry yet
3. Writer updates catalogue with versionId
4. GC cleanup would delete the version → **DATA LOSS**

With MIN_AGE:
- Step 2 skips the version because it's too new (< 24h old)
- By the next GC cycle, the catalogue entry exists

### Cleanup Algorithm

```typescript
async function gcCleanup(repo: string): Promise<number> {
  const minAge = 24 * 60 * 60 * 1000; // 24 hours in ms
  const cutoff = Date.now() - minAge;
  let deletedCount = 0;

  // List all object versions in S3
  const versions = await listObjectVersions(`objects/${repo}/`);

  for (const version of versions) {
    // Skip if too new
    if (version.LastModified.getTime() > cutoff) continue;

    const hash = extractHashFromKey(version.Key);

    // Check if this version is the current version
    const catalogueEntry = await dynamo.getItem({
      Key: { PK: `OBJ/${repo}`, SK: hash }
    });

    if (catalogueEntry && catalogueEntry.currentVersion === version.VersionId) {
      // This is the live version - don't delete
      continue;
    }

    // Safe to delete: either no catalogue entry or different version
    await s3.deleteObject({
      Bucket: bucket,
      Key: version.Key,
      VersionId: version.VersionId
    });
    deletedCount++;
  }

  return deletedCount;
}
```

## S3 Lifecycle Policy

**Important**: Disable automatic noncurrent version deletion.

The GC cleanup process handles version deletion manually based on catalogue state. S3 lifecycle rules would interfere:

```yaml
# DO NOT configure this:
# NoncurrentVersionExpiration:
#   NoncurrentDays: 30

# S3 versioning MUST be enabled, lifecycle rules should NOT auto-delete versions
```

## Race Condition Analysis

### Race 1: Write During GC Mark

```
Timeline:
  T1: GC starts mark phase
  T2: User writes new object (hash H)
  T3: GC completes mark (H not in live set)
  T4: GC sweep deletes catalogue entry for H
  T5: User expects to read H → not found
```

**Mitigation**: GC sweep should check `lastReferencedAt`:
- Skip deletion if `lastReferencedAt` is recent (within GC cycle time)
- Or: Use optimistic locking with condition expression

### Race 2: Write During GC Cleanup

```
Timeline:
  T1: User uploads object to S3 (gets version V1)
  T2: GC cleanup scans, sees V1 has no catalogue entry
  T3: User updates catalogue with V1
  T4: GC cleanup deletes V1 → DATA LOSS
```

**Mitigation**: MIN_AGE protection (24h delay)
- At T2, V1 is brand new (< 24h old)
- GC cleanup skips it
- By next GC cycle, catalogue entry exists

### Race 3: Hash Reuse After Delete

```
Timeline:
  T1: Object H deleted (catalogue entry removed)
  T2: GC cleanup deletes S3 versions for H
  T3: User writes H again (same content)
  T4: New S3 version created, catalogue updated
```

**Result**: Safe - new upload creates fresh S3 version

### Race 4: Concurrent Writes Same Hash

```
Timeline:
  T1: Writer A uploads H → S3 version V1
  T2: Writer B uploads H → S3 version V2
  T3: Writer A updates catalogue: currentVersion = V1
  T4: Writer B updates catalogue: currentVersion = V2
```

**Result**: Safe
- Catalogue has currentVersion = V2 (last write wins)
- V1 will be cleaned up by GC (not current, old enough)
- Both V1 and V2 contain identical bytes (SHA256 guarantee)

## Summary

| Component | Location | Purpose |
|-----------|----------|---------|
| Object Catalogue | DynamoDB `OBJ/{repo}/{hash}` | Track current version, inline small objects |
| Object Storage | S3 with versioning | Store large objects, maintain version history |
| GC Mark | Lambda | Walk roots, identify live hashes |
| GC Sweep | Lambda | Delete catalogue entries for dead hashes |
| GC Cleanup | Lambda | Delete orphaned S3 versions (> MIN_AGE) |

### Key Invariants

1. **Catalogue entry exists** → Object is readable via `currentVersion`
2. **S3 version matches currentVersion** → Never deleted by GC cleanup
3. **S3 version age < MIN_AGE** → Never deleted by GC cleanup
4. **SHA256 hash collision** → Assumed impossible (2^128 security level)

### Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| MIN_AGE | 24 hours | Protects in-flight uploads from GC |
| Inline threshold | 4 KB | DynamoDB item size vs S3 overhead tradeoff |
| GC frequency | Daily | Balance cleanup latency vs compute cost |
