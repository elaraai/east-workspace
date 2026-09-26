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
 * function. It is linked and
 * encoded like any other body, runs on the runner the author chose, and is
 * what keeps e3 out of the business of evaluating user East: the engine runs a
 * program and applies what it emits.
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
  DELTA_CONFLICT, editTypeOf, indexCollectionType, mutationDeltaType, patchOpsType, type DeltaTarget,
} from '@elaraai/e3-types';
import type { MigrationDef, MutationDef, RecordDef, RecordIndexDef } from './types.js';

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
 * The build program of an index: `(piece, emit) => Null`.
 *
 * @remarks
 * Called with a piece of the primary — a whole small record, or one piece of a
 * large one — it emits each row's index entries as it reads the row. Index
 * order is not primary order, and need not be: the runner writes a `dict`
 * output through its RunSorter, which sorts what it is given, so the program
 * holds no more than the row in hand.
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
  const entryKey = indexEntryKeyType(dict.key, def.keyType);
  const emitType = FunctionType([entryKey as never, def.valueType], NullType);

  return East.function([recordType as never, emitType], NullType, ($: any, piece: any, emit: any) => {
    const indexKey = $.const(def.keyFn);
    const project = def.valueFn === undefined ? undefined : $.const(def.valueFn);
    $.for(piece, ($: any, row: any, key: any) => {
      const value = project === undefined ? null : $.const(project(key, row));
      if (def.multi) {
        $.for(indexKey(key, row), ($: any, ik: any) => {
          $(emit({ ik, k: key }, value));
        });
      } else {
        $(emit({ ik: indexKey(key, row), k: key }, value));
      }
    });
    return null;
  }).toIR() as EastIR<any, any>;
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
 * The author's function is bound as a function value and CALLED, never
 * spliced: a spliced expression tree would be re-evaluated per reference and
 * could capture the wrong bindings.
 *
 * @param def - the migration, a `rows` or `rekey` step
 * @returns the program's IR bundle
 * @throws {Error} When the step is a `value` step, whose own function runs.
 */
export function migrationProgram(def: MigrationDef): EastIR<any, any> {
  if (def.form === 'value') {
    throw new Error(`e3.migration.value '${def.name}' runs its own function, and has no program`);
  }
  const to = def.to as unknown as { type: string; key: EastType; value: EastType };
  const emitType = to.type === 'Dict'
    ? FunctionType([to.key as never, to.value as never], NullType)
    : FunctionType([(to.type === 'Array' ? to.value : to.key) as never], NullType);

  return East.function([def.from as never, emitType], NullType, ($: any, piece: any, emit: any) => {
    const step = $.const(def.fn);
    if (to.type !== 'Dict') {
      $.for(piece, ($: any, element: any) => {
        $(emit(step(element)));
      });
    } else if (def.form === 'rows') {
      $.for(piece, ($: any, row: any, key: any) => {
        $(emit(key, step(key, row)));
      });
    } else {
      $.for(piece, ($: any, row: any, key: any) => {
        const entry = $.let(step(key, row));
        $(emit(entry.key, entry.value));
      });
    }
    return null;
  }).toIR() as EastIR<any, any>;
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
 * apply's cost proportional to what actually differs. A client's `replace`
 * whose `before` the record no longer holds is a stale write, emitted as the
 * delta's conflict.
 */
function collectOps(
  $: any, state: any, patchExpr: any, ops: any, keyed: 'Dict' | 'Set', verifyBefore: boolean, emit: any,
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
          $(emit(
            variant(DELTA_CONFLICT, 'the patch replaces a state the record no longer holds'),
            variant(DELTA_CONFLICT, null)));
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
 * One program, three forms, one output — the mutation delta, emitted entry by
 * entry as it is computed, in any order: the runner writes a `dict` output
 * through its RunSorter, which sorts it. e3 stores the delta as segments and
 * applies it one target segment at a time; it never evaluates the author's
 * East itself, which is what keeps one rule for where user code runs and gives
 * the three runtimes something to agree on byte for byte.
 *
 * The three forms differ only in how the per-key ops are reached — a diff of
 * the reducer's result, the folded writes of an `edit` body, or the client's
 * own patch — after which the tail is shared: for each touched key, emit its
 * op, then resolve the old and new row and ask each index what its entry was
 * and what it becomes.
 *
 * A write the state moved under — a patch whose `before` the record no longer
 * holds, an update of a row that no longer matches, a delete or update of a
 * key the record does not hold — is emitted as a {@link DELTA_CONFLICT} entry
 * naming it, which sorts first, rather than failing the program: a caller
 * resubmits a conflict and gives up on a failure.
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
      `e3.mutation.${mut.form} '${mut.name}' writes a delta, ` +
      `which addresses a Dict or a Set by key; record '${rec.name}' holds ${collection.type}.`);
  }
  const keyed = collection.type as 'Dict' | 'Set';
  const indexes = Object.values(rec.indexes)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const delta = mutationDeltaType(deltaTargets(rec.type, indexes)) as unknown as { key: EastType; value: EastType };
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
        collectOps($, state, args[0], ops, keyed, true, emit);
      } else if (mut.form === 'reduce') {
        const reduce = $.const(mut.fn);
        const next = $.let(reduce(state, ...args));
        collectOps($, state, East.diff(state, next), ops, keyed, false, emit);
      } else {
        foldEdits($, state, mut, args, ops, rec.type, emit);
      }

      const keyFns = indexes.map((index) => $.const(index.keyFn));
      const valueFns = indexes.map((index) => (index.valueFn === undefined ? undefined : $.const(index.valueFn)));

      $.for(ops, ($: any, op: any, key: any) => {
        $(emit(variant('primary', key), variant('primary', op)));
        if (indexes.length === 0) return;
        const held = $.let(state.tryGet(key));
        const next = $.let(none, OptionType(collection.value));
        $.match(op, {
          insert: ($: any, value: any) => {
            $.assign(next, some(value));
          },
          update: ($: any, patch: any) => {
            $.matchTag(held, 'some', ($: any, value: any) => {
              // Applying a patch verifies the row it was made against, and a
              // row that no longer matches is a stale write — the conflict the
              // engine reports when it applies an unindexed record's patch.
              // Named in words every runtime shares: each one's own apply
              // message is different.
              $.try(($: any) => {
                $.assign(next, some(East.applyPatch(value, patch)));
              }).catch(($: any) => {
                $(emit(
                  variant(DELTA_CONFLICT, East.str`update of ${East.print(key)}, whose row no longer matches the patch`),
                  variant(DELTA_CONFLICT, null)));
              });
            });
          },
        });
        indexes.forEach((index, i) => {
          maintainIndex($, index, key, held, next, keyFns[i], valueFns[i], emit);
        });
      });
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
 * `update` of a key the record does not hold is found — emitted as the
 * delta's conflict naming the key, as an apply would name it, rather than
 * reaching the apply as an op that cannot be represented.
 */
