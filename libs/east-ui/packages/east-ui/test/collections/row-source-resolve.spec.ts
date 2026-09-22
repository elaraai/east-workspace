/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The row-source classifier every collection shares.
 *
 * Pure `node:test` over BUILD-time types (no East body runs, so no companion
 * examples file): `resolveRowSource` decides which arm a component's rows
 * prop is, and the one that cannot be seen at runtime is `ordered` — a paged
 * source whose window is an ARRAY of index entries, which is how a read
 * through a record's index keeps index order instead of re-sorting by the
 * row's own key. It is recognised by the entry's shape rather than announced
 * by a flag, so the shape is what has to be pinned.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType,
    DictType,
    East,
    IntegerType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";
import { Paged, resolveRowSource } from "@elaraai/east-ui/internal";

const RowType = StructType({ title: StringType, due: IntegerType });
/** The window a read through a record's index answers with: `ik` first, so the
 *  array is in INDEX order, and every row carries its own primary key. */
const EntryType = StructType({
    ik: IntegerType,
    key: StringType,
    value: StringType,
    row: OptionType(RowType),
});

/** A paged source over `collection`, the way a component receives one. */
const sourceOver = (collection: unknown): unknown =>
    Paged.of("records.plans", collection as never);

describe("resolveRowSource", () => {
    test("classifies a window of index entries as ordered, recovering both keys", () => {
        const resolved = resolveRowSource(
            sourceOver(East.value([] as never, ArrayType(EntryType))), "Table");

        assert.equal(resolved.kind, "ordered");
        if (resolved.kind !== "ordered") return;
        // `key` is the row's identity, `ik` the order the window is sorted by
        // — a component that confused the two would address the wrong row.
        assert.deepEqual(resolved.keyType, StringType);
        assert.deepEqual(resolved.orderKeyType, IntegerType);
        assert.deepEqual(resolved.elementType, EntryType);
    });

    test("an ordinary array window stays paged, with no key", () => {
        const resolved = resolveRowSource(
            sourceOver(East.value([] as never, ArrayType(RowType))), "Table");

        assert.equal(resolved.kind, "paged");
        assert.equal(resolved.keyType, undefined, "an array is positional");
    });

    test("a keyed window stays paged, keyed by the dict's key", () => {
        const resolved = resolveRowSource(
            sourceOver(East.value(new Map() as never, DictType(StringType, RowType))), "Table");

        assert.equal(resolved.kind, "paged");
        assert.deepEqual(resolved.keyType, StringType);
    });

    test("a near-miss entry is paged: the four fields, in order, and nothing else", () => {
        // The shape IS the signal, so a struct that merely contains `ik` and
        // `key` must not be read as an index entry — a component would then
        // page it in an order it is not sorted in.
        const extra = StructType({
            ik: IntegerType, key: StringType, value: StringType,
            row: OptionType(RowType), note: StringType,
        });
        const reordered = StructType({
            key: StringType, ik: IntegerType, value: StringType, row: OptionType(RowType),
        });
        for (const [label, element] of [["an extra field", extra], ["reordered", reordered]] as const) {
            assert.equal(
                resolveRowSource(sourceOver(East.value([] as never, ArrayType(element))), "Table").kind,
                "paged", label);
        }
    });

    test("refuses a rows prop that is neither a collection nor a source", () => {
        assert.throws(
            () => resolveRowSource(East.value("not rows" as never, StringType), "Table"),
            /Table: rows must be a collection/);
    });
});
