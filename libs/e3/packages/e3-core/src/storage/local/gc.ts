/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Shared garbage collection algorithm for e3 repositories.
 *
 * Uses mark-and-sweep:
 * 1. collectAllRoots: Collect root hashes from all root scan methods
 * 2. markReachable: DFS through object graph via BEAST2 schema-aware traversal
 * 3. sweepBatch: Pure decision function — identify unreachable objects to delete
 * 4. repoGc: Driver that calls all phases in sequence
 *
 * These functions work with any StorageBackend — no instanceof checks.
 * Cloud-specific concerns (S3 reachable set persistence, orphaned version cleanup)
 * are handled in the cloud Lambda handlers.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { decodeBeast2, isEastDict } from '@elaraai/east';
import type { RepoStore, GcObjectEntry, GcRootScanResult, StorageBackend } from '../interfaces.js';

/**
 * Options for garbage collection
 */
export interface GcOptions {
  /**
   * Minimum age in milliseconds for files to be considered for deletion.
   * Files younger than this are skipped to avoid race conditions with concurrent writes.
   * Default: 60000 (1 minute)
   */
  minAge?: number;

  /**
   * If true, only report what would be deleted without actually deleting.
   * Default: false
   */
  dryRun?: boolean;
}

/**
 * Result of garbage collection
 */
export interface GcResult {
  /** Number of objects deleted */
  deletedObjects: number;
  /** Number of orphaned staging files deleted */
  deletedPartials: number;
  /** Number of objects retained */
  retainedObjects: number;
  /** Number of files skipped due to being too young */
  skippedYoung: number;
  /** Total bytes freed */
  bytesFreed: number;
}

/**
 * Result from sweepBatch — pure decision, no side effects.
 */
export interface SweepBatchResult {
  /** Hashes of objects to delete */
  toDelete: string[];
  /** Number of objects retained (reachable) */
  retained: number;
  /** Number of objects skipped due to being too young */
  skippedYoung: number;
  /** Total bytes that would be freed */
  bytesFreed: number;
}

// =============================================================================
// Shared Algorithm Functions
// =============================================================================

/**
 * Collect all root hashes from packages, workspaces, and executions.
 *
 * Calls each gcScan*Roots method with pagination support.
 * Adding a new root scan method to RepoStore requires updating this function.
 */
export async function collectAllRoots(store: RepoStore, repo: string): Promise<Set<string>> {
  const roots = new Set<string>();

  const scanAll = async (scan: (repo: string, cursor?: unknown) => Promise<GcRootScanResult>) => {
    let cursor: unknown;
    do {
      const result = await scan(repo, cursor);
      for (const hash of result.roots) {
        roots.add(hash);
      }
      cursor = result.cursor;
    } while (cursor !== undefined);
  };

  await scanAll(store.gcScanPackageRoots.bind(store));
  await scanAll(store.gcScanWorkspaceRoots.bind(store));
  await scanAll(store.gcScanExecutionRoots.bind(store));

  return roots;
}

/**
 * Trace the object graph from roots using iterative DFS with schema-aware traversal.
 *
 * Decodes each object using BEAST2 self-describing format and extracts child
 * hashes based on the detected object type (Package, Task, or Tree). Objects
 * known to be leaves (values, IR blobs) are marked reachable without reading.
 *
 * @param readObject - Function to read an object by hash (returns null if missing)
 * @param roots - Set of root hashes to start from
 * @returns Set of all reachable hashes
 */
export async function markReachable(
  readObject: (hash: string) => Promise<Uint8Array | null>,
  roots: Set<string>
): Promise<Set<string>> {
  const reachable = new Set<string>();
  const stack = [...roots];

  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (reachable.has(hash)) continue;

    const data = await readObject(hash);
    if (!data) continue;
    reachable.add(hash);

    // Schema-aware child extraction
    let children: { hash: string; isLeaf: boolean }[];
    try {
      const decoded = decodeBeast2(Buffer.from(data));
      children = extractChildren(decoded.type, decoded.value);
    } catch {
      continue; // Not valid BEAST2 or unknown format — treat as leaf
    }

    for (const child of children) {
      if (reachable.has(child.hash)) continue;
      if (child.isLeaf) {
        reachable.add(child.hash); // Mark without reading
      } else {
        stack.push(child.hash);
      }
    }
  }

  return reachable;
}

// =============================================================================
// Type Detection Helpers
// =============================================================================

// EastTypeValue is a variant object: { type: string, value: any }
// For Struct: type.type === "Struct", type.value is Array<{ name: string, type: EastTypeValue }>
// For Variant: type.type === "Variant", type.value is Array<{ name: string, type: EastTypeValue }>

