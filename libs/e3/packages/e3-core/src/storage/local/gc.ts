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
 * 4. repoGc: Driver that calls all phases in sequence, after pruning the
 *    history of runs and executions it does not keep (history.ts)
 *
 * These functions work with any StorageBackend — no instanceof checks.
 * Cloud-specific concerns (S3 reachable set persistence, orphaned version cleanup)
 * are handled in the cloud Lambda handlers.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { decodeBeast2, readBeast2Type, toEastTypeValue, variant, type EastType, type EastTypeValue } from '@elaraai/east';
import { COLLECTION_MANIFEST_KIND, CollectionManifestType, EnvironmentSpecType, FunctionObjectType, MutationObjectType, PackageObjectType, RECORD_STATE_KIND, RecordCommitType, RecordIndexObjectType, RecordObjectType, RecordStateType, TASK_OBJECT_KIND, TaskObjectType, UNIT_PLAN_KIND, UnitPlanType, type CollectionManifest, type FunctionObject, type MutationObject, type PackageObject, type RecordCommit, type RecordIndexObject, type RecordObject, type RecordState, type TaskObject, type UnitPlan } from '@elaraai/e3-types';
import type { RepoStore, GcObjectEntry, GcRootScanResult, LockHandle, StorageBackend } from '../interfaces.js';
import { transferStagingDir } from './localHelpers.js';
import { DEFAULT_KEEP_DAYS, DEFAULT_KEEP_RUNS, pruneHistory } from './history.js';
import { sweepScratchDirs } from '../../execution/scratch.js';
import { sweepEnvironments } from '../../execution/environment.js';

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

  /**
   * The runs of each workspace kept however old, the latest first: with the
   * executions they used (history.ts).
   * Default: {@link DEFAULT_KEEP_RUNS}
   */
  keepRuns?: number;

  /**
   * The days of runs and executions kept however many.
   * Default: {@link DEFAULT_KEEP_DAYS}
   */
  keepDays?: number;
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
  /** Number of dataflow run records deleted */
  deletedRuns: number;
  /** Number of execution attempts deleted, each with its owner and logs */
  deletedExecutions: number;
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
 *
 * @param store - The repository store to scan
 * @param repo - Repository identifier
 * @param executionRoots - The roots of the executions gc keeps, when it has
 *   pruned the history itself, so a dry run marks as if it had deleted what it
 *   prunes; absent, every recorded execution's, as the store's scan finds them
 * @returns The root hashes
 */
