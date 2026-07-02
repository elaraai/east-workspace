/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { BooleanType, East, NullType, StringType, variant } from "@elaraai/east";
import { Board, CellRefType, DragEventType } from "@elaraai/east-ui/internal";
import * as ex from "./board.examples.js";

describeEast("Board", (test) => {
    Assert.examples(test, {
        boardEdit: ex.boardEdit,
        boardPublished: ex.boardPublished,
        boardCoverage: ex.boardCoverage,
        boardOverflow: ex.boardOverflow,
        boardInteractive: ex.boardInteractive,
        boardWithLibrary: ex.boardWithLibrary,
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
        $(Assert.equal(root.canAssign.hasTag("none"), true));
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

        $(Assert.equal(root.canAssign.hasTag("some"), true));
        $(Assert.equal(root.canAssign.unwrap("some")("patel", "icu", "am"), true));
        $(Assert.equal(root.canAssign.unwrap("some")("patel", "icu", "night"), false));
        $(Assert.equal(root.onDrag.hasTag("some"), true));
        $(Assert.equal(root.onSelect.hasTag("some"), true));
        $(Assert.equal(root.onAccept.hasTag("none"), true));
        $(Assert.equal(root.onAddAt.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
