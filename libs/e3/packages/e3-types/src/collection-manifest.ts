/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The segment-object layout: a collection dataset is a **manifest naming
 * standalone segment objects**, not one segmented blob.
 *
 * The type itself lives in `east`, beside the container it describes, because
 * every runtime must read it: a task input staged as a manifest is one file
 * naming sibling segment files, and a body that iterates it pays for the
 * segments it touches rather than for a splice of the whole value. This module
 * re-exports it for the e3 packages and adds what only a store cares about.
 *
 * Three properties are why records at millions of entries are affordable, and
 * every one of them is about successive states SHARING storage rather than
 * about indexing, which the trailing index already gave:
 *
 * - **A one-row edit costs one segment.** The new state names the same objects
 *   as the old one bar the segment that changed, so a commit's new storage is
 *   the touched segments plus a manifest — not the whole value.
 * - **Two states diff in O(changed segments)**, by comparing entry hashes. No
 *   value is decoded to find out what moved, which is what index maintenance
 *   and the mutation delta are built on.
 * - **A segment is verified against its own hash before it is decoded**, which
 *   a ranged read of one blob can never offer: no digest exists for a byte
 *   range.
 *
 * The manifest is the envelope the garbage collector recognizes, which is why
 * its `kind` is a stored field rather than something inferred: an object whose
 * entries name other objects MUST be traversable by shape, or the first sweep
 * deletes a record's segments.
 *
 * @packageDocumentation
 */

export {
  COLLECTION_MANIFEST_KIND,
  CollectionManifestType,
  CollectionManifestEntryType,
  type CollectionManifest,
  type CollectionManifestEntry,
  type Beast2ManifestSource,
  isCollectionManifestType,
  isCollectionManifest,
  isBeast2ManifestSource,
  encodeCollectionManifest,
  decodeCollectionManifest,
  readBeast2Manifest,
  manifestElementCount,
  manifestByteSize,
} from '@elaraai/east';
