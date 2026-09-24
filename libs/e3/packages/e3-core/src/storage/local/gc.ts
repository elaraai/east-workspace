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
import { decodeBeast2, isEastDict, readBeast2Type, toEastTypeValue, variant, type EastTypeValue } from '@elaraai/east';
import { COLLECTION_MANIFEST_KIND, MutationObjectType, PartitionPlanType, RECORD_STATE_KIND, RecordCommitType, RecordIndexObjectType, RecordObjectType, isCollectionManifestType, isRecordStateType } from '@elaraai/e3-types';
import type { RepoStore, GcObjectEntry, GcRootScanResult, LockHandle, StorageBackend } from '../interfaces.js';
import { transferStagingDir } from './localHelpers.js';
import { sweepScratchDirs } from '../../execution/scratch.js';

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

/** Head read sizes the header-first mark tries, in order — the sequence
 *  `readBeast2HeaderType` uses. */
const HEAD_PROBE_BYTES = [64 * 1024, 1024 * 1024, 16 * 1024 * 1024];

/**
 * Options for {@link markReachable}.
 */
export interface MarkReachableOptions {
  /**
   * Reads the first `length` bytes of an object (fewer when the object is
   * shorter), or returns null when it does not exist. With it the mark is
   * header-first: an object's type is read from its head, and only an object
   * of a structural shape — one that names other objects — is read whole;
   * every other object is marked without being read. Without it every object
   * the mark visits is read whole, so a sweep reads every dataset it reaches
   * — still classified by its type before anything is decoded.
   */
  readHead?: (hash: string, length: number) => Promise<Uint8Array | null>;
}

/**
 * How a child hash found inside an object must be treated.
 */
export type GcChildKind =
  /** Marked reachable without ever being read — an IR blob, an args tuple, a
   *  segment object. Nothing inside it names another object. */
  | 'leaf'
  /** Read and traversed: it names other objects, and one that cannot be read
   *  keeps nothing alive. */
  | 'node'
  /**
   * A dataset value: marked reachable **unconditionally**, so a ref whose
   * object is missing or unreadable is never swept out from under itself, and
   * then visited, because a collection manifest names segment objects that
   * nothing else keeps alive.
   *
   * @remarks
   * Marking blind is what keeps a partially transferred repository sound.
   * Visiting is what keeps a manifest's header and segments: marked and not
   * walked, the manifest would survive a sweep that took everything it names.
   * With `readHead` a value is classified from its head and read no further
   * unless it is a manifest; without, it is read whole to learn its type,
   * which costs the sweep I/O but never an object.
   */
  | 'value';

/**
 * Trace the object graph from roots using iterative DFS with schema-aware traversal.
 *
 * Decodes each object using BEAST2 self-describing format and extracts child
 * hashes based on the detected object type (Package, Task, Tree, or collection
 * manifest). Objects known to be leaves (IR blobs, segment objects) are marked
 * reachable without reading; see {@link GcChildKind} for how a dataset value is
 * treated.
 *
 * With `options.readHead`, a root or child whose kind is not known in advance
 * is classified by its header first: 64 KiB of head, growing to 1 MiB and then
 * 16 MiB while its type section does not fit. Only a structural shape is read
 * whole; a dataset, whatever its size, is marked without being read, and so is
 * an object whose head yields no type. Without it such an object is read whole
 * and classified the same way, by its type, before anything is decoded.
 *
 * @param readObject - Function to read an object by hash (returns null if missing)
 * @param roots - Set of root hashes to start from
 * @param options - Header-first classification
 * @returns Set of all reachable hashes
 */
