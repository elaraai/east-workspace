/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The row-source classifier every collection shares.
 *
 * Pure `node:test` over BUILD-time types (no East body runs, so no companion
 * examples file): `resolveRowSource` decides which arm a component's rows
 * prop is. A paged source is recognised by its East TYPE — a subtype of the
 * contract over the collection its `page` serves (`Data.bindPaged`'s handle,
 * which names its snapshot with `revision` and `refresh`), or of the shape
 * that predates those two — never by its field names, so a struct that merely
 * has `page` and `total` is refused, naming the contract. The arm that cannot
 * be seen at runtime is `ordered` — a paged source whose window is an ARRAY of
 * index entries, which is how a read through a record's index keeps index
 * order instead of re-sorting by the row's own key. It is recognised by the
 * entry's shape rather than announced by a flag, so the shape is what has to
 * be pinned.
 *
 * Paged data is bound, so no package produces a source: each one below is
 * built by hand to the contract over an EMPTY fixture collection — every
 * window is the empty one (the source is exhausted at any offset) and the
 * total is 0. Nothing here runs; the arm is decided on the types.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType,
    DictType,
    East,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    isTypeEqual,
    none,
    some,
} from "@elaraai/east";
import { Paged, Plan, Sheet, Table, resolveRowSource } from "@elaraai/east-ui/internal";

const RowType = StructType({ title: StringType, due: IntegerType });
/** The window a read through a record's index answers with: `ik` first, so the
 *  array is in INDEX order, and every row carries its own primary key. */
const EntryType = StructType({
    ik: IntegerType,
    key: StringType,
    value: StringType,
    row: OptionType(RowType),
});
/** Near-misses of an index entry: the four fields and one more, and the four reordered. */
const ExtraEntryType = StructType({
    ik: IntegerType, key: StringType, value: StringType,
    row: OptionType(RowType), note: StringType,
});
const ReorderedEntryType = StructType({
    key: StringType, ik: IntegerType, value: StringType, row: OptionType(RowType),
});

const Rows = ArrayType(RowType);
const Entries = ArrayType(EntryType);
const RowsByKey = DictType(StringType, RowType);
const ExtraEntries = ArrayType(ExtraEntryType);
const ReorderedEntries = ArrayType(ReorderedEntryType);

// The windows of each empty fixture, and the rest of the contract's members.
const ROWS_PAGE = East.function([IntegerType, IntegerType], OptionType(Rows), () => some([]));
const ENTRIES_PAGE = East.function([IntegerType, IntegerType], OptionType(Entries), () => some([]));
const ROWS_BY_KEY_PAGE = East.function([IntegerType, IntegerType], OptionType(RowsByKey), () => some(new Map()));
const EXTRA_ENTRIES_PAGE = East.function([IntegerType, IntegerType], OptionType(ExtraEntries), () => some([]));
const REORDERED_ENTRIES_PAGE = East.function([IntegerType, IntegerType], OptionType(ReorderedEntries), () => some([]));
const TITLE_PAGE = East.function([IntegerType, IntegerType], OptionType(StringType), () => some(""));
const EMPTY_TOTAL = East.function([], OptionType(IntegerType), () => some(0n));
const REVISION = East.function([], OptionType(StringType), () => some("r1"));
const REFRESH = East.function([OptionType(StringType)], NullType, () => null);

const ID = "records.plans";

// The shape that predates `revision` / `refresh` — the released handle.
const ROWS_SOURCE = East.value({ id: ID, page: ROWS_PAGE, total: EMPTY_TOTAL, seek: none }, Paged.Types.Source(Rows));
const ENTRIES_SOURCE = East.value({ id: ID, page: ENTRIES_PAGE, total: EMPTY_TOTAL, seek: none }, Paged.Types.Source(Entries));
const ROWS_BY_KEY_SOURCE = East.value({ id: ID, page: ROWS_BY_KEY_PAGE, total: EMPTY_TOTAL, seek: none }, Paged.Types.Source(RowsByKey));
const EXTRA_ENTRIES_SOURCE = East.value({ id: ID, page: EXTRA_ENTRIES_PAGE, total: EMPTY_TOTAL, seek: none }, Paged.Types.Source(ExtraEntries));
const REORDERED_ENTRIES_SOURCE = East.value({ id: ID, page: REORDERED_ENTRIES_PAGE, total: EMPTY_TOTAL, seek: none }, Paged.Types.Source(ReorderedEntries));

