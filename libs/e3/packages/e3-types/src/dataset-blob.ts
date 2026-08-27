/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ONE encoder that decides how a dataset value is stored.
 *
 * Collection-rooted values (Array / Set / Dict) are ALWAYS stored segmented
 * with a trailing index, at every size: one uniform encoding per logical value,
 * so the paged read API can decode just the segments a window touches and the
 * key search can bisect the segment fences. Every other root is stored whole.
 *
 * This lives in `e3-types` — the floor both `e3` and `e3-core` stand on —
 * because the rule has to hold at EVERY door a value enters the store through,
 * and it did not. The store path (`e3-core`'s `datasetWrite`) segmented; the
 * package export path (`e3`'s `export_`) encoded flat regardless of root kind.
 * Since `workspaceDeploy` copies package refs verbatim, a freshly deployed
 * collection input pointed at an unindexed blob and could not be paged at all
 * — `dataset_not_indexed`, with no whole-decode fallback — until something
 * happened to WRITE the dataset, at which point it silently started working.
 * A demo poked by hand behaved differently from a workspace only deployed.
 *
 * So: one branch, one home, and both doors call it.
 *
 * @packageDocumentation
 */

import {
  encodeBeast2For,
  encodeBeast2PagedFor,
  isVariant,
  toEastTypeValue,
  type EastType,
  type EastTypeValue,
} from '@elaraai/east';

/**
 * Whether a dataset root type is a collection — the kinds stored segmented +
 * indexed so the paged read API can seek.
 *
 * @param typeValue - The dataset's root type
 * @returns true for Array / Set / Dict roots
 */
export function isCollectionRoot(typeValue: EastTypeValue): boolean {
  return typeValue.type === 'Array' || typeValue.type === 'Set' || typeValue.type === 'Dict';
}

/**
 * Encode a dataset value for the object store.
 *
 * @remarks
 * The single point where segmentation is decided. Callers must not choose an
 * encoder themselves: a value that reaches the store unsegmented is one the
 * paged endpoints refuse, and nothing on the read path can repair it.
 *
 * @param type - The dataset's declared type (an `EastType` or its homoiconic value)
 * @param value - The value to encode
 * @returns The beast2 bytes to store — segmented + indexed for a collection root
 */
export function encodeDatasetBlob(type: EastType | EastTypeValue, value: unknown): Uint8Array {
  const typeValue: EastTypeValue = isVariant(type)
    ? (type as EastTypeValue)
    : toEastTypeValue(type as EastType);
  return isCollectionRoot(typeValue)
    ? encodeBeast2PagedFor(typeValue)(value)
    : encodeBeast2For(typeValue)(value);
}