export async function markReachable(
  readObject: (hash: string) => Promise<Uint8Array | null>,
  roots: Set<string>,
  options: MarkReachableOptions = {}
): Promise<Set<string>> {
  const reachable = new Set<string>();
  // Marking and visiting are separate: a dataset value is marked the moment
  // its ref names it, and may still be visited afterwards to find the segment
  // objects a manifest names.
  const visited = new Set<string>();
  const stack = [...roots];

  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (visited.has(hash)) continue;
    visited.add(hash);

    if (options.readHead) {
      const type = await readHeadType(options.readHead, hash);
      if (type === 'missing') continue;
      if (type === null || !isStructuralShape(type)) {
        reachable.add(hash); // a leaf: marked without being read
        continue;
      }
    }

    const data = await readObject(hash);
    if (!data) continue;
    reachable.add(hash);

    // Without head reads the object had to be read whole to be classified,
    // but it is classified all the same before it is decoded: a dataset of any
    // size is decoded only when it is a shape that names other objects.
    if (!options.readHead) {
      let type: EastTypeValue;
      try {
        type = readBeast2Type(data);
      } catch {
        continue; // Not valid BEAST2 or unknown format — a leaf
      }
      if (!isStructuralShape(type)) continue;
    }

    // Schema-aware child extraction
    let children: { hash: string; kind: GcChildKind }[];
    try {
      const decoded = decodeBeast2(Buffer.from(data));
      children = extractChildren(decoded.type, decoded.value);
    } catch {
      continue; // Not valid BEAST2 or unknown format — treat as leaf
    }

    for (const child of children) {
      if (child.kind === 'leaf') {
        reachable.add(child.hash); // Mark without reading
        continue;
      }
      if (child.kind === 'value') {
        reachable.add(child.hash);
        stack.push(child.hash);
        continue;
      }
      if (!visited.has(child.hash)) stack.push(child.hash);
    }
  }

  return reachable;
}

/**
 * The root type an object's header declares, read through growing head
 * probes; `null` when no probe yields one (not beast2, or a malformed or
 * implausibly large type section — a leaf), or `'missing'` when the object
 * does not exist.
 */
async function readHeadType(
  readHead: (hash: string, length: number) => Promise<Uint8Array | null>,
  hash: string
): Promise<EastTypeValue | null | 'missing'> {
  for (const probe of HEAD_PROBE_BYTES) {
    const head = await readHead(hash, probe);
    if (head === null) return 'missing';
    try {
      return readBeast2Type(head);
    } catch {
      // A short head fails like a malformed one: grow, unless this head was
      // already the whole object.
      if (head.length < probe) return null;
    }
  }
  return null;
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

/** `RecordObjectType`'s field names, in wire order, read from the type itself:
 *  every record-object shape a repository can hold is a PREFIX of this list,
 *  because struct fields encode positionally and the record object only ever
 *  grows by appending LAST. */
const RECORD_OBJECT_FIELDS: readonly string[] =
  (toEastTypeValue(RecordObjectType).value as { name: string }[]).map(f => f.name);

/** The fields every record object has carried from the first vintage on. */
const RECORD_OBJECT_MIN_FIELDS = 2;

/**
 * Check if a decoded EastTypeValue represents a RecordObject — of any vintage:
 * a struct agreeing with {@link RECORD_OBJECT_FIELDS} on their common prefix,
 * which must reach {@link RECORD_OBJECT_MIN_FIELDS}.
 *
 * Both directions matter. A record object SHORTER than this build's type is
 * one an older e3 wrote; one LONGER is one a newer e3 wrote in a repository
 * this build is sweeping. Either way an unrecognised record object is treated
 * as a leaf, its mutation bodies and index objects are never extracted, and
 * the sweep deletes the things it is the only reference to.
 */
function isRecordObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const names = (type.value as { name: string }[]).map(f => f.name);
  const common = Math.min(names.length, RECORD_OBJECT_FIELDS.length);
  if (common < RECORD_OBJECT_MIN_FIELDS) return false;
  return RECORD_OBJECT_FIELDS.slice(0, common).every((name, i) => name === names[i]);
}

/** `RecordIndexObjectType`'s field names, in wire order, read from the type
 *  itself: an index object of any vintage BEGINS with these, because struct
 *  fields encode positionally and the index object only ever grows by
 *  appending LAST. */
