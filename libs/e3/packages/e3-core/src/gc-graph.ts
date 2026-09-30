/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What an object names, as gc finds it: the mark from a set of roots, and the
 * re-reference of an object graph a caller roots without writing it.
 *
 * gc's mark ({@link markReachable}) and a caller rooting objects it did not
 * write ({@link touchReachable}) walk the same graph by the same rules: a
 * kind-tagged object by its tag, any other by its shape, and a dataset value
 * classified from its head. Both reach storage only through its interfaces.
 */

import { decodeBeast2, readBeast2Type, toEastTypeValue, type EastType, type EastTypeValue } from '@elaraai/east';
import { COLLECTION_MANIFEST_KIND, CollectionManifestType, EnvironmentSpecType, FunctionObjectType, MigrationObjectType, MutationObjectType, PackageObjectType, RECORD_STATE_KIND, RecordCommitType, RecordIndexObjectType, RecordObjectType, RecordStateType, TASK_OBJECT_KIND, TaskObjectType, UNIT_PLAN_KIND, UnitPlanType, environmentSpecObjectHashes, type CollectionManifest, type EnvironmentSpec, type FunctionObject, type MigrationObject, type MutationObject, type PackageObject, type RecordCommit, type RecordIndexObject, type RecordObject, type RecordState, type TaskObject, type UnitPlan } from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, TOUCH_BATCH, eachAtMost } from './concurrency.js';
import { GcReadError, ObjectNotFoundError } from './errors.js';
import type { StorageBackend } from './storage/interfaces.js';

/** Head read sizes the header-first mark tries, in order — the sequence
 *  `readBeast2HeaderType` uses. */
const HEAD_PROBE_BYTES = [64 * 1024, 1024 * 1024, 16 * 1024 * 1024];

/** How many batches of re-references {@link touchReachable} has in flight at
 *  once. */
const TOUCH_BATCHES_AT_ONCE = 4;

/**
 * How long a read that finds nothing, right after a touch found the object,
 * waits before it looks once more ({@link readTouched}): a local store's
 * delete that raced the touch has the object aside for a moment, and puts it
 * back once it finds the note the touch cleared gone
 * (`LocalRepoStore.gcDeleteUnreachable`).
 */
const TOUCHED_REREAD_MS = 50;

/**
 * Options for {@link markReachable}.
 */
export interface MarkReachableOptions {
  /**
   * Reads the first `length` bytes of an object (fewer when the object is
   * shorter), or returns null when it does not exist, and rejects on any other
   * failure. With it the mark is header-first: an object's type is read from
   * its head, and only an object of a structural shape — one that names other
   * objects — is read whole; every other object is marked without being read.
   * Without it every object the mark visits is read whole, so a sweep reads
   * every dataset it reaches — still classified by its type before anything is
   * decoded.
   */
  readHead?: (hash: string, length: number) => Promise<Uint8Array | null>;
  /**
   * How many objects the mark reads at once: {@link OBJECT_CONCURRENCY} unless
   * set. On a store elsewhere each read is a request, and a mark that read one
   * at a time would wait on the store's latency for every object it visits.
   */
  concurrency?: number;
}

/** Options for {@link markFrom}: those of {@link markReachable}, and when to
 *  stop. */
