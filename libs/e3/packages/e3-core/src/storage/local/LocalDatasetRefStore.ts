/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem implementation of DatasetRefStore.
 *
 * Stores per-dataset refs as .ref files in the workspace data directory:
 *   workspaces/<ws>/data/<path>.ref
 *
 * A current-format file is a 0xFF magic byte followed by a beast2-encoded
 * { revision, ref } struct, where `revision` is a unique token minted per write
 * — NOT a content digest, so two byte-identical refs still get distinct
 * revisions and the compare-and-swap can never miss a concurrent change (ABA).
 * Pre-revision files (a bare beast2 DatasetRef variant) are still read; their
 * revision is the content hash, and the next write upgrades them.
 *
 * Writes are atomic (write to .partial, then rename).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { encodeBeast2For, decodeBeast2For, variant, StructType, StringType } from '@elaraai/east';
import { DatasetRefType, type DatasetRef } from '@elaraai/e3-types';
import { computeHash } from '../../objects.js';
import { DatasetRefConflictError } from '../../errors.js';
import { acquireWorkspaceLock } from './LocalLockService.js';
import { atomicWriteFile, isTransientFsError } from './localHelpers.js';
import { withKeyedLock } from './keyedMutex.js';
import type { DatasetRefStore } from '../interfaces.js';

const decodeRef = decodeBeast2For(DatasetRefType);

// Current ref-file format: a 0xFF magic byte (a bare DatasetRef variant always
// begins with a small case-index byte 0x00/0x01/0x02, so 0xFF is unambiguous)
// then a { revision, ref } struct.
const REVISIONED_MAGIC = 0xff;
const RevisionedRefType = StructType({ revision: StringType, ref: DatasetRefType });
const encodeRevisioned = encodeBeast2For(RevisionedRefType);
const decodeRevisioned = decodeBeast2For(RevisionedRefType);

/** Decode a stored ref file (either format) to its ref and revision. */
function decodeStored(data: Buffer): { ref: DatasetRef; revision: string } {
  if (data[0] === REVISIONED_MAGIC) {
    const { revision, ref } = decodeRevisioned(data.subarray(1));
    return { ref, revision };
  }
  // Legacy bare-DatasetRef file: its content hash is a stable revision, and the
  // next write upgrades it to the revisioned format.
  return { ref: decodeRef(data), revision: computeHash(data) };
}

/** Encode a ref + a freshly-minted unique revision in the current format. */
function encodeStored(ref: DatasetRef): { data: Uint8Array; revision: string } {
  const revision = randomUUID();
  return { data: Buffer.concat([Buffer.from([REVISIONED_MAGIC]), encodeRevisioned({ revision, ref })]), revision };
}

// Upper bound on how long writeIf waits for the per-path lock. The critical
// section (read + compare + atomic rename) is microseconds, so contention
// clears almost immediately; the bound only matters if a holder crashed
// mid-write, in which case the lock's own process-liveness check reclaims it.
const CAS_LOCK_TIMEOUT_MS = 30_000;

export class LocalDatasetRefStore implements DatasetRefStore {
  /**
   * Get the filesystem path for a dataset ref file.
   */
  private refPath(repo: string, ws: string, datasetPath: string): string {
    return path.join(repo, 'workspaces', ws, 'data', `${datasetPath}.ref`);
  }

