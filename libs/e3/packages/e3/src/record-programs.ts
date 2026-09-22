/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The East programs a record's declarations generate.
 *
 * An author declares what an index keys on and how a mutation writes; what
 * actually runs is a program built from those declarations — an ordinary East
 * function assembled at export time from the author's own expressions, the way
 * `partitionTask` builds its merge command and `streamTask` its command IR. It
 * is linked and encoded like any other body, runs on the runner the author
 * chose, and is what keeps e3 out of the business of evaluating user East: the
 * engine runs a program and applies what it emits.
 *
 * @packageDocumentation
 */

import {
  DictType,
  East,
  FunctionType,
  NullType,
  OptionType,
  PatchType,
  SetType,
  StructType,
  VariantType,
  none,
  some,
  variant,
  type EastIR,
  type EastType,
} from '@elaraai/east';
import {
  editTypeOf, indexCollectionType, mutationDeltaType, patchOpsType, type DeltaTarget,
} from '@elaraai/e3-types';
import type { MutationDef, RecordDef, RecordIndexDef } from './types.js';

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
export function indexEntryKeyType(keyType: EastType, indexKeyType: EastType): EastType {
  return StructType({ ik: indexKeyType, k: keyType });
}

/**
 * The build program of an index: `(slice, emit) => Null`.
 *
 * @remarks
 * Called with a slice of the primary — a whole small record, or one partition
 * of a large one — it emits that slice's index entries. Index order is not
 * primary order, so the program collects its slice into a local Dict and emits
 * that in order: the TypeScript emit sink refuses out-of-order keys (only the
 * C sink spills and merges), so every generated program emits in canonical
 * order itself rather than relying on the sink to sort.
 *
 * The author's key and value functions are bound as function values and
 * CALLED, never spliced into the loop: a spliced expression tree would be
 * re-evaluated per reference and could capture the wrong bindings.
 *
 * @param recordType - the record's state type, `Dict<K, V>`
 * @param def - the index declaration
 * @returns the program's IR bundle
 */
export function indexBuildProgram(recordType: EastType, def: RecordIndexDef): EastIR<any, any> {
  const dict = recordType as unknown as { type: string; key: EastType; value: EastType };
  const keyType = dict.key;
  const entryKey = indexEntryKeyType(keyType, def.keyType);
  const emitType = FunctionType([entryKey as never, def.valueType], NullType);
  const accType = DictType(entryKey as never, def.valueType);

  return East.function([recordType as never, emitType], NullType, ($: any, slice: any, emit: any) => {
    const indexKey = $.const(def.keyFn);
    const project = def.valueFn === undefined ? undefined : $.const(def.valueFn);
    const entries = $.let(new Map(), accType);
    $.for(slice, ($: any, row: any, key: any) => {
      const value = project === undefined ? null : project(key, row);
      if (def.multi) {
        $.for(indexKey(key, row), ($: any, ik: any) => {
          $(entries.insert({ ik, k: key }, value));
        });
      } else {
        $(entries.insert({ ik: indexKey(key, row), k: key }, value));
      }
    });
    $.for(entries, ($: any, projection: any, entry: any) => {
      $(emit(entry, projection));
    });
    return null;
  }).toIR() as EastIR<any, any>;
}

/**
 * The merge function an index's fan-in folds equal keys with: the first
 * standing.
 *
 * @remarks
 * It is never called. An index entry is `{ik, k}` and `k` belongs to exactly
 * one slice of the primary, so two partials cannot hold the same entry — but
 * the runner's `merge` command takes a fold function whatever the data, and a
 * fold that cannot run is better than one that could pick wrongly if the
 * premise ever changed.
 *
 * @param recordType - the record's state type, `Dict<K, V>`
 * @param def - the index declaration
 * @returns the program's IR bundle
 */
export function indexMergeProgram(recordType: EastType, def: RecordIndexDef): EastIR<any, any> {
  const dict = recordType as unknown as { key: EastType };
  const entryKey = indexEntryKeyType(dict.key, def.keyType);
  return East.function(
    [entryKey as never, def.valueType, def.valueType], def.valueType,
    ($: any, _entry: any, first: any, _second: any) => first,
  ).toIR() as EastIR<any, any>;
}

/**
 * The delta's targets for a record: its own collection, then each index.
 *
 * @remarks
 * The names become the delta's variant cases, which is why `primary` is a
 * reserved index name. Returned in the order the cases compare in — variant
 * values order by case NAME — so a caller emitting arm by arm emits ascending
 * keys.
 *
 * @param recordType - the record's state type, a Dict or a Set
 * @param indexes - the record's index declarations
 * @returns the targets, in canonical case order
 */