// The contract — `Data.bindPaged`'s handle, naming its snapshot.
const PINNED_ROWS = East.value(
    { id: ID, page: ROWS_PAGE, total: EMPTY_TOTAL, seek: none, revision: REVISION, refresh: REFRESH },
    Paged.Types.PinnedSource(Rows));
const PINNED_ENTRIES = East.value(
    { id: ID, page: ENTRIES_PAGE, total: EMPTY_TOTAL, seek: none, revision: REVISION, refresh: REFRESH },
    Paged.Types.PinnedSource(Entries));
const PINNED_ROWS_BY_KEY = East.value(
    { id: ID, page: ROWS_BY_KEY_PAGE, total: EMPTY_TOTAL, seek: none, revision: REVISION, refresh: REFRESH },
    Paged.Types.PinnedSource(RowsByKey));

// Lookalikes: each carries `page` and `total`, and each is neither shape.
const Page = FunctionType([IntegerType, IntegerType], OptionType(Rows));
const Total = FunctionType([], OptionType(IntegerType));
const Seek = OptionType(FunctionType([Paged.Types.SeekQuery], OptionType(Paged.Types.SeekRange)));
const LOOKALIKES = {
    "no id and no seek": East.value(
        { page: ROWS_PAGE, total: EMPTY_TOTAL },
        StructType({ page: Page, total: Total })),
    "its fields out of order": East.value(
        { page: ROWS_PAGE, total: EMPTY_TOTAL, id: ID, seek: none },
        StructType({ page: Page, total: Total, id: StringType, seek: Seek })),
    "an extra field": East.value(
        { id: ID, page: ROWS_PAGE, total: EMPTY_TOTAL, seek: none, note: "" },
        StructType({ id: StringType, page: Page, total: Total, seek: Seek, note: StringType })),
    "`page` at another type": East.value(
        { id: ID, page: East.function([IntegerType], OptionType(Rows), () => some([])), total: EMPTY_TOTAL, seek: none },
        StructType({ id: StringType, page: FunctionType([IntegerType], OptionType(Rows)), total: Total, seek: Seek })),
    "`total` at another type": East.value(
        { id: ID, page: ROWS_PAGE, total: East.function([], IntegerType, () => 0n), seek: none },
        StructType({ id: StringType, page: Page, total: FunctionType([], IntegerType), seek: Seek })),
    "`revision` without `refresh`": East.value(
        { id: ID, page: ROWS_PAGE, total: EMPTY_TOTAL, seek: none, revision: REVISION },
        StructType({ id: StringType, page: Page, total: Total, seek: Seek, revision: FunctionType([], OptionType(StringType)) })),
    "`refresh` without `revision`": East.value(
        { id: ID, page: ROWS_PAGE, total: EMPTY_TOTAL, seek: none, refresh: REFRESH },
        StructType({ id: StringType, page: Page, total: Total, seek: Seek, refresh: FunctionType([OptionType(StringType)], NullType) })),
};

/** What a refusal of a lookalike says: the contract, every field in its order at its type. */
const NAMES_THE_CONTRACT = (label: string) => new RegExp(
    `^Error: ${label}: a paged source is a platform bind's handle \\(Data\\.bindPaged\\) — ` +
    "`\\{ id: String, page: \\(Integer, Integer\\) → Option<C>, total: \\(\\) → Option<Integer>, " +
    "seek: Option<\\(SeekQuery\\) → Option<SeekRange>>, revision: \\(\\) → Option<String>, " +
    "refresh: \\(Option<String>\\) → Null \\}`, its fields in that order at those types, " +
    "or the same without `revision` and `refresh`");

