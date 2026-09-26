/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ArrayType, DictType, East, FunctionType, IntegerType, NullType, OptionType, RecursiveType, StringType, StructType, equalFor, variant, some, none } from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Plan, Table } from "@elaraai/east-ui/internal";
import { buildRowSource, resolveRowSource } from "../../src/contracts/source.js";
import * as ex from "./paged-source.examples.js";

/** A 50-row positional fixture, generated at MODULE scope so the East bodies
 *  below stay free of host helper calls (east 990020). Wide enough that a
 *  window is a genuine window and a jump skips real rows. */
const WIDE_ROWS = Array.from({ length: 50 }, (_, i) => ({
    id: `r${String(i).padStart(2, "0")}`, n: BigInt(i),
}));

/** The same 50 rows KEYED — the Dict form at the same scale, so canonical key
 *  order is checked at an arbitrary offset rather than only at the head. */
const WIDE_DICT = new Map(WIDE_ROWS.map(r => [r.id, { n: r.n }] as const));

/** A canvas window for the trimmed-source tests — the Plan's paged arm
 *  requires one, and nothing here depends on where it sits. */
const TRIM_WINDOW = { min: new Date("2026-07-06T00:00:00Z"), max: new Date("2026-09-28T00:00:00Z") };

describeEast("Row-source contract (#567)", (test) => {
    Assert.examples(test, {
        pagedSourceCanvas: ex.pagedSourceCanvas,
        pagedTableSource: ex.pagedTableSource,
        pagedSourceTrimmed: ex.pagedSourceTrimmed,
        pagedSourceWindows: ex.pagedSourceWindows,
        pagedSourceBlocks: ex.pagedSourceBlocks,
        pagedSnapshotRevision: ex.pagedSnapshotRevision,
    });

    test("Paged.of windows a collection, reports the total and exhausts on an EMPTY window", $ => {
        const Row = StructType({ id: StringType, n: IntegerType });
        const rows = $.const([
            { id: "a", n: 1n }, { id: "b", n: 2n }, { id: "c", n: 3n },
            { id: "d", n: 4n }, { id: "e", n: 5n },
        ], ArrayType(Row));
        const src = $.let(Paged.of("units", rows));
        $(Assert.equal(src.id, "units"));
        $(Assert.equal(src.total().unwrap("some"), 5n));
        // A window is `some` immediately — in-memory sources are never in flight.
        const w0 = $.let(src.page(0n, 2n));
        $(Assert.equal(w0.unwrap("some").length(), 2n));
        $(Assert.equal(w0.unwrap("some").get(0n).id, "a"));
        // The tail window CLAMPS rather than overrunning.
        const w2 = $.let(src.page(4n, 2n));
        $(Assert.equal(w2.unwrap("some").length(), 1n));
        $(Assert.equal(w2.unwrap("some").get(0n).id, "e"));
        // Past the end ⇒ the EMPTY window: `some([])`, never `none`. That is
        // how a walking reader terminates (`none` means "still loading").
        const past = $.let(src.page(5n, 2n));
        $(Assert.equal(past.hasTag("some"), true));
        $(Assert.equal(past.unwrap("some").length(), 0n));
    });

    test("seek is a KEY-ORDER capability — present with a key accessor, absent without", $ => {
        const Row = StructType({ id: StringType });
        const rows = $.const([
            { id: "ka-1" }, { id: "ka-2" }, { id: "kb-1" }, { id: "kc-9" },
        ], ArrayType(Row));
        // No key accessor ⇒ nothing to binary-search, exactly as an
        // Array-backed dataset behaves: the chrome renders no affordance.
        const plain = $.let(Paged.of("plain", rows));
        $(Assert.equal(plain.seek.hasTag("none"), true));
        // With one, a prefix locates a CONTIGUOUS run: first row + count.
        const keyed = $.let(Paged.of("keyed", rows, { key: r => r.id }));
        const find = $.const(keyed.seek.unwrap("some"));
        const hit = $.let(find($.const(variant("prefix", "ka"), Paged.Types.SeekQuery)));
        $(Assert.equal(hit.unwrap("some").found, true));
        $(Assert.equal(hit.unwrap("some").row, 0n));
        $(Assert.equal(hit.unwrap("some").count, 2n));
        const mid = $.let(find($.const(variant("prefix", "kb"), Paged.Types.SeekQuery)));
        $(Assert.equal(mid.unwrap("some").row, 2n));
        $(Assert.equal(mid.unwrap("some").count, 1n));
        // A miss still carries the INSERTION row, so a viewport can position.
        const miss = $.let(find($.const(variant("prefix", "kz"), Paged.Types.SeekQuery)));
        $(Assert.equal(miss.unwrap("some").found, false));
        $(Assert.equal(miss.unwrap("some").count, 0n));
    });

    test("a query is exact / prefix / leading fields — three shapes, one row RANGE (#574)", $ => {
        // The chrome parses the user's typed text against the key type it was
        // handed, then sends `.east` literals — so the query is plain data at
        // any key type, and the same three shapes e3's `datasetFindKey` takes.
        const Row = StructType({ id: StringType });
        const rows = $.const([
            { id: "ka-1" }, { id: "ka-2" }, { id: "kb-1" },
        ], ArrayType(Row));
        const keyed = $.let(Paged.of("keyed", rows, { key: r => r.id }));
        const find = $.const(keyed.seek.unwrap("some"));
        // `key` — the whole-key `.east` literal (a String key's is quoted).
        const exact = $.let(find($.const(variant("key", '"ka-2"'), Paged.Types.SeekQuery)));
        $(Assert.equal(exact.unwrap("some").found, true));
        $(Assert.equal(exact.unwrap("some").row, 1n));
        $(Assert.equal(exact.unwrap("some").count, 1n));
        // `fields` naming NO leading fields is just its prefix — a String key
        // has no fields to lead with.
        const asPrefix = $.let(find($.const(
            variant("fields", { values: [], prefix: some("kb") }), Paged.Types.SeekQuery)));
        $(Assert.equal(asPrefix.unwrap("some").found, true));
        $(Assert.equal(asPrefix.unwrap("some").row, 2n));
        // Naming one cannot match a String key at all.
        const noMatch = $.let(find($.const(
            variant("fields", { values: ['"ka-1"'], prefix: none }), Paged.Types.SeekQuery)));
        $(Assert.equal(noMatch.unwrap("some").found, false));
        $(Assert.equal(noMatch.unwrap("some").count, 0n));
    });

    test("a KEYED source windows in key order and seeks its OWN keys (#568)", $ => {
        // The invariant the keyed pipeline exists for: `seek` returns a row in
        // the source's canonical key order, and that row indexes the very
        // window space `page` serves — so a search result addresses a real row.
        const Row = StructType({ n: IntegerType });
        const rows = $.const(new Map([
            ["ka-1", { n: 1n }], ["ka-2", { n: 2n }], ["kb-1", { n: 3n }], ["kc-9", { n: 4n }],
        ]), DictType(StringType, Row));
        const src = $.let(Paged.of("units", rows));
        $(Assert.equal(src.total().unwrap("some"), 4n));
        // A window is a DICT — the collection it was given, in key order.
        const w0 = $.let(src.page(0n, 2n));
        $(Assert.equal(w0.unwrap("some").size(), 2n));
        $(Assert.equal(w0.unwrap("some").has("ka-1"), true));
        $(Assert.equal(w0.unwrap("some").has("kb-1"), false));
        // `seek` needs no key accessor here: the collection IS keyed.
        const find = $.const(src.seek.unwrap("some"));
        const hit = $.let(find($.const(variant("prefix", "ka"), Paged.Types.SeekQuery)));
        $(Assert.equal(hit.unwrap("some").found, true));
        $(Assert.equal(hit.unwrap("some").row, 0n));
        $(Assert.equal(hit.unwrap("some").count, 2n));
        const mid = $.let(find($.const(variant("prefix", "kb"), Paged.Types.SeekQuery)));
        $(Assert.equal(mid.unwrap("some").row, 2n));
        // The seek row plugs straight into a window — the same row space.
        const at = $.let(src.page(mid.unwrap("some").row, 1n));
        $(Assert.equal(at.unwrap("some").has("kb-1"), true));
        // Past the end ⇒ the EMPTY window, exactly as the array form.
        $(Assert.equal(src.page(4n, 2n).unwrap("some").size(), 0n));
    });

    test("two sources at different ids compare UNEQUAL — the memo discriminator", $ => {
        // East compares every function as equal, so a source of nothing but
        // closures is indistinguishable from any other and a memoized
        // component would never re-render on a swap. `id` is what makes the
        // value comparable at all.
        const Row = StructType({ id: StringType });
        const rows = $.const([{ id: "a" }], ArrayType(Row));
        const a = $.let(Paged.of("inputs.ops", rows));
        const b = $.let(Paged.of("inputs.other", rows));
        $(Assert.equal(East.equal(a, b), false));
        $(Assert.equal(East.equal(a, a), true));
    });

    test("RANDOM ACCESS — a window is the same rows whatever order it is asked for", $ => {
        const WideRow = StructType({ id: StringType, n: IntegerType });
        const src = $.let(Paged.of("wide", $.const(WIDE_ROWS, ArrayType(WideRow))));
        $(Assert.equal(src.total().unwrap("some"), 50n));
        // Jump straight into the middle — no earlier window is read first, which
        // is the whole point of a paged source (the driver rebases on a jump
        // rather than walking there, #577).
        const mid = $.let(src.page(30n, 5n));
        $(Assert.equal(mid.unwrap("some").length(), 5n));
        $(Assert.equal(mid.unwrap("some").get(0n).id, "r30"));
        $(Assert.equal(mid.unwrap("some").get(4n).id, "r34"));
        // Then backwards, then the same offset again: the source is stateless,
        // so an offset answers identically regardless of what was read between.
        const head = $.let(src.page(0n, 5n));
        $(Assert.equal(head.unwrap("some").get(0n).id, "r00"));
        const midAgain = $.let(src.page(30n, 5n));
        $(Assert.equal(East.equal(mid, midAgain), true));
        // A window that overruns the end CLAMPS; it does not wrap or throw.
        const tail = $.let(src.page(48n, 10n));
        $(Assert.equal(tail.unwrap("some").length(), 2n));
        $(Assert.equal(tail.unwrap("some").get(1n).id, "r49"));
        // A limit past the whole source is the whole source.
        $(Assert.equal(src.page(0n, 999n).unwrap("some").length(), 50n));
    });

    test("RANDOM ACCESS tiles — disjoint windows cover every row exactly once, in order", $ => {
        const WideRow = StructType({ id: StringType, n: IntegerType });
        const src = $.let(Paged.of("wide", $.const(WIDE_ROWS, ArrayType(WideRow))));
        // Three windows requested OUT of order still tile [0,50) with no gap
        // and no repeat — the property a merged canvas depends on.
        const w2 = $.let(src.page(40n, 20n));
        const w0 = $.let(src.page(0n, 20n));
        const w1 = $.let(src.page(20n, 20n));
        $(Assert.equal(w0.unwrap("some").length(), 20n));
        $(Assert.equal(w1.unwrap("some").length(), 20n));
        $(Assert.equal(w2.unwrap("some").length(), 10n));
        // Boundaries abut exactly: last of w0 is r19, first of w1 is r20.
        $(Assert.equal(w0.unwrap("some").get(19n).id, "r19"));
        $(Assert.equal(w1.unwrap("some").get(0n).id, "r20"));
        $(Assert.equal(w1.unwrap("some").get(19n).id, "r39"));
        $(Assert.equal(w2.unwrap("some").get(0n).id, "r40"));
    });

    test("RANDOM ACCESS on a KEYED source holds canonical key order mid-source", $ => {
        const WideVal = StructType({ n: IntegerType });
        const src = $.let(Paged.of("wide", $.const(WIDE_DICT, DictType(StringType, WideVal))));
        $(Assert.equal(src.total().unwrap("some"), 50n));
        // An arbitrary offset is a DICT of exactly the keys at that position in
        // canonical order — not the head, and not insertion order.
        const mid = $.let(src.page(25n, 3n));
        $(Assert.equal(mid.unwrap("some").size(), 3n));
        $(Assert.equal(mid.unwrap("some").has("r25"), true));
        $(Assert.equal(mid.unwrap("some").has("r27"), true));
        $(Assert.equal(mid.unwrap("some").has("r28"), false));
        $(Assert.equal(mid.unwrap("some").has("r00"), false));
        // And a seek lands in the very window that serves its row.
        const find = $.const(src.seek.unwrap("some"));
        const hit = $.let(find($.const(variant("key", '"r37"'), Paged.Types.SeekQuery)));
        $(Assert.equal(hit.unwrap("some").found, true));
        $(Assert.equal(hit.unwrap("some").row, 37n));
        $(Assert.equal(src.page(hit.unwrap("some").row, 1n).unwrap("some").has("r37"), true));
    });

    // ── Trimmed sources (#829) ───────────────────────────────────────────
    // A source may serve FEWER elements than a window asks for while it still
    // has more — e3 trims every page to a byte budget. `pageLimit` is the
    // in-memory twin, and every component's derived `page` must still hand
    // its renderer WHOLE windows, or a window's tail is never asked for.

    test("pageLimit trims every window — short before the end, and the pieces tile", $ => {
        const WideRow = StructType({ id: StringType, n: IntegerType });
        const rows = $.const(WIDE_ROWS, ArrayType(WideRow));
        const src = $.let(Paged.of("trimmed", rows, { pageLimit: 7 }));
        // The total is the source's, whatever a window serves.
        $(Assert.equal(src.total().unwrap("some"), 50n));
        // Asked for 20, served 7 — the source still has more.
        const w0 = $.let(src.page(0n, 20n));
        $(Assert.equal(w0.unwrap("some").length(), 7n));
        // The rest is addressable exactly where the short window stopped.
        const w1 = $.let(src.page(7n, 20n));
        $(Assert.equal(w1.unwrap("some").get(0n).id, "r07"));
        // A request under the cap is served whole; the tail still clamps, and
        // only past the end is the window EMPTY.
        const small = $.let(src.page(10n, 3n));
        $(Assert.equal(small.unwrap("some").length(), 3n));
        const tail = $.let(src.page(49n, 20n));
        $(Assert.equal(tail.unwrap("some").length(), 1n));
        const past = $.let(src.page(50n, 20n));
        $(Assert.equal(past.unwrap("some").length(), 0n));
    });

    test("pageLimit trims a KEYED source too, in canonical key order", $ => {
        const WideVal = StructType({ n: IntegerType });
        const entries = $.const(WIDE_DICT, DictType(StringType, WideVal));
        const src = $.let(Paged.of("trimmed", entries, { pageLimit: 7 }));
        const w0 = $.let(src.page(0n, 20n));
        $(Assert.equal(w0.unwrap("some").size(), 7n));
        $(Assert.equal(w0.unwrap("some").has("r06"), true));
        $(Assert.equal(w0.unwrap("some").has("r07"), false));
        const w1 = $.let(src.page(7n, 20n));
        $(Assert.equal(w1.unwrap("some").has("r07"), true));
    });

    test("a Table over a trimmed ARRAY source gets WHOLE windows — the tail is read, not dropped", $ => {
        const WideRow = StructType({ id: StringType, n: IntegerType });
        const rows = $.const(WIDE_ROWS, ArrayType(WideRow));
        const src = $.let(Paged.of("trimmed", rows, { pageLimit: 7 }));
        const table = $.let(Table.Root(src, ["id", "n"]));
        const derived = $.let(table.unwrap().unwrap("Table").rows.unwrap("paged"));
        // 20 asked, 7 served per piece: the derived window re-requests the
        // rest, three pieces deep, and hands back all 20.
        const w0 = $.let(derived.page(0n, 20n));
        $(Assert.equal(w0.unwrap("some").length(), 20n));
        // The next window starts at 20 — nothing between 7 and 19 was lost.
        const w1 = $.let(derived.page(20n, 20n));
        $(Assert.equal(w1.unwrap("some").length(), 20n));
        // The final window is partial (the source ends), and past the end is
        // the EMPTY window — never `none`.
        const w2 = $.let(derived.page(40n, 20n));
        $(Assert.equal(w2.unwrap("some").length(), 10n));
        const past = $.let(derived.page(60n, 20n));
        $(Assert.equal(past.unwrap("some").length(), 0n));
    });

    test("a Plan over a trimmed KEYED source gets WHOLE windows", $ => {
        const WideVal = StructType({ n: IntegerType });
        const entries = $.const(WIDE_DICT, DictType(StringType, WideVal));
        const src = $.let(Paged.of("trimmed", entries, { pageLimit: 7 }));
        const series = $.const([
            Plan.series.span(WideVal, { key: "entries", title: "Entries", label: (_r, k) => k, runs: () => [] }),
        ], ArrayType(Plan.Types.Series(WideVal)));
        const axis = $.const(Plan.axis({ window: TRIM_WINDOW, resolution: "week" }));
        const plan = $.let(Plan.Root({ axis, data: src, series }));
        const derived = $.let(plan.unwrap().unwrap("Plan").rows.unwrap("paged"));
        // One row per entry: a whole window is 20 rows, r00…r19 in key order —
        // the one series' block of it (#823: a window is the canvas's blocks).
        const w0 = $.let(derived.page(0n, 20n).unwrap("some").get(0n).rows);
        $(Assert.equal(w0.size(), 20n));
        $(Assert.equal(w0.get(0n).id, Plan.ref("entries", "r00")));
        $(Assert.equal(w0.get(19n).id, Plan.ref("entries", "r19")));
        const w2 = $.let(derived.page(40n, 20n).unwrap("some").get(0n).rows);
        $(Assert.equal(w2.size(), 10n));
    });

    test("a piece still in flight holds the whole derived window at `none`", $ => {
        const Row = StructType({ id: StringType, n: IntegerType });
        const rows = $.const(WIDE_ROWS, ArrayType(Row));
        // A source that trims to 7 and has only its first piece in hand —
        // every later piece is still on the wire.
        const firstPieceOnly = $.const(East.function(
            [IntegerType, IntegerType], OptionType(ArrayType(Row)),
            ($, offset, limit) => {
                const piece = $.let(none, OptionType(ArrayType(Row)));
                const served = $.let(limit.less(7n).ifElse(() => limit, () => 7n), IntegerType);
                $.if(offset.equal(0n), ($) => { $.assign(piece, some(rows.slice(0n, served))); });
                return piece;
            }));
        const knownTotal = $.const(East.function([], OptionType(IntegerType), (_$) => some(50n)));
        // A source that cannot name its snapshot says so (`none`), and has
        // nothing to refresh to.
        const noRevision = $.const(East.function([], OptionType(StringType), (_$) => none));
        const noRefresh = $.const(East.function([OptionType(StringType)], NullType, (_$) => null));
        const src = $.let(
            { id: "slow", page: firstPieceOnly, total: knownTotal, seek: none, revision: noRevision, refresh: noRefresh },
            Paged.Types.Source(ArrayType(Row)),
        );
        const table = $.let(Table.Root(src, ["id", "n"]));
        const derived = $.let(table.unwrap().unwrap("Table").rows.unwrap("paged"));
        // Serving the landed 7 as the window would drop 8…19 for good; the
        // window waits, and re-fires when the piece lands.
        $(Assert.equal(derived.page(0n, 20n).hasTag("none"), true));
        // A window the landed piece covers on its own is whole already.
        $(Assert.equal(derived.page(0n, 5n).unwrap("some").length(), 5n));
    });
}, { platformFns: TestImpl });