export interface MarkFromOptions extends MarkReachableOptions {
  /**
   * Asked before each visit after the first: once it answers true, the mark
   * starts no more visits, and returns once those in flight have settled, with
   * what it had still to visit.
   */
  until?: () => boolean;
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
 * Only an object's absence is `null`. A read that fails for any other reason
 * leaves what the object names unknown, and so does an object of a shape that
 * names other objects which does not decode: either stops the mark, naming the
 * object, since a sweep after an incomplete mark would delete what that object
 * keeps. An object whose header is not beast2 names nothing, and is a leaf.
 *
 * The mark reads {@link MarkReachableOptions.concurrency} objects at once, a
 * visit each from what it has still to visit.
 *
 * @param readObject - Reads an object whole by its hash: resolves `null` when
 *   the object does not exist, and rejects on any other failure
 * @param roots - Set of root hashes to start from
 * @param options - Header-first classification, and how many reads at once
 * @returns Set of all reachable hashes
 * @throws {GcReadError} When an object cannot be read for a reason other than
 *   its absence, or is of a shape that names other objects and does not decode
 */
export async function markReachable(
  readObject: (hash: string) => Promise<Uint8Array | null>,
  roots: Set<string>,
  options: MarkReachableOptions = {}
): Promise<Set<string>> {
  const reachable = new Set<string>();
  await markFrom(readObject, reachable, [...roots], options);
  return reachable;
}

/**
 * Goes on with a mark ({@link markReachable}): visits what `pending` holds,
 * and what each visit finds, adding what it reaches to `reachable`, until
 * nothing is left to visit or `options.until` says to stop.
 *
 * @remarks
 * Marking and visiting are separate: a dataset value is marked the moment its
 * ref names it, and is visited afterwards to find the segment objects a
 * manifest names. So what a mark has reached, with what it has still to visit,
 * is all it needs to go on: an object reached and not left to visit has been
 * visited, or needs no visit. A mark stopped between visits hands both over,
 * and one given them visits what the stopped one would have, which is how gc
 * beside running work spreads its mark over steps.
 *
 * At least one object is visited before `until` is asked, so a mark always
 * gets on. A read that fails stops the mark once the reads in flight have
 * settled.
 *
 * @param readObject - Reads an object whole, as {@link markReachable} takes it
 * @param reachable - What the mark has reached so far, which it adds to
 * @param pending - What the mark has still to visit, which it takes from and
 *   adds to; on return, only what it has not visited
 * @param options - Header-first classification, how many reads at once, and
 *   when to stop
 * @returns Whether nothing is left to visit
 * @throws {GcReadError} As {@link markReachable} does.
 * @internal
 */
export async function markFrom(
  readObject: (hash: string) => Promise<Uint8Array | null>,
  reachable: Set<string>,
  pending: string[],
  options: MarkFromOptions = {},
): Promise<boolean> {
  const left = new Set(pending);
  const visited = new Set<string>();
  for (const hash of reachable) if (!left.has(hash)) visited.add(hash);

  const visit = async (hash: string): Promise<void> => {
    if (options.readHead) {
      const head = await readHeadType(options.readHead, hash);
      if (head.missing) return;
      if (head.type === null || !isStructuralShape(head.type)) {
        reachable.add(hash); // a leaf: marked without being read
        return;
      }
    }

    const data = await naming(hash, () => readObject(hash));
    if (data === null) return;
    reachable.add(hash);

    // Without head reads the object had to be read whole to be classified,
    // but it is classified all the same before it is decoded: a dataset of any
    // size is decoded only when it is a shape that names other objects.
    if (!options.readHead) {
      let type: EastTypeValue;
      try {
        type = readBeast2Type(data);
      } catch {
        return; // Not beast2: it names nothing — a leaf
      }
      if (!isStructuralShape(type)) return;
    }

    // A shape that names other objects is decoded to find them. One that does
    // not decode names objects that cannot be known, which a sweep would then
    // delete: the mark stops instead.
    let children: { hash: string; kind: GcChildKind }[];
    try {
      const decoded = decodeBeast2(Buffer.from(data));
      children = extractChildren(decoded.type, decoded.value);
    } catch (err) {
      throw new GcReadError(hash, messageOf(err), true);
    }

    for (const child of children) {
      if (child.kind === 'leaf') {
        reachable.add(child.hash); // Mark without reading
        continue;
      }
      if (child.kind === 'value') {
        reachable.add(child.hash);
        pending.push(child.hash);
        continue;
      }
      if (!visited.has(child.hash)) pending.push(child.hash);
    }
  };

  const width = Math.max(1, options.concurrency ?? OBJECT_CONCURRENCY);
  const inFlight = new Set<Promise<void>>();
  const failures: unknown[] = [];
  let visits = 0;
  for (;;) {
    while (failures.length === 0 && inFlight.size < width && pending.length > 0 && !(visits > 0 && options.until?.() === true)) {
      const hash = pending.pop()!;
      if (visited.has(hash)) continue;
      visited.add(hash);
      visits++;
      const visiting: Promise<void> = visit(hash)
        .catch((error: unknown) => { failures.push(error); })
        .finally(() => { inFlight.delete(visiting); });
      inFlight.add(visiting);
    }
    if (inFlight.size === 0) break;
    await Promise.race(inFlight);
  }
  if (failures.length > 0) throw failures[0];

  // What is left is only what has not been visited: a hash pushed twice may
  // have been visited from its other place.
  let kept = 0;
  for (const hash of pending) {
    if (!visited.has(hash)) pending[kept++] = hash;
  }
  pending.length = kept;
  return kept === 0;
}

/**
 * What an object's head says it is: missing, or the root type its header
 * declares — `null` when no probe yields one.
 */
type HeadType =
  | { readonly missing: true }
  | { readonly missing: false; readonly type: EastTypeValue | null };

/**
 * The root type an object's header declares, read through growing head
 * probes: `null` when no probe yields one (not beast2, or a malformed or
 * implausibly large type section — a leaf).
 *
 * @throws {GcReadError} When a head read fails for any reason but the object's
 *   absence.
 */
async function readHeadType(
  readHead: (hash: string, length: number) => Promise<Uint8Array | null>,
  hash: string
): Promise<HeadType> {
  for (const probe of HEAD_PROBE_BYTES) {
    const head = await naming(hash, () => readHead(hash, probe));
    if (head === null) return { missing: true };
    try {
      return { missing: false, type: readBeast2Type(head) };
    } catch {
      // A short head fails like a malformed one: grow, unless this head was
      // already the whole object.
      if (head.length < probe) return { missing: false, type: null };
    }
  }
  return { missing: false, type: null };
}

/**
 * Runs a read of an object, naming the object in its failure: a read that
 * fails for any reason but the object's absence leaves what the object names
 * unknown.
 *
 * @throws {GcReadError} When the read rejects.
 */
async function naming<T>(hash: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    throw err instanceof GcReadError ? err : new GcReadError(hash, messageOf(err));
  }
}

