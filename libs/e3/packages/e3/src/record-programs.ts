/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The East programs a record's declarations generate.
 *
 * An author declares what an index keys on, how a mutation writes and how a
 * migration changes a row; what actually runs is a program built from those
 * declarations — an ordinary East function assembled at export time from the
 * author's own expressions, as a stream task's output kind builds its merge
 * function. It is linked and encoded like any other body, runs on the runner
 * the author chose, and is what keeps e3 out of the business of evaluating
 * user East: the engine runs a program and applies what it emits.
 *
 * Each program is assembled from typed East functions, each built from the
 * declaration's types: the record's key and row, an index's key and
 * projection, a mutation's arguments. Where a declaration chooses — a
 * mutation's form, whether its record has indexes, which kind each index is —
 * the choice is made as the program is built, never inside it. The author's
 * functions are bound as function values and CALLED, never spliced: a spliced
 * expression tree would be re-evaluated per reference and could capture the
 * wrong bindings.
 *
 * @packageDocumentation
 */

import {
  ArrayType, BooleanType, DictType, East, FunctionType, IntegerType, NullType, OptionType, PatchType, SetType, StructType,
  VariantType, none, printType, some, variant, withLocationCapture,
  type EastIR, type EastType, type FunctionExpr,
} from '@elaraai/east';
import {
  DELTA_CONFLICT, RecordSummaryTotalsType, editTypeOf, indexCollectionType, mutationDeltaType, type DeltaTarget,
} from '@elaraai/e3-types';
import { functionAt, sameEastType, signatureOf, type IndexFunction } from './record-guards.js';
import { argumentsType, callWithArguments, programOverArguments } from './record-arguments.js';
import { patchTypeOf, patchesOf, type Patches } from './record-patches.js';
import type { MigrationDef, MutationDef, RecordDef, RecordIndexDef } from './types.js';

/**
 * Builds a program's IR with no source location captured.
 *
 * @remarks
 * A program is built as its package exports, so a location captured then
 * would name the code that called `e3.export`, and two exports of one
 * declaration would give two programs (#1284). e3 keeps a program, and every
 * object that names it, by its hash, so its bytes are the declaration's
 * alone. The author's functions it calls keep the locations they were built
 * with.
 *
 * @param build - Builds the program
 * @returns The program's IR bundle
 */
function locationFree<I extends EastType[], O extends EastType>(build: () => FunctionExpr<I, O>): EastIR<I, O> {
  return withLocationCapture(false, () => build().toIR());
}

/**
 * The entry key an index collection sorts under: `{ik, k}`.
 *
 * @remarks
 * `ik` first, so every entry with one index key is a contiguous run — ordered
 * by primary key inside it — and a range of index keys is one contiguous run
 * too. Struct keys compare field by field in declaration order, which is what
 * makes that true rather than merely intended.
 *
 * @param keyType - the record's primary key type
 * @param indexKeyType - the index key
 * @returns the entry key type
 */
export function indexEntryKeyType(keyType: EastType, indexKeyType: EastType): StructType<{ ik: EastType; k: EastType }> {
  return StructType({ ik: indexKeyType, k: keyType });
}

/** A Dict record's key and row types; any other record is refused, naming `what` reads it. */
function dictEntry(recordType: EastType, what: string): { keyType: EastType; valueType: EastType } {
  if (recordType.type !== 'Dict') throw new Error(`${what} reads a Dict record, not ${printType(recordType)}`);
  return { keyType: recordType.key, valueType: recordType.value };
}

/**
 * A record's index as it is built and bound (#1434): as declared, but, beside
 * a nested series index of the record, one that carries nothing — a plain or
 * an interval index with no `value` — or the row — an area index, a key-form
 * series index — carries the lean row instead: its rows without the listed
 * collections, so a page of them reads no nested item and no segment of the
 * record's own. An index with a `value` of its own carries its own.
 *
 * @param rec - The record, its indexes declared
 * @param index - One of its indexes
 * @returns The index as it is built
 */
export function builtIndex(rec: RecordDef, index: RecordIndexDef): RecordIndexDef {
  const nested = Object.values(rec.indexes).find((other) => other.nested !== undefined)?.nested;
  if (nested === undefined || index.nested !== undefined || index.summary !== undefined) return index;
  const carriesTheRow = index.area !== undefined || index.series !== undefined;
  if (index.valueFn !== undefined && !carriesTheRow) return index;
  const { valueType } = dictEntry(rec.type, `index '${index.name}'`);
  return { ...index, valueFn: nested.lean, valueType };
}

/** An index's keys for a row: `(K, V) → Set<IK>` — its `keys` function, or its `key` function's one key. */
function indexKeys(index: RecordIndexDef, keyType: EastType, valueType: EastType) {
  const keysType = SetType(index.keyType);
  if (index.multi) return functionAt(index.keyFn, [keyType, valueType], keysType);
  const key = functionAt(index.keyFn, [keyType, valueType], index.keyType);
  return East.function([keyType, valueType], keysType, ($, k, v) => {
    const keyOf = $.const(key);
    return new Set([keyOf(k, v)]);
  });
}

/** An index's projection of a row: `(K, V) → P` — its `value` function, or `Null` where it carries none. */
function indexProjection(index: RecordIndexDef, keyType: EastType, valueType: EastType) {
  if (index.valueFn !== undefined) return functionAt(index.valueFn, [keyType, valueType], index.valueType);
  return East.function([keyType, valueType], NullType, () => null);
}

