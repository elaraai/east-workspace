/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Data manifest for UI tasks — declares which datasets a UI binds to via
 * `Data.bind()` and which named functions it calls via `Func.bind()`.
 * Stored as a beast2-encoded blob in the task's `metadata`.
 *
 * @packageDocumentation
 */

import { StructType, ArrayType, StringType, encodeBeast2For, decodeBeast2For, type ValueTypeOf } from '@elaraai/east';
import { TreePathType } from '@elaraai/e3-types';

/**
 * East type for the UI binding manifest.
 *
 * @property paths - Dataset paths this UI accesses (read or write) via Data.bind.
 * @property functions - Named package functions this UI calls via Func.bind.
 */
export const DataManifestType = StructType({
  paths: ArrayType(TreePathType),
  functions: ArrayType(StringType),
});

export type DataManifest = ValueTypeOf<typeof DataManifestType>;

/** The pre-`functions` manifest shape — kept for dual-decode of blobs
 *  written by older SDKs. */
const LegacyDataManifestType = StructType({
  paths: ArrayType(TreePathType),
});

/** Encode a manifest to beast2 bytes for storage in task metadata. */
export function encodeManifest(manifest: DataManifest): Uint8Array {
  return encodeBeast2For(DataManifestType)(manifest);
}

/**
 * Decode a manifest from beast2 bytes.
 *
 * @remarks
 * Dual-decode: tries the current shape first, then falls back to the
 * legacy `{ paths }` shape (defaulting `functions` to empty) so manifests
 * exported by older SDKs keep decoding. The reverse is NOT true — old
 * viewers cannot decode new manifests — so viewers must update before UIs
 * exporting function manifests are deployed to shared repos (the same
 * landing-order constraint as `decodePackageObject`).
 */
export function decodeManifest(blob: Uint8Array): DataManifest {
  try {
    return decodeBeast2For(DataManifestType)(blob);
  } catch {
    const legacy = decodeBeast2For(LegacyDataManifestType)(blob);
    return { paths: legacy.paths, functions: [] };
  }
}