describe("Paged.of refusals (#829)", () => {
    const rows = East.value([{ id: "a" }], ArrayType(StructType({ id: StringType })));
    hostTest("a pageLimit that is not a positive integer is refused, naming the value", () => {
        assert.throws(() => Paged.of("p", rows, { pageLimit: 0 }), /pageLimit.*positive integer.*got 0/);
        assert.throws(() => Paged.of("p", rows, { pageLimit: -3 }), /got -3/);
        assert.throws(() => Paged.of("p", rows, { pageLimit: 2.5 }), /got 2\.5/);
    });
});

describe("Paged source lifecycle — revision and refresh (#744, #821)", () => {
    const Row = StructType({ id: StringType, nested: ArrayType(IntegerType) });
    const Rows = ArrayType(Row);
    const capture = East.function([Rows], Paged.Types.Source(Rows), (_$, rows) => Paged.of("snapshot", rows));

    hostTest("Paged.of detaches nested mutable input and refuses an unrelated revision", () => {
        const input = [{ id: "a", nested: [1n] }];
        const source = East.compile(capture, [])(input);
        input[0]!.nested.push(2n);
        input.push({ id: "b", nested: [] });
        assert.deepEqual(source.page(0n, 10n), some([{ id: "a", nested: [1n] }]));
        assert.deepEqual(source.total(), some(1n));
        assert.deepEqual(source.revision(), some("snapshot"));
        source.refresh(none);
        source.refresh(some("snapshot"));
        assert.throws(() => source.refresh(some("other")), /immutable snapshot/);
        assert.deepEqual(source.revision(), some("snapshot"));
    });

    hostTest("mapped row sources keep the handle's id and forward lifecycle methods with their original closure", () => {
        const program = East.function([Rows], Paged.Types.RowSource(Rows), ($, rows) => {
            const source = $.let(Paged.of("snapshot", rows));
            return buildRowSource(resolveRowSource(source, "fixture"), Rows, r => r as never);
        });
        const value = East.compile(program, [])([{ id: "a", nested: [1n] }]);
        assert.equal(value.type, "paged");
        if (value.type !== "paged") return;
        // The id names the logical source; what `make` serves is told apart by
        // comparing the derived source whole (#809), not by a signed id (#822).
        assert.equal(value.value.id, "snapshot");
        assert.deepEqual(value.value.revision(), some("snapshot"));
        assert.throws(() => value.value.refresh(some("other")), /immutable snapshot/);
    });

    hostTest("a legacy producer normalizes to read-only lifecycle without inventing a revision", () => {
        const program = East.function([Rows], Paged.Types.RowSource(Rows), ($, rows) => {
            const current = $.let(Paged.of("legacy", rows));
            const legacy = $.let({ id: current.id, page: current.page, total: current.total, seek: current.seek });
            return buildRowSource(resolveRowSource(legacy, "fixture"), Rows, r => r as never);
        });
        const value = East.compile(program, [])([]);
        assert.equal(value.type, "paged");
        if (value.type !== "paged") return;
        assert.deepEqual(value.value.revision(), none);
        assert.throws(() => value.value.refresh(none), /legacy source cannot refresh/);
        assert.deepEqual(value.value.page(0n, 10n), some([]));
    });
});