function foldEdits(
  $: any, state: any, mut: MutationDef, args: any[], ops: any, recordType: EastType, emit: any,
): void {
  const { key: keyType, value: valueType } = recordType as unknown as { key: EastType; value: EastType };
  const edits = $.let(new Map(), DictType(keyType as never, editOpsType(valueType) as never));
  const capability = $.const({
    set: East.function([keyType as never, valueType as never], NullType, ($: any, key: any, value: any) => {
      $(edits.insertOrUpdate(key, variant('set', value)));
    }),
    delete: East.function([keyType as never], NullType, ($: any, key: any) => {
      $.if(state.has(key), ($: any) => {
        $(edits.insertOrUpdate(key, variant('delete', null)));
      }).else(($: any) => {
        // The record does not hold the key, so a pending `set` of it is this
        // body creating it: deleting it again leaves the record as it was, and
        // there is nothing to write. Anything else is a delete of a key the
        // record does not hold, which resolving refuses.
        $.match(edits.tryGet(key), {
          some: ($: any, prior: any) => {
            $.match(prior, {
              set: ($: any) => {
                $(edits.delete(key));
              },
              delete: ($: any) => {
                $(edits.insertOrUpdate(key, variant('delete', null)));
              },
              update: ($: any) => {
                $(edits.insertOrUpdate(key, variant('delete', null)));
              },
            });
          },
          none: ($: any) => {
            $(edits.insertOrUpdate(key, variant('delete', null)));
          },
        });
      });
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
            // A `set` of what the record already holds changed nothing, and a
            // delta says what changed: an op here would re-cut the segment to
            // the bytes it already has and count itself in the history.
            $.if(East.notEqual(prior, value), ($: any) => {
              $(ops.insertOrUpdate(key, variant('update', East.diff(prior, value))));
            });
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
            $(emit(
              variant(DELTA_CONFLICT, East.str`delete of ${East.print(key)}, which the record does not hold`),
              variant(DELTA_CONFLICT, null)));
          },
        });
      },
      update: ($: any, patch: any) => {
        $.match(held, {
          some: ($: any) => {
            $(ops.insertOrUpdate(key, variant('update', patch)));
          },
          none: ($: any) => {
            $(emit(
              variant(DELTA_CONFLICT, East.str`update of ${East.print(key)}, which the record does not hold`),
              variant(DELTA_CONFLICT, null)));
          },
        });
      },
    });
  });
}

/**
 * Emits one index's entry changes for one touched row.
 *
 * @remarks
 * An index entry is `{ik, k}`, so a row moving from one index key to another is
 * a delete at the old entry and an insert at the new one — not an update. Only
 * an entry that keeps its index key and whose covering projection changed is an
 * update, and an index carrying no projection has none of those at all. The
 * three sets are disjoint and `k` is this row's, so no entry is emitted twice.
 */
function maintainIndex(
  $: any, index: RecordIndexDef, key: any, held: any, next: any,
  indexKey: any, project: any, emit: any,
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
    $(emit(variant(index.name, { ik, k: key }), variant(index.name, variant('delete', heldValue.unwrap()))));
  });
  $.for(nextKeys.difference(heldKeys), ($: any, ik: any) => {
    $(emit(variant(index.name, { ik, k: key }), variant(index.name, variant('insert', nextValue.unwrap()))));
  });
  if (project === undefined) return;
  $.for(heldKeys.intersection(nextKeys), ($: any, ik: any) => {
    const before = $.let(heldValue.unwrap());
    const after = $.let(nextValue.unwrap());
    $.if(East.notEqual(before, after), ($: any) => {
      $(emit(variant(index.name, { ik, k: key }), variant(index.name, variant('update', East.diff(before, after)))));
    });
  });
}
