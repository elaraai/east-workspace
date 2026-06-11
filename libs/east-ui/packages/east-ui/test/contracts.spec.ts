/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, variant, some, none } from "@elaraai/east";
import { DragEventType, CellRefType, LibraryRefType } from "@elaraai/east-ui";

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
