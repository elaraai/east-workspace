/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A collection written as a manifest directory: the manifest, and beside it
 * every object the manifest names — each segment, and the header they share —
 * named by its SHA-256.
 *
 * On disk the manifest is one file and the objects sit in the sibling
 * directory `<file>.segments/`, each as `<hash>.beast2`: the layout e3 stages a
 * collection input in, and the one every runtime's opener reads. Because the
 * names are the hashes a store gives the files, a store takes a directory in by
 * linking each file under its name, and a collection written by any runtime is
 * the collection written by any other, byte for byte.
 */

import type { EastTypeValue } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { asTypeValue } from "./type-section.js";
import { Beast2ElementWriter, type Beast2ElementOf, type Beast2ElementWriterOptions } from "./stream.js";
import { COLLECTION_MANIFEST_KIND, encodeCollectionManifest, type CollectionManifestEntry } from "./manifest.js";
import { segmentRuleFor } from "./boundary.js";
import { sha256Hex } from "./sha256.js";

/** Where a {@link Beast2ManifestWriter} puts a manifest directory. */
export interface Beast2ManifestSink {
  /**
   * Receives one object the manifest names: first the header every segment is
   * written under, then each segment as it is cut. An Array that holds two
   * equal segments hands the same object over twice.
   *
   * @param hash - the SHA-256 of `bytes` in lowercase hex: the name a store
   *   gives the object, and its file's name in the directory, `<hash>.beast2`
   * @param bytes - the object
   */
  object(hash: string, bytes: Uint8Array): void;
  /**
   * Receives the manifest, after every object it names.
   *
   * @param bytes - the manifest's beast2 bytes
   */
  manifest(bytes: Uint8Array): void;
}

/**
 * The canonical writer of a collection as a manifest directory: elements go in
 * one at a time, in canonical order, and out come the header, the segments the
 * cut rule places, and a manifest naming them — each object under its SHA-256.
 *
 * The segments are the ones {@link Beast2ElementWriter} writes for the same
 * value, each a standalone blob, so splicing them under the header gives the
 * blob that writer writes. Memory is one open segment.
 *
 * @example
 * ```ts
 * const type = DictType(StringType, IntegerType);
 * const files = new Map<string, Uint8Array>();
 * const writer = new Beast2ManifestWriter(type, {
 *   object: (hash, bytes) => files.set(`table.beast2.segments/${hash}.beast2`, bytes),
 *   manifest: (bytes) => files.set("table.beast2", bytes),
 * });
 * writer.add(["a", 1n]);
 * writer.add(["b", 2n]);
 * writer.finish();
 * decodeCollectionManifest(files.get("table.beast2")!).entries.length;  // 1
 * ```
 */
export class Beast2ManifestWriter<T extends EastType = EastType> {
  private readonly typeValue: EastTypeValue;
  private readonly sink: Beast2ManifestSink;
  private readonly writer: Beast2ElementWriter<T>;
  private readonly headerHash: string;
  private readonly entries: CollectionManifestEntry[] = [];
  private finished = false;

  /**
   * @param type - the collection type (Array/Set/Dict)
   * @param sink - receives the header, each segment, and then the manifest
   * @param options - codec, source map, header prefix and parallel framing
   * @throws {TypeError} When `type` is not an Array, Set or Dict type, or
   *   when `options.headerPrefix` is not a v5 header of exactly `type`.
   */
  constructor(type: T | EastTypeValue, sink: Beast2ManifestSink, options?: Beast2ElementWriterOptions) {
    this.typeValue = asTypeValue(type);
    this.sink = sink;
    this.writer = new Beast2ElementWriter<T>(this.typeValue, {
      segment: (segment) => {
        const hash = sha256Hex(segment.blob);
        sink.object(hash, segment.blob);
        this.entries.push({
          hash,
          fence: segment.fence,
          count: BigInt(segment.count),
          bytes: BigInt(segment.blob.length),
        });
      },
    }, options);
    const header = this.writer.header;
    this.headerHash = sha256Hex(header);
    sink.object(this.headerHash, header);
  }

  /** Segments written so far; the open segment is not among them until the
   *  cut rule closes it or {@link finish} does. */
  get segments(): number {
    return this.writer.segments;
  }

  /**
   * Encodes one element and appends it to the collection.
   *
   * @param element - an Array or Set element, or a Dict's `[key, value]` pair
   * @throws {Error} When called after {@link finish}, when a Set element or
   *   Dict key does not ascend strictly from the last in East order, or when
   *   the element cannot be encoded — which leaves the writer as it was.
   */
  add(element: Beast2ElementOf<T>): void {
    this.writer.add(element);
  }

  /**
   * Appends one element that is already in its canonical bytes, without
   * decoding it; see {@link Beast2ElementWriter.addEncoded}.
   *
   * @param element - the element's canonical bytes (a Dict pair's key, then
   *   its value)
   * @param keyLength - the length of the key at the front of `element`: a Set
   *   element's whole length, a Dict pair's key; ignored for an Array
   * @throws {Error} When called after {@link finish}.
   */
  addEncoded(element: Uint8Array, keyLength: number): void {
    this.writer.addEncoded(element, keyLength);
  }

  /**
   * Writes the open segment, then the manifest naming the header and every
   * segment. Idempotent. A finish that fails writes no manifest, so a
   * directory left behind by one is never read as complete.
   *
   * @throws {Error} For a parallel writer, when an in-flight frame's worker
   *   failed or stopped responding (see {@link Beast2ElementWriter.finish}).
   */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.writer.finish();
    this.sink.manifest(encodeCollectionManifest({
      kind: COLLECTION_MANIFEST_KIND,
      level: 0n,
      type: this.typeValue,
      rule: segmentRuleFor(this.typeValue),
      header: this.headerHash,
      entries: this.entries,
    }));
  }
}
