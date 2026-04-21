/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Data manifest for UI tasks — declares which datasets a UI binds to via
 * `Data.bind()`. Stored as a beast2-encoded blob in the task's `metadata`.
 *
 * @packageDocumentation
 */

import { StructType, ArrayType, encodeBeast2For, decodeBeast2For, type ValueTypeOf } from '@elaraai/east';
import { TreePathType } from '@elaraai/e3-types';

/**
 * East type for the UI binding manifest.
 *
 * @property paths - Dataset paths this UI accesses (read or write) via Data.bind.
 */
export const DataManifestType = StructType({
  paths: ArrayType(TreePathType),
});

export type DataManifest = ValueTypeOf<typeof DataManifestType>;

/** Encode a manifest to beast2 bytes for storage in task metadata. */
export function encodeManifest(manifest: DataManifest): Uint8Array {
  return encodeBeast2For(DataManifestType)(manifest);
}

/** Decode a manifest from beast2 bytes. */
export function decodeManifest(blob: Uint8Array): DataManifest {
  return decodeBeast2For(DataManifestType)(blob);
}
