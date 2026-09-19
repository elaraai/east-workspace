/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Test helpers for e3-core
 * Provides utilities for setting up and tearing down test repositories
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { repoInit } from './storage/local/repository.js';

// Re-export InMemoryStorage for test consumers
export { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';

/**
 * Creates a temporary directory for testing
 * @returns Path to temporary directory
 */
export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'e3-test-'));
}

/**
 * Removes a temporary directory and all its contents
 * @param dir Path to directory to remove
 */
export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
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
 * Read all entries from a zip file
 * @param zipPath Path to zip file
 * @returns Map of entry path to content buffer
 */
export async function readZipEntries(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error('No zipfile'));

      const entries = new Map<string, Buffer>();
      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory entry, skip
          zipfile.readEntry();
        } else {
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) return reject(err);
            if (!readStream) return reject(new Error('No read stream'));

            const chunks: Buffer[] = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => {
              entries.set(entry.fileName, Buffer.concat(chunks));
              zipfile.readEntry();
            });
          });
        }
      });

      zipfile.on('end', () => resolve(entries));
      zipfile.on('error', reject);
    });
  });
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
