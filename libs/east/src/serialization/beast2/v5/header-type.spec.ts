/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A collection blob's header names the type its body is written in, and its
 * body is positional: a variant's tag is its case's place in the header's
 * order. So every reader checks the header's type against the type it was
 * asked for before it reads a segment, as the whole decode does — the pages,
 * through a range reader or not, the lazy value, the segment iterator, and a
 * manifest, its own type at open and each segment's header as it is read
 * (east-workspace#1578). The bytes here are v1.0.105's, which listed a
 * variant's integer-like cases in the order a TypeScript object lists them,
 * `50` before `100`; read by their positions under this release's order they
 * would come out `a=100 b=300 c=400 d=50`.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, NullType, StringType, VariantType, type ValueTypeOf } from "../../../types.js";
import { toEastTypeValue, type EastTypeValue } from "../../../type_of_type.js";
import { variant } from "../../../containers/variant.js";
import {
  COLLECTION_MANIFEST_KIND,
  type Beast2ManifestSource,
  type Beast2SyncRangeReader,
  Beast2ElementWriter,
  decodeBeast2For,
  encodeBeast2FenceFor,
  encodeBeast2PagedFor,
  iterBeast2SegmentsFor,
  openBeast2LazyFor,
  openBeast2PagesFor,
  segmentRuleFor,
} from "../index.js";

const Shade = VariantType({ "50": NullType, "100": NullType, "300": NullType, "400": NullType });
const Shades = DictType(StringType, Shade);

/** {@link Shades}' type as v1.0.105 wrote it: its cases as an object lists them. */
const OLD_TYPE: EastTypeValue = variant("Dict", {
  key: variant("String", null),
  value: variant("Variant", ["50", "100", "300", "400"].map((name) => ({ name, type: variant("Null", null) }))),
});

/** `{a: 50, b: 100, c: 300, d: 400}` of {@link Shades}, paged, as v1.0.105 wrote it: one segment, the cases' tags 0 to 3 in its order. */
const OLD_PAGED = new Uint8Array([
  0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05, 0x00, 0x1c, 0x03, 0x04, 0x01, 0x00, 0x08, 0x04, 0x02, 0x35, 0x30, 0x01,
  0x03, 0x31, 0x30, 0x30, 0x01, 0x03, 0x33, 0x30, 0x30, 0x01, 0x03, 0x34, 0x30, 0x30, 0x01, 0x0b, 0x00, 0x02, 0x01, 0x00,
  0x00, 0x01, 0x01, 0x00, 0x00, 0x0d, 0x0d, 0x04, 0x01, 0x61, 0x00, 0x01, 0x62, 0x01, 0x01, 0x63, 0x02, 0x01, 0x64, 0x03,
  0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x2c, 0x04, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x89, 0x45, 0x61, 0x73,
  0x74, 0x0d, 0x0a, 0xf5,
]);

/** The same value written whole, as v1.0.105 wrote it. */
const OLD_WHOLE = new Uint8Array([
  0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05, 0x00, 0x1c, 0x03, 0x04, 0x01, 0x00, 0x08, 0x04, 0x02, 0x35, 0x30, 0x01,
  0x03, 0x31, 0x30, 0x30, 0x01, 0x03, 0x33, 0x30, 0x30, 0x01, 0x03, 0x34, 0x30, 0x30, 0x01, 0x0b, 0x00, 0x02, 0x01, 0x00,
  0x00, 0x0f, 0x0f, 0x00, 0x04, 0x01, 0x61, 0x00, 0x01, 0x62, 0x01, 0x01, 0x63, 0x02, 0x01, 0x64, 0x03, 0x00,
]);

/** The value both hold. */
const VALUE = new Map<string, ValueTypeOf<typeof Shade>>([["a", variant("50", null)], ["b", variant("100", null)], ["c", variant("300", null)], ["d", variant("400", null)]]);

/** The refusal every reader gives: the whole decode's. */
const REFUSED = /beast2: cannot decode a blob of type .*"50".*"100".* as .*"100".*"50"/s;

