/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ArrayType, DictType, East, IntegerType, StringType, StructType, variant, some, none } from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
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

describeEast("Row-source contract (#567)", (test) => {
    Assert.examples(test, {
        pagedSourceCanvas: ex.pagedSourceCanvas,
        pagedTableSource: ex.pagedTableSource,
        pagedSourceWindows: ex.pagedSourceWindows,
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
}, { platformFns: TestImpl });