/** An error's message. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
const MIGRATION_OBJECT_FIELDS = namesOf(MigrationObjectType);
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
    || isStructOf(t, RECORD_COMMIT_FIELDS) || isTreeObjectShape(t) || isStructOf(t, RECORD_INDEX_OBJECT_FIELDS)
    || isStructOf(t, MIGRATION_OBJECT_FIELDS);
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
    for (const step of rec.migrations) {
      children.push({ hash: step.migration, kind: 'node' });
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

  if (isStructOf(t, MIGRATION_OBJECT_FIELDS)) {
    const step = value as MigrationObject;
    children.push({ hash: step.bodyIr, kind: 'leaf' }); // IR is a leaf
    // A value step runs its own function, and names no program.
    if (step.programIr !== '') children.push({ hash: step.programIr, kind: 'leaf' });
    return children;
  }

  if (isEnvironmentSpecShape(t)) {
    // Every file the spec names is a Blob that names nothing; an image names
    // no object at all.
    for (const hash of environmentSpecObjectHashes(value as EnvironmentSpec)) children.push({ hash, kind: 'leaf' });
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

// =============================================================================
// Reading objects, and re-referencing a graph
// =============================================================================

/**
 * The readers gc's mark goes through ({@link markReachable}): an object whole,
 * and its head, over a backend's object store.
 *
 * @remarks
 * Only an object's absence (`ObjectNotFoundError`) reads as `null`. Any other
 * failure — a store answering under load, a timeout, an expired credential —
 * leaves what the object names unknown, so it stops the mark rather than read
 * as absence, and a sweep after the mark never deletes what the object keeps.
 * A backend that retries its own transient failures does so beneath the
 * store's interface. A host that drives the mark itself reads through these,
 * so the rule is kept in one place.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @returns The whole-object reader and the head reader
 */
export function gcObjectReaders(storage: StorageBackend, repo: string): {
  readObject: (hash: string) => Promise<Uint8Array | null>;
  readHead: (hash: string, length: number) => Promise<Uint8Array | null>;
} {
  const absentAsNull = async (read: () => Promise<Uint8Array>): Promise<Uint8Array | null> => {
    try {
      return await read();
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return null;
      throw err;
    }
  };
  return {
    readObject: (hash) => absentAsNull(() => storage.objects.read(repo, hash)),
    readHead: (hash, length) => absentAsNull(() => storage.objects.readRange(repo, hash, 0, length)),
  };
}