/**
 * The build program of an index: `(piece, emit) => Null`.
 *
 * @remarks
 * Called with a piece of the primary — a whole small record, or one piece of a
 * large one — it emits each row's index entries as it reads the row. Index
 * order is not primary order, and need not be: the runner writes a `dict`
 * output through its RunSorter, which sorts what it is given, so the program
 * holds no more than the row in hand.
 *
 * A summary's program emits each row's contributions under their keys, `k`
 * Null (#1039). Two rows, in one piece or two, contribute to one key: the
 * build's output names the merge that sums them ({@link summaryMergeProgram}).
 * A nested series index's emits each row's entries, each with its own value
 * (#1434).
 *
 * @param recordType - the record's state type, `Dict<K, V>`
 * @param def - the index declaration
 * @returns the program's IR bundle
 */
export function indexBuildProgram(recordType: EastType, def: RecordIndexDef) {
  const { keyType, valueType } = dictEntry(recordType, `index '${def.name}'`);
  const pieceType = DictType(keyType, valueType);
  if (def.summary !== undefined) {
    const contributions = functionAt(def.keyFn, [keyType, valueType], DictType(def.keyType, RecordSummaryTotalsType));
    const emitType = FunctionType([indexEntryKeyType(NullType, def.keyType), RecordSummaryTotalsType], NullType);
    return locationFree(() => East.function([pieceType, emitType], NullType, ($, piece, emit) => {
      const contribute = $.const(contributions);
      $.for(piece, ($, row, key) => {
        $.for(contribute(key, row), ($, totals, ik) => {
          $(emit({ ik, k: null }, totals));
        });
      });
    }));
  }
  const emitType = FunctionType([indexEntryKeyType(keyType, def.keyType), def.valueType], NullType);
  if (def.nested !== undefined) {
    // A nested series index's row gives its entries with their values (#1434), each under the row's key.
    const entries = functionAt(def.keyFn, [keyType, valueType], DictType(def.keyType, def.valueType));
    return locationFree(() => East.function([pieceType, emitType], NullType, ($, piece, emit) => {
      const entriesOf = $.const(entries);
      $.for(piece, ($, row, key) => {
        $.for(entriesOf(key, row), ($, value, ik) => {
          $(emit({ ik, k: key }, value));
        });
      });
    }));
  }
  return locationFree(() => {
    const keys = indexKeys(def, keyType, valueType);
    const projection = indexProjection(def, keyType, valueType);
    return East.function([pieceType, emitType], NullType, ($, piece, emit) => {
      const keysOf = $.const(keys);
      const project = $.const(projection);
      $.for(piece, ($, row, key) => {
        const value = $.let(project(key, row));
        $.for(keysOf(key, row), ($, ik) => {
          $(emit({ ik, k: key }, value));
        });
      });
    });
  });
}

/**
 * A summary index's build merge (#1039): `({ik, k}, Totals, Totals) =>
 * Totals`, the sum of two pieces' totals for one key. Integer addition is
 * associative and commutative, so a build split into any pieces sums to the
 * totals a single piece would; a sum past the largest Integer fails the build,
 * naming the summary and the key, rather than wrap.
 *
 * @param def - The summary's declaration
 * @returns The merge's IR bundle
 * @throws {Error} When the index is not a summary
 */
export function summaryMergeProgram(def: RecordIndexDef) {
  if (def.summary === undefined || def.mergeFn === undefined) throw new Error(`index '${def.name}' is not a summary, and its build merges nothing`);
  const totals = RecordSummaryTotalsType;
  const merge = functionAt(def.mergeFn, [indexEntryKeyType(NullType, def.keyType), totals, totals], totals);
  return locationFree(() => merge);
}

/**
 * A Dict `rekey` step's function as `(K, V) → { key, value }`, whichever order
 * the entry it returns declares its two fields in.
 */
function rekeyStep(fn: IndexFunction, fromKey: EastType, fromValue: EastType, toKey: EastType, toValue: EastType) {
  const entryType = StructType({ key: toKey, value: toValue });
  if (sameEastType(signatureOf(fn).output, entryType)) return functionAt(fn, [fromKey, fromValue], entryType);
  const swapped = functionAt(fn, [fromKey, fromValue], StructType({ value: toValue, key: toKey }));
  return East.function([fromKey, fromValue], entryType, ($, key, row) => {
    const step = $.const(swapped);
    const entry = $.let(step(key, row));
    return { key: entry.key, value: entry.value };
  });
}

/**
 * The program a `rows` or `rekey` migration runs over each piece of a record's
 * state: `(piece, emit) => Null`.
 *
 * @remarks
 * It calls the author's function on each row, or element, as it reads it, and
 * emits what the function returns: a `rows` step under the row's own key, or
 * in order over an Array; a `rekey` step under the key the function returns,
 * or, over a Set, as the element it returns. The runner writes a `dict` or
 * `set` output through its RunSorter, which sorts what it is given, and an
 * `array` output in the order emitted, so the program holds no more than the
 * row in hand.
 *
 * @param def - the migration, a `rows` or `rekey` step
 * @returns the program's IR bundle
 * @throws {Error} When the step is a `value` step, whose own function runs.
 */
