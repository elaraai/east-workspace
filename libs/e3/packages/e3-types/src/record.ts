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
 * The record's current state is an ordinary `value` dataset ref (its `hash`
 * points at the plain state blob), so every existing read path — task inputs,
 * `e3 get`, the UI `Data.bind` read — works on records unchanged. Only the
 * write protocol differs.
 */

import {
  ArrayType, BooleanType, DateTimeType, DictType, EastTypeType, OptionType, StringType,
  StructType, decodeBeast2For, toEastTypeValue,
  type EastType, type EastTypeValue, type ValueTypeOf,
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
});
export type RecordCommitType = typeof RecordCommitType;
export type RecordCommit = ValueTypeOf<typeof RecordCommitType>;

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
  /** Author-chosen runtime; resolved to argv by runnerToArgv. */
  runner: RunnerType,
});
export type MutationObjectType = typeof MutationObjectType;
export type MutationObject = ValueTypeOf<typeof MutationObjectType>;

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
  /** Hash of the generated build program's IR bundle: `(slice, emit) => Null`,
   *  which emits the index entries of one slice of the primary. */
  buildIr: StringType,
  /** Author-chosen runtime the index's functions run on. */
  runner: RunnerType,
});
export type RecordIndexObjectType = typeof RecordIndexObjectType;
export type RecordIndexObject = ValueTypeOf<typeof RecordIndexObjectType>;

/**
 * Record object stored in the object store, referenced by name from
 * `PackageObject.records`. Carries the record's dataset path, its mutations
 * and its secondary indexes.
 */
export const RecordObjectType = StructType({
  /** refPath of the record's dataset, e.g. `records/orders`. */
  path: StringType,
  /** Mutations by name -> MutationObject hash. */
  mutations: DictType(StringType, StringType),
  /** Secondary indexes by name -> RecordIndexObject hash.
   *  BEAST2 encodes struct fields positionally in declaration order, so new
   *  fields MUST be appended LAST — never inserted between existing fields. */
  indexes: DictType(StringType, StringType),
});
export type RecordObjectType = typeof RecordObjectType;
export type RecordObject = ValueTypeOf<typeof RecordObjectType>;

/**
 * The pre-`indexes` record object wire shape, kept only so
 * {@link decodeRecordObject} can read records deployed before secondary
 * indexes existed.
 */
const MutationsEraRecordObjectType = StructType({
  path: StringType,
  mutations: DictType(StringType, StringType),
});

const decodeCurrentRecord = decodeBeast2For(RecordObjectType);
const decodeMutationsEraRecord = decodeBeast2For(MutationsEraRecordObjectType);

/**
 * Decode a `RecordObject`, tolerating the shapes that predate its appended
 * fields.
 *
 * @remarks
 * Every record-read path — local AND cloud — must use this rather than
 * `decodeBeast2For(RecordObjectType)`. A struct is encoded positionally, so a
 * record object written before `indexes` existed simply ends early; read
 * through the current decoder it fails, and a record that fails to decode is a
 * record whose mutations go unmarked by the collector and whose bodies the
 * next sweep deletes.
 *
 * @param data - the stored bytes
 * @returns the record object, with absent maps defaulted to empty
 * @throws {Error} When the bytes are no known record-object shape — the
 *   current format's error, not the oldest one's.
 */
export function decodeRecordObject(data: Uint8Array): RecordObject {
  try {
    return decodeCurrentRecord(data);
  } catch (err) {
    try {
      return { ...decodeMutationsEraRecord(data), indexes: new Map() };
    } catch {
      throw err; // no known shape — surface the current-format error
    }
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