  /** Read raw ref bytes, or null if the file is absent. */
  private async readBytes(filePath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Atomically replace the ref file: write to a unique staging file, then rename. */
  private async writeBytes(filePath: string, data: Uint8Array): Promise<void> {
    await atomicWriteFile(filePath, data);
  }

  /**
   * Flat lock-resource name for a per-dataset compare-and-swap.
   *
   * Lands the `.lock` file directly under `workspaces/` (a sibling of the
   * `<ws>/data/` ref tree, so it never shows up in {@link list}) and never
   * collides with the workspace's own `<ws>.lock`. The dataset path's slashes
   * are flattened so the resource maps to a single lock file rather than a
   * nested directory the lock service would not create.
   */
  private casResource(ws: string, datasetPath: string): string {
    // Escape both reserved chars with a '~'-introduced hex form so the
    // (ws, datasetPath) -> resource mapping is injective: a literal '~' or '/'
    // in a segment can no longer alias the separator and collide two paths onto
    // one lock. '~' is escaped first so the '~' from the '/' step isn't re-escaped.
    const esc = (s: string): string => s.replace(/~/g, '~7e').replace(/\//g, '~2f');
    return `${esc(ws)}~data~${esc(datasetPath)}`;
  }

  /**
   * In-process keys for a single `.ref`, both derived from the SAME
   * {@link casResource} the cross-process lock uses (so they can never drift) plus
   * the repo, since one process may hold several repos open. Two keys, two scopes:
   *
   * - {@link critKey} guards only the read-compare-rename **critical section**
   *   (microseconds). Reads and the rename take it, so a writer's atomic rename
   *   never overlaps a same-process reader's open handle — the Windows
   *   sharing-violation that no rename-retry budget can fully absorb — eliminated
   *   by construction, without serializing a read against the cross-process wait.
   * - {@link writeSerializeKey} serializes same-process *writers* across the whole
   *   {@link writeIf} (including its cross-process file-lock wait), so K concurrent
   *   writers never stampede the exclusive `.lock`; reads never take it, so a read
   *   is never blocked behind a writer's up-to-30s file-lock wait.
   *
   * The filesystem lock in {@link writeIf} stays the load-bearing CROSS-process
   * serializer — these mutexes are same-process optimizations with NO cross-process
   * meaning and MUST NOT be relied on for correctness between processes.
   */
  private critKey(repo: string, ws: string, datasetPath: string): string {
    return `c\0${repo}\0${this.casResource(ws, datasetPath)}`;
  }
  private writeSerializeKey(repo: string, ws: string, datasetPath: string): string {
    return `w\0${repo}\0${this.casResource(ws, datasetPath)}`;
  }

  async read(repo: string, ws: string, datasetPath: string): Promise<DatasetRef | null> {
    return withKeyedLock(this.critKey(repo, ws, datasetPath), async () => {
      const data = await this.readBytes(this.refPath(repo, ws, datasetPath));
      if (data === null || data.length === 0) return null;
      return decodeStored(data).ref;
    });
  }

  async write(repo: string, ws: string, datasetPath: string, ref: DatasetRef): Promise<void> {
    // Unconditional last-writer-wins (no file lock); the crit-section key alone
    // keeps its rename from overlapping a same-process read or another rename.
    await withKeyedLock(this.critKey(repo, ws, datasetPath), () =>
      this.writeBytes(this.refPath(repo, ws, datasetPath), encodeStored(ref).data),
    );
  }

  async readVersioned(
    repo: string,
    ws: string,
    datasetPath: string
  ): Promise<{ ref: DatasetRef; revision: string } | null> {
    return withKeyedLock(this.critKey(repo, ws, datasetPath), async () => {
      const data = await this.readBytes(this.refPath(repo, ws, datasetPath));
      if (data === null || data.length === 0) return null;
      return decodeStored(data);
    });
  }

  async writeIf(
    repo: string,
    ws: string,
    datasetPath: string,
    ref: DatasetRef,
    expectedRevision: string | null
  ): Promise<{ revision: string }> {
    const filePath = this.refPath(repo, ws, datasetPath);
    // Outer key: serialize same-process WRITERS across the whole call so only one
    // reaches the exclusive `.lock` — K concurrent writers never stampede it. Held
    // across the cross-process file-lock wait below, but READS do not take this
    // key, so a read is never blocked behind a writer's up-to-30s wait.
    return withKeyedLock(this.writeSerializeKey(repo, ws, datasetPath), async () => {
      // acquireWorkspaceLock's O_EXCL/hardlink create + process-liveness stale
      // detection is reused verbatim; the flat resource keeps this lock
      // independent of the workspace-level lock the caller may hold in shared mode.
      // In a single process it is uncontended (granted first try); cross-process it
      // is the load-bearing serializer.
      const lock = await acquireWorkspaceLock(
        repo,
        this.casResource(ws, datasetPath),
        variant('dataset_write', null),
        { mode: 'exclusive', wait: true, timeout: CAS_LOCK_TIMEOUT_MS }
      );
      try {
        // Inner key: the read-compare-rename critical section only (microseconds).
        // Reads take this same key, so the atomic rename never overlaps a
        // same-process reader's open handle — the Windows sharing violation — yet a
        // read only ever waits this microsecond window, never the file-lock wait.
        // readBytes/writeBytes are the raw (non-keyed) helpers, so no re-entrancy.
        return await withKeyedLock(this.critKey(repo, ws, datasetPath), async () => {
          const current = await this.readBytes(filePath);
          const currentRevision = current && current.length > 0 ? decodeStored(current).revision : null;
          if (currentRevision !== expectedRevision) {
            throw new DatasetRefConflictError(ws, datasetPath, expectedRevision, currentRevision);
          }
          // A freshly-minted revision per write: two byte-identical refs still get
          // distinct revisions, so a later writeIf can't false-match (no ABA).
          const { data, revision } = encodeStored(ref);
          try {
            await this.writeBytes(filePath, data);
          } catch (err) {
            // A cross-process reader can hold the .ref open across the rename long
            // enough to exhaust atomicWriteFile's retry budget on Windows. The
            // destination is left intact (atomicWriteFile re-throws after cleaning
            // its staging file), so nothing committed — surface it as a conflict so
            // the caller's CAS loop re-polls and retries instead of hard-failing on
            // a raw EPERM. Same-process readers cannot trigger this (the crit key
            // serializes them); a genuine error (ENOSPC, …) still propagates. The
            // original fault is kept as `cause` so a persistent transient-coded
            // fault (e.g. a read-only data dir) stays diagnosable in logs.
            if (isTransientFsError(err)) {
              const conflict = new DatasetRefConflictError(ws, datasetPath, expectedRevision, currentRevision);
              (conflict as Error).cause = err;
              throw conflict;
            }
            throw err;
          }
          return { revision };
        });
      } finally {
        await lock.release();
      }
    });
  }

  async list(repo: string, ws: string): Promise<string[]> {
    const dataDir = path.join(repo, 'workspaces', ws, 'data');
    const paths: string[] = [];

    try {
      await this.walkDir(dataDir, dataDir, paths);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    return paths;
  }

  /**
   * Recursively walk a directory collecting .ref file paths.
   */
  private async walkDir(baseDir: string, currentDir: string, results: string[]): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(baseDir, fullPath, results);
      } else if (entry.name.endsWith('.ref') && !entry.name.includes('.partial')) {
        // Convert filesystem path back to dataset path. Dataset paths are
        // always forward-slash separated; path.relative yields backslashes on
        // Windows, so normalize them or nested paths won't match the
        // forward-slash keys deploy looks up (writeRefsFromPackageRecursive).
        const relative = path.relative(baseDir, fullPath).split(path.sep).join('/');
        const datasetPath = relative.slice(0, -4); // remove .ref
        results.push(datasetPath);
      }
    }
  }

  async remove(repo: string, ws: string, datasetPath: string): Promise<void> {
    const filePath = this.refPath(repo, ws, datasetPath);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') return; // Already removed
      throw err;
    }
  }

  async removeAll(repo: string, ws: string): Promise<void> {
    const dataDir = path.join(repo, 'workspaces', ws, 'data');
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return; // Already removed
      throw err;
    }
  }
}