const RECORD_INDEX_OBJECT_FIELDS: readonly string[] =
  (toEastTypeValue(RecordIndexObjectType).value as { name: string }[]).map(f => f.name);

/**
 * Check if a decoded EastTypeValue represents a RecordIndexObject — the
 * declaration an index was built under, which a historical state keeps naming
 * long after the package that declared it is gone. Of any vintage: a struct
 * beginning with {@link RECORD_INDEX_OBJECT_FIELDS}, so one a NEWER e3 wrote
 * with a field appended is still recognised in a repository this build sweeps.
 *
 * An index object this does not recognise is a leaf: the key, projection,
 * build and merge IR it names go unmarked, the next sweep deletes them, and
 * the index is left one no rebuild can ever run again.
 */
function isRecordIndexObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const names = (type.value as { name: string }[]).map(f => f.name);
  if (names.length < RECORD_INDEX_OBJECT_FIELDS.length) return false;
  return RECORD_INDEX_OBJECT_FIELDS.every((name, i) => name === names[i]);
}

/**
 * Check if a decoded EastTypeValue represents a record's `$record` state — the
 * table naming its primary manifest and every index's.
 */
function isRecordStateShape(type: any): boolean {
  return isRecordStateType(type as EastTypeValue);
}

/** `MutationObjectType`'s field names, in wire order, read from the type
 *  itself: a mutation of any vintage is a PREFIX of this list. */
const MUTATION_OBJECT_FIELDS: readonly string[] =
  (toEastTypeValue(MutationObjectType).value as { name: string }[]).map(f => f.name);

/** The fields every mutation has carried from the first vintage on. */
const MUTATION_OBJECT_MIN_FIELDS = 3;

/**
 * Check if a decoded EastTypeValue represents a MutationObject — of any
 * vintage: a struct agreeing with {@link MUTATION_OBJECT_FIELDS} on their
 * common prefix. Distinct from a FunctionObject, which has
 * inputTypes/outputType rather than argTypes.
 *
 * A mutation this does not recognise is a leaf, its body and program go
 * unmarked, and the next sweep deletes the IR the deployed package needs.
 */
function isMutationObjectShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const names = (type.value as { name: string }[]).map(f => f.name);
  const common = Math.min(names.length, MUTATION_OBJECT_FIELDS.length);
  if (common < MUTATION_OBJECT_MIN_FIELDS) return false;
  return MUTATION_OBJECT_FIELDS.slice(0, common).every((name, i) => name === names[i]);
}

/**
 * Check if a decoded EastTypeValue represents a CollectionManifest — the
 * object a collection dataset's ref points at, naming its segment objects.
 *
 * Exact field set, as every recognizer here is: a record's state is an
 * arbitrary user struct flowing through the same dispatch. `kind` is checked
 * when the children are extracted, so a struct of this shape carrying another
 * tag is a leaf rather than a mis-traversed manifest.
 */
function isCollectionManifestShape(type: any): boolean {
  return isCollectionManifestType(type as EastTypeValue);
}

/** `RecordCommitType`'s field names, in wire order, read from the type itself:
 *  a commit of any vintage is a PREFIX of this list. */
const RECORD_COMMIT_FIELDS: readonly string[] =
  (toEastTypeValue(RecordCommitType).value as { name: string }[]).map(f => f.name);

/** The fields every commit has carried from the first vintage on. */
const RECORD_COMMIT_MIN_FIELDS = 6;

/**
 * Check if a decoded EastTypeValue represents a RecordCommit — of any vintage:
 * a struct agreeing with {@link RECORD_COMMIT_FIELDS} on their common prefix,
 * which must reach {@link RECORD_COMMIT_MIN_FIELDS} so a user state struct
 * sharing a field name is not probed for hashes.
 *
 * A commit this does not recognise ends the chain there, taking every state
 * and delta the older commits name with it.
 */
function isRecordCommitShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const names = (type.value as { name: string }[]).map(f => f.name);
  const common = Math.min(names.length, RECORD_COMMIT_FIELDS.length);
  if (common < RECORD_COMMIT_MIN_FIELDS) return false;
  return RECORD_COMMIT_FIELDS.slice(0, common).every((name, i) => name === names[i]);
}

/** `PartitionPlanType`'s field names, in wire order, read from the type
 *  itself rather than written out here: every plan shape a repository can
 *  hold is a PREFIX of this list, because beast2 encodes struct fields
 *  positionally and the plan only ever grows by appending LAST. */
const PARTITION_PLAN_FIELDS: readonly string[] =
  (toEastTypeValue(PartitionPlanType).value as { name: string }[]).map(f => f.name);

/** The fields every plan has carried, from the first vintage on: the ones a
 *  prefix must reach before it is a plan rather than an unrelated struct. */
const PARTITION_PLAN_MIN_FIELDS = 4;

/**
 * Check if a decoded EastTypeValue represents a PartitionPlan — of any
 * vintage: a struct that agrees with {@link PARTITION_PLAN_FIELDS} on their
 * common prefix, which must reach {@link PARTITION_PLAN_MIN_FIELDS}.
 *
 * Both directions matter, and both lose objects when they are wrong. A plan
 * SHORTER than this build's type is one an older e3 recorded; a plan LONGER
 * is one a newer e3 recorded in a repository this build is sweeping. Either
 * way an unrecognised plan is treated as a leaf, its children are never
 * extracted, and the sweep deletes the carved slices and range blobs it is
 * the only reference to. Reading the names off the type keeps the two from
 * drifting when a field is appended; `gc.spec.ts` pins the order they must
 * be appended in.
 */
