/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Record object types for e3.
 *
 * An `e3.record` is a root dataset whose writes go through named, typed, pure
 * East **mutations** rather than blind replace. Each committed mutation appends
 * a content-addressed commit object, so a record's history is a git-style chain
 * — the audit trail of who changed what, when, superseding which state.
 *
 * The record's current state is an ordinary `value` dataset ref. Its `hash`
 * names the state or, once the record declares an index, a `$record` state
 * naming it, and every read path resolves it, so task inputs, `e3 get` and the
 * UI `Data.bind` read work on records unchanged. Only the write protocol
 * differs.
 */

import {
  ArrayType, BooleanType, DateTimeType, DictType, EastTypeType, FunctionType, NullType,
  OptionType, PatchType, StringType, StructType, VariantType,
  decodeBeast2For, dictPatchOpsType, setPatchOpsType, toEastTypeValue,
  type EastType, type EastTypeValue, type PatchTypeOf, type ValueTypeOf,
} from '@elaraai/east';
import { RunnerType } from './runner.js';

/**
 * A single commit in a record's history.
 *
 * Commits are ordinary content-addressed objects; a typical one is a few
 * hundred bytes. The record ref's version-vector self-entry carries the commit
 * hash (not the state hash), so change detection is commit-granular and there
 * is no ABA even when a mutation reproduces an earlier state.
 */
export const RecordCommitType = StructType({
  /** Previous commit hash; none for the genesis commit. */
  parent: OptionType(StringType),
  /** Hash of the state blob this commit produced (== the ref's value.hash). */
  state: StringType,
  /** Mutation name; `$init` for genesis, `$compact` for snapshot rewrites. */
  mutation: StringType,
  /** Hash of the beast2-encoded args tuple; none when the mutation has no args. */
  args: OptionType(StringType),
  /** Caller identity (auth principal / `cli:<user>`); best-effort string. */
  actor: StringType,
  /** Commit wall-clock time. */
  at: DateTimeType,
  /** The mutation delta this commit applied: one sorted collection of the
   *  primary and index changes, addressed by key. History then shows WHAT
   *  changed without diffing two states, and an undo can be synthesised from
   *  it. No state depends on it — every state past and present reads
   *  identically if every delta were deleted — but it is a collection like any
   *  other, a manifest naming segment objects, so a collector walks it as a
   *  value rather than marking it as a leaf the way it marks `args`. */
  delta: OptionType(StringType),
});
export type RecordCommitType = typeof RecordCommitType;
export type RecordCommit = ValueTypeOf<typeof RecordCommitType>;

const decodeCurrentCommit = decodeBeast2For(RecordCommitType);

/**
 * Decode a `RecordCommit`.
 *
 * @remarks
 * Stored state, so it changes by hard cutover: a repository an older e3 wrote
 * is re-created rather than read, and this says so.
 *
 * @param data - the stored bytes
 * @returns the commit
 * @throws {Error} When the bytes are not a current commit — one an older e3
 *   wrote, whose repository is re-created.
 */