describe("resolveRowSource", () => {
    test("the contract — Data.bindPaged's handle — is a pinned source", () => {
        const resolved = resolveRowSource(PINNED_ROWS, "Table");
        assert.equal(resolved.kind, "paged");
        if (resolved.kind !== "paged") return;
        assert.equal(resolved.pinned, true);
        assert.ok(isTypeEqual(resolved.collectionType, Rows));
        assert.ok(isTypeEqual(resolved.elementType, RowType));
    });

    test("the shape that predates revision and refresh is a paged source that names no snapshot", () => {
        const resolved = resolveRowSource(ROWS_SOURCE, "Table");
        assert.equal(resolved.kind, "paged");
        if (resolved.kind !== "paged") return;
        assert.equal(resolved.pinned, false);
        assert.equal(resolved.keyType, undefined, "an array is positional");
    });

    test("classifies a window of index entries as ordered, recovering both keys", () => {
        const resolved = resolveRowSource(ENTRIES_SOURCE, "Table");
        assert.equal(resolved.kind, "ordered");
        if (resolved.kind !== "ordered") return;
        // `key` is the row's identity, `ik` the order the window is sorted by
        // — a component that confused the two would address the wrong row.
        assert.ok(isTypeEqual(resolved.keyType, StringType));
        assert.ok(isTypeEqual(resolved.orderKeyType, IntegerType));
        assert.ok(isTypeEqual(resolved.elementType, EntryType));
    });

    test("a keyed window stays paged, keyed by the dict's key", () => {
        const resolved = resolveRowSource(ROWS_BY_KEY_SOURCE, "Table");
        assert.equal(resolved.kind, "paged");
        if (resolved.kind !== "paged") return;
        assert.ok(resolved.keyType !== undefined && isTypeEqual(resolved.keyType, StringType));
    });

    test("a near-miss entry is paged: the four fields, in order, and nothing else", () => {
        // The shape IS the signal, so a struct that merely contains `ik` and
        // `key` must not be read as an index entry — a component would then
        // page it in an order it is not sorted in.
        for (const [label, source] of [["an extra field", EXTRA_ENTRIES_SOURCE], ["reordered", REORDERED_ENTRIES_SOURCE]] as const) {
            assert.equal(resolveRowSource(source, "Table").kind, "paged", label);
        }
    });

    test("a source that names its snapshot is pinned — a keyed window and an index window alike", () => {
        const keyed = resolveRowSource(PINNED_ROWS_BY_KEY, "Table");
        assert.equal(keyed.kind, "paged");
        assert.equal(keyed.kind === "paged" && keyed.pinned, true);

        const ordered = resolveRowSource(PINNED_ENTRIES, "Table");
        assert.equal(ordered.kind, "ordered");
        assert.equal(ordered.kind === "ordered" && ordered.pinned, true);
    });

    test("a source that names no snapshot is not pinned", () => {
        for (const source of [ROWS_SOURCE, ENTRIES_SOURCE]) {
            const resolved = resolveRowSource(source, "Table");
            assert.notEqual(resolved.kind, "inline");
            assert.equal(resolved.kind !== "inline" && resolved.pinned, false);
        }
    });

    test("a struct with `page` and `total` that is neither shape is refused, naming the contract's fields", () => {
        // East struct subtyping is exact: a lookalike read by its field names
        // would be paged through members that do not mean what a component
        // reads them as.
        for (const [label, lookalike] of Object.entries(LOOKALIKES)) {
            assert.throws(() => resolveRowSource(lookalike, "Table"), NAMES_THE_CONTRACT("Table"), label);
        }
    });

    test("a source whose `page` serves no collection is refused, naming what it serves", () => {
        const titles = East.value(
            { id: ID, page: TITLE_PAGE, total: EMPTY_TOTAL, seek: none }, Paged.Types.Source(StringType));
        assert.throws(() => resolveRowSource(titles, "Table"),
            /^Error: Table: a paged source's `page` serves a collection — an Array, Dict or Set — and this one's serves \.String$/);
    });

    test("refuses a rows prop that is neither a collection nor a source", () => {
        assert.throws(
            () => resolveRowSource(East.value("not rows" as never, StringType), "Table"),
            /Table: rows must be a collection/);
    });
});

describe("a lookalike paged source is refused by every collection", () => {
    const lookalike = LOOKALIKES["no id and no seek"];

    test("Plan", () => {
        const axis = Plan.axis({ window: { min: new Date("2026-06-29T00:00:00Z"), max: new Date("2026-09-21T00:00:00Z") }, resolution: "week" });
        assert.throws(() => Plan.Root({ axis, data: lookalike as never, series: [] }), NAMES_THE_CONTRACT("Plan"));
    });

    test("Table", () => {
        assert.throws(() => Table.Root(lookalike as never, ["title", "due"] as never), NAMES_THE_CONTRACT("Table"));
    });

    test("Sheet", () => {
        assert.throws(() => Sheet.Root(lookalike as never, { title: Sheet.column.text(RowType) } as never, { id: "title" } as never),
            NAMES_THE_CONTRACT("Sheet"));
    });
});