/**
 * Re-reference objects a caller is about to root without writing them, and
 * every object each names, so gc beside running work never deletes them before
 * a ref names them.
 *
 * @remarks
 * A caller that roots an object by its hash — a record restored to an earlier
 * state, a delivery the adoption memo answers, a call's argument naming an
 * object — roots everything it names too, which may have been unreachable as
 * long. Each object is touched (`ObjectStore.touch`) before it is read,
 * and what it names is found as the mark finds it: a manifest's header and
 * segments, a record state's collections and index objects, a task's
 * programs. So a sweep that races the walk leaves everything it touched, and
 * an object gone before its touch makes the graph incomplete: the walk stops
 * and answers false.
 *
 * The walk goes a level of the graph at a time: it touches the level's objects
 * a batch at a time ({@link TOUCH_BATCH}, a few batches at once), then reads
 * those that may name others {@link OBJECT_CONCURRENCY} at once. A caller that
 * re-references a large collection — a transfer init's dedup, a split call's
 * job, a record's restore — so pays a request per batch of segments, not per
 * segment. A read that finds nothing, right after the object's touch found it,
 * looks once more a moment later ({@link TOUCHED_REREAD_MS}): a local delete
 * that raced the touch has the object aside, and puts it back.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param roots - The objects to re-reference
 * @returns true when the store holds every object reached, and false, once
 *   one is found gone
 * @throws {GcReadError} When an object cannot be read for a reason other than
 *   its absence, or names other objects and does not decode.
 */
export async function touchReachable(storage: StorageBackend, repo: string, roots: Iterable<string>): Promise<boolean> {
  const { readObject, readHead } = gcObjectReaders(storage, repo);
  const touched = new Set<string>();
  const walk = { gone: false };
  let level: { hash: string; kind: GcChildKind }[] = [...roots].map((hash) => ({ hash, kind: 'value' }));
  while (level.length > 0) {
    const fresh: { hash: string; kind: GcChildKind }[] = [];
    for (const object of level) {
      if (touched.has(object.hash)) continue;
      touched.add(object.hash);
      fresh.push(object);
    }

    // Each object touched before it is read, a batch at a time
    const batches: string[][] = [];
    for (let from = 0; from < fresh.length; from += TOUCH_BATCH) {
      batches.push(fresh.slice(from, from + TOUCH_BATCH).map(({ hash }) => hash));
    }
    await eachAtMost(batches, TOUCH_BATCHES_AT_ONCE, async (batch) => {
      if (walk.gone) return;
      if (!(await storage.objects.touch(repo, batch)).every((held) => held)) walk.gone = true;
    });
    if (walk.gone) return false;

    // What the ones that may name others name: a leaf names nothing, and is
    // never read
    const next: { hash: string; kind: GcChildKind }[] = [];
    await eachAtMost(fresh.filter(({ kind }) => kind !== 'leaf'), OBJECT_CONCURRENCY, async ({ hash }) => {
      if (walk.gone) return;
      const head = await readTouched(() => readHeadType(readHead, hash), (read) => read.missing);
      if (head.missing) {
        walk.gone = true;
        return;
      }
      if (head.type === null || !isStructuralShape(head.type)) return;
      const data = await readTouched(() => naming(hash, () => readObject(hash)), (read) => read === null);
      if (data === null) {
        walk.gone = true;
        return;
      }
      let children: { hash: string; kind: GcChildKind }[];
      try {
        const decoded = decodeBeast2(Buffer.from(data));
        children = extractChildren(decoded.type, decoded.value);
      } catch (err) {
        throw new GcReadError(hash, messageOf(err), true);
      }
      for (const child of children) next.push(child);
    });
    if (walk.gone) return false;
    level = next;
  }
  return true;
}

/**
 * A read of an object a touch has just found, made once more a moment later
 * when it finds nothing ({@link TOUCHED_REREAD_MS}): a local delete that raced
 * the touch has the object aside, and puts it back. What a caller rooting the
 * object reads right after its touch reads through this, so the moment never
 * reads as the object's absence.
 *
 * @param read - The read
 * @param missing - Whether what it read says the object is not there
 * @returns What the last read read
 * @internal
 */
export async function readTouched<T>(read: () => Promise<T>, missing: (read: T) => boolean): Promise<T> {
  const first = await read();
  if (!missing(first)) return first;
  await new Promise((resolve) => setTimeout(resolve, TOUCHED_REREAD_MS));
  return read();
}
