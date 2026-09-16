/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ONE check that a value's wire type is the type its dataset declares.
 *
 * No door into a dataset used to compare the two. `workspaceSetDataset`
 * validated the path and the `writable` flag and then encoded with whatever
 * type the caller passed; `e3 dataset set` passed a `.beast2` argument's own
 * header type; the API `PUT` forwarded the body's header type; the transfer
 * commit checked only that a collection blob carried an index. So a delivery
 * whose schema had moved was accepted at the boundary and failed later, inside
 * the consuming task — a decode error on the runner, or `cannot open a blob of
 * type ... as ...` out of `FileSystem.openBeast` — naming neither the dataset
 * that was set nor the field that moved.
 *
 * This lives in `e3-types` for the reason {@link encodeDatasetBlob} does: the
 * rule has to hold at every door, and the doors are spread across `e3` (the
 * export's `file` source check), `e3-core` (the set and the adopt) and
 * `e3-api-server` (the `PUT` and the transfer commit), which share no package
 * above this one.
 *
 * **Equality, not assignability.** A runner decodes the object *by the declared
 * type* and beast2 decoding is type-directed, so a blob that is merely a
 * subtype still decodes wrong. `isTypeValueEqual` is the relation.
 *
 * @packageDocumentation
 */

import {
  diffTypeValues,
  isTypeValueEqual,
  isVariant,
  printTypeValueSummary,
  renderTypeDiff,
  toEastTypeValue,
  type EastType,
  type EastTypeValue,
  type TypeDiff,
} from '@elaraai/east';

/**
 * A declared type and a wire type that disagree, localized to the first
 * differing position.
 */
export interface DatasetTypeMismatch {
  /** The type the dataset declares. */
  readonly declared: EastTypeValue;
  /** The type the bytes carry. */
  readonly given: EastTypeValue;
  /** Every localized difference — see `diffTypeValues`. */
  readonly diffs: readonly TypeDiff[];
  /** The one-line message every door reports. */
  readonly message: string;
}

/** Normalizes either type representation to the homoiconic value form. */
function asTypeValue(type: EastType | EastTypeValue): EastTypeValue {
  return isVariant(type) ? (type as EastTypeValue) : toEastTypeValue(type as EastType);
}

/**
 * Compares a dataset's declared type with the type some bytes carry.
 *
 * @param subject - what is being written, as it should read at the head of the
 * message — e.g. `dataset '.inputs.table'` or `input 'table'`
 * @param carrier - what carries the given type, e.g. `the value` or a file path
 * @param declared - the type the dataset declares
 * @param given - the type the bytes carry
 * @returns `null` when the types are equal, else the localized mismatch
 *
 * @example
 * ```ts
 * const bad = checkDatasetType("dataset '.inputs.table'", 'the value', declared, header);
 * if (bad) throw new DatasetTypeMismatchError(ws, '.inputs.table', bad);
 * ```
 */
export function checkDatasetType(
  subject: string,
  carrier: string,
  declared: EastType | EastTypeValue,
  given: EastType | EastTypeValue,
): DatasetTypeMismatch | null {
  const declaredValue = asTypeValue(declared);
  const givenValue = asTypeValue(given);
  if (isTypeValueEqual(declaredValue, givenValue)) return null;

  // Equality failed, so a diff normally localizes it — except where the two are
  // assignable but unequal (a subtype, or the same struct fields in another
  // order), which the assignability-shaped diff prunes to nothing. Say so
  // plainly rather than printing a headline with no location under it.
  const diffs = diffTypeValues(givenValue, declaredValue);
  const first = diffs[0];
  const where = first
    ? `first difference at ${renderTypeDiff([first])}`
    : 'the two are assignable but not identical — a dataset is decoded by its declared type, ' +
      `so the bytes must carry exactly it${structuralHint(declaredValue, givenValue)}`;

  return {
    declared: declaredValue,
    given: givenValue,
    diffs,
    message:
      `${subject} declares ${printTypeValueSummary(declaredValue, 2)} but ${carrier} carries ` +
      `${printTypeValueSummary(givenValue, 2)} — ${where}`,
  };
}

/** Names the commonest assignable-but-unequal case: the same struct fields in a
 *  different order (East struct field order is significant on the wire). */
function structuralHint(declared: EastTypeValue, given: EastTypeValue): string {
  if (declared.type !== 'Struct' || given.type !== 'Struct') return '';
  const declaredOrder = (declared.value as { name: string }[]).map((f) => f.name);
  const givenOrder = (given.value as { name: string }[]).map((f) => f.name);
  if (declaredOrder.length !== givenOrder.length) return '';
  const key = (names: string[]) => names.join('\\');
  if (key([...declaredOrder].sort()) !== key([...givenOrder].sort())) return '';
  if (key(declaredOrder) === key(givenOrder)) return '';
  return ` (same fields, different order: expected ${declaredOrder.join(', ')}; found ${givenOrder.join(', ')})`;
}

/**
 * Renders a dataset's tree path as it appears in messages: `.inputs.table`.
 *
 * Exported so every door spells the subject identically.
 *
 * @param segments - the path's field names, root-first
 * @returns the dotted address, or `(root)` for an empty path
 */
export function datasetAddress(segments: readonly string[]): string {
  return segments.length === 0 ? '(root)' : segments.map((s) => `.${s}`).join('');
}
