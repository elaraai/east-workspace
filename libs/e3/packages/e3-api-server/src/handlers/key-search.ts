/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Key searches over a stored Set or Dict: a query compiled into the monotone
 * bounds it locates, and the bounds of many queries located together, each
 * segment they touch read once (#1351).
 *
 * Every form of a search addresses one contiguous row range in the canonical
 * key order, so each is one or two monotone predicates — false, then true,
 * over the keys in order — and a predicate's boundary row is found by a bisect
 * of the manifest's fences, which reads nothing, then a binary search of the
 * one segment that holds it, which decodes the keys it compares and no value.
 * A search through an index addresses the index
 * key, `ik`, and ranges bound the index collection's flattened key.
 *
 * @packageDocumentation
 */

import { compareFor, keyAtOrPast, keyLeaves, parseFor, some, type EastTypeValue, type option } from '@elaraai/east';
import type { DatasetSegments, StorageBackend } from '@elaraai/e3-core/portable';
import { decodedSegments, firstWhere } from './segments.js';

/**
 * One key search: exactly one form — `key` (a whole-key `.east` literal),
 * `prefix` and/or `fields` (exact leading fields of a Struct key, then a
 * String prefix of the next), or a `from`/`to` range of `.east` literals of a
 * leading prefix of the flattened key.
 */
export interface KeySearchQuery {
  key?: string;
  prefix?: string;
  fields?: string[];
  from?: string[];
  to?: string[];
}

/** Where a bound fell: its row, and the key at that row when there is one. */
export interface Located {
  row: number;
  key: unknown;
  hasKey: boolean;
}

/** Why a query cannot be searched, as a route refuses it. */
export interface KeySearchRefusal {
  /** The error's type: `bad_request` or `key_parse_error`. */
  type: string;
  message: string;
}

/** A compiled search: the bounds it locates, and its answer from where they fell. */
export interface KeySearch {
  /** The monotone predicates to locate, in order. */
  readonly bounds: readonly ((key: unknown) => boolean)[];
  /**
   * The answer, from where each bound fell.
   *
   * @param located - Each bound's location, in the order of {@link bounds}
   * @param elementCount - The collection's element count, which an open end
   *   of a range reaches
   */
  answer(located: readonly Located[], elementCount: number): { found: boolean; row: number; count: number };
}

/** What a search is compiled against: the collection it searches. */
export interface KeySearchTarget {
  /** The collection's key type: a Dict's key, a Set's element — for an index,
   *  `{ik, k}`. */
  keyType: EastTypeValue;
  /** Whether the collection is an index, whose forms address `ik`. */
  indexed: boolean;
  /** How a refusal names the keys searched. */
  keysNoun: string;
}

/**
 * Compiles a key search against a collection: its bounds, or why it cannot be
 * searched.
 *
 * @param query - The search
 * @param target - The collection's key type, and whether it is an index
 * @returns The compiled search, or the refusal a route answers it with
 */
export function compileKeySearch(query: KeySearchQuery, target: KeySearchTarget): KeySearch | KeySearchRefusal {
  const { keyType: keyTypeValue, indexed, keysNoun } = target;
  // Through an index, the key, prefix and fields forms address the index key
  // `ik` — the key a client holds, as the record's signature names it — not
  // the collection's `{ik, k}`, which pairs it with each row's own key. The
  // collection sorts by `ik` first, so a predicate over it is monotone over
  // the collection's order. The range form bounds the collection's
  // flattened key, which begins inside `ik`.
  const formKeyType: EastTypeValue = indexed
    ? (keyTypeValue.value as { name: string; type: EastTypeValue }[]).find((f) => f.name === 'ik')!.type
    : keyTypeValue;
  const formKey = indexed ? (k: unknown): unknown => (k as { ik: unknown }).ik : (k: unknown): unknown => k;

  const fields = query.fields !== undefined && query.fields.length > 0 ? query.fields : undefined;
  const ranged = (query.from !== undefined && query.from.length > 0) || (query.to !== undefined && query.to.length > 0);
  const forms = [query.key !== undefined, query.prefix !== undefined || fields !== undefined, ranged];
  if (forms.filter(Boolean).length !== 1) {
    return { type: 'bad_request', message: 'Pass a key literal, or a prefix and/or leading fields, or a from/to range — exactly one form' };
  }

  // The range form's bounds are leading parts of the key — its first leaves,
  // in the order the collection is sorted in — so each bounds one contiguous
  // row range. The rule is East's own (`keyLeaves`, `keyAtOrPast`, #1616): the
  // one an East function's `range` reads by.
  const leaves = keyLeaves(keyTypeValue);
  const parseBound = (label: string, literals: string[] | undefined): { values: unknown[] } | KeySearchRefusal => {
    if (literals === undefined || literals.length === 0) return { values: [] };
    if (literals.length > leaves.length) {
      return {
        type: 'bad_request',
        message: `${label} names ${literals.length} key fields, but the key flattens to ${leaves.length}: `
          + leaves.map((leaf) => leaf.path.join('.') || '(the key)').join(', '),
      };
    }
    const values: unknown[] = [];
    for (let i = 0; i < literals.length; i++) {
      const parsed = parseFor(leaves[i]!.type)(literals[i]!);
      if (!parsed.success) {
        return { type: 'key_parse_error', message: `${label} field '${leaves[i]!.path.join('.') || '(the key)'}': ${parsed.error}` };
      }
      values.push(parsed.value);
    }
    return { values };
  };
  const lowerBound = parseBound('from', query.from);
  if ('type' in lowerBound) return lowerBound;
  const upperBound = parseBound('to', query.to);
  if ('type' in upperBound) return upperBound;
  const structMeta = formKeyType.type === 'Struct'
    ? formKeyType.value as { name: string; type: EastTypeValue }[]
    : null;
  if (fields !== undefined) {
    if (structMeta === null) {
      return { type: 'bad_request', message: `Leading-field search addresses Struct keys; ${keysNoun} are ${formKeyType.type}` };
    }
    if (fields.length > structMeta.length) {
      return { type: 'bad_request', message: `Key has ${structMeta.length} fields, got ${fields.length}` };
    }
  }
  const fieldValues: unknown[] = [];
  if (fields !== undefined && structMeta !== null) {
    for (let j = 0; j < fields.length; j++) {
      const parsed = parseFor(structMeta[j]!.type)(fields[j]!);
      if (!parsed.success) {
        return { type: 'key_parse_error', message: `field '${structMeta[j]!.name}': ${parsed.error}` };
      }
      fieldValues.push(parsed.value);
    }
  }
  let optionalPrefix = false;
  let prefixValue: unknown = query.prefix;
  if (query.prefix !== undefined) {
    const prefixIdx = fieldValues.length;
    const prefixFieldType = structMeta !== null
      ? (prefixIdx < structMeta.length ? structMeta[prefixIdx]!.type : undefined)
      : formKeyType;
    if (prefixFieldType === undefined) {
      return { type: 'bad_request', message: `All ${structMeta!.length} key fields are exact — nothing left for a prefix` };
    }
    if (prefixFieldType.type === 'Variant') {
      const cases = prefixFieldType.value as { name: string; type: EastTypeValue }[];
      optionalPrefix = cases.length === 2
        && cases.some(c => c.name === 'none' && c.type.type === 'Null')
        && cases.some(c => c.name === 'some' && c.type.type === 'String');
    }
    if (prefixFieldType.type !== 'String' && !optionalPrefix) {
      return {
        type: 'bad_request',
        message: structMeta !== null
          ? `prefix continues key field '${structMeta[prefixIdx]!.name}', which is ${prefixFieldType.type}, not String or Option<String>`
          : `prefix search needs String or Option<String> keys; ${keysNoun} are ${formKeyType.type}`,
      };
    }
    if (optionalPrefix) prefixValue = some(query.prefix);
  }
  const matchesPrefix = (value: unknown): boolean => {
    if (!optionalPrefix) return (value as string).startsWith(query.prefix!);
    const option = value as option<string>;
    return option.type === 'some' && option.value.startsWith(query.prefix!);
  };
  let keyValue: unknown;
  if (query.key !== undefined) {
    const parsed = parseFor(formKeyType)(query.key);
    if (!parsed.success) {
      return { type: 'key_parse_error', message: parsed.error };
    }
    keyValue = parsed.value;
  }
  const cmp = compareFor(formKeyType);

  if (ranged) {
    // Two bisects, one contiguous range: `[from, to)` on the flattened
    // prefix. An absent bound is the collection's own end.
    const hasLower = query.from !== undefined && query.from.length > 0;
    const hasUpper = query.to !== undefined && query.to.length > 0;
    const bounds = [
      ...(hasLower ? [keyAtOrPast(leaves, lowerBound.values)] : []),
      ...(hasUpper ? [keyAtOrPast(leaves, upperBound.values)] : []),
    ];
    return {
      bounds,
      answer(located, elementCount) {
        const lower = hasLower ? located[0]!.row : 0;
        const upper = hasUpper ? located[hasLower ? 1 : 0]!.row : elementCount;
        const count = Math.max(0, upper - lower);
        return { found: count > 0, row: lower, count };
      },
    };
  }
  if (query.key !== undefined) {
    if (indexed) {
      // An index holds an entry per row under a key, so a key is a run.
      return {
        bounds: [(k) => cmp(formKey(k), keyValue) >= 0, (k) => cmp(formKey(k), keyValue) > 0],
        answer(located) {
          const count = located[1]!.row - located[0]!.row;
          return { found: count > 0, row: located[0]!.row, count };
        },
      };
    }
    return {
      bounds: [(k) => cmp(formKey(k), keyValue) >= 0],
      answer(located) {
        const at = located[0]!;
        const found = at.hasKey && cmp(at.key, keyValue) === 0;
        return { found, row: at.row, count: found ? 1 : 0 };
      },
    };
  }
  // Range query — a String prefix, or a struct key's exact leading fields
  // with an optional prefix on the next field. Both predicates depend only on
  // the leading field tuple, and struct keys compare field-by-field in
  // declaration order, so they are monotone over the canonical key order;
  // prefix-extending strings form one contiguous interval in East
  // (code-point) order.
  let lowerPred: (k: unknown) => boolean;
  let upperPred: (k: unknown) => boolean;
  const prefix = query.prefix;
  if (structMeta !== null) {
    const fieldCmps = structMeta.map((f) => compareFor(f.type));
    const lead = (k: unknown): number => {
      const key = formKey(k) as Record<string, unknown>;
      for (let j = 0; j < fieldValues.length; j++) {
        const c = fieldCmps[j]!(key[structMeta[j]!.name], fieldValues[j]);
        if (c !== 0) return c;
      }
      return 0;
    };
    if (prefix === undefined) {
      lowerPred = (k) => lead(k) >= 0;
      upperPred = (k) => lead(k) > 0;
    } else {
      const prefixIdx = fieldValues.length;
      const prefixName = structMeta[prefixIdx]!.name;
      const prefixCmp = fieldCmps[prefixIdx]!;
      lowerPred = (k) => {
        const c = lead(k);
        return c !== 0 ? c > 0 : prefixCmp((formKey(k) as Record<string, unknown>)[prefixName], prefixValue) >= 0;
      };
      upperPred = (k) => {
        const c = lead(k);
        if (c !== 0) return c > 0;
        const field = (formKey(k) as Record<string, unknown>)[prefixName];
        return prefixCmp(field, prefixValue) > 0 && !matchesPrefix(field);
      };
    }
  } else {
    // Scalar String / Option<String> keys: none sorts before every
    // some(String), so the same pair of monotone predicates bounds only
    // present strings, including for an empty prefix.
    lowerPred = (k) => cmp(formKey(k), prefixValue) >= 0;
    upperPred = (k) => cmp(formKey(k), prefixValue) > 0 && !matchesPrefix(formKey(k));
  }
  return {
    bounds: [lowerPred, upperPred],
    answer(located) {
      const count = located[1]!.row - located[0]!.row;
      return { found: count > 0, row: located[0]!.row, count };
    },
  };
}

/**
 * Where each of many monotone predicates first holds over a stored Set or
 * Dict's keys, in canonical order — each segment the predicates land in read
 * once, several at a time, and searched in by bisection.
 *
 * @remarks
 * A predicate's segment is found by a bisect of the manifest's fences, which
 * reads nothing: the greatest segment whose fence it does not hold at. Every
 * segment so found is read once for all the predicates landing in it, through
 * the kept segments, and each predicate's row is a binary search of that
 * segment's keys, each decoded as the search compares it — no value is built.
 * When the boundary is the first row of a later segment,
 * that segment's fence is the key there, and nothing more is read.
 *
 * @param storage - The backend the collection is read through
 * @param repo - The repository it is in
 * @param segments - The opened collection, a Set or a Dict
 * @param preds - The predicates, each false, then true, over the keys in order
 * @returns Each predicate's location, in order
 */
export async function locateAll(
  storage: StorageBackend, repo: string, segments: DatasetSegments, preds: readonly ((key: unknown) => boolean)[],
): Promise<Located[]> {
  const located: (Located | number)[] = new Array(preds.length);
  const segmentCount = segments.segmentCount;
  for (let p = 0; p < preds.length; p++) {
    const pred = preds[p]!;
    if (segmentCount === 0) {
      located[p] = { row: 0, key: undefined, hasKey: false };
      continue;
    }
    const first = await segments.fence(0);
    if (pred(first)) {
      located[p] = { row: 0, key: first, hasKey: true };
      continue;
    }
    // Greatest segment whose fence is before the boundary.
    let lo = 0;
    let hi = segmentCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (!pred(await segments.fence(mid))) lo = mid;
      else hi = mid - 1;
    }
    located[p] = lo;
  }
  const decoded = await decodedSegments(storage, repo, segments,
    located.filter((entry): entry is number => typeof entry === 'number'));
  const out: Located[] = new Array(preds.length);
  for (let p = 0; p < preds.length; p++) {
    const entry = located[p]!;
    if (typeof entry !== 'number') {
      out[p] = entry;
      continue;
    }
    const segment = decoded.get(entry)!;
    const pred = preds[p]!;
    const at = firstWhere(segment.count, (row) => pred(segment.key(row)));
    const base = entry === 0 ? 0 : segments.cumulative[entry - 1]!;
    if (at < segment.count) {
      out[p] = { row: base + at, key: segment.key(at), hasKey: true };
    } else if (entry + 1 < segmentCount) {
      out[p] = { row: segments.cumulative[entry]!, key: await segments.fence(entry + 1), hasKey: true };
    } else {
      out[p] = { row: segments.elementCount, key: undefined, hasKey: false };
    }
  }
  return out;
}
