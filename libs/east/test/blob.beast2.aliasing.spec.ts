/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, IntegerType, StringType, StructType, VariantType, NullType, RecursiveType, PatchType, encodeBeast2For, variant } from "../src/index.js";
import type { ValueTypeOf } from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import { diffFor } from "../src/patch/diff.js";
import { composeFor } from "../src/patch/compose.js";

// Beast2 v5 gives every Array, Set, Dict and Ref an identity on the wire:
// the second time the SAME container is met, it is written as a
// back-reference to its first definition. Structs, variants and functions
// have no identity — they are written inline at every reference — so a
// container they own is met again through its owner. east-c's writer
// tracked only containers holding more than one reference and wrote a
// container owned by a shared struct or variant twice (#774). These pins
// hold the reference bytes, so every runtime's writer must see the same
// sharing.

const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString("hex")}`;

const Node = VariantType({ leaf: NullType, items: ArrayType(IntegerType) });
const NodePair = StructType({ a: Node, b: Node });
const node: ValueTypeOf<typeof Node> = variant("items", [1n, 2n, 3n]);
const nodePairHex = hex(encodeBeast2For(NodePair)({ a: node, b: node }));

const Row = StructType({ id: IntegerType, tags: ArrayType(StringType) });
const RowPair = StructType({ a: Row, b: Row });
const row: ValueTypeOf<typeof Row> = { id: 1n, tags: ["x", "y"] };
const rowPairHex = hex(encodeBeast2For(RowPair)({ a: row, b: row }));

// The shape a composed patch takes: the first patch inserts an element, the
// second replaces it, and both operations carry the same element.
const Item = RecursiveType((self) => VariantType({ end: NullType, items: ArrayType(IntegerType), next: self }));
const Items = ArrayType(Item);
const ItemPatch = PatchType(Items);
const PatchPair = StructType({ p1: ItemPatch, p2: ItemPatch });
const v1: ValueTypeOf<typeof Items> = [];
const v2: ValueTypeOf<typeof Items> = [variant("items", [1n, 2n, 3n])];
const v3: ValueTypeOf<typeof Items> = [variant("items", [4n])];
const p1 = diffFor(Items)(v1, v2);
const p2 = diffFor(Items)(v2, v3);
const patchPairHex = hex(encodeBeast2For(PatchPair)({ p1, p2 }));
const composedHex = hex(encodeBeast2For(ItemPatch)(composeFor(Items)(p1, p2)));

await describe("Blob (Beast v2) aliasing", (test) => {
    test("a container owned by a shared variant is written once", $ => {
        const shared = $.let(node, Node);
        const pair = $.let({ a: shared, b: shared });
        $(assert.equal(East.str`${East.Blob.encodeBeast(pair, 'v2')}`, nodePairHex));
    });

    test("a container owned by a shared struct is written once", $ => {
        const shared = $.let(row, Row);
        const pair = $.let({ a: shared, b: shared });
        $(assert.equal(East.str`${East.Blob.encodeBeast(pair, 'v2')}`, rowPairHex));
    });

    test("two patches carrying the same element share it on the wire", $ => {
        const a = $.const(v1, Items), b = $.const(v2, Items), c = $.const(v3, Items);
        const d1 = $.let(East.diff(a, b));
        const d2 = $.let(East.diff(b, c));
        const pair = $.let({ p1: d1, p2: d2 });
        $(assert.equal(East.str`${East.Blob.encodeBeast(pair, 'v2')}`, patchPairHex));
        const composed = $.let(East.composePatch(d1, d2, Items));
        $(assert.equal(East.str`${East.Blob.encodeBeast(composed, 'v2')}`, composedHex));
    });
});