/** Ranged access to `bytes`, as a file descriptor gives it. */
function ranged(bytes: Uint8Array): Beast2SyncRangeReader {
  return { size: bytes.length, read: (offset, length) => bytes.slice(offset, offset + length) };
}

/**
 * A manifest naming `segments` as {@link Shades}' segments, under `type`.
 *
 * @param type - The collection type the manifest records
 * @param segments - Each segment's standalone blob, with its first key
 * @returns The manifest's source
 */
function manifestOf(type: EastTypeValue, segments: { blob: Uint8Array; first: string; count: number }[]): Beast2ManifestSource {
  const fence = encodeBeast2FenceFor(StringType);
  return {
    manifest: {
      kind: COLLECTION_MANIFEST_KIND,
      level: 0n,
      type,
      rule: segmentRuleFor(Shades),
      header: "",
      entries: segments.map((segment, i) => ({ hash: `${i}`, fence: fence(segment.first), count: BigInt(segment.count), bytes: BigInt(segment.blob.length) })),
    },
    segment: (i) => segments[i]!.blob,
  };
}

/** {@link VALUE} as this release writes its segments. */
function segmentsNow(): { blob: Uint8Array; first: string; count: number }[] {
  const segments: { blob: Uint8Array; first: string; count: number }[] = [];
  const writer = new Beast2ElementWriter(Shades, { segment: (segment) => segments.push({ blob: segment.blob, first: "a", count: segment.count }) });
  for (const entry of VALUE) writer.add(entry);
  writer.finish();
  return segments;
}

describe("a collection blob whose header names another order of a variant's cases", () => {
  test("is refused by the whole decode, paged or whole", () => {
    assert.throws(() => decodeBeast2For(Shades)(OLD_WHOLE), REFUSED);
    assert.throws(() => decodeBeast2For(Shades)(OLD_PAGED), REFUSED);
  });

  test("is refused by the pages at open, from its bytes and through a range reader", () => {
    assert.throws(() => openBeast2PagesFor(Shades)(OLD_PAGED), REFUSED);
    assert.throws(() => openBeast2PagesFor(Shades)(ranged(OLD_PAGED)), REFUSED);
  });

  test("is refused by the lazy value at open", () => {
    assert.throws(() => openBeast2LazyFor(Shades)(OLD_PAGED), REFUSED);
    assert.throws(() => openBeast2LazyFor(Shades, { frozen: true })(ranged(OLD_PAGED)), REFUSED);
  });

  test("is refused by the segment iterator before its first segment", () => {
    const seen: unknown[] = [];
    assert.throws(() => {
      for (const segment of iterBeast2SegmentsFor(Shades)(OLD_PAGED)) seen.push(segment);
    }, REFUSED);
    assert.deepEqual(seen, []);
  });

  test("is refused as a manifest's type at open, and as a segment's header when the segment is read", () => {
    assert.throws(() => openBeast2PagesFor(Shades)(manifestOf(OLD_TYPE, segmentsNow())), REFUSED);
    const pages = openBeast2PagesFor(Shades)(manifestOf(toEastTypeValue(Shades), [{ blob: OLD_PAGED, first: "a", count: 4 }]));
    assert.throws(() => pages.get("a"), REFUSED);
    assert.throws(() => pages.segment(0), REFUSED);
  });

  test("is read, as this release writes it, by every reader", () => {
    const paged = encodeBeast2PagedFor(Shades)(VALUE);
    assert.deepEqual([...decodeBeast2For(Shades)(paged)], [...VALUE]);
    assert.deepEqual(openBeast2PagesFor(Shades)(paged).get("a"), variant("50", null));
    assert.deepEqual(openBeast2PagesFor(Shades)(ranged(paged)).get("d"), variant("400", null));
    assert.deepEqual([...openBeast2LazyFor(Shades)(paged)], [...VALUE]);
    assert.deepEqual([...iterBeast2SegmentsFor(Shades)(paged)].flatMap((segment) => [...segment]), [...VALUE]);
    const pages = openBeast2PagesFor(Shades)(manifestOf(toEastTypeValue(Shades), segmentsNow()));
    assert.deepEqual(pages.get("b"), variant("100", null));
  });
});
