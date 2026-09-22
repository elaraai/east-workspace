/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The East programs a record's declarations generate.
 *
 * An author declares what an index keys on; what actually runs is a program
 * built from that declaration — an ordinary East function assembled at export
 * time from the author's own expressions, the way `partitionTask` builds its
 * merge command and `streamTask` its command IR. It is linked and encoded like
 * any other body, runs on the runner the author chose, and is what keeps e3
 * out of the business of evaluating user East: the engine runs a program and
 * applies what it emits.
 *
 * @packageDocumentation
 */

import {
  DictType,
  East,
  FunctionType,
  NullType,
  StructType,
  type EastIR,
  type EastType,
} from '@elaraai/east';
import type { RecordIndexDef } from './types.js';

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
