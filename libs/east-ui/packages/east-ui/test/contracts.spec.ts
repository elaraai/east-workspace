/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ArrayType, East, IntegerType, StringType, StructType, variant, some, none } from "@elaraai/east";
import { DragEventType, CellRefType, LibraryRefType, Paged } from "@elaraai/east-ui";

describeEast("Drag grammar contract", (test) => {
    test("constructs an add event with a duplicate flag", $ => {
        const event = $.const(variant("add", {
            from: { library: "people", key: "patel" },
            into: { surface: "roster-se", row: "patel", slot: "thu", event: none },
            duplicate: true,
        }), DragEventType);

        $(Assert.equal(event.getTag(), "add"));
        $(Assert.equal(event.unwrap("add").from.library, "people"));
        $(Assert.equal(event.unwrap("add").into.slot, "thu"));
        $(Assert.equal(event.unwrap("add").into.event.hasTag("none"), true));
        $(Assert.equal(event.unwrap("add").duplicate, true));
    });

    test("constructs a cross-row move event", $ => {
        const event = $.const(variant("move", {
            from: { surface: "roster-se", row: "patel", slot: "thu", event: some("shift-12") },
            to: { surface: "roster-se", row: "cho", slot: "thu", event: none },
        }), DragEventType);

        $(Assert.equal(event.getTag(), "move"));
        $(Assert.equal(East.notEqual(event.unwrap("move").from.row, event.unwrap("move").to.row), true));
        $(Assert.equal(event.unwrap("move").from.event.unwrap("some"), "shift-12"));
    });

    test("constructs remove events for both sinks", $ => {
        const fromCell = $.const({
            surface: "bench", row: "BLEND-318", slot: "alloc", event: some("SRC-204"),
        }, CellRefType);
        const toTrash = $.const(variant("remove", { from: fromCell, to: variant("trash", null) }), DragEventType);
        const toSource = $.const(variant("remove", { from: fromCell, to: variant("source", null) }), DragEventType);

        $(Assert.equal(toTrash.unwrap("remove").to.getTag(), "trash"));
        $(Assert.equal(toSource.unwrap("remove").to.getTag(), "source"));
    });

    test("constructs a resize event with an edge", $ => {
        const event = $.const(variant("resize", {
            event: { surface: "gantt-1", row: "line-2", slot: "w39", event: some("job-7") },
            edge: variant("end", null),
        }), DragEventType);

        $(Assert.equal(event.getTag(), "resize"));
        $(Assert.equal(event.unwrap("resize").edge.hasTag("end"), true));
    });

    test("drag events round-trip through print and parse", $ => {
        const event = $.const(variant("add", {
            from: East.value({ library: "materials", key: "SRC-204" }, LibraryRefType),
            into: { surface: "bench", row: "BLEND-318", slot: "alloc", event: none },
            duplicate: false,
        }), DragEventType);
        const parsed = $.let(East.print(event).parse(DragEventType));

        $(Assert.equal(East.equal(event, parsed), true));
    });
}, { platformFns: TestImpl });

describeEast("Row-source contract (#567)", (test) => {
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
        const hit = $.let(keyed.seek.unwrap("some")("ka"));
        $(Assert.equal(hit.unwrap("some").found, true));
        $(Assert.equal(hit.unwrap("some").row, 0n));
        $(Assert.equal(hit.unwrap("some").count, 2n));
        const mid = $.let(keyed.seek.unwrap("some")("kb"));
        $(Assert.equal(mid.unwrap("some").row, 2n));
        $(Assert.equal(mid.unwrap("some").count, 1n));
        // A miss still carries the INSERTION row, so a viewport can position.
        const miss = $.let(keyed.seek.unwrap("some")("kz"));
        $(Assert.equal(miss.unwrap("some").found, false));
        $(Assert.equal(miss.unwrap("some").count, 0n));
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
}, { platformFns: TestImpl });