function isPartitionPlanShape(type: any): boolean {
  if (type.type !== 'Struct') return false;
  const names = (type.value as { name: string }[]).map(f => f.name);
  const common = Math.min(names.length, PARTITION_PLAN_FIELDS.length);
  if (common < PARTITION_PLAN_MIN_FIELDS) return false;
  return PARTITION_PLAN_FIELDS.slice(0, common).every((name, i) => name === names[i]);
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
 * Whether an object of this type names other objects, so the mark must read
 * it whole: every shape {@link extractChildren} traverses.
 */
function isStructuralShape(type: EastTypeValue): boolean {
  const t = type as any;
  return isPackageObjectShape(t) || isTaskObjectShape(t) || isFunctionObjectShape(t)
    || isRecordObjectShape(t) || isMutationObjectShape(t) || isEnvironmentSpecShape(t)
    || isRecordCommitShape(t) || isPartitionPlanShape(t) || isTreeObjectShape(t)
    || isCollectionManifestShape(t) || isRecordIndexObjectShape(t) || isRecordStateShape(t);
}

/**
 * Extract child hashes from a decoded BEAST2 object based on its type.
 * Returns each child with the {@link GcChildKind} that decides whether it is
 * marked, read, or both.
 */
function extractChildren(
  type: unknown,
  value: unknown
): { hash: string; kind: GcChildKind }[] {
  const t = type as any;
  const children: { hash: string; kind: GcChildKind }[] = [];

  if (isPackageObjectShape(t)) {
    const pkg = value as { tasks: Map<string, string>; data: { structure: unknown; refs?: Map<string, { type: string; value: any }> }; functions?: Map<string, string>; records?: Map<string, string> };
    for (const taskHash of pkg.tasks.values()) {
      children.push({ hash: taskHash, kind: 'node' });
    }
    // Function objects (absent on pre-`functions` packages)
    if (isEastDict(pkg.functions)) {
      for (const fnHash of pkg.functions.values()) {
        children.push({ hash: fnHash, kind: 'node' });
      }
    }
    // Record objects (absent on pre-`records` packages)
    if (isEastDict(pkg.records)) {
      for (const recHash of pkg.records.values()) {
        children.push({ hash: recHash, kind: 'node' });
      }
    }
    // Extract value hashes from inline per-dataset refs. A collection's value
    // is a manifest naming other objects, so the ref's root is a `value`: it
    // is marked whatever happens to it, and walked only far enough to find
    // the segments it names.
    if (isEastDict(pkg.data.refs)) {
      for (const ref of pkg.data.refs.values()) {
        if (ref.type === 'value' && typeof ref.value?.hash === 'string') {
          children.push({ hash: ref.value.hash, kind: 'value' });
        }
      }
    }
    return children;
  }

  if (isTaskObjectShape(t)) {
    const task = value as { commandIr: string; environment?: { type: string; value: string } };
    children.push({ hash: task.commandIr, kind: 'leaf' }); // IR is a leaf
    if (task.environment?.type === 'some') {
      children.push({ hash: task.environment.value, kind: 'node' }); // walk the spec's blobs
    }
    return children;
  }

  if (isFunctionObjectShape(t)) {
    const fn = value as { bodyIr: string; environment?: { type: string; value: string } };
    children.push({ hash: fn.bodyIr, kind: 'leaf' }); // IR is a leaf
    if (fn.environment?.type === 'some') {
      children.push({ hash: fn.environment.value, kind: 'node' }); // walk the spec's blobs
    }
    return children;
  }

  if (isRecordObjectShape(t)) {
    const rec = value as { mutations: Map<string, string>; indexes?: Map<string, string> };
    for (const mutHash of rec.mutations.values()) {
      children.push({ hash: mutHash, kind: 'node' });
    }
    // Absent on a record object written before indexes existed.
    if (isEastDict(rec.indexes)) {
      for (const indexHash of rec.indexes.values()) {
        children.push({ hash: indexHash, kind: 'node' });
      }
    }
    return children;
  }

  if (isRecordIndexObjectShape(t)) {
    const index = value as { keyIr: string; valueIr: { type: string; value: string }; buildIr: string; mergeIr: string };
    children.push(
      { hash: index.keyIr, kind: 'leaf' },
      { hash: index.buildIr, kind: 'leaf' },
      { hash: index.mergeIr, kind: 'leaf' },
    );
    if (index.valueIr.type === 'some') children.push({ hash: index.valueIr.value, kind: 'leaf' });
    return children;
  }

  if (isRecordStateShape(t)) {
    const state = value as { kind: string; primary: string; indexes: Map<string, { manifest: string; index: string }> };
    if (state.kind !== RECORD_STATE_KIND) return children; // a look-alike user struct
    children.push({ hash: state.primary, kind: 'value' });
    for (const entry of state.indexes.values()) {
      children.push({ hash: entry.manifest, kind: 'value' });
      // The declaration an index was built under must outlive the package
      // that declared it: a state read at an older commit names it.
      children.push({ hash: entry.index, kind: 'node' });
    }
    return children;
  }

  if (isMutationObjectShape(t)) {
    // A mutation written before the delta existed names no program.
    const mut = value as { bodyIr: string; programIr?: string };
    children.push({ hash: mut.bodyIr, kind: 'leaf' }); // IR is a leaf
    if (typeof mut.programIr === 'string' && mut.programIr !== '') {
      children.push({ hash: mut.programIr, kind: 'leaf' });
    }
    return children;
  }

  if (isEnvironmentSpecShape(t)) {
    const spec = value as { type: string; value: Record<string, unknown> };
    if (spec.type === 'python') {
      const env = spec.value as { pyproject: string; lock: string; sdists: { filename: string; hash: string }[] };
      children.push({ hash: env.pyproject, kind: 'leaf' }, { hash: env.lock, kind: 'leaf' });
      for (const sdist of env.sdists) children.push({ hash: sdist.hash, kind: 'leaf' });
    } else if (spec.type === 'node') {
      const env = spec.value as { packageJson: string; lock: string; tarballs: string[] };
      children.push({ hash: env.packageJson, kind: 'leaf' }, { hash: env.lock, kind: 'leaf' });
      for (const tarball of env.tarballs) children.push({ hash: tarball, kind: 'leaf' });
    } else if (spec.type === 'tools') {
      const env = spec.value as { files: { path: string; hash: string }[] };
      for (const file of env.files) children.push({ hash: file.hash, kind: 'leaf' });
    } else if (spec.type === 'workspace_node') {
      const env = spec.value as {
        packageJson: string; lock: string;
        config: { type: string; value: string };
        members: { path: string; name: string; tarball: string }[];
      };
      children.push({ hash: env.packageJson, kind: 'leaf' }, { hash: env.lock, kind: 'leaf' });
      if (env.config?.type === 'some') children.push({ hash: env.config.value, kind: 'leaf' });
      for (const member of env.members) children.push({ hash: member.tarball, kind: 'leaf' });
    }
    // image: no object-store references
    return children;
  }

  if (isCollectionManifestShape(t)) {
    const manifest = value as { kind: string; level: bigint; header: string; entries: { hash: string }[] };
    if (manifest.kind !== COLLECTION_MANIFEST_KIND) return children; // a look-alike user struct
    // The header bytes every segment is written under — what makes a splice
    // possible, and the one object an empty collection still names.
    children.push({ hash: manifest.header, kind: 'leaf' });
    // Level 0 entries are segment objects (leaves); above it they are child
    // manifests, which name objects of their own.
    const entriesAreLeaves = manifest.level === 0n;
    for (const entry of manifest.entries) {
      children.push({ hash: entry.hash, kind: entriesAreLeaves ? 'leaf' : 'node' });
    }
    return children;
  }

  if (isRecordCommitShape(t)) {
    const commit = value as {
      parent: { type: string; value: string };
      state: string;
      args: { type: string; value: string };
      // Absent on a commit written before deltas existed.
      delta?: { type: string; value: string };
    };
    // The state may be a manifest naming segment objects, so it is marked and
    // then classified; a plain value blob is never read.
    children.push({ hash: commit.state, kind: 'value' });
    if (commit.parent.type === 'some') {
      children.push({ hash: commit.parent.value, kind: 'node' }); // walk the chain
    }
    if (commit.args.type === 'some') {
      children.push({ hash: commit.args.value, kind: 'leaf' }); // args tuple is a leaf
    }
    // The delta is a collection like any other, so it may be a manifest naming
    // segment objects: marked, then classified, never read as a value.
    if (commit.delta?.type === 'some') {
      children.push({ hash: commit.delta.value, kind: 'value' });
    }
    return children;
  }

  if (isPartitionPlanShape(t)) {
    // A partition slice is a dataset value; '' marks a slice the run never
    // carved, which is no object. A merged component's range blobs are values
    // too — either may be a manifest naming segment objects.
    const plan = value as { slices: string[][]; merges?: { ranges: string[] }[] };
    for (const slices of plan.slices) {
      for (const slice of slices) if (slice !== '') children.push({ hash: slice, kind: 'value' });
    }
    for (const merge of plan.merges ?? []) {
      for (const range of merge.ranges) children.push({ hash: range, kind: 'value' });
    }
    return children;
  }

  if (isTreeObjectShape(t)) {
    const tree = value as Record<string, { type: string; value: any }>;
    for (const ref of Object.values(tree)) {
      if (ref.type === 'tree') {
        children.push({ hash: ref.value as string, kind: 'node' }); // subtree needs traversal
      } else if (ref.type === 'value') {
        children.push({ hash: ref.value as string, kind: 'value' }); // may be a manifest
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
 * The lock gc takes exclusive, and every write that stores objects before a
 * ref names them holds shared, so the two never overlap: an ad-hoc task run
 * (`e3 run`), which has no dataflow lock, a record write, a dataset write
 * through the store's door, and a deploy. Each writes objects it has not yet
 * rooted, which a concurrent sweep would delete.
 */
export const TASKS_LOCK = '#tasks';

/**
 * Runs `fn` holding the tasks lock shared, so a sweep cannot run while it
 * does.
 *
 * @remarks
 * A write through the store's door stores objects before anything names them
 * — a delivery's segments, a delta, an index build's output — exactly as an
 * ad-hoc task run does, and the answer is the same one: gc takes this lock
 * exclusively, so the two never overlap and none of it needs rooting. Without
 * it a sweep landing mid-write deletes objects the ref it is about to write
 * names.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param fn - the work, which writes objects before anything names them
 * @returns what `fn` returns
 * @throws {Error} When a garbage collection holds the lock.
 */
export async function withRunningWork<T>(storage: StorageBackend, repo: string, fn: () => Promise<T>): Promise<T> {
  const lock = await storage.locks.acquire(repo, TASKS_LOCK, variant('dataflow', null), { mode: 'shared' });
  if (!lock) throw new Error('a garbage collection is running in this repository — retry when it finishes');
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Run garbage collection on an e3 repository.
 *
 * Works with any StorageBackend — no instanceof checks.
 *
 * gc holds the {@link TASKS_LOCK} exclusively and every workspace's dataflow
 * lock from before the mark until the sweep is done, so it never overlaps a
 * write holding the tasks lock or a dataflow run: the objects either writes
 * before it roots them need no rooting. Marking is header-first, so a dataset
 * is never read whole.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - GC options
 * @returns GC result with statistics
 * @throws {Error} When a task is running in the repository, or a dataflow is
 *   running in one of its workspaces.
 */
export async function repoGc(
  storage: StorageBackend,
  repo: string,
  options: GcOptions = {}
): Promise<GcResult> {
  const locks: LockHandle[] = [];
  try {
    const tasks = await storage.locks.acquire(repo, TASKS_LOCK, variant('dataflow', null));
    if (tasks === null) {
      throw new Error('gc: a task is running — retry when it finishes');
    }
    locks.push(tasks);
    for (const ws of await storage.refs.workspaceList(repo)) {
      const lock = await storage.locks.acquire(repo, `${ws}#dataflow`, variant('dataflow', null));
      if (lock === null) {
        throw new Error(`gc: a dataflow is running in workspace '${ws}' — retry when it finishes`);
      }
      locks.push(lock);
    }
    return await collectGarbage(storage, repo, options);
  } finally {
    for (const lock of locks) {
      await lock.release();
    }
  }
}

/** The mark and sweep of {@link repoGc}, run under its locks. */
async function collectGarbage(
  storage: StorageBackend,
  repo: string,
  options: GcOptions
): Promise<GcResult> {
  const minAge = options.minAge ?? 60000;
  const dryRun = options.dryRun ?? false;

  // Step 1: Collect all root hashes
  const roots = await collectAllRoots(storage.repos, repo);

  // Step 2: Mark all reachable objects, header-first
  const readObject = async (hash: string): Promise<Uint8Array | null> => {
    try {
      return await storage.objects.read(repo, hash);
    } catch {
      return null;
    }
  };
  const readHead = async (hash: string, length: number): Promise<Uint8Array | null> => {
    try {
      return await storage.objects.readRange(repo, hash, 0, length);
    } catch {
      return null;
    }
  };
  const reachable = await markReachable(readObject, roots, { readHead });

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

  // Step 6: Remove the scratch directories of executions whose orchestrator
  // has exited (local-only concern)
  if (!dryRun) {
    try {
      await sweepScratchDirs(repo, { minAge });
    } catch {
      // Not a fatal error
    }
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
 * prefix: the content path is unknown until the digest names it) — and the
 * dataset uploads staged in {@link transferStagingDir}, which an upload that
 * was never committed leaves behind and nothing else removes.
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

  // Dataset uploads staged under the repository. An in-flight upload is
  // young, so the same age gate keeps gc from racing it.
  const stagingDir = transferStagingDir(repoPath);
  let staged: string[] = [];
  try {
    staged = await fs.readdir(stagingDir);
  } catch {
    // No upload has been staged in this repository (ENOENT) — nothing to sweep
  }
  for (const entry of staged) {
    if (entry.endsWith('.partial')) {
      await sweep(path.join(stagingDir, entry));
    }
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