/**
 * Check if a decoded EastTypeValue represents a PackageObject.
 * PackageObject is a Struct with fields: tasks (Dict<String,String>), data (Struct)
 */
function isPackageObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const fields = type.value as { name: string; type: any }[];
  const names = new Set(fields.map(f => f.name));
  return names.has('tasks') && names.has('data');
}

/**
 * Check if a decoded EastTypeValue represents an EnvironmentSpec.
 *
 * EnvironmentSpec is a Variant whose cases are a subset of {python, node,
 * image, tools, workspace_node} and always include the original three. The
 * bounded predicate (⊇ the original 3, ⊆ all 5) accepts both pre-`tools`
 * specs (exactly 3 cases) and current specs (5 cases) without matching an
 * unrelated variant that merely happens to contain `python`/`node`/`image`.
 */
function isEnvironmentSpecShape(type: any): boolean {
  if (type?.type !== 'Variant' || !Array.isArray(type.value)) return false;
  const names = new Set<string>(type.value.map((c: any) => c.name as string));
  const known = new Set(['python', 'node', 'image', 'tools', 'workspace_node']);
  return names.has('python') && names.has('node') && names.has('image')
    && [...names].every((n) => known.has(n));
}

/**
 * Check if a decoded EastTypeValue represents a TaskObject.
 * TaskObject is a Struct with fields: commandIr, inputs, output
 */
function isTaskObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const fields = type.value as { name: string; type: any }[];
  const names = new Set(fields.map(f => f.name));
  return names.has('commandIr') && names.has('inputs') && names.has('output');
}

/**
 * Check if a decoded EastTypeValue represents a FunctionObject.
 * FunctionObject is a Struct with fields: bodyIr, inputTypes, outputType, runner
 */
function isFunctionObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const fields = type.value as { name: string; type: any }[];
  const names = new Set(fields.map(f => f.name));
  return names.has('bodyIr') && names.has('inputTypes') && names.has('outputType') && names.has('runner');
}

/**
 * Check if a decoded EastTypeValue represents a RecordObject.
 * RecordObject is a Struct with fields: path, mutations.
 */
function isRecordObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const names = new Set((type.value as { name: string }[]).map(f => f.name));
  return names.has('path') && names.has('mutations') && names.size === 2;
}

/**
 * Check if a decoded EastTypeValue represents a MutationObject.
 * MutationObject is a Struct with fields: bodyIr, argTypes, runner — distinct
 * from a FunctionObject (which has inputTypes/outputType, not argTypes).
 */
function isMutationObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const names = new Set((type.value as { name: string }[]).map(f => f.name));
  // Exact field set (records' state blobs are arbitrary user structs that flow
  // through this dispatch, so a name-subset match could misclassify one).
  return names.size === 3 && names.has('bodyIr') && names.has('argTypes') && names.has('runner');
}

/**
 * Check if a decoded EastTypeValue represents a RecordCommit.
 * RecordCommit is a Struct with fields: parent, state, mutation, args, actor, at.
 */
function isRecordCommitShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const names = new Set((type.value as { name: string }[]).map(f => f.name));
  // Exact field set so a user state struct sharing some of these field names
  // can't be misclassified as a commit and have its fields probed as hashes.
  return names.size === 6
    && names.has('parent') && names.has('state') && names.has('mutation')
    && names.has('args') && names.has('actor') && names.has('at');
}

/**
 * Check if a field type is a DataRef (Variant with cases: unassigned, null, value, tree).
 */
function isDataRefFieldType(fieldType: any): boolean {
  if (fieldType.type !== 'Variant') return false;
  const cases = fieldType.value as { name: string; type: any }[];
  const names = new Set(cases.map(c => c.name));
  return names.has('tree') && names.has('value') && names.has('unassigned') && names.has('null');
}

/**
 * Check if a decoded EastTypeValue represents a TreeObject.
 * A tree is a Struct where every field is a DataRef variant.
 */
function isTreeObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const fields = type.value as { name: string; type: any }[];
  return fields.length > 0 && fields.every(f => isDataRefFieldType(f.type));
}

/**
 * Extract child hashes from a decoded BEAST2 object based on its type.
 * Returns children with isLeaf flag to avoid reading leaf objects.
 */