export function deltaTargets(recordType: EastType, indexes: readonly RecordIndexDef[]): DeltaTarget[] {
  const collection = recordType as unknown as { key: EastType };
  const targets: DeltaTarget[] = [
    { name: 'primary', keyType: collection.key, collectionType: recordType },
  ];
  for (const index of indexes) {
    targets.push({
      name: index.name,
      keyType: indexEntryKeyType(collection.key, index.keyType),
      collectionType: indexCollectionType(collection.key, index.keyType, index.valueType),
    });
  }
  return targets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The foldable op an `edit` body records per key, before the state resolves it
 *  into an insert / delete / update. `set` is deliberately not one of those:
 *  which it becomes depends on whether the record already holds the key, and
 *  the body is not the place that knows. */
function editOpsType(valueType: EastType): EastType {
  return VariantType({ set: valueType, delete: NullType, update: PatchType(valueType) });
}

/** Whether a record's own collection has a delta at all: one addressed by key,
 *  which is what lets a commit rebuild only the segments it touched. An Array
 *  record's patch is positional, and a scalar's is a replace. */
export function hasKeyedDelta(recordType: EastType): boolean {
  const t = (recordType as unknown as { type: string }).type;
  return t === 'Dict' || t === 'Set';
}

/**
 * Folds a `PatchType(State)` into the program's per-key op dict.
 *
 * @remarks
 * A patch has three arms and the delta has one shape, so all three land here.
 * `replace` is the interesting one: `diff` produces it whenever every key
 * changed, and a client may send it outright — so it is turned into per-key
 * ops against the state rather than carried through, which is what keeps the
 * apply's cost proportional to what actually differs.
 */
function collectOps(
  $: any, state: any, patchExpr: any, ops: any, keyed: 'Dict' | 'Set', verifyBefore: boolean,
): void {
  const patch = $.let(patchExpr);
  $.match(patch, {
    patch: ($: any, entries: any) => {
      $.for(entries, ($: any, op: any, key: any) => {
        $(ops.insertOrUpdate(key, op));
      });
    },
    replace: ($: any, whole: any) => {
      if (verifyBefore) {
        $.if(East.notEqual(whole.before, state), ($: any) => {
          $.error('the patch replaces a state the record no longer holds');
        });
      }
      if (keyed === 'Set') {
        $.for(state, ($: any, key: any) => {
          $.if(whole.after.has(key).not(), ($: any) => {
            $(ops.insertOrUpdate(key, variant('delete', null)));
          });
        });
        $.for(whole.after, ($: any, key: any) => {
          $.if(state.has(key).not(), ($: any) => {
            $(ops.insertOrUpdate(key, variant('insert', null)));
          });
        });
        return;
      }
      $.for(state, ($: any, value: any, key: any) => {
        $.if(whole.after.has(key).not(), ($: any) => {
          $(ops.insertOrUpdate(key, variant('delete', value)));
        });
      });
      $.for(whole.after, ($: any, value: any, key: any) => {
        $.match(state.tryGet(key), {
          none: ($: any) => {
            $(ops.insertOrUpdate(key, variant('insert', value)));
          },
          some: ($: any, held: any) => {
            $.if(East.notEqual(held, value), ($: any) => {
              $(ops.insertOrUpdate(key, variant('update', East.diff(held, value))));
            });
          },
        });
      });
    },
  });
}

/**
 * The program every write form runs: `(State, …Args | Patch, Emit) => Null`.
 *
 * @remarks
 * One program, three forms, one output — the mutation delta, emitted key by
 * key in the delta's own canonical order so the engine never sorts and never
 * holds it whole. The engine applies what comes out (segment by segment, per
 * target); it never evaluates the author's East itself, which is what keeps
 * one rule for where user code runs and gives the three runtimes something to
 * agree on byte for byte.
 *
 * The three forms differ only in how the per-key ops are reached — a diff of
 * the reducer's result, the folded writes of an `edit` body, or the client's
 * own patch — after which the tail is shared: for each touched key, resolve
 * the old and new row, then ask each index what its entry was and what it
 * becomes.
 *
 * The author's functions are bound as function values and CALLED, never
 * spliced: a spliced tree would be re-evaluated per reference and could
 * capture the wrong bindings.
 *
 * @param rec - the record, carrying its indexes
 * @param mut - the mutation declaration
 * @returns the program's IR bundle
 * @throws {Error} When the record's collection has no keyed delta, or an
 *   `edit` / `patch` mutation has no body where one is required.
 */
export function buildMutationProgram(rec: RecordDef, mut: MutationDef): EastIR<any, any> {
  const collection = rec.type as unknown as { type: string; key: EastType; value: EastType };
  if (!hasKeyedDelta(rec.type)) {
    throw new Error(
      `e3.${mut.form === 'reduce' ? 'mutation' : `${mut.form}Mutation`} '${mut.name}' writes a delta, ` +
      `which addresses a Dict or a Set by key; record '${rec.name}' holds ${collection.type}.`);
  }
  const keyed = collection.type as 'Dict' | 'Set';
  const indexes = Object.values(rec.indexes)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const targets = deltaTargets(rec.type, indexes);
  const delta = mutationDeltaType(targets) as unknown as { key: EastType; value: EastType };
  const emitType = FunctionType([delta.key as never, delta.value as never], NullType);
  const primaryOps = patchOpsType(rec.type);
  const opsType = DictType(collection.key as never, primaryOps as never);
  const argTypes: EastType[] = mut.form === 'patch' ? [PatchType(rec.type)] : [...mut.argTypes];
  if (mut.form !== 'patch' && mut.fn === undefined) {
    throw new Error(`e3 mutation '${mut.name}' has no body to build its program from`);
  }

  return East.function(
    [rec.type as never, ...(argTypes as never[]), emitType], NullType,
    ($: any, ...params: any[]) => {
      const state = params[0];
      const emit = params[params.length - 1];
      const args = params.slice(1, params.length - 1);
      const ops = $.let(new Map(), opsType);

      if (mut.form === 'patch') {
        collectOps($, state, args[0], ops, keyed, true);
      } else if (mut.form === 'reduce') {
        const reduce = $.const(mut.fn);
        const next = $.let(reduce(state, ...args));
        collectOps($, state, East.diff(state, next), ops, keyed, false);
      } else {
        foldEdits($, state, mut, args, ops, rec.type);
      }

      if (indexes.length === 0) {
        $.for(ops, ($: any, op: any, key: any) => {
          $(emit(variant('primary', key), variant('primary', op)));
        });
        return null;
      }

      const arms = indexes.map((index) => $.let(new Map(), DictType(
        indexEntryKeyType(collection.key, index.keyType) as never,
        patchOpsType(indexCollectionType(collection.key, index.keyType, index.valueType)) as never)));
      const keyFns = indexes.map((index) => $.const(index.keyFn));
      const valueFns = indexes.map((index) => (index.valueFn === undefined ? undefined : $.const(index.valueFn)));

      $.for(ops, ($: any, op: any, key: any) => {
        const held = $.let(state.tryGet(key));
        const next = $.let(none, OptionType(collection.value));
        $.match(op, {
          insert: ($: any, value: any) => {
            $.assign(next, some(value));
          },
          update: ($: any, patch: any) => {
            $.matchTag(held, 'some', ($: any, value: any) => {
              $.assign(next, some(East.applyPatch(value, patch)));
            });
          },
        });
        indexes.forEach((index, i) => {
          maintainIndex($, index, key, held, next, keyFns[i], valueFns[i], arms[i]);
        });
      });

      for (const target of targets) {
        if (target.name === 'primary') {
          $.for(ops, ($: any, op: any, key: any) => {
            $(emit(variant('primary', key), variant('primary', op)));
          });
          continue;
        }
        const arm = arms[indexes.findIndex((index) => index.name === target.name)];
        $.for(arm, ($: any, op: any, entry: any) => {
          $(emit(variant(target.name, entry), variant(target.name, op)));
        });
      }
      return null;
    }).toIR() as EastIR<any, any>;
}

/**
 * Runs an `edit` body against a capability that folds its writes, then resolves
 * the fold into the per-key ops the tail shares.
 *
 * @remarks
 * `set` is the reason the fold has its own op type: whether it becomes an
 * insert or an update is a fact about the record, not about the body, and the
 * body is not asked to know. Resolving it here is also where a `delete` or an
 * `update` of a key the record does not hold fails — naming the key, as an
 * apply would, rather than reaching the apply as an op that cannot be
 * represented.
 */
function foldEdits(
  $: any, state: any, mut: MutationDef, args: any[], ops: any, recordType: EastType,
): void {
  const { key: keyType, value: valueType } = recordType as unknown as { key: EastType; value: EastType };
  const edits = $.let(new Map(), DictType(keyType as never, editOpsType(valueType) as never));
  const capability = $.const({
    set: East.function([keyType as never, valueType as never], NullType, ($: any, key: any, value: any) => {
      $(edits.insertOrUpdate(key, variant('set', value)));
    }),
    delete: East.function([keyType as never], NullType, ($: any, key: any) => {
      $(edits.insertOrUpdate(key, variant('delete', null)));
    }),
    update: East.function([keyType as never, PatchType(valueType) as never], NullType, ($: any, key: any, patch: any) => {
      $.match(edits.tryGet(key), {
        none: ($: any) => {
          $(edits.insertOrUpdate(key, variant('update', patch)));
        },
        some: ($: any, prior: any) => {
          $.match(prior, {
            set: ($: any, value: any) => {
              $(edits.insertOrUpdate(key, variant('set', East.applyPatch(value, patch))));
            },
            update: ($: any, first: any) => {
              $(edits.insertOrUpdate(key, variant('update', East.composePatch(first, patch, valueType))));
            },
            delete: ($: any) => {
              $.error(East.str`update of ${East.print(key)}, which this mutation already deleted`);
            },
          });
        },
      });
    }),
  }, editTypeOf(recordType));

  const body = $.const(mut.fn);
  $(body(state, ...args, capability));

  $.for(edits, ($: any, edit: any, key: any) => {
    const held = $.let(state.tryGet(key));
    $.match(edit, {
      set: ($: any, value: any) => {
        $.match(held, {
          some: ($: any, prior: any) => {
            $(ops.insertOrUpdate(key, variant('update', East.diff(prior, value))));
          },
          none: ($: any) => {
            $(ops.insertOrUpdate(key, variant('insert', value)));
          },
        });
      },
      delete: ($: any) => {
        $.match(held, {
          some: ($: any, prior: any) => {
            $(ops.insertOrUpdate(key, variant('delete', prior)));
          },
          none: ($: any) => {
            $.error(East.str`delete of ${East.print(key)}, which the record does not hold`);
          },
        });
      },
      update: ($: any, patch: any) => {
        $.match(held, {
          some: ($: any) => {
            $(ops.insertOrUpdate(key, variant('update', patch)));
          },
          none: ($: any) => {
            $.error(East.str`update of ${East.print(key)}, which the record does not hold`);
          },
        });
      },
    });
  });
}

/**
 * Writes one index's entry changes for one touched row into that index's arm.
 *
 * @remarks
 * An index entry is `{ik, k}`, so a row moving from one index key to another is
 * a delete at the old entry and an insert at the new one — not an update. Only
 * an entry that keeps its index key and whose covering projection changed is an
 * update, and an index carrying no projection has none of those at all.
 */
function maintainIndex(
  $: any, index: RecordIndexDef, key: any, held: any, next: any,
  indexKey: any, project: any, arm: any,
): void {
  const heldKeys = $.let(new Set(), SetType(index.keyType as never));
  const nextKeys = $.let(new Set(), SetType(index.keyType as never));
  const heldValue = $.let(none, OptionType(index.valueType));
  const nextValue = $.let(none, OptionType(index.valueType));
  const gather = (keys: any, value: any) => ($: any, row: any) => {
    if (index.multi) {
      $.for(indexKey(key, row), ($: any, ik: any) => {
        $(keys.insert(ik));
      });
    } else {
      $(keys.insert(indexKey(key, row)));
    }
    $.assign(value, some(project === undefined ? null : project(key, row)));
  };
  $.matchTag(held, 'some', gather(heldKeys, heldValue));
  $.matchTag(next, 'some', gather(nextKeys, nextValue));

  $.for(heldKeys.difference(nextKeys), ($: any, ik: any) => {
    $(arm.insertOrUpdate({ ik, k: key }, variant('delete', heldValue.unwrap())));
  });
  $.for(nextKeys.difference(heldKeys), ($: any, ik: any) => {
    $(arm.insertOrUpdate({ ik, k: key }, variant('insert', nextValue.unwrap())));
  });
  if (project === undefined) return;
  $.for(heldKeys.intersection(nextKeys), ($: any, ik: any) => {
    const before = $.let(heldValue.unwrap());
    const after = $.let(nextValue.unwrap());
    $.if(East.notEqual(before, after), ($: any) => {
      $(arm.insertOrUpdate({ ik, k: key }, variant('update', East.diff(before, after))));
    });
  });
}
