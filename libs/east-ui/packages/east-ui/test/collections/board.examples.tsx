/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, IntegerType, NullType, StringType, example, variant } from "@elaraai/east";
import { CellRefType, DragEventType, State, UIComponentType } from "@elaraai/east-ui";
import { Board, Box, Library, Reactive, Separator, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

// Shared assignment-state values for the hoisted fixtures.
const COMMITTED = variant("committed", null);
const ADDED = variant("proposed", variant("added", null));

const BOARD_PUBLISHED_AREAS_DATA = [
    { id: "icu", name: "ICU" },
    { id: "surgical", name: "Surgical" },
];
const BOARD_PUBLISHED_SHIFTS_DATA = [
    { id: "am", name: "AM" },
    { id: "pm", name: "PM" },
];
const BOARD_PUBLISHED_PEOPLE_DATA = [
    { id: "patel", name: "Patel, R." },
    { id: "cho", name: "Cho, J." },
];
const BOARD_PUBLISHED_DATA = [
    { id: "x1", person: "patel", area: "icu", shift: "am", state: COMMITTED },
    { id: "x2", person: "cho", area: "icu", shift: "pm", state: COMMITTED },
    { id: "x3", person: "cho", area: "surgical", shift: "am", state: ADDED },
];
const BOARD_COVERAGE_AREAS_DATA = [
    { id: "emergency", name: "Emergency" },
    { id: "icu", name: "ICU" },
];
const BOARD_COVERAGE_SHIFTS_DATA = [
    { id: "am", name: "AM", window: "06:00–14:00" },
    { id: "pm", name: "PM", window: "14:00–22:00" },
];
const BOARD_COVERAGE_PEOPLE_DATA = [
    { id: "patel", name: "Patel, R." },
    { id: "cho", name: "Cho, J." },
    { id: "rivera", name: "Rivera, M." },
    { id: "okafor", name: "Okafor, S." },
];
const BOARD_COVERAGE_DATA = [
    // Emergency AM — exact (2/2).
    { id: "x1", person: "patel", area: "emergency", shift: "am", state: COMMITTED },
    { id: "x2", person: "cho", area: "emergency", shift: "am", state: COMMITTED },
    // Emergency PM — understaffed (1/3, two open slots).
    { id: "x3", person: "rivera", area: "emergency", shift: "pm", state: COMMITTED },
    // ICU AM — overstaffed (3/2).
    { id: "x4", person: "okafor", area: "icu", shift: "am", state: COMMITTED },
    { id: "x5", person: "rivera", area: "icu", shift: "am", state: COMMITTED },
    { id: "x6", person: "cho", area: "icu", shift: "am", state: ADDED },
];
const BOARD_COVERAGE_REQUIREMENTS_DATA = [
    { area: "emergency", shift: "am", count: 2n },
    { area: "emergency", shift: "pm", count: 3n },
    { area: "icu", shift: "am", count: 2n },
    { area: "icu", shift: "pm", count: 1n },
];
const BOARD_OVERFLOW_DATA = [
    { id: "x1", person: "patel", area: "maternity", shift: "am", state: COMMITTED },
    { id: "x2", person: "cho", area: "maternity", shift: "am", state: COMMITTED },
    { id: "x3", person: "rivera", area: "maternity", shift: "am", state: COMMITTED },
    { id: "x4", person: "okafor", area: "maternity", shift: "am", state: COMMITTED },
    { id: "x5", person: "kim", area: "maternity", shift: "am", state: ADDED },
    { id: "x6", person: "patel", area: "maternity", shift: "pm", state: COMMITTED },
];
const BOARD_SCROLL_AREAS_DATA = [
    { id: "emergency", name: "Emergency" }, { id: "icu", name: "ICU" },
    { id: "warda", name: "Ward A" }, { id: "wardb", name: "Ward B" },
    { id: "theatre", name: "Theatre" }, { id: "recovery", name: "Recovery" },
    { id: "triage", name: "Triage" }, { id: "pharmacy", name: "Pharmacy" },
];
const BOARD_SCROLL_SHIFTS_DATA = [
    { id: "am", name: "AM" }, { id: "pm", name: "PM" },
];
const BOARD_SCROLL_PEOPLE_DATA = [
    { id: "patel", name: "Patel, R." }, { id: "cho", name: "Cho, J." },
    { id: "rivera", name: "Rivera, M." }, { id: "okafor", name: "Okafor, S." },
];
const BOARD_SCROLL_DATA = [
    { id: "a1", person: "patel", area: "emergency", shift: "am", state: COMMITTED },
    { id: "a2", person: "cho", area: "icu", shift: "am", state: COMMITTED },
    { id: "a3", person: "rivera", area: "warda", shift: "pm", state: COMMITTED },
    { id: "a4", person: "okafor", area: "theatre", shift: "am", state: COMMITTED },
    { id: "a5", person: "patel", area: "triage", shift: "pm", state: COMMITTED },
];
const BOARD_FILL_AREAS_DATA = East.Array.range(0n, 200n).map((_$, i) => ({
    id: East.str`area${i}`,
    name: East.str`Area ${i}`,
}));
const BOARD_FILL_SHIFTS_DATA = [
    { id: "am", name: "AM" }, { id: "pm", name: "PM" },
];
const BOARD_FILL_PEOPLE_DATA = [
    { id: "patel", name: "Patel, R." }, { id: "cho", name: "Cho, J." },
    { id: "rivera", name: "Rivera, M." }, { id: "okafor", name: "Okafor, S." },
];
const BOARD_FILL_DATA = [
    { id: "a1", person: "patel", area: "area0", shift: "am", state: COMMITTED },
    { id: "a2", person: "cho", area: "area1", shift: "am", state: COMMITTED },
    { id: "a3", person: "rivera", area: "area2", shift: "pm", state: COMMITTED },
    { id: "a4", person: "okafor", area: "area15", shift: "am", state: COMMITTED },
    { id: "a5", person: "patel", area: "area199", shift: "pm", state: COMMITTED },
];

export const boardEdit = example({
    keywords: ["Board", "assignment", "edit", "areas", "shifts", "ghost", "added", "removed", "summary"],
    description: "Edit-mode day board — committed, added, removed, and model-ghost assignments across areas × shifts",
    fn: East.function([], UIComponentType, ($) => {
        const areas = $.const([
            { id: "emergency", name: "Emergency", wing: "Level 1" },
            { id: "icu", name: "ICU", wing: "Level 2" },
            { id: "surgical", name: "Surgical", wing: "Level 2" },
        ]);
        const shifts = $.const([
            { id: "am", name: "AM", window: "06:00–14:00" },
            { id: "pm", name: "PM", window: "14:00–22:00" },
            { id: "night", name: "Night", window: "22:00–06:00" },
        ]);
        const people = $.const([
            { id: "patel", name: "Patel, R.", role: "Senior RN" },
            { id: "cho", name: "Cho, J.", role: "RN" },
            { id: "rivera", name: "Rivera, M.", role: "RN" },
            { id: "okafor", name: "Okafor, S.", role: "Senior RN" },
            { id: "kim", name: "Kim, A.", role: "EN" },
        ]);
        const committed = variant("committed", null);
        const added = variant("proposed", variant("added", null));
        const removed = variant("proposed", variant("removed", null));
        const ghost = variant("proposed", variant("model", null));
        const assignments = $.const([
            { id: "x1", person: "patel", area: "emergency", shift: "am", state: committed },
            { id: "x2", person: "cho", area: "emergency", shift: "am", state: committed },
            { id: "x3", person: "kim", area: "emergency", shift: "am", state: added },
            { id: "x4", person: "rivera", area: "emergency", shift: "pm", state: removed },
            { id: "x5", person: "okafor", area: "icu", shift: "am", state: committed },
            { id: "x6", person: "cho", area: "icu", shift: "pm", state: added },
            { id: "x7", person: "kim", area: "icu", shift: "pm", state: ghost },
            { id: "x8", person: "rivera", area: "surgical", shift: "am", state: committed },
            { id: "x9", person: "okafor", area: "surgical", shift: "night", state: committed },
        ]);
        return (
            <Board
                id="board-tue"
                sources={["people"]}
                mode="edit"
                areas={areas}
                area={a => ({ key: a.id, label: a.name, sublabel: a.wing })}
                areaHeader="Ward"
                shifts={shifts}
                shift={s => ({ key: s.id, label: s.name, sublabel: s.window })}
                people={people}
                person={p => ({ key: p.id, label: p.name, sublabel: p.role })}
                assignments={assignments}
                assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                summary="3 proposed · 1 model-ghost"
            />
        );
    }),
    inputs: [],
});

export const boardInteractive = example({
    keywords: ["Board", "Reactive", "State", "onDrag", "onAccept", "interactive"],
    description: "Edit day board whose onDrag / onAccept callbacks count interactions",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const dragBind = $.let(State.bind([IntegerType], "board_drags", 0n));
            const acceptBind = $.let(State.bind([IntegerType], "board_accepts", 0n));
            const onDrag = $.const(East.function([DragEventType], NullType, ($, _event) => {
                const n = $.let(dragBind.read());
                $(dragBind.write(n.add(1n)));
            }));
            const onAccept = $.const(East.function([CellRefType], NullType, ($, _ref) => {
                const n = $.let(acceptBind.read());
                $(acceptBind.write(n.add(1n)));
            }));
            const drags = $.let(dragBind.read());
            const accepts = $.let(acceptBind.read());
            return (
                <VStack gap="3" align="stretch">
                    <Board
                        id="board-live"
                        sources={["people"]}
                        mode="edit"
                        areas={[{ id: "icu", name: "ICU" }, { id: "surgical", name: "Surgical" }]}
                        area={a => ({ key: a.id, label: a.name })}
                        shifts={[{ id: "am", name: "AM" }, { id: "pm", name: "PM" }]}
                        shift={s => ({ key: s.id, label: s.name })}
                        people={[{ id: "patel", name: "Patel, R." }, { id: "cho", name: "Cho, J." }]}
                        person={p => ({ key: p.id, label: p.name })}
                        assignments={[
                            { id: "x1", person: "patel", area: "icu", shift: "am", state: variant("proposed", variant("added", null)) },
                            { id: "x2", person: "cho", area: "surgical", shift: "pm", state: variant("proposed", variant("model", null)) },
                        ]}
                        assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                        onDrag={onDrag}
                        onAccept={onAccept}
                    />
                    <Text.MonoLabel>{East.str`DRAGS · ${East.print(drags)} · ACCEPTS · ${East.print(accepts)}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Batch review foot (#265) — Board v1 wears the shared commitBar foot only
 * (Approve all / Reject all / Rerun + host summary); per-area decision
 * columns are an epic candidate. Per-tile ghost accept is unchanged and
 * complementary.
 */
export const boardReviewFoot = example({
    keywords: ["Board", "review", "approve", "reject", "batch", "foot", "commitBar", "rerun"],
    description: "Batch review foot on a day board — Approve all / Reject all / Rerun on the shared commitBar, beside per-tile ghost accept",
    fn: East.function([], UIComponentType, ($) => {
        const onAccept = $.const(East.function([CellRefType], NullType, _$ => null));
        return (
            <Board
                id="board-review"
                mode="edit"
                areas={[{ id: "icu", name: "ICU" }, { id: "ed", name: "ED" }]}
                area={a => ({ key: a.id, label: a.name })}
                shifts={[{ id: "am", name: "AM" }, { id: "pm", name: "PM" }]}
                shift={sh => ({ key: sh.id, label: sh.name })}
                people={[{ id: "patel", name: "Patel, R." }, { id: "cho", name: "Cho, J." }]}
                person={p => ({ key: p.id, label: p.name })}
                assignments={[
                    { id: "x1", personId: "patel", areaId: "icu", shiftId: "am", state: variant("committed", null) },
                    { id: "x2", personId: "cho", areaId: "icu", shiftId: "pm", state: variant("proposed", variant("model", null)) },
                    { id: "x3", personId: "cho", areaId: "ed", shiftId: "am", state: variant("proposed", variant("added", null)) },
                ]}
                assignment={x => ({ key: x.id, person: x.personId, area: x.areaId, shift: x.shiftId, state: x.state })}
                summary="1 model ghost · 1 operator draft"
                onAccept={onAccept}
                review={{
                    summary: <Text color="fg.muted">2 areas · 2 proposals staged</Text>,
                    onApproveAll: East.function([], NullType, _$ => null),
                    onRejectAll: East.function([], NullType, _$ => null),
                    onRerun: East.function([], NullType, _$ => null),
                }}
            />
        );
    }),
    inputs: [],
});

export const boardLibraryDnd = example({
    keywords: ["Board", "Library", "DnD", "drag", "add", "move", "remove", "onDrag", "canAssign", "page", "composition"],
    description: "Library + Board DnD — drag a person onto an (area, shift) cell (add), move/remove proposed chips; canAssign (deprecated sugar for canDrop) vetoes Kim on nights (⊘)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const lastBind = $.let(State.bind([StringType], "board_last_drop", "none yet"));
            // Forbidden cells render the invalid treatment (red outline + ⊘)
            // while dragging, and the drop is a no-op.
            const canAssign = $.const(East.function([StringType, StringType, StringType], BooleanType,
                (_$, person, _area, shift) => person.equal("kim").and(() => shift.equal("night")).not()));
            const onDrag = $.const(East.function([DragEventType], NullType, ($, event) => {
                $.match(event, {
                    add: ($, add) => { $(lastBind.write(East.str`add ${add.from.key} → ${add.into.row} · ${add.into.slot}`)); },
                    move: ($, mv) => { $(lastBind.write(East.str`move → ${mv.to.row} · ${mv.to.slot}`)); },
                    remove: ($, rm) => { $(lastBind.write(East.str`remove from ${rm.from.row} · ${rm.from.slot}`)); },
                    resize: (_$) => {},
                });
            }));
            const last = $.let(lastBind.read());
            return (
                <VStack gap="4" align="stretch">
                    <Library
                        id="people"
                        data={[
                            { id: "patel", name: "Patel, R.", role: "Senior RN" },
                            { id: "cho", name: "Cho, J.", role: "RN" },
                            { id: "kim", name: "Kim, A.", role: "EN" },
                        ]}
                        item={p => ({ key: p.id, label: p.name, sublabel: p.role, icon: "user" })}
                    />
                    <Board
                        id="board-tue"
                        sources={["people"]}
                        mode="edit"
                        areas={[{ id: "icu", name: "ICU" }, { id: "surgical", name: "Surgical" }]}
                        area={a => ({ key: a.id, label: a.name })}
                        shifts={[{ id: "am", name: "AM" }, { id: "pm", name: "PM" }, { id: "night", name: "Night" }]}
                        shift={s => ({ key: s.id, label: s.name })}
                        people={[{ id: "patel", name: "Patel, R." }, { id: "cho", name: "Cho, J." }]}
                        person={p => ({ key: p.id, label: p.name })}
                        assignments={[
                            { id: "x1", person: "patel", area: "icu", shift: "am", state: variant("committed", null) },
                            { id: "x2", person: "cho", area: "surgical", shift: "pm", state: variant("proposed", variant("added", null)) },
                        ]}
                        assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                        requirements={[
                            { area: "icu", shift: "am", count: 2n },
                            { area: "icu", shift: "night", count: 1n },
                            { area: "surgical", shift: "pm", count: 2n },
                        ]}
                        requirement={r => ({ area: r.area, shift: r.shift, required: r.count })}
                        canAssign={canAssign}
                        onDrag={onDrag}
                    />
                    <Text.MonoLabel>{East.str`LAST DROP · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const boardModes = example({
    keywords: ["Board", "assignment", "published", "committed", "read-only", "requirements", "coverage", "open", "slots", "understaffed", "overstaffed", "maxVisible", "overflow", "popover", "multiple", "people"],
    description: "Board mode panel — published (day board with committed assignments only, no grips, pointer-immutable), coverage (requirements render n/required numerals, open-slot placeholders, and under/over tones), overflow (a cell past maxVisible collapses behind a +N chip)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="PUBLISHED" align="start" />
                <Board
                        id="board-published"
                        areas={BOARD_PUBLISHED_AREAS_DATA}
                        area={a => ({ key: a.id, label: a.name })}
                        shifts={BOARD_PUBLISHED_SHIFTS_DATA}
                        shift={s => ({ key: s.id, label: s.name })}
                        people={BOARD_PUBLISHED_PEOPLE_DATA}
                        person={p => ({ key: p.id, label: p.name })}
                        assignments={BOARD_PUBLISHED_DATA}
                        assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                        summary="published · Tue 2 Jul"
                    />
                <Separator label="COVERAGE" align="start" />
                <Board
                        id="board-coverage"
                        mode="edit"
                        areas={BOARD_COVERAGE_AREAS_DATA}
                        area={a => ({ key: a.id, label: a.name })}
                        shifts={BOARD_COVERAGE_SHIFTS_DATA}
                        shift={s => ({ key: s.id, label: s.name, sublabel: s.window })}
                        people={BOARD_COVERAGE_PEOPLE_DATA}
                        person={p => ({ key: p.id, label: p.name })}
                        assignments={BOARD_COVERAGE_DATA}
                        assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                        requirements={BOARD_COVERAGE_REQUIREMENTS_DATA}
                        requirement={r => ({ area: r.area, shift: r.shift, required: r.count })}
                        summary="3 open · 1 over"
                    />
                <Separator label="OVERFLOW" align="start" />
                <Board
                        id="board-overflow"
                        mode="edit"
                        areas={[{ id: "maternity", name: "Maternity" }]}
                        area={a => ({ key: a.id, label: a.name })}
                        shifts={[{ id: "am", name: "AM" }, { id: "pm", name: "PM" }]}
                        shift={s => ({ key: s.id, label: s.name })}
                        people={[
                            { id: "patel", name: "Patel, R." },
                            { id: "cho", name: "Cho, J." },
                            { id: "rivera", name: "Rivera, M." },
                            { id: "okafor", name: "Okafor, S." },
                            { id: "kim", name: "Kim, A." },
                        ]}
                        person={p => ({ key: p.id, label: p.name })}
                        assignments={BOARD_OVERFLOW_DATA}
                        assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                        maxVisible={3}
                    />
            </VStack>
        );
    }),
    inputs: [],
});

export const boardFill = example({
    keywords: ["Board", "maxHeight", "bounded", "scroll", "virtual", "sizing", "#320", "fill", "height", "Box"],
    description: "Board sizing panel (#320) — scroll (maxHeight=\"180px\" caps the component; eight areas overflow so it clips mid-row and scrolls within), fill (height=\"fill\": the board fills a fixed 180px Box and scrolls within it; two hundred areas overflow the box so only the visible area rows plus overscan mount)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="SCROLL" align="start" />
                <Board
                        id="board-scroll"
                        areas={BOARD_SCROLL_AREAS_DATA}
                        area={a => ({ key: a.id, label: a.name })}
                        shifts={BOARD_SCROLL_SHIFTS_DATA}
                        shift={s => ({ key: s.id, label: s.name })}
                        people={BOARD_SCROLL_PEOPLE_DATA}
                        person={p => ({ key: p.id, label: p.name })}
                        assignments={BOARD_SCROLL_DATA}
                        assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                        maxHeight="180px"
                    />
                <Separator label="FILL" align="start" />
                <Box height="180px">
                        <Board
                            id="board-fill"
                            areas={BOARD_FILL_AREAS_DATA}
                            area={a => ({ key: a.id, label: a.name })}
                            shifts={BOARD_FILL_SHIFTS_DATA}
                            shift={s => ({ key: s.id, label: s.name })}
                            people={BOARD_FILL_PEOPLE_DATA}
                            person={p => ({ key: p.id, label: p.name })}
                            assignments={BOARD_FILL_DATA}
                            assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                            height="fill"
                        />
                    </Box>
            </VStack>
        );
    }),
    inputs: [],
});