export function migrationProgram(def: MigrationDef) {
  if (def.form === 'value') {
    throw new Error(`e3.migration.value '${def.name}' runs its own function, and has no program`);
  }
  const from: EastType = def.from;
  const to: EastType = def.to;
  if (from.type === 'Dict' && to.type === 'Dict') {
    const fromKey: EastType = from.key;
    const fromValue: EastType = from.value;
    const toKey: EastType = to.key;
    const toValue: EastType = to.value;
    const emitType = FunctionType([toKey, toValue], NullType);
    if (def.form === 'rows') {
      // Each row under its own key.
      const step = functionAt(def.fn, [fromKey, fromValue], toValue);
      return locationFree(() => East.function([DictType(fromKey, fromValue), emitType], NullType, ($, piece, emit) => {
        const stepFn = $.const(step);
        $.for(piece, ($, row, key) => {
          $(emit(key, stepFn(key, row)));
        });
      }));
    }
    // Each row under the key its step gives it.
    return locationFree(() => {
      const step = rekeyStep(def.fn, fromKey, fromValue, toKey, toValue);
      return East.function([DictType(fromKey, fromValue), emitType], NullType, ($, piece, emit) => {
        const stepFn = $.const(step);
        $.for(piece, ($, row, key) => {
          const entry = $.let(stepFn(key, row));
          $(emit(entry.key, entry.value));
        });
      });
    });
  }
  if (from.type === 'Set' && to.type === 'Set') {
    const fromKey: EastType = from.key;
    const toKey: EastType = to.key;
    const step = functionAt(def.fn, [fromKey], toKey);
    return locationFree(() => East.function([SetType(fromKey), FunctionType([toKey], NullType)], NullType, ($, piece, emit) => {
      const stepFn = $.const(step);
      $.for(piece, ($, element) => {
        $(emit(stepFn(element)));
      });
    }));
  }
  if (from.type === 'Array' && to.type === 'Array') {
    const fromValue: EastType = from.value;
    const toValue: EastType = to.value;
    const step = functionAt(def.fn, [fromValue], toValue);
    return locationFree(() => East.function([ArrayType(fromValue), FunctionType([toValue], NullType)], NullType, ($, piece, emit) => {
      const stepFn = $.const(step);
      $.for(piece, ($, element) => {
        $(emit(stepFn(element)));
      });
    }));
  }
  throw new Error(`e3.migration.${def.form} '${def.name}' migrates a Dict, a Set or an Array, from ${printType(from)} to ${printType(to)}`);
}

/**
 * The delta's targets for a record: its own collection, then each index.
 *
 * @remarks
 * The names become the delta's variant cases, which is why `primary` is a
 * reserved index name. Returned in the order the cases compare in — variant
 * values order by case NAME — which is the order the delta holds their ops in.
 *
 * @param recordType - the record's state type, a Dict or a Set
 * @param indexes - the record's index declarations
 * @returns the targets, in canonical case order
 */