function extractChildren(
  type: unknown,
  value: unknown
): { hash: string; isLeaf: boolean }[] {
  const t = type as any;
  const children: { hash: string; isLeaf: boolean }[] = [];

  if (isPackageObjectShape(t)) {
    const pkg = value as { tasks: Map<string, string>; data: { structure: unknown; refs?: Map<string, { type: string; value: any }> }; functions?: Map<string, string>; records?: Map<string, string> };
    for (const taskHash of pkg.tasks.values()) {
      children.push({ hash: taskHash, isLeaf: false });
    }
    // Function objects (absent on pre-`functions` packages)
    if (isEastDict(pkg.functions)) {
      for (const fnHash of pkg.functions.values()) {
        children.push({ hash: fnHash, isLeaf: false });
      }
    }
    // Record objects (absent on pre-`records` packages)
    if (isEastDict(pkg.records)) {
      for (const recHash of pkg.records.values()) {
        children.push({ hash: recHash, isLeaf: false });
      }
    }
    // Extract value hashes from inline per-dataset refs
    if (isEastDict(pkg.data.refs)) {
      for (const ref of pkg.data.refs.values()) {
        if (ref.type === 'value' && typeof ref.value?.hash === 'string') {
          children.push({ hash: ref.value.hash, isLeaf: true });
        }
      }
    }
    return children;
  }

  if (isTaskObjectShape(t)) {
    const task = value as { commandIr: string; environment?: { type: string; value: string } };
    children.push({ hash: task.commandIr, isLeaf: true }); // IR is a leaf
    if (task.environment?.type === 'some') {
      children.push({ hash: task.environment.value, isLeaf: false }); // walk the spec's blobs
    }
    return children;
  }

  if (isFunctionObjectShape(t)) {
    const fn = value as { bodyIr: string; environment?: { type: string; value: string } };
    children.push({ hash: fn.bodyIr, isLeaf: true }); // IR is a leaf
    if (fn.environment?.type === 'some') {
      children.push({ hash: fn.environment.value, isLeaf: false }); // walk the spec's blobs
    }
    return children;
  }

  if (isRecordObjectShape(t)) {
    const rec = value as { mutations: Map<string, string> };
    for (const mutHash of rec.mutations.values()) {
      children.push({ hash: mutHash, isLeaf: false });
    }
    return children;
  }

  if (isMutationObjectShape(t)) {
    const mut = value as { bodyIr: string };
    children.push({ hash: mut.bodyIr, isLeaf: true }); // IR is a leaf
    return children;
  }

  if (isEnvironmentSpecShape(t)) {
    const spec = value as { type: string; value: Record<string, unknown> };
    if (spec.type === 'python') {
      const env = spec.value as { pyproject: string; lock: string; sdists: { filename: string; hash: string }[] };
      children.push({ hash: env.pyproject, isLeaf: true }, { hash: env.lock, isLeaf: true });
      for (const sdist of env.sdists) children.push({ hash: sdist.hash, isLeaf: true });
    } else if (spec.type === 'node') {
      const env = spec.value as { packageJson: string; lock: string; tarballs: string[] };
      children.push({ hash: env.packageJson, isLeaf: true }, { hash: env.lock, isLeaf: true });
      for (const tarball of env.tarballs) children.push({ hash: tarball, isLeaf: true });
    } else if (spec.type === 'tools') {
      const env = spec.value as { files: { path: string; hash: string }[] };
      for (const file of env.files) children.push({ hash: file.hash, isLeaf: true });
    } else if (spec.type === 'workspace_node') {
      const env = spec.value as {
        packageJson: string; lock: string;
        config: { type: string; value: string };
        members: { path: string; name: string; tarball: string }[];
      };
      children.push({ hash: env.packageJson, isLeaf: true }, { hash: env.lock, isLeaf: true });
      if (env.config?.type === 'some') children.push({ hash: env.config.value, isLeaf: true });
      for (const member of env.members) children.push({ hash: member.tarball, isLeaf: true });
    }
    // image: no object-store references
    return children;
  }

  if (isRecordCommitShape(t)) {
    const commit = value as {
      parent: { type: string; value: string };
      state: string;
      args: { type: string; value: string };
    };
    children.push({ hash: commit.state, isLeaf: true }); // state blob is a leaf
    if (commit.parent.type === 'some') {
      children.push({ hash: commit.parent.value, isLeaf: false }); // walk the chain
    }
    if (commit.args.type === 'some') {
      children.push({ hash: commit.args.value, isLeaf: true }); // args tuple is a leaf
    }
    return children;
  }

  if (isTreeObjectShape(t)) {
    const tree = value as Record<string, { type: string; value: any }>;
    for (const ref of Object.values(tree)) {
      if (ref.type === 'tree') {
        children.push({ hash: ref.value as string, isLeaf: false }); // subtree needs traversal
      } else if (ref.type === 'value') {
        children.push({ hash: ref.value as string, isLeaf: true }); // value is a leaf
      }
      // 'unassigned' and 'null': no hash to follow
    }
    return children;
  }

  return []; // Unknown type: leaf, no children
}

