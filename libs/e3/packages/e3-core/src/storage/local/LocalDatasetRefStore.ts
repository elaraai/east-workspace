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
 * Each .ref file contains a beast2-encoded DatasetRef variant.
 * Writes are atomic (write to .partial, then rename).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import { DatasetRefType, type DatasetRef } from '@elaraai/e3-types';
import type { DatasetRefStore } from '../interfaces.js';

const encodeRef = encodeBeast2For(DatasetRefType);
const decodeRef = decodeBeast2For(DatasetRefType);

// Windows sharing-violation codes raised when renaming over an open file.
const WIN_SHARING_VIOLATION = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Rename `from` over `to`, retrying on Windows sharing-violation errors.
 *
 * POSIX rename-over-existing is atomic even while another process holds the
 * destination open. Windows refuses it (EPERM/EACCES/EBUSY) unless that handle
 * was opened with FILE_SHARE_DELETE — and Node/libuv never opens files that way
 * (verified on Node 22: fs.open 'r'/'rs' and createReadStream all block a
 * concurrent rename). So the orchestrator reading a dataset `.ref` via
 * fs.readFile blocks a concurrent `dataset set`'s rename over it. Node exposes
 * no way to set the share mode, so — like graceful-fs / npm — we retry.
 * (graceful-fs's own rename retry only fires when the destination is *absent*,
 * so it does not cover renaming over an existing, reader-locked file.)
 *
 * The reader holds the handle only for the microseconds of the read, so a
 * bounded exponential backoff clears it — almost always on the first or second
 * attempt; the bound is a safety net so a genuine permission error still
 * surfaces promptly. A no-op on POSIX, where the first attempt always succeeds.
 */
async function renameWithRetry(from: string, to: string, maxAttempts = 15): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= maxAttempts - 1 || !WIN_SHARING_VIOLATION.has(code)) throw err;
      // 1, 2, 4, … ms, capped at 200ms (≈1.3s total over 15 attempts).
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 200)));
    }
  }
}

export class LocalDatasetRefStore implements DatasetRefStore {
  /**
   * Get the filesystem path for a dataset ref file.
   */
  private refPath(repo: string, ws: string, datasetPath: string): string {
    return path.join(repo, 'workspaces', ws, 'data', `${datasetPath}.ref`);
  }

  async read(repo: string, ws: string, datasetPath: string): Promise<DatasetRef | null> {
    const filePath = this.refPath(repo, ws, datasetPath);
    try {
      const data = await fs.readFile(filePath);
      if (data.length === 0) return null;
      return decodeRef(data);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(repo: string, ws: string, datasetPath: string, ref: DatasetRef): Promise<void> {
    const filePath = this.refPath(repo, ws, datasetPath);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Atomic write: write to unique staging file, then rename
    // Use random suffix to avoid collisions with concurrent writes
    const randomSuffix = Math.random().toString(36).slice(2, 10);
    const stagingPath = `${filePath}.${Date.now()}.${randomSuffix}.partial`;
    const data = encodeRef(ref);
    await fs.writeFile(stagingPath, data);
    try {
      await renameWithRetry(stagingPath, filePath);
    } catch (err) {
      // Clean up staging file on failure
      try { await fs.unlink(stagingPath); } catch { /* ignore */ }
      throw err;
    }
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
