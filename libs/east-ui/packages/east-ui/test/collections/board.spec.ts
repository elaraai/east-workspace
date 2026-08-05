/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { BooleanType, East, IntegerType, NullType, StringType, StructType, none, some, variant, type ExprType } from "@elaraai/east";
import { Board, CellRefType, DragEventType } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./board.examples.js";

describeEast("Board", (test) => {
    Assert.examples(test, {
        boardEdit: ex.boardEdit,
        boardLibraryDnd: ex.boardLibraryDnd,
        boardVariants: ex.boardVariants,
        boardReview: ex.boardReview,
        boardFill: ex.boardFill,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("boardModes drives its preview from inline option tables", $ => {
        // The mode-preset axis is declared inside the example body, because
        // the documentation capture only extracts `fn`. That puts it inside
        // the Reactive body, which TestImpl does not execute, so it cannot be
        // asserted from here; `Assert.examples` above still compiles and
        // evaluates the outer function. Per-mode prop coverage lives in the
        // Board.Root tests below.
        const panel = $.const(ex.boardVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("creates a board with target declaration and bare defaults", $ => {
        const board = $.let(Board.Root(
            [{ id: "icu", name: "ICU" }],
            [{ id: "am", name: "AM" }],
            [{ id: "patel", name: "Patel, R." }],
            [{ id: "x1", personId: "patel", areaId: "icu", shiftId: "am", state: variant("committed", null) }],
            {
                id: "board-tue",
                sources: ["people"],
                area: a => ({ key: a.id, label: a.name }),
                shift: s => ({ key: s.id, label: s.name }),
                person: p => ({ key: p.id, label: p.name }),
                assignment: x => ({ key: x.id, person: x.personId, area: x.areaId, shift: x.shiftId, state: x.state }),
            },
        ));
        const root = $.let(board.unwrap().unwrap("Board"));

        $(Assert.equal(root.id, "board-tue"));
        $(Assert.equal(root.sources.get(0n), "people"));
        $(Assert.equal(root.mode.hasTag("published"), true));
        // Zero baked copy — the area header is blank unless the host names it.
        $(Assert.equal(root.areaHeader.hasTag("none"), true));
        $(Assert.equal(root.areaWidth.hasTag("none"), true));
        $(Assert.equal(root.requirements.hasTag("none"), true));
        $(Assert.equal(root.maxVisible.hasTag("none"), true));
        $(Assert.equal(root.summary.hasTag("none"), true));
        $(Assert.equal(root.canDrop.hasTag("none"), true));
        $(Assert.equal(root.areas.get(0n).key, "icu"));
        $(Assert.equal(root.areas.get(0n).sublabel.hasTag("none"), true));
        $(Assert.equal(root.shifts.get(0n).label, "AM"));
        $(Assert.equal(root.people.get(0n).label, "Patel, R."));
    });

    test("assignments resolve through the encoding and keep typed state", $ => {
        const board = $.let(Board.Root(
            [{ id: "icu", name: "ICU", wing: "Level 2" }],
            [{ id: "am", name: "AM", window: "06:00–14:00" }],
            [{ id: "patel", name: "Patel, R." }],
            [
                { id: "x1", personId: "patel", areaId: "icu", shiftId: "am", state: variant("committed", null) },
                { id: "x2", personId: "patel", areaId: "icu", shiftId: "am", state: variant("proposed", variant("model", null)) },
            ],
            {
                id: "b",
                mode: "edit",
                areaHeader: "Ward",
                areaWidth: "180px",
                summary: "1 ghost",
                maxVisible: 4,
                area: a => ({ key: a.id, label: a.name, sublabel: a.wing }),
                shift: s => ({ key: s.id, label: s.name, sublabel: s.window }),
                person: p => ({ key: p.id, label: p.name }),
                assignment: x => ({ key: x.id, person: x.personId, area: x.areaId, shift: x.shiftId, state: x.state }),
            },
        ));
        const root = $.let(board.unwrap().unwrap("Board"));

        $(Assert.equal(root.mode.hasTag("edit"), true));
        $(Assert.equal(root.areaHeader.unwrap("some"), "Ward"));
        $(Assert.equal(root.areaWidth.unwrap("some"), "180px"));
        $(Assert.equal(root.summary.unwrap("some"), "1 ghost"));
        $(Assert.equal(root.maxVisible.unwrap("some"), 4n));
        $(Assert.equal(root.areas.get(0n).sublabel.unwrap("some"), "Level 2"));
        $(Assert.equal(root.shifts.get(0n).sublabel.unwrap("some"), "06:00–14:00"));
        $(Assert.equal(root.assignments.get(0n).person, "patel"));
        $(Assert.equal(root.assignments.get(0n).state.hasTag("committed"), true));
        $(Assert.equal(root.assignments.get(1n).state.unwrap("proposed").hasTag("model"), true));
    });

    test("requirements resolve through the requirement encoding", $ => {
        const board = $.let(Board.Root(
            [{ id: "icu", name: "ICU" }],
            [{ id: "am", name: "AM" }],
            [{ id: "patel", name: "Patel, R." }],
            [{ id: "x1", personId: "patel", areaId: "icu", shiftId: "am", state: variant("committed", null) }],
            {
                id: "b",
                area: a => ({ key: a.id, label: a.name }),
                shift: s => ({ key: s.id, label: s.name }),
                person: p => ({ key: p.id, label: p.name }),
                assignment: x => ({ key: x.id, person: x.personId, area: x.areaId, shift: x.shiftId, state: x.state }),
                requirements: [
                    { areaId: "icu", shiftId: "am", count: 3n },
                ],
                requirement: r => ({ area: r.areaId, shift: r.shiftId, required: r.count }),
            },
        ));
        const requirements = $.let(board.unwrap().unwrap("Board").requirements.unwrap("some"));

        $(Assert.equal(requirements.get(0n).area, "icu"));
        $(Assert.equal(requirements.get(0n).shift, "am"));
        $(Assert.equal(requirements.get(0n).required, 3n));
    });

    test("callbacks are encoded when provided", $ => {
        const onDrag = $.const(East.function([DragEventType], NullType, (_$, _event) => null));
        const onSelect = $.const(East.function([CellRefType], NullType, (_$, _ref) => null));
        const canAssign = $.const(East.function([StringType, StringType, StringType], BooleanType,
            (_$, _person, _area, shift) => shift.notEqual("night")));
        const board = $.let(Board.Root(
            [{ id: "icu", name: "ICU" }],
            [{ id: "am", name: "AM" }],
            [{ id: "patel", name: "Patel, R." }],
            [{ id: "x1", personId: "patel", areaId: "icu", shiftId: "am", state: variant("committed", null) }],
            {
                id: "b",
                mode: "edit",
                area: a => ({ key: a.id, label: a.name }),
                shift: s => ({ key: s.id, label: s.name }),
                person: p => ({ key: p.id, label: p.name }),
                assignment: x => ({ key: x.id, person: x.personId, area: x.areaId, shift: x.shiftId, state: x.state }),
                canAssign,
                onDrag,
                onSelect,
            },
        ));
        const root = $.let(board.unwrap().unwrap("Board"));

        // The deprecated `canAssign` sugar compiles into the shared `canDrop`
        // predicate over synthesized candidate events (#261).
        $(Assert.equal(root.canDrop.hasTag("some"), true));
        const veto = $.let(root.canDrop.unwrap("some"));
        // add: the dragged card's key IS the person; (icu, am) allowed, nights vetoed.
        $(Assert.equal(veto(variant("add", {
            from: { library: "people", key: "patel" },
            into: { surface: "b", row: "icu", slot: "am", event: none },
            duplicate: false,
        })), true));
        $(Assert.equal(veto(variant("add", {
            from: { library: "people", key: "patel" },
            into: { surface: "b", row: "icu", slot: "night", event: none },
            duplicate: false,
        })), false));
        // move: the person resolves from the authored assignments by event key.
        $(Assert.equal(veto(variant("move", {
            from: { surface: "b", row: "icu", slot: "am", event: some("x1") },
            to: { surface: "b", row: "icu", slot: "night", event: none },
        })), false));
        // move of an unknown key fails open (e.g. a chip added optimistically).
        $(Assert.equal(veto(variant("move", {
            from: { surface: "b", row: "icu", slot: "am", event: some("nope") },
            to: { surface: "b", row: "icu", slot: "night", event: none },
        })), true));
        // sink kinds are always structurally valid.
        $(Assert.equal(veto(variant("remove", {
            from: { surface: "b", row: "icu", slot: "am", event: some("x1") },
            to: variant("trash", null),
        })), true));
        $(Assert.equal(root.onDrag.hasTag("some"), true));
        $(Assert.equal(root.onSelect.hasTag("some"), true));
        $(Assert.equal(root.onAccept.hasTag("none"), true));
        $(Assert.equal(root.onAddAt.hasTag("none"), true));
    });

    test("review foot encodes; per-row fields are dropped with a warning (#265)", $ => {
        const board = $.let(Board.Root(
            [{ id: "icu", name: "ICU" }],
            [{ id: "am", name: "AM" }],
            [{ id: "patel", name: "Patel, R." }],
            [{ id: "x1", personId: "patel", areaId: "icu", shiftId: "am", state: variant("committed", null) }],
            {
                id: "b",
                mode: "edit",
                area: a => ({ key: a.id, label: a.name }),
                shift: sh => ({ key: sh.id, label: sh.name }),
                person: p => ({ key: p.id, label: p.name }),
                assignment: x => ({ key: x.id, person: x.personId, area: x.areaId, shift: x.shiftId, state: x.state }),
                review: {
                    // Per-row fields are unused on Board v1 — the factory warns
                    // and drops them so the foot-only contract is explicit.
                    onApprove: East.function([StructType({ rowIndex: IntegerType })], NullType, _$ => null),
                    onApproveAll: East.function([], NullType, _$ => null),
                    onRejectAll: East.function([], NullType, _$ => null),
                },
            },
        ));
        const review = $.let(board.unwrap().unwrap("Board").review.unwrap("some"));

        $(Assert.equal(review.onApprove.hasTag("none"), true));
        $(Assert.equal(review.onApproveAll.hasTag("some"), true));
        $(Assert.equal(review.onRejectAll.hasTag("some"), true));
        $(Assert.equal(review.onRerun.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