/**
 * Pure decision function: determine which objects to delete.
 *
 * No side effects — trivially testable. Caller decides whether to
 * actually delete (supports dry-run by skipping gcDeleteObjects).
 *
 * @param objects - Object entries from gcScanObjects
 * @param reachable - Set of reachable hashes from markReachable
 * @param minAge - Minimum age in ms; objects younger than this are skipped
 * @returns Decision result with toDelete list and stats
 */
export function sweepBatch(
  objects: GcObjectEntry[],
  reachable: Set<string>,
  minAge: number
): SweepBatchResult {
  const now = Date.now();
  const toDelete: string[] = [];
  let retained = 0;
  let skippedYoung = 0;
  let bytesFreed = 0;

  for (const obj of objects) {
    if (reachable.has(obj.hash)) {
      retained++;
      continue;
    }
    const age = now - obj.lastModified;
    if (minAge > 0 && age < minAge) {
      skippedYoung++;
      continue;
    }
    toDelete.push(obj.hash);
    bytesFreed += obj.size;
  }

  return { toDelete, retained, skippedYoung, bytesFreed };
}

// =============================================================================
// Local Driver
// =============================================================================

/**
 * Run garbage collection on an e3 repository.
 *
 * Works with any StorageBackend — no instanceof checks.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - GC options
 * @returns GC result with statistics
 */
export async function repoGc(
  storage: StorageBackend,
  repo: string,
  options: GcOptions = {}
): Promise<GcResult> {
  const minAge = options.minAge ?? 60000;
  const dryRun = options.dryRun ?? false;

  // Step 1: Collect all root hashes
  const roots = await collectAllRoots(storage.repos, repo);

  // Step 2: Mark all reachable objects
  const readObject = async (hash: string): Promise<Uint8Array | null> => {
    try {
      return await storage.objects.read(repo, hash);
    } catch {
      return null;
    }
  };
  const reachable = await markReachable(readObject, roots);

  // Step 3: Scan and sweep objects
  let totalDeleted = 0;
  let totalRetained = 0;
  let totalSkippedYoung = 0;
  let totalBytesFreed = 0;
  let cursor: unknown;

  do {
    const scan = await storage.repos.gcScanObjects(repo, cursor);
    const result = sweepBatch(scan.objects, reachable, minAge);

    totalRetained += result.retained;
    totalSkippedYoung += result.skippedYoung;
    totalBytesFreed += result.bytesFreed;

    if (!dryRun && result.toDelete.length > 0) {
      await storage.repos.gcDeleteObjects(repo, result.toDelete);
    }
    totalDeleted += result.toDelete.length;

    cursor = scan.cursor;
  } while (cursor !== undefined);

  // Step 4: Clean up orphaned .partial files (local-only concern)
  let deletedPartials = 0;
  let partialSkippedYoung = 0;
  try {
    const partialResult = await cleanupPartials(repo, minAge, dryRun);
    deletedPartials = partialResult.deleted;
    partialSkippedYoung = partialResult.skippedYoung;
  } catch {
    // Not a fatal error
  }

  // Step 4b: Sweep orphaned .partial staging files left by atomicWriteFile in
  // the ref trees (packages/, workspaces/ incl. nested dataset refs,
  // executions/, dataflows/) — cleanupPartials above only covers objects/.
  const partialNow = Date.now();
  for (const refRoot of ['packages', 'workspaces', 'executions', 'dataflows']) {
    try {
      const result = await cleanupRefTreePartials(path.join(repo, refRoot), partialNow, minAge, dryRun);
      deletedPartials += result.deleted;
      partialSkippedYoung += result.skippedYoung;
    } catch {
      // Not a fatal error
    }
  }

  // Step 5: Clean up orphaned transfer staging files
  try {
    const transferResult = await cleanupTransferStaging(minAge, dryRun);
    deletedPartials += transferResult.deleted;
    partialSkippedYoung += transferResult.skippedYoung;
  } catch {
    // Not a fatal error
  }

  return {
    deletedObjects: totalDeleted,
    deletedPartials,
    retainedObjects: totalRetained,
    skippedYoung: totalSkippedYoung + partialSkippedYoung,
    bytesFreed: totalBytesFreed,
  };
}