describe("Paged.of snapshots entries of any type (#822)", () => {
    // The snapshot is a beast round trip. Beast v1 writes neither a recursive
    // type nor a function, so a v1 copy refused both — and a Plan's entries
    // may be either.
    const Node = RecursiveType(self => StructType({ name: StringType, children: DictType(StringType, self) }));
    const Tree = DictType(StringType, Node);

    hostTest("recursive entries page, detached from the input at every depth", () => {
        const capture = East.function([Tree], Paged.Types.Source(Tree), (_$, tree) => Paged.of("tree", tree));
        const children = new Map([["b", { name: "B", children: new Map() }]]);
        const input = new Map([["a", { name: "A", children }]]);
        const source = East.compile(capture, [])(input);
        children.set("c", { name: "C", children: new Map() });
        // East's own equality: the runtime's dicts are sorted maps, not `Map`s.
        const pageEqual = equalFor(OptionType(Tree));
        assert.ok(pageEqual(source.page(0n, 10n), some(new Map([["a", { name: "A", children: new Map([["b", { name: "B", children: new Map() }]]) }]]))));
        assert.deepEqual(source.total(), some(1n));
    });

    hostTest("entries carrying a function page, and the function still runs", () => {
        const Job = StructType({ name: StringType, cost: FunctionType([IntegerType], IntegerType) });
        const Jobs = ArrayType(Job);
        const program = East.function([], Paged.Types.Source(Jobs), ($) => {
            const double = $.const(East.function([IntegerType], IntegerType, (_$, n) => n.multiply(2n)));
            const jobs = $.let([{ name: "weld", cost: double }], Jobs);
            return Paged.of("jobs", jobs);
        });
        const page = East.compile(program, [])().page(0n, 10n);
        assert.equal(page.type, "some");
        if (page.type !== "some") return;
        assert.equal(page.value[0]!.name, "weld");
        assert.equal(page.value[0]!.cost(21n), 42n);
    });
});