export async function collectAllRoots(store: RepoStore, repo: string, executionRoots?: Iterable<string>): Promise<Set<string>> {
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
  if (executionRoots === undefined) {
    await scanAll(store.gcScanExecutionRoots.bind(store));
  } else {
    for (const hash of executionRoots) roots.add(hash);
  }

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
 * hashes by what the object is: a kind-tagged object by its tag (a manifest, a
 * record state, a task object or a unit plan), any other by its shape (a
 * package, a tree, a commit…). Objects known to be leaves (IR blobs, segment
 * objects) are marked reachable without reading; see {@link GcChildKind} for
 * how a dataset value is treated.
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

/** A type's struct field names or variant case names, in wire order. */
function namesOf(type: EastType): readonly string[] {
  return (toEastTypeValue(type).value as { name: string }[]).map((f) => f.name);
}

/**
 * Whether a decoded type is a struct whose fields are exactly `fields`, in
 * order: how an object without a kind tag is recognised, by its current shape
 * alone.
 */
function isStructOf(type: any, fields: readonly string[]): boolean {
  if (type.type !== 'Struct') return false;
  const names = (type.value as { name: string }[]).map((f) => f.name);
  return names.length === fields.length && names.every((name, i) => name === fields[i]);
}

const PACKAGE_OBJECT_FIELDS = namesOf(PackageObjectType);
const FUNCTION_OBJECT_FIELDS = namesOf(FunctionObjectType);
const RECORD_OBJECT_FIELDS = namesOf(RecordObjectType);
const RECORD_INDEX_OBJECT_FIELDS = namesOf(RecordIndexObjectType);
const MUTATION_OBJECT_FIELDS = namesOf(MutationObjectType);
const RECORD_COMMIT_FIELDS = namesOf(RecordCommitType);
const ENVIRONMENT_SPEC_CASES = namesOf(EnvironmentSpecType);

/** Whether a decoded type is an EnvironmentSpec: a variant of exactly its
 *  cases, in order. */
function isEnvironmentSpecShape(type: any): boolean {
  if (type?.type !== 'Variant' || !Array.isArray(type.value)) return false;
  const names = (type.value as { name: string }[]).map((c) => c.name);
  return names.length === ENVIRONMENT_SPEC_CASES.length && names.every((name, i) => name === ENVIRONMENT_SPEC_CASES[i]);
}

/** A kind of object that names other objects and carries a `kind` tag. */
interface TaggedKind {
  /** The kind's field names, in wire order. A later version appends fields,
   *  so its names begin with these. */
  readonly fields: readonly string[];
  /** The objects a value of the kind names, and how each is treated. */
  readonly children: (value: any) => { hash: string; kind: GcChildKind }[];
}

/**
 * Every kind-tagged object, by its tag: the mark dispatches on the tag.
 *
 * @remarks
 * An object is walked as a kind when its fields begin with the kind's and its
 * `kind` is the kind's tag. A struct of that shape carrying another tag is a
 * user value, and a leaf. A later version appends fields, so it is walked for
 * the fields this build knows. A new kind is one more entry here, with its
 * tests.
 *
 * A tagged object this does not recognise is a leaf: what it names goes
 * unmarked, and the next sweep deletes it.
 */
const TAGGED_KINDS: ReadonlyMap<string, TaggedKind> = new Map<string, TaggedKind>([
  [COLLECTION_MANIFEST_KIND, {
    fields: namesOf(CollectionManifestType),
    children: (manifest: CollectionManifest) => [
      // The header bytes every segment is written under — what makes a splice
      // possible, and the one object an empty collection still names.
      { hash: manifest.header, kind: 'leaf' },
      // Level 0 entries are segment objects; above it they are child
      // manifests, which name objects of their own.
      ...manifest.entries.map((entry): { hash: string; kind: GcChildKind } => ({ hash: entry.hash, kind: manifest.level === 0n ? 'leaf' : 'node' })),
    ],
  }],
  [RECORD_STATE_KIND, {
    fields: namesOf(RecordStateType),
    children: (state: RecordState) => [
      { hash: state.primary, kind: 'value' },
      // The declaration an index was built under must outlive the package
      // that declared it: a state read at an older commit names it.
      ...[...state.indexes.values()].flatMap((entry): { hash: string; kind: GcChildKind }[] => [
        { hash: entry.manifest, kind: 'value' },
        { hash: entry.index, kind: 'node' },
      ]),
    ],
  }],
  [TASK_OBJECT_KIND, {
    fields: namesOf(TaskObjectType),
    children: (task: TaskObject) => {
      // The program or the command IR, and what the output folds with: every
      // one an IR blob or a value, which name nothing.
      const children: { hash: string; kind: GcChildKind }[] = [
        { hash: task.body.type === 'east' ? task.body.value.program : task.body.value.commandIr, kind: 'leaf' },
      ];
      const kind = task.output.kind;
      if (kind.type === 'dict' && kind.value.merge.type === 'some') {
        children.push({ hash: kind.value.merge.value, kind: 'leaf' });
      }
      if (kind.type === 'fold') {
        children.push({ hash: kind.value.zero, kind: 'leaf' }, { hash: kind.value.combine, kind: 'leaf' });
      }
      if (task.environment.type === 'some') {
        children.push({ hash: task.environment.value, kind: 'node' }); // walk the spec's blobs
      }
      return children;
    },
  }],
  [UNIT_PLAN_KIND, {
    fields: namesOf(UnitPlanType),
    children: (plan: UnitPlan) => {
      // The task, whose program the units run. A piece's inputs and a merge's
      // parts are dataset values, which may be manifests naming segment
      // objects; a merge's key range is a small value that names nothing. The
      // plan of the stage before is walked too: a success names only its last,
      // and gc finds the task's units through the plans it names.
      const children: { hash: string; kind: GcChildKind }[] = [{ hash: plan.task, kind: 'node' }];
      if (plan.previous.type === 'some') children.push({ hash: plan.previous.value, kind: 'node' });
      if (plan.stage.type === 'pieces') {
        for (const inputs of plan.stage.value) {
          for (const input of inputs) children.push({ hash: input, kind: 'value' });
        }
      } else {
        for (const group of plan.stage.value.groups) {
          if (group.range.type === 'some') children.push({ hash: group.range.value, kind: 'leaf' });
          for (const entry of group.entries) children.push({ hash: entry, kind: 'value' });
        }
      }
      return children;
    },
  }],
]);

/**
 * The tag of the kind an object of this type may be: the kind whose fields
 * its fields begin with. Only the `kind` the object carries, read once it is
 * decoded, makes it one.
 *
 * @param type - The object's root type
 * @returns The tag, or `null` when the type is no tagged kind's
 */
function taggedKindOf(type: any): string | null {
  if (type.type !== 'Struct') return null;
  const names = (type.value as { name: string }[]).map(f => f.name);
  for (const [tag, kind] of TAGGED_KINDS) {
    if (kind.fields.length <= names.length && kind.fields.every((name, i) => name === names[i])) return tag;
  }
  return null;
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
  return taggedKindOf(t) !== null || isStructOf(t, PACKAGE_OBJECT_FIELDS) || isStructOf(t, FUNCTION_OBJECT_FIELDS)
    || isStructOf(t, RECORD_OBJECT_FIELDS) || isStructOf(t, MUTATION_OBJECT_FIELDS) || isEnvironmentSpecShape(t)
    || isStructOf(t, RECORD_COMMIT_FIELDS) || isTreeObjectShape(t) || isStructOf(t, RECORD_INDEX_OBJECT_FIELDS);
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

  // A kind-tagged object dispatches on its tag. A struct of a tagged kind's
  // shape carrying another tag is a user value, and a leaf.
  const tag = taggedKindOf(t);
  if (tag !== null) {
    return (value as { kind?: unknown }).kind === tag ? TAGGED_KINDS.get(tag)!.children(value) : children;
  }

  if (isStructOf(t, PACKAGE_OBJECT_FIELDS)) {
    const pkg = value as PackageObject;
    for (const taskHash of pkg.tasks.values()) {
      children.push({ hash: taskHash, kind: 'node' });
    }
    for (const fnHash of pkg.functions.values()) {
      children.push({ hash: fnHash, kind: 'node' });
    }
    for (const recHash of pkg.records.values()) {
      children.push({ hash: recHash, kind: 'node' });
    }
    // Extract value hashes from inline per-dataset refs. A collection's value
    // is a manifest naming other objects, so the ref's root is a `value`: it
    // is marked whatever happens to it, and walked only far enough to find
    // the segments it names.
    for (const ref of pkg.data.refs.values()) {
      if (ref.type === 'value') children.push({ hash: ref.value.hash, kind: 'value' });
    }
    return children;
  }

  if (isStructOf(t, FUNCTION_OBJECT_FIELDS)) {
    const fn = value as FunctionObject;
    children.push({ hash: fn.bodyIr, kind: 'leaf' }); // IR is a leaf
    if (fn.environment.type === 'some') {
      children.push({ hash: fn.environment.value, kind: 'node' }); // walk the spec's blobs
    }
    return children;
  }

  if (isStructOf(t, RECORD_OBJECT_FIELDS)) {
    const rec = value as RecordObject;
    for (const mutHash of rec.mutations.values()) {
      children.push({ hash: mutHash, kind: 'node' });
    }
    for (const indexHash of rec.indexes.values()) {
      children.push({ hash: indexHash, kind: 'node' });
    }
    return children;
  }

  if (isStructOf(t, RECORD_INDEX_OBJECT_FIELDS)) {
    const index = value as RecordIndexObject;
    children.push(
      { hash: index.keyIr, kind: 'leaf' },
      { hash: index.buildIr, kind: 'leaf' },
    );
    if (index.valueIr.type === 'some') children.push({ hash: index.valueIr.value, kind: 'leaf' });
    return children;
  }

  if (isStructOf(t, MUTATION_OBJECT_FIELDS)) {
    const mut = value as MutationObject;
    children.push({ hash: mut.bodyIr, kind: 'leaf' }, { hash: mut.programIr, kind: 'leaf' }); // IR is a leaf
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

  if (isStructOf(t, RECORD_COMMIT_FIELDS)) {
    const commit = value as RecordCommit;
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
    if (commit.delta.type === 'some') {
      children.push({ hash: commit.delta.value, kind: 'value' });
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
 * lock from before the history's prune until the sweep is done, so it never
 * overlaps a write holding the tasks lock or a dataflow run: the objects
 * either writes before it roots them need no rooting, and no record is written
 * while it decides which to keep. It prunes the history first (history.ts),
 * and then marks from what it kept, so the outputs only the deleted records
 * kept go in the same sweep. Marking is header-first, so a dataset is never
 * read whole.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - GC options
 * @returns GC result with statistics
 * @throws {RangeError} When `keepRuns` or `keepDays` is not a whole number of
 *   zero or more.
 * @throws {Error} When a task is running in the repository, or a dataflow is
 *   running in one of its workspaces.
 */
export async function repoGc(
  storage: StorageBackend,
  repo: string,
  options: GcOptions = {}
): Promise<GcResult> {
  for (const [name, value] of [['keepRuns', options.keepRuns], ['keepDays', options.keepDays]] as const) {
    if (value !== undefined && !(Number.isInteger(value) && value >= 0)) {
      throw new RangeError(`gc: ${name} must be a whole number of zero or more, got ${value}`);
    }
  }
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

  // Step 0: Prune the history: the runs and executions gc does not keep go,
  // or would in a dry run
  const history = await pruneHistory(storage, repo, {
    keepRuns: options.keepRuns ?? DEFAULT_KEEP_RUNS,
    keepDays: options.keepDays ?? DEFAULT_KEEP_DAYS,
    dryRun,
  });

  // Step 1: Collect all root hashes: the executions' from what the prune kept
  const roots = await collectAllRoots(storage.repos, repo, history.roots);

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
  // the record trees — cleanupPartials above only covers objects/ and the
  // staged transfers — and beside the repository's own record, at the root.
  // The root holds the trees and what the other steps sweep, so it is swept
  // without being walked.
  const partialNow = Date.now();
  for (const [refRoot, walk] of [
    ['', false], ['packages', true], ['workspaces', true], ['executions', true],
    ['dataflows', true], ['adoptions', true], ['locks', true],
  ] as const) {
    try {
      const result = await cleanupRefTreePartials(path.join(repo, refRoot), partialNow, minAge, dryRun, walk);
      deletedPartials += result.deleted;
      partialSkippedYoung += result.skippedYoung;
    } catch {
      // Not a fatal error
    }
  }

  // Step 5: Remove the scratch directories of executions whose orchestrator
  // has exited, and the built environments the mark no longer reached
  // (local-only concerns)
  if (!dryRun) {
    try {
      await sweepScratchDirs(repo);
    } catch {
      // Not a fatal error
    }
    try {
      await sweepEnvironments(repo, reachable);
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
    deletedRuns: history.deletedRuns,
    deletedExecutions: history.deletedExecutions,
  };
}

/**
 * Clean up orphaned .partial staging files in the objects directory — both
 * the per-prefix stages of whole-object writes and the root-level
 * `stage.*.partial` files of streaming writes (which cannot stage under a
 * prefix: the content path is unknown until the digest names it) — and the
 * transfers staged in {@link transferStagingDir}, which a transfer that was
 * never finished leaves behind and nothing else removes.
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

  // Transfers staged under the repository. An in-flight upload is young, so
  // the same age gate keeps gc from racing it.
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
 * Unlink aged `.partial` staging files in a directory, and in every directory
 * beneath it when it is walked.
 *
 * `atomicWriteFile` stages bytes in a sibling `<dest>.<rand>.partial` file
 * before renaming it over the destination; that staging file survives only if a
 * writer crashed between the write and the rename. This sweeps those orphans
 * from the record trees (packages/, workspaces/ — including nested dataset
 * refs —, executions/, dataflows/, adoptions/, locks/) and the repository's
 * root, which {@link cleanupPartials} does not cover. The age gate ensures a
 * live, in-flight staging file is never raced.
 *
 * @param rootDir - The directory to sweep
 * @param now - Reference timestamp for the age gate
 * @param minAge - Minimum age (ms) before a staging file is eligible for removal
 * @param dryRun - When true, count but do not delete
 * @param walk - Whether the directories beneath it are swept too
 * @returns Counts of deleted and too-young-to-delete staging files
 */
async function cleanupRefTreePartials(
  rootDir: string,
  now: number,
  minAge: number,
  dryRun: boolean,
  walk: boolean
): Promise<{ deleted: number; skippedYoung: number }> {
  let deleted = 0;
  let skippedYoung = 0;

  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => null);
  if (!entries) return { deleted, skippedYoung }; // Root directory doesn't exist

  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (!walk) continue;
      const sub = await cleanupRefTreePartials(full, now, minAge, dryRun, walk);
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