/**
 * Clean up orphaned .partial staging files in the objects directory — both
 * the per-prefix stages of whole-object writes and the root-level
 * `stage.*.partial` files of streaming writes (which cannot stage under a
 * prefix: the content path is unknown until the digest names it).
 * This is a local-only concern — cloud storage doesn't use .partial files.
 */
async function cleanupPartials(
  repoPath: string,
  minAge: number,
  dryRun: boolean
): Promise<{ deleted: number; skippedYoung: number }> {
  const objectsDir = path.join(repoPath, 'objects');
  const now = Date.now();
  let deleted = 0;
  let skippedYoung = 0;

  const sweep = async (filePath: string): Promise<void> => {
    try {
      const fileStat = await fs.stat(filePath);
      const age = now - fileStat.mtimeMs;
      if (minAge > 0 && age < minAge) {
        skippedYoung++;
        return;
      }
      if (!dryRun) {
        await fs.unlink(filePath);
      }
      deleted++;
    } catch {
      // Skip files we can't stat or delete
    }
  };

  try {
    const entries = await fs.readdir(objectsDir);
    for (const entry of entries) {
      if (entry.endsWith('.partial')) {
        await sweep(path.join(objectsDir, entry));
        continue;
      }
      if (!/^[a-f0-9]{2}$/.test(entry)) continue;
      const subdirPath = path.join(objectsDir, entry);
      try {
        const stat = await fs.stat(subdirPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const files = await fs.readdir(subdirPath);
      for (const file of files) {
        if (!file.endsWith('.partial')) continue;
        await sweep(path.join(subdirPath, file));
      }
    }
  } catch {
    // Objects directory doesn't exist
  }

  return { deleted, skippedYoung };
}

/**
 * Recursively unlink aged `.partial` staging files under a ref-tree root.
 *
 * `atomicWriteFile` stages bytes in a sibling `<dest>.<rand>.partial` file
 * before renaming it over the destination; that staging file survives only if a
 * writer crashed between the write and the rename. This sweeps those orphans
 * from the ref trees (packages/, workspaces/ — including nested dataset refs —,
 * executions/, dataflows/), which the objects-only {@link cleanupPartials} does
 * not cover. The age gate ensures a live, in-flight staging file is never raced.
 *
 * @param rootDir - Ref-tree root directory to walk
 * @param now - Reference timestamp for the age gate
 * @param minAge - Minimum age (ms) before a staging file is eligible for removal
 * @param dryRun - When true, count but do not delete
 * @returns Counts of deleted and too-young-to-delete staging files
 */
async function cleanupRefTreePartials(
  rootDir: string,
  now: number,
  minAge: number,
  dryRun: boolean
): Promise<{ deleted: number; skippedYoung: number }> {
  let deleted = 0;
  let skippedYoung = 0;

  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => null);
  if (!entries) return { deleted, skippedYoung }; // Root directory doesn't exist

  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await cleanupRefTreePartials(full, now, minAge, dryRun);
      deleted += sub.deleted;
      skippedYoung += sub.skippedYoung;
    } else if (entry.name.endsWith('.partial')) {
      try {
        const fileStat = await fs.stat(full);
        if (minAge > 0 && now - fileStat.mtimeMs < minAge) {
          skippedYoung++;
          continue;
        }
        if (!dryRun) {
          await fs.unlink(full);
        }
        deleted++;
      } catch {
        // Skip files we can't stat or delete
      }
    }
  }

  return { deleted, skippedYoung };
}

/**
 * Clean up orphaned transfer staging files from the OS temp directory.
 * These are created by the transfer upload flow and should be cleaned up
 * after the transfer completes, but may be left behind on crashes.
 */
async function cleanupTransferStaging(
  minAge: number,
  dryRun: boolean
): Promise<{ deleted: number; skippedYoung: number }> {
  const stagingDir = path.join(tmpdir(), 'e3-transfers');
  const now = Date.now();
  let deleted = 0;
  let skippedYoung = 0;

  try {
    const files = await fs.readdir(stagingDir);
    for (const file of files) {
      if (!file.endsWith('.partial')) continue;
      const filePath = path.join(stagingDir, file);
      try {
        const fileStat = await fs.stat(filePath);
        const age = now - fileStat.mtimeMs;
        if (minAge > 0 && age < minAge) {
          skippedYoung++;
          continue;
        }
        if (!dryRun) {
          await fs.unlink(filePath);
        }
        deleted++;
      } catch {
        // Skip files we can't stat or delete
      }
    }
  } catch {
    // Staging directory doesn't exist — nothing to clean
  }

  return { deleted, skippedYoung };
}