export function deltaTargets(recordType: EastType, indexes: readonly RecordIndexDef[]): DeltaTarget[] {
  if (recordType.type !== 'Dict' && recordType.type !== 'Set') {
    throw new Error(`a mutation delta addresses a Dict or a Set by key, not ${printType(recordType)}`);
  }
  const keyType: EastType = recordType.key;
  const targets: DeltaTarget[] = [
    { name: 'primary', keyType, collectionType: recordType },
  ];
  for (const index of indexes) {
    // A summary's entry stands for every row of its key, so its `k` is Null,
    // and its arm carries what to add to each total (#1039).
    const k = index.summary !== undefined ? NullType : keyType;
    targets.push({
      name: index.name,
      keyType: indexEntryKeyType(k, index.keyType),
      collectionType: indexCollectionType(k, index.keyType, index.valueType),
      ...(index.summary !== undefined && { summary: true }),
    });
  }
  return targets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Whether a record's own collection has a delta at all: one addressed by key,
 *  which is what lets a commit rebuild only the segments it touched. An Array
 *  record's patch is positional, and a scalar's is a replace. */
export function hasKeyedDelta(recordType: EastType): boolean {
  return recordType.type === 'Dict' || recordType.type === 'Set';
}

/** The foldable op an `edit` body records per key, before the state resolves it
 *  into an insert / delete / update. `set` is deliberately not one of those:
 *  which it becomes depends on whether the record already holds the key, and
 *  the body is not the place that knows. */
function editOpsType(valueType: EastType, rows: Patches) {
  return VariantType({ set: valueType, delete: NullType, update: rows.patchType });
}

/** The emit a write's program hands its delta to, entry by entry: `(DeltaKey, DeltaOp) → Null`. */
function deltaEmitType(recordType: EastType, indexes: readonly RecordIndexDef[]) {
  const delta = mutationDeltaType(deltaTargets(recordType, indexes));
  return FunctionType([delta.key, delta.value], NullType);
}

/**
 * The types a Dict record's write is built over: its state; its rows'
 * patches; its patch and its ops, typed to the depth a write reads them — an
 * op's `update` is its row's patch, which the write passes on whole — and
 * checked to be East's own; the rows a write touches; and the emit.
 */
function dictWrite(keyType: EastType, valueType: EastType, indexes: readonly RecordIndexDef[]) {
  const stateType = DictType(keyType, valueType);
  const rows = patchesOf(valueType);
  const opsType = DictType(keyType, VariantType({ delete: valueType, insert: valueType, update: rows.patchType }));
  const patchType = VariantType({ unchanged: NullType, replace: StructType({ before: stateType, after: stateType }), patch: opsType });
  if (!sameEastType(patchType, patchTypeOf(stateType))) {
    throw new Error(`a write's patch of ${printType(stateType)} is not East's ${printType(patchTypeOf(stateType))}`);
  }
  return {
    keyType,
    valueType,
    stateType,
    rows,
    patchType,
    opsType,
    /** The rows a write touches: under each key it changes, the row before and after. */
    changesType: DictType(keyType, StructType({ held: OptionType(valueType), next: OptionType(valueType) })),
    emitType: deltaEmitType(stateType, indexes),
  };
}

/** The types a Dict record's write is built over. */
type DictWrite = ReturnType<typeof dictWrite>;

/**
 * Folds a patch of a Dict record into per-key ops: `(State, Patch, verify, Emit) → Ops`.
 *
 * @remarks
 * A patch has three arms and the delta has one shape, so all three land here.
 * `replace` is the interesting one: `diff` produces it whenever every key
 * changed, and a client may send it outright — so it is turned into per-key
 * ops against the state rather than carried through, which is what keeps the
 * apply's cost proportional to what actually differs. A client's `replace`
 * whose `before` the record no longer holds is a stale write, emitted as the
 * delta's conflict; `verify` asks for that check, which a diff of the state
 * needs no more than its own `before`.
 */
export function dictPatchOps(types: DictWrite) {
  const { stateType, rows, patchType, opsType, emitType } = types;
  return East.function([stateType, patchType, BooleanType, emitType], opsType, ($, state, patch, verify, emit) => {
    const diff = $.const(rows.diff);
    const ops = $.let(new Map(), opsType);
    $.match(patch, {
      unchanged: () => {},
      patch: ($, entries) => {
        $.assign(ops, entries);
      },
      replace: ($, whole) => {
        $.if(verify.and(() => East.notEqual<EastType>(whole.before, state)), ($) => {
          $(emit(variant(DELTA_CONFLICT, 'the patch replaces a state the record no longer holds'), variant(DELTA_CONFLICT, null)));
        });
        $.for(state, ($, value, key) => {
          $.if(whole.after.has(key).not(), ($) => {
            $(ops.insertOrUpdate(key, variant('delete', value)));
          });
        });
        $.for(whole.after, ($, value, key) => {
          $.match(state.tryGet(key), {
            none: ($) => {
              $(ops.insertOrUpdate(key, variant('insert', value)));
            },
            some: ($, held) => {
              $.if(East.notEqual<EastType>(held, value), ($) => {
                $(ops.insertOrUpdate(key, variant('update', diff(held, value))));
              });
            },
          });
        });
      },
    });
    return ops;
  });
}

/**
 * The rows a write touches: `(State, Ops, Emit) → Changes`, under each key it
 * changes the row before it and the row after.
 *
 * @remarks
 * Applying a patch verifies the row it was made against, and a row that no
 * longer matches is a stale write — the conflict the engine reports when it
 * applies an unindexed record's patch — emitted as the delta's conflict, its
 * row after then `none`. Named in words every runtime shares: each one's own
 * apply message is different.
 */
function rowChanges(types: DictWrite) {
  const { valueType, stateType, rows, opsType, changesType, emitType } = types;
  return East.function([stateType, opsType, emitType], changesType, ($, state, ops, emit) => {
    const apply = $.const(rows.apply);
    const changes = $.let(new Map(), changesType);
    $.for(ops, ($, op, key) => {
      const held = $.let(state.tryGet(key));
      const next = $.let(none, OptionType(valueType));
      $.match(op, {
        insert: ($, value) => {
          $.assign(next, some(value));
        },
        update: ($, patch) => {
          $.match(held, {
            some: ($, value) => {
              $.try(($) => {
                $.assign(next, some(apply(value, patch)));
              }).catch(($) => {
                $(emit(
                  variant(DELTA_CONFLICT, East.str`update of ${East.print(key)}, whose row no longer matches the patch`),
                  variant(DELTA_CONFLICT, null)));
              });
            },
            none: () => {},
          });
        },
        delete: () => {},
      });
      $(changes.insert(key, { held, next }));
    });
    return changes;
  });
}

/**
 * One index's entry changes for a write's touched rows: `(Changes, Emit) → Null`.
 *
 * @remarks
 * An index entry is `{ik, k}`, so a row moving from one index key to another is
 * a delete at the old entry and an insert at the new one — not an update. Only
 * an entry that keeps its index key and whose covering projection changed is an
 * update, and an index carrying no projection, whose projection is Null, has
 * none of those at all. The three sets are disjoint and `k` is this row's, so
 * no entry is emitted twice.
 */
function indexChanges(index: RecordIndexDef, types: DictWrite) {
  const { keyType, valueType, changesType, emitType } = types;
  const keys = indexKeys(index, keyType, valueType);
  const projection = indexProjection(index, keyType, valueType);
  const projected = patchesOf(index.valueType);
  // A row's entries: its index keys and its projection; none for no row.
  const entriesType = StructType({ keys: SetType(index.keyType), value: OptionType(index.valueType) });
  const entriesOf = East.function([keyType, OptionType(valueType)], entriesType, ($, key, row) => {
    const keysOf = $.const(keys);
    const project = $.const(projection);
    $.match(row, {
      some: ($, value) => {
        $.return({ keys: keysOf(key, value), value: some(project(key, value)) });
      },
      none: () => {},
    });
    return { keys: new Set([]), value: none };
  });
  return East.function([changesType, emitType], NullType, ($, changes, emit) => {
    const entries = $.const(entriesOf);
    const diff = $.const(projected.diff);
    $.for(changes, ($, change, key) => {
      const before = $.let(entries(key, change.held));
      const after = $.let(entries(key, change.next));
      $.for(before.keys.difference(after.keys), ($, ik) => {
        $(emit(variant(index.name, { ik, k: key }), variant(index.name, variant('delete', before.value.unwrap()))));
      });
      $.for(after.keys.difference(before.keys), ($, ik) => {
        $(emit(variant(index.name, { ik, k: key }), variant(index.name, variant('insert', after.value.unwrap()))));
      });
      $.for(before.keys.intersection(after.keys), ($, ik) => {
        const was = $.let(before.value.unwrap());
        const is = $.let(after.value.unwrap());
        $.if(East.notEqual<EastType>(was, is), ($) => {
          $(emit(variant(index.name, { ik, k: key }), variant(index.name, variant('update', diff(was, is)))));
        });
      });
    });
  });
}

/**
 * A nested series index's entry changes for a write's touched rows (#1434):
 * `(Changes, Emit) → Null`, each row's entries before and after compared by
 * key — one gone a delete, one come an insert, one whose value changed an
 * update. The entries' keys hold the row's own key, so no two rows share one.
 */
function nestedChanges(index: RecordIndexDef, types: DictWrite) {
  const { keyType, valueType, changesType, emitType } = types;
  const entriesType = DictType(index.keyType, index.valueType);
  const entries = functionAt(index.keyFn, [keyType, valueType], entriesType);
  const values = patchesOf(index.valueType);
  // A row's entries; none for no row.
  const entriesOf = East.function([keyType, OptionType(valueType)], entriesType, ($, key, row) => {
    const of = $.const(entries);
    $.match(row, {
      some: ($, value) => {
        $.return(of(key, value));
      },
      none: () => {},
    });
    return new Map();
  });
  return East.function([changesType, emitType], NullType, ($, changes, emit) => {
    const rowEntries = $.const(entriesOf);
    const diff = $.const(values.diff);
    $.for(changes, ($, change, key) => {
      const before = $.let(rowEntries(key, change.held));
      const after = $.let(rowEntries(key, change.next));
      $.for(before, ($, was, ik) => {
        $.match(after.tryGet(ik), {
          none: ($) => {
            $(emit(variant(index.name, { ik, k: key }), variant(index.name, variant('delete', was))));
          },
          some: ($, is) => {
            $.if(East.notEqual<EastType>(was, is), ($) => {
              $(emit(variant(index.name, { ik, k: key }), variant(index.name, variant('update', diff(was, is)))));
            });
          },
        });
      });
      $.for(after, ($, is, ik) => {
        $.if(before.has(ik).not(), ($) => {
          $(emit(variant(index.name, { ik, k: key }), variant(index.name, variant('insert', is))));
        });
      });
    });
  });
}

/** `(totals, sign) → sign × totals`: a row's contribution given, `1`, or taken away, `−1`. */
const signedTotals = East.function([RecordSummaryTotalsType, IntegerType], RecordSummaryTotalsType, (_$, totals, sign) =>
  ({ count: totals.count.multiply(sign), ms: totals.ms.multiply(sign) }));

/** `(a, b) → a + b`: two changes to one key's totals. */
const addedTotals = East.function([RecordSummaryTotalsType, RecordSummaryTotalsType], RecordSummaryTotalsType, (_$, a, b) =>
  ({ count: a.count.add(b.count), ms: a.ms.add(b.ms) }));

/**
 * One summary's change for a write's touched rows (#1039): `(Changes, Emit) →
 * Null`, under each key the rows it replaced contributed to, or it writes do,
 * what those took away and these give, summed.
 *
 * @remarks
 * A write reads the record, never the summary, so it says what changed rather
 * than what a total becomes; the apply adds it to the total held. The change
 * of a key two rows share is summed here, so the delta holds it once, and a
 * change of nothing is not emitted.
 */
function summaryChanges(index: RecordIndexDef, types: DictWrite) {
  const { keyType, valueType, changesType, emitType } = types;
  const totalsType = DictType(index.keyType, RecordSummaryTotalsType);
  const contributions = functionAt(index.keyFn, [keyType, valueType], totalsType);
  return East.function([changesType, emitType], NullType, ($, changes, emit) => {
    const contribute = $.const(contributions);
    const signed = $.const(signedTotals);
    const add = $.const(addedTotals);
    const sums = $.let(new Map(), totalsType);
    $.for(changes, ($, change, key) => {
      $.match(change.held, {
        some: ($, row) => {
          $(sums.unionInPlace(contribute(key, row).map(($, part) => signed(part, -1n)), ($, was, part) => add(was, part)));
        },
        none: () => {},
      });
      $.match(change.next, {
        some: ($, row) => {
          $(sums.unionInPlace(contribute(key, row), ($, was, part) => add(was, part)));
        },
        none: () => {},
      });
    });
    $.for(sums, ($, change, ik) => {
      $.if(change.count.notEqual(0n).or(() => change.ms.notEqual(0n)), ($) => {
        $(emit(variant(index.name, { ik, k: null }), variant(index.name, variant('add', change))));
      });
    });
  });
}

/**
 * Every index's changes for a write's touched rows, each index in turn:
 * `(Changes, Emit) → Null`, a function calling the ones before it and then
 * its own index's.
 */
function indexesChanges(indexes: readonly RecordIndexDef[], types: DictWrite) {
  const { changesType, emitType } = types;
  return indexes.reduce(
    (earlier, index) => {
      const own = index.summary !== undefined ? summaryChanges(index, types)
        : index.nested !== undefined ? nestedChanges(index, types)
        : indexChanges(index, types);
      return East.function([changesType, emitType], NullType, ($, changes, emit) => {
        const before = $.const(earlier);
        const these = $.const(own);
        $(before(changes, emit));
        $(these(changes, emit));
      });
    },
    East.function([changesType, emitType], NullType, () => null),
  );
}

/** A write's own ops, each under its key: `(Ops, Emit) → Null`. */
function primaryOps(opsType: DictType<EastType, EastType>, emitType: DictWrite['emitType']) {
  return East.function([opsType, emitType], NullType, ($, ops, emit) => {
    $.for(ops, ($, op, key) => {
      $(emit(variant('primary', key), variant('primary', op)));
    });
  });
}

/** The delta of a write whose record has no indexes, once its ops are known: `(State, Ops, Emit) → Null`, each op under its key. */
function primaryApply(stateType: EastType, opsType: DictType<EastType, EastType>, emitType: DictWrite['emitType']) {
  const primary = primaryOps(opsType, emitType);
  return East.function([stateType, opsType, emitType], NullType, ($, _state, ops, emit) => {
    const own = $.const(primary);
    $(own(ops, emit));
  });
}

/**
 * The delta of a Dict record's write, once its ops are known: `(State, Ops,
 * Emit) → Null`, each op under its key and, where the record has indexes, each
 * index's changes for the rows the ops touch.
 */
function dictApply(indexes: readonly RecordIndexDef[], types: DictWrite) {
  const { stateType, opsType, emitType } = types;
  if (indexes.length === 0) return primaryApply(stateType, opsType, emitType);
  const primary = primaryOps(opsType, emitType);
  const touched = rowChanges(types);
  const maintain = indexesChanges(indexes, types);
  return East.function([stateType, opsType, emitType], NullType, ($, state, ops, emit) => {
    const own = $.const(primary);
    const rows = $.const(touched);
    const indexed = $.const(maintain);
    $(own(ops, emit));
    const changes = $.let(rows(state, ops, emit));
    $(indexed(changes, emit));
  });
}

/**
 * Runs an `edit` body against a capability that folds its writes, then resolves
 * the fold into per-key ops: `(State, Args, Emit) → Ops`.
 *
 * @remarks
 * `set` is the reason the fold has its own op type: whether it becomes an
 * insert or an update is a fact about the record, not about the body, and the
 * body is not asked to know. Resolving it here is also where a `delete` or an
 * `update` of a key the record does not hold is found — emitted as the
 * delta's conflict naming the key, as an apply would name it, rather than
 * reaching the apply as an op that cannot be represented.
 */
function editOps(fn: IndexFunction, argTypes: readonly EastType[], types: DictWrite) {
  const { keyType, valueType, stateType, rows, opsType, emitType } = types;
  // The capability, typed as the ops are: its `update` takes the row's patch, checked to be East's own.
  const editType = StructType({
    set: FunctionType([keyType, valueType], NullType),
    delete: FunctionType([keyType], NullType),
    update: FunctionType([keyType, rows.patchType], NullType),
  });
  const declared: EastType = stateType;
  if (!sameEastType(editType, editTypeOf(declared))) {
    throw new Error(`an edit's capability over ${printType(stateType)} is not ${printType(editTypeOf(declared))}`);
  }
  const editsType = DictType(keyType, editOpsType(valueType, rows));
  const argsType = argumentsType(argTypes);
  const body = callWithArguments(fn, stateType, argTypes, [editType], NullType);
  const resolve = East.function([stateType, editsType, emitType], opsType, ($, state, edits, emit) => {
    const diff = $.const(rows.diff);
    const ops = $.let(new Map(), opsType);
    $.for(edits, ($, edit, key) => {
      const held = $.let(state.tryGet(key));
      $.match(edit, {
        set: ($, value) => {
          $.match(held, {
            some: ($, prior) => {
              // A `set` of what the record already holds changed nothing, and a
              // delta says what changed: an op here would re-cut the segment to
              // the bytes it already has and count itself in the history.
              $.if(East.notEqual<EastType>(prior, value), ($) => {
                $(ops.insertOrUpdate(key, variant('update', diff(prior, value))));
              });
            },
            none: ($) => {
              $(ops.insertOrUpdate(key, variant('insert', value)));
            },
          });
        },
        delete: ($) => {
          $.match(held, {
            some: ($, prior) => {
              $(ops.insertOrUpdate(key, variant('delete', prior)));
            },
            none: ($) => {
              $(emit(
                variant(DELTA_CONFLICT, East.str`delete of ${East.print(key)}, which the record does not hold`),
                variant(DELTA_CONFLICT, null)));
            },
          });
        },
        update: ($, patch) => {
          $.match(held, {
            some: ($) => {
              $(ops.insertOrUpdate(key, variant('update', patch)));
            },
            none: ($) => {
              $(emit(
                variant(DELTA_CONFLICT, East.str`update of ${East.print(key)}, which the record does not hold`),
                variant(DELTA_CONFLICT, null)));
            },
          });
        },
      });
    });
    return ops;
  });
  return East.function([stateType, argsType, emitType], opsType, ($, state, args, emit) => {
    const apply = $.const(rows.apply);
    const compose = $.const(rows.compose);
    const edits = $.let(new Map(), editsType);
    const capability = $.const({
      set: East.function([keyType, valueType], NullType, ($, key, value) => {
        $(edits.insertOrUpdate(key, variant('set', value)));
      }),
      delete: East.function([keyType], NullType, ($, key) => {
        $.if(state.has(key), ($) => {
          $(edits.insertOrUpdate(key, variant('delete', null)));
        }).else(($) => {
          // The record does not hold the key, so a pending `set` of it is this
          // body creating it: deleting it again leaves the record as it was, and
          // there is nothing to write. Anything else is a delete of a key the
          // record does not hold, which resolving refuses.
          $.match(edits.tryGet(key), {
            some: ($, prior) => {
              $.match(prior, {
                set: ($) => {
                  $(edits.delete(key));
                },
                delete: ($) => {
                  $(edits.insertOrUpdate(key, variant('delete', null)));
                },
                update: ($) => {
                  $(edits.insertOrUpdate(key, variant('delete', null)));
                },
              });
            },
            none: ($) => {
              $(edits.insertOrUpdate(key, variant('delete', null)));
            },
          });
        });
      }),
      update: East.function([keyType, rows.patchType], NullType, ($, key, patch) => {
        $.match(edits.tryGet(key), {
          none: ($) => {
            $(edits.insertOrUpdate(key, variant('update', patch)));
          },
          some: ($, prior) => {
            $.match(prior, {
              set: ($, value) => {
                $(edits.insertOrUpdate(key, variant('set', apply(value, patch))));
              },
              update: ($, first) => {
                $(edits.insertOrUpdate(key, variant('update', compose(first, patch))));
              },
              delete: ($) => {
                $.error(East.str`update of ${East.print(key)}, which this mutation already deleted`);
              },
            });
          },
        });
      }),
    }, editType);
    const run = $.const(body);
    const resolveFn = $.const(resolve);
    $(run(state, args, capability));
    return resolveFn(state, edits, emit);
  });
}

/**
 * Folds a patch of a Set record into per-key ops: `(State, Patch, verify,
 * Emit) → Ops`, as {@link dictPatchOps} folds a Dict's.
 */
function setPatchOps(keyType: EastType, emitType: DictWrite['emitType']) {
  const stateType = SetType(keyType);
  const patchType = PatchType(stateType);
  const opsType = patchType.cases.patch;
  return East.function([stateType, patchType, BooleanType, emitType], opsType, ($, state, patch, verify, emit) => {
    const ops = $.let(new Map(), opsType);
    $.match(patch, {
      unchanged: () => {},
      patch: ($, entries) => {
        $.assign(ops, entries);
      },
      replace: ($, whole) => {
        $.if(verify.and(() => East.notEqual<EastType>(whole.before, state)), ($) => {
          $(emit(variant(DELTA_CONFLICT, 'the patch replaces a state the record no longer holds'), variant(DELTA_CONFLICT, null)));
        });
        $.for(state, ($, key) => {
          $.if(whole.after.has(key).not(), ($) => {
            $(ops.insertOrUpdate(key, variant('delete', null)));
          });
        });
        $.for(whole.after, ($, key) => {
          $.if(state.has(key).not(), ($) => {
            $(ops.insertOrUpdate(key, variant('insert', null)));
          });
        });
      },
    });
    return ops;
  });
}

/** What a write's program is built from, whatever its record's collection: its types, and its steps. */
interface WriteSteps {
  readonly stateType: EastType;
  /** The state's patch type, as a client's patch arrives. */
  readonly patchType: EastType;
  /** The per-key ops a write's delta carries for its record's own collection. */
  readonly opsType: EastType;
  readonly emitType: DictWrite['emitType'];
  /** `(before, after) → the patch between two states` */
  readonly diff: FunctionExpr<[EastType, EastType], EastType>;
  /** `(State, Patch, verify, Emit) → Ops` */
  readonly patchOps: FunctionExpr<[EastType, EastType, BooleanType, EastType], EastType>;
  /** `(State, Ops, Emit) → Null`: the delta, once the ops are known. */
  readonly apply: FunctionExpr<[EastType, EastType, EastType], NullType>;
}

/** A Dict record's write steps. */
function dictSteps(types: DictWrite, indexes: readonly RecordIndexDef[]): WriteSteps {
  return {
    stateType: types.stateType,
    patchType: types.patchType,
    opsType: types.opsType,
    emitType: types.emitType,
    diff: patchesOf(types.stateType).diff,
    patchOps: dictPatchOps(types),
    apply: dictApply(indexes, types),
  };
}

/** A Set record's write steps: it is indexed by nothing, so its delta is its own ops. */
function setSteps(keyType: EastType): WriteSteps {
  const stateType = SetType(keyType);
  const patchType = PatchType(stateType);
  const opsType = patchType.cases.patch;
  const emitType = deltaEmitType(stateType, []);
  return {
    stateType,
    patchType,
    opsType,
    emitType,
    diff: patchesOf(stateType).diff,
    patchOps: setPatchOps(keyType, emitType),
    apply: primaryApply(stateType, opsType, emitType),
  };
}

/** A mutation's body; a `patch` mutation has none. */
function bodyOf(mut: MutationDef): IndexFunction {
  if (mut.fn === undefined) throw new Error(`e3 mutation '${mut.name}' has no body to build its program from`);
  return mut.fn;
}

/**
 * A reducer's ops: `(State, Args, Emit) → Ops`, the per-key ops a diff of the
 * whole new state it returns gives — the diff's `before` is the state, so it
 * needs no check.
 */
function reduceOps(fn: IndexFunction, argTypes: readonly EastType[], steps: WriteSteps) {
  const { stateType, opsType, emitType, diff, patchOps } = steps;
  const reduce = callWithArguments(fn, stateType, argTypes, [], stateType);
  const argsType = argumentsType(argTypes);
  return East.function([stateType, argsType, emitType], opsType, ($, state, args, emit) => {
    const reduceFn = $.const(reduce);
    const diffFn = $.const(diff);
    const opsOf = $.const(patchOps);
    const next = $.let(reduceFn(state, args));
    return opsOf(state, diffFn(state, next), false, emit);
  });
}

/**
 * The program every write form runs: `(State, …Args | Patch, Emit) => Null`.
 *
 * @remarks
 * One program, three forms, one output — the mutation delta, emitted entry by
 * entry as it is computed, in any order: the runner writes a `dict` output
 * through its RunSorter, which sorts it. e3 stores the delta as segments and
 * applies it one target segment at a time; it never evaluates the author's
 * East itself, which is what keeps one rule for where user code runs and gives
 * the three runtimes something to agree on byte for byte.
 *
 * The three forms differ only in how the per-key ops are reached — a diff of
 * the reducer's result, the folded writes of an `edit` body, or the client's
 * own patch — after which the rest is shared: each op emitted under its key,
 * then each touched key's old and new row, and each index asked what its
 * entries were and what they become.
 *
 * A write the state moved under — a patch whose `before` the record no longer
 * holds, an update of a row that no longer matches, a delete or update of a
 * key the record does not hold — is emitted as a {@link DELTA_CONFLICT} entry
 * naming it, which sorts first, rather than failing the program: a caller
 * resubmits a conflict and gives up on a failure.
 *
 * @param rec - the record, carrying its indexes
 * @param mut - the mutation declaration
 * @returns the program's IR bundle
 * @throws {Error} When the record's collection has no keyed delta, an `edit`
 *   mutation writes a Set, or an `edit` / `reduce` mutation has no body.
 */
export function buildMutationProgram(rec: RecordDef, mut: MutationDef) {
  const recordType: EastType = rec.type;
  if (recordType.type !== 'Dict' && recordType.type !== 'Set') {
    throw new Error(
      `e3.mutation.${mut.form} '${mut.name}' writes a delta, ` +
      `which addresses a Dict or a Set by key; record '${rec.name}' holds ${recordType.type}.`);
  }
  // A Set record is indexed by nothing, and written by a patch or a reducer: an edit writes a Dict.
  if (recordType.type === 'Set' && mut.form === 'edit') {
    throw new Error(`e3.mutation.edit '${mut.name}' writes a Dict record; '${rec.name}' holds a Set`);
  }
  if (mut.form !== 'patch') bodyOf(mut);
  return locationFree(() => writeProgram(rec, mut));
}

/**
 * A write's program (see {@link buildMutationProgram}): its record's steps,
 * its form's ops, and the program the runner calls.
 */
function writeProgram(rec: RecordDef, mut: MutationDef): FunctionExpr<EastType[], NullType> {
  const recordType: EastType = rec.type;
  let steps: WriteSteps;
  let argumentOps: FunctionExpr<[EastType, EastType, EastType], EastType> | undefined;
  if (recordType.type === 'Dict') {
    const indexes = Object.values(rec.indexes).map((index) => builtIndex(rec, index)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const types = dictWrite(recordType.key, recordType.value, indexes);
    steps = dictSteps(types, indexes);
    argumentOps = mut.form === 'edit' ? editOps(bodyOf(mut), mut.argTypes, types)
      : mut.form === 'reduce' ? reduceOps(bodyOf(mut), mut.argTypes, steps)
      : undefined;
  } else if (recordType.type === 'Set') {
    steps = setSteps(recordType.key);
    argumentOps = mut.form === 'reduce' ? reduceOps(bodyOf(mut), mut.argTypes, steps) : undefined;
  } else {
    throw new Error(`a write addresses a Dict or a Set by key, not ${printType(recordType)}`);
  }
  const { stateType, patchType, emitType, patchOps, apply } = steps;
  if (argumentOps === undefined) {
    // A patch: the client's own, checked against the state it was made from.
    return East.function([stateType, patchType, emitType], NullType, ($, state, patch, emit) => {
      const opsOf = $.const(patchOps);
      const applyFn = $.const(apply);
      const ops = $.let(opsOf(state, patch, true, emit));
      $(applyFn(state, ops, emit));
    });
  }
  const opsOfArguments = argumentOps;
  const argsType = argumentsType(mut.argTypes);
  return programOverArguments(stateType, mut.argTypes, emitType,
    East.function([stateType, argsType, emitType], NullType, ($, state, args, emit) => {
      const opsOf = $.const(opsOfArguments);
      const applyFn = $.const(apply);
      const ops = $.let(opsOf(state, args, emit));
      $(applyFn(state, ops, emit));
    }));
}