export function decodeRecordCommit(data: Uint8Array): RecordCommit {
  try {
    return decodeCurrentCommit(data);
  } catch (err) {
    throw new Error(
      `the record commit does not decode: an older e3 wrote this repository — re-create it: deploy again and import its data again ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * A mutation: the write half of the function machinery (CQRS — `e3.function`
 * is the read/query half). A mutation is a pure East reducer
 * `(State, ...Args) => State` run where the data is, in a compare-and-swap
 * retry loop. Its output type IS the owning record's type, so — unlike a
 * {@link FunctionObjectType} — there is no separate `outputType` field.
 */
export const MutationObjectType = StructType({
  /** Hash of the encoded EastIR bundle (encodeEastIR), like a function's bodyIr. */
  bodyIr: StringType,
  /** The EXTRA positional parameter types after the state parameter. */
  argTypes: ArrayType(EastTypeType),
  /** Author-chosen runtime the mutation's unit runs on. */
  runner: RunnerType,
  /** Which write form this is — see {@link MutationForm}. */
  form: StringType,
  /** Hash of the generated program's IR bundle: the one thing that actually
   *  runs, whatever the form. For the `patch` form `bodyIr` names it too,
   *  there being no author body. */
  programIr: StringType,
});
export type MutationObjectType = typeof MutationObjectType;
export type MutationObject = ValueTypeOf<typeof MutationObjectType>;

/**
 * How a mutation says what it changed.
 *
 * - `reduce` — `(State, …Args) => State`, the original surface. Its body and
 *   its diff see the whole state, so its RUNNER cost stays O(state); only its
 *   write, on a Dict or Set record, is O(touched).
 * - `edit` — `(State, …Args, Edit) => Null`, the lazy write: the body reads the
 *   state it is given, lazily, and writes through an `edit` capability, so the
 *   body reads only the entries it touches and the commit rewrites only the
 *   segments they live in. The state reaches the runner as its manifest, the
 *   segments linked, so nothing on the way reads it whole either.
 * - `patch` — no body; the argument is `PatchType(State)`. What an interactive
 *   edit from a view sends. On a record with no index a patch of per-key
 *   changes runs nothing at all, the only write whose cost is independent of
 *   the record's size.
 */
export type MutationForm = 'reduce' | 'edit' | 'patch';

const decodeCurrentMutation = decodeBeast2For(MutationObjectType);

/**
 * Decode a `MutationObject`.
 *
 * @remarks
 * A package-borne wire, so it changes by hard cutover: a package exported by
 * an older SDK is re-exported with the current one, and this says so.
 *
 * @param data - the stored bytes
 * @returns the mutation object
 * @throws {Error} When the bytes are not a current mutation object — a package
 *   exported by an older SDK, which is re-exported with the current one.
 */
export function decodeMutationObject(data: Uint8Array): MutationObject {
  try {
    return decodeCurrentMutation(data);
  } catch (err) {
    throw new Error(
      `the mutation object does not decode: the package was exported by an older e3 SDK — re-export it with the current one ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * A secondary index over a record: an East function of an entry, and the
 * collection it builds.
 *
 * An index is a second canonical collection whose sort order IS the query
 * order, stored as a segment manifest exactly like the primary and maintained
 * inside the same commit — so a view by an attribute of the row, or by a
 * related entity a row names many of, is a page rather than a scan.
 *
 * The functions are pure for the reason a reducer is: they run again on every
 * commit and in every bulk build, and a maintained index must equal a rebuilt
 * one to the byte.
 */
export const RecordIndexObjectType = StructType({
  /** Hash of the encoded EastIR bundle: `(K, V) -> IK`, or `-> Set<IK>` when
   *  {@link multi}. */
  keyIr: StringType,
  /** Declared with `keys` (a Set return) rather than `key`: one entry per
   *  element, so a row that names five resources appears under five keys. */
  multi: BooleanType,
  /** Hash of the covering projection's IR bundle, `(K, V) -> P`; none when the
   *  index carries no value and `P` is Null. */
  valueIr: OptionType(StringType),
  /** `IK` — the index key an entry sorts under. */
  keyType: EastTypeType,
  /** `P` — the covering projection's type; Null when there is none. */
  valueType: EastTypeType,
  /** Hash of the generated build program's IR bundle: `(piece, emit) =>
   *  Null`, which emits the index entries of a piece of the primary, in any
   *  order. */
  buildIr: StringType,
  /** Author-chosen runtime the index's functions run on. */
  runner: RunnerType,
});
export type RecordIndexObjectType = typeof RecordIndexObjectType;
export type RecordIndexObject = ValueTypeOf<typeof RecordIndexObjectType>;

/**
 * A migration: one step of a record's declared chain, which a deploy runs over
 * a workspace's state that has not applied it.
 *
 * @remarks
 * A step changes the record's type, or keeps the type and changes its values.
 * The chain is the record object's `migrations`, in order, and a workspace's
 * record ref names the steps it has applied by name, never by this object's
 * hash: the hash covers the step's IR, which carries source locations and
 * changes with the SDK that exported it, so an unchanged step would read as
 * edited.
 */
export const MigrationObjectType = StructType({
  /** Which form this is — see {@link MigrationForm}. */
  form: StringType,
  /** The record's type before the step. */
  from: EastTypeType,
  /** The record's type after it. */
  to: EastTypeType,
  /** Hash of the author's function's IR bundle, which a `value` step runs. */
  bodyIr: StringType,
  /** Hash of the generated program's IR bundle, `(piece, emit) => Null`,
   *  which a `rows` or `rekey` step runs over each piece of the state; empty
   *  for a `value` step. */
  programIr: StringType,
  /** Author-chosen runtime the step runs on. */
  runner: RunnerType,
});
export type MigrationObjectType = typeof MigrationObjectType;
export type MigrationObject = ValueTypeOf<typeof MigrationObjectType>;

/**
 * How a migration says what it changes.
 *
 * - `value` — `(Old) => New`, the whole state: one unit, whose runner opens the
 *   state lazily, so it costs what the body reads.
 * - `rows` — a Dict's rows, `(K, V1) => V2` with the keys unchanged, or an
 *   Array's elements, `(T1) => T2` in order: a task split over the state, a
 *   piece at a time.
 * - `rekey` — a Dict's entries, `(K1, V1) => { key: K2, value: V2 }`, or a
 *   Set's elements, `(T1) => T2`: the same split task, whose pieces' outputs
 *   merge by key. Two rows landing on one key fail, naming it; two elements
 *   landing on one are one element.
 */
export type MigrationForm = 'value' | 'rows' | 'rekey';

const decodeCurrentMigration = decodeBeast2For(MigrationObjectType);

/**
 * Decode a `MigrationObject`.
 *
 * @remarks
 * A package-borne wire, so it changes by hard cutover: a package exported by
 * an older SDK is re-exported with the current one, and this says so.
 *
 * @param data - the stored bytes
 * @returns the migration object
 * @throws {Error} When the bytes are not a current migration object — a
 *   package exported by an older SDK, which is re-exported with the current
 *   one.
 */
export function decodeMigrationObject(data: Uint8Array): MigrationObject {
  try {
    return decodeCurrentMigration(data);
  } catch (err) {
    throw new Error(
      `the migration object does not decode: the package was exported by an older e3 SDK — re-export it with the current one ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * Record object stored in the object store, referenced by name from
 * `PackageObject.records`. Carries the record's dataset path, its mutations,
 * its secondary indexes and its migration chain.
 */
export const RecordObjectType = StructType({
  /** refPath of the record's dataset, e.g. `records/orders`. */
  path: StringType,
  /** Mutations by name -> MutationObject hash. */
  mutations: DictType(StringType, StringType),
  /** Secondary indexes by name -> RecordIndexObject hash. */
  indexes: DictType(StringType, StringType),
  /** The declared migration chain, in order: each step's name, an identifier
   *  unique on the record, and its MigrationObject hash. Empty when the
   *  record declares none. */
  migrations: ArrayType(StructType({ name: StringType, migration: StringType })),
});
export type RecordObjectType = typeof RecordObjectType;
export type RecordObject = ValueTypeOf<typeof RecordObjectType>;

const decodeCurrentRecord = decodeBeast2For(RecordObjectType);

/**
 * Decode a `RecordObject`.
 *
 * @remarks
 * A package-borne wire, so it changes by hard cutover: a package exported by
 * an older SDK is re-exported with the current one, and this says so.
 *
 * @param data - the stored bytes
 * @returns the record object
 * @throws {Error} When the bytes are not a current record object — a package
 *   exported by an older SDK, which is re-exported with the current one.
 */
export function decodeRecordObject(data: Uint8Array): RecordObject {
  try {
    return decodeCurrentRecord(data);
  } catch (err) {
    throw new Error(
      `the record object does not decode: the package was exported by an older e3 SDK — re-export it with the current one ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/** The `kind` tag a record's state object carries once the record has an
 *  index: what tells a reader that the ref names a table of manifests rather
 *  than one of them. */
export const RECORD_STATE_KIND = '$record';

/**
 * A record's state when it has secondary indexes: one small object naming the
 * primary's manifest and every index's.
 *
 * @remarks
 * One state object, one commit, one conditional ref write — so the primary and
 * every index are consistent at every commit, history carries them, reading at
 * an older commit resolves them, compaction keeps them by copying one hash,
 * and the collector walks them. A record with no index keeps the plain
 * manifest, so this is additive: the door that resolves a record's state
 * accepts either.
 */
export const RecordStateType = StructType({
  /** Always {@link RECORD_STATE_KIND}. */
  kind: StringType,
  /** CollectionManifest hash of the primary. */
  primary: StringType,
  /** Index name -> the manifest it is held in and the index object it was
   *  built under. Deploy compares the second against the package's to decide
   *  whether an index is built, dropped or kept. */
  indexes: DictType(StringType, StructType({
    /** CollectionManifest hash of the index collection. */
    manifest: StringType,
    /** RecordIndexObject hash the index was built under. */
    index: StringType,
  })),
});
export type RecordStateType = typeof RecordStateType;
export type RecordState = ValueTypeOf<typeof RecordStateType>;

/** The record state's field names, in wire order — read from the type itself
 *  so the recognizer and the type cannot drift. */
const RECORD_STATE_FIELDS: readonly string[] =
  (toEastTypeValue(RecordStateType).value as { name: string }[]).map((f) => f.name);

/**
 * Whether a decoded object is a record's `$record` state.
 *
 * @remarks
 * Matched on the exact field set plus the tag, as every object recognizer is:
 * a record's own state is an arbitrary user struct flowing through the same
 * dispatch, and misreading one as a state table would probe its fields as
 * object hashes.
 *
 * @param typeValue - the object's decoded root type
 * @param value - the decoded value, when the tag is to be checked too
 * @returns whether the object is a record state
 */
export function isRecordStateType(typeValue: EastTypeValue, value?: unknown): boolean {
  if (typeValue.type !== 'Struct') return false;
  const fields = typeValue.value as { name: string }[];
  if (fields.length !== RECORD_STATE_FIELDS.length
    || !fields.every((f, i) => f.name === RECORD_STATE_FIELDS[i])) return false;
  return value === undefined || (value as RecordState | null)?.kind === RECORD_STATE_KIND;
}

/**
 * The collection an index is held in: `Dict<{ik, k}, P>`.
 *
 * @remarks
 * `ik` first, so every entry with one index key is a contiguous run — ordered
 * by primary key inside it — and a RANGE of index keys is one contiguous run
 * too. `k` makes the entry unique and gives the run its inner order.
 *
 * @param keyType - the record's primary key type, `K`
 * @param indexKeyType - the index key the function computes, `IK`
 * @param valueType - the covering projection's type, `P`
 * @returns the index collection's East type
 */
export function indexCollectionType(keyType: EastType, indexKeyType: EastType, valueType: EastType): EastType {
  return DictType(StructType({ ik: indexKeyType, k: keyType }), valueType);
}

/**
 * The op type of one target's changes: what one touched key carries.
 *
 * @remarks
 * Exactly the op type of that target's own `PatchType`, which is what makes
 * applying a delta's run for one target literally
 * `applyFor(targetType)(segment, variant('patch', ops))` — `ConflictError` and
 * all — rather than a second apply implementation that could disagree with the
 * first.
 *
 * @param collectionType - the target's collection type (a Dict or a Set)
 * @returns the op variant for one key of it
 * @throws {Error} When the type is not a Dict or a Set — the kinds whose
 *   patches are sparse and addressed by key.
 */
export function patchOpsType(collectionType: EastType): EastType {
  const collection = collectionType as unknown as { type: string; key: EastType; value: EastType };
  if (collection.type === 'Dict') return dictPatchOpsType(collection.value);
  if (collection.type === 'Set') return setPatchOpsType(collection.key);
  throw new Error(
    `a mutation delta addresses Dict and Set targets by key; this one holds ${collection.type}`,
  );
}

/** One target of a mutation delta: its name, its key and its op type. */
export interface DeltaTarget {
  /** `primary`, or an index name. */
  name: string;
  /** The key the target is addressed by — `K` for the primary, `{ik, k}` for
   *  an index. */
  keyType: EastType;
  /** The target's own collection type, whose patch ops the arm carries. */
  collectionType: EastType;
}

/**
 * The case of a mutation delta that says the write went stale: its key says
 * what went stale, in words, and its op is Null.
 *
 * @remarks
 * A write reaches the record two ways — the program emits a delta and the
 * engine applies it, or the engine applies the client's patch directly — and
 * both meet the same situation: an op that disagrees with the state it lands
 * on. The apply reports it as a conflict, which a caller retries. A program
 * that meets it — a patch whose `before` the record no longer holds, an
 * update of a row that no longer matches, a delete of a key the record does
 * not hold — emits one of these rather than failing, which a caller would not
 * retry. The name sorts before every target's, since index names are
 * identifiers, so a stale delta says so in its first entry.
 */
export const DELTA_CONFLICT = '$conflict';

/**
 * The type of a mutation delta: every target's changes in ONE sorted
 * collection.
 *
 * @remarks
 * One variant case per target — `primary` plus one per declared index, which
 * is why `primary` is a reserved index name — and {@link DELTA_CONFLICT}, which
 * sorts first. Canonical order puts every target's ops in one contiguous run,
 * in that target's own key order, so the apply takes the delta one target at
 * a time, a segment at a time, and a delta is a pageable collection like any
 * other.
 *
 * Derived on demand and never stored as a type: a delta blob is
 * self-describing, and deriving it means it cannot drift from the record's
 * declarations.
 *
 * @param targets - the primary and each index, in canonical case order
 * @returns `Dict<DeltaKey, DeltaOp>`
 */
export function mutationDeltaType(targets: readonly DeltaTarget[]): EastType {
  const keys: Record<string, EastType> = { [DELTA_CONFLICT]: StringType };
  const ops: Record<string, EastType> = { [DELTA_CONFLICT]: NullType };
  for (const target of targets) {
    keys[target.name] = target.keyType;
    ops[target.name] = patchOpsType(target.collectionType);
  }
  return DictType(VariantType(keys), VariantType(ops));
}

/**
 * The `edit` capability an edit-form mutation writes through.
 *
 * @remarks
 * An edit body reads the state it is given — lazily, the frozen pager-backed
 * value every runner already serves — and writes through these three
 * functions; it never returns a state, so its commit rewrites only the
 * segments the entries it touched live in.
 *
 * Repeated edits of one key fold: `set` after anything is that `set`; `update`
 * after `set` applies to the set value; `update` after `update` composes;
 * `delete` after anything is `delete`. A `set` of the value the state already
 * holds is no change, and a `delete` or `update` of a key the state does not
 * hold is a conflict naming the key, as an apply's would be.
 *
 * The Dict overload carries the struct's shape into TypeScript, so a body that
 * declares `editTypeOf(record.type)` as its last parameter gets `edit.set`,
 * `edit.delete` and `edit.update` typed against the record's own key and row.
 *
 * @param recordType - the record's state type, a Dict
 * @returns the struct of edit functions
 * @throws {Error} When the record's root is not a Dict.
 */
export function editTypeOf<K extends EastType, V extends EastType>(recordType: DictType<K, V>): StructType<{
  set: FunctionType<[K, V], NullType>;
  delete: FunctionType<[K], NullType>;
  update: FunctionType<[K, PatchTypeOf<V>], NullType>;
}>;
export function editTypeOf(recordType: EastType): EastType;
export function editTypeOf(recordType: EastType): EastType {
  const dict = recordType as unknown as { type: string; key: EastType; value: EastType };
  if (dict.type !== 'Dict') {
    throw new Error(`an edit mutation writes a Dict record; this one holds ${dict.type}`);
  }
  return StructType({
    set: FunctionType([dict.key, dict.value], NullType),
    delete: FunctionType([dict.key], NullType),
    update: FunctionType([dict.key, PatchType(dict.value)], NullType),
  });
}

/**
 * One window of an index read: an ORDERED array, never a dict.
 *
 * @remarks
 * A Dict value re-sorts by its own key, which would throw away the index order
 * the page was asked for — so the wire type of an index window is positional,
 * in index order, carrying every key the client may need. Whatever renders an
 * index-ordered view consumes this shape; it is a contract the data layer sets
 * and the UI meets, not the reverse.
 *
 * @param keyType - the record's primary key type, `K`
 * @param indexKeyType - the index key, `IK`
 * @param valueType - the covering projection's type, `P`
 * @param rowType - the record's row type, `V`
 * @returns the window's East type
 */
export function indexWindowType(keyType: EastType, indexKeyType: EastType, valueType: EastType, rowType: EastType): EastType {
  return ArrayType(StructType({
    /** The index key. */
    ik: indexKeyType,
    /** The primary key, so a client can address the row it came from. */
    key: keyType,
    /** The covering projection; Null when the index carries none. */
    value: valueType,
    /** The primary row — `some(...)` when the read asked for a join. */
    row: OptionType(rowType),
  }));
}
