/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { CellRefType, DragEventType, State, UIComponentType } from "@elaraai/east-ui";
import { Board, Box, Configurator, Library, Reactive, SegmentGroup, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

// Shared assignment-state values for the hoisted fixtures.

const BOARD_PUBLISHED_SHIFTS_DATA = [
    { id: "am", name: "AM" },
    { id: "pm", name: "PM" },
];

export const boardEdit = example({
    keywords: ["Board", "assignment", "edit", "areas", "shifts", "ghost", "added", "removed", "summary", "Reactive", "State", "onDrag", "onAccept", "interactive"],
    description: "Edit-mode day board — committed, added, removed, and model-ghost assignments across areas × shifts; onDrag / onAccept count every interaction into the footer readout",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
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
            // Interaction counters (boardInteractive fold-in) — every drag
            // gesture and per-tile ghost accept ticks its own counter, read
            // back into the mono footer line below the board.
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

/**
 * THE Board configurator (pass 5) — ONE live day board; the preset axis is a
 * pure DATA struct (areas / shifts / people / assignments / requirements /
 * maxVisible / mode / summary), so published, coverage numerals and the +N
 * overflow all flow through the same instance: an empty requirements array is
 * "no coverage chrome" and a large maxVisible is "no cap".
 */
export const boardVariants = example({
    keywords: ["Board", "assignment", "published", "committed", "read-only", "requirements", "coverage", "open", "slots", "understaffed", "overstaffed", "maxVisible", "overflow", "popover", "multiple", "people", "mode", "edit", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "Board configurator — a data-preset axis (published / coverage / overflow) driving one live day board; requirements, chip caps and mode all travel as data",
    fn: East.function([], UIComponentType, (_$) => {
        const COMMITTED = variant("committed", null);
        const ADDED = variant("proposed", variant("added", null));
        const BOARD_PUBLISHED_AREAS_DATA = [
            { id: "icu", name: "ICU" },
            { id: "surgical", name: "Surgical" },
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
        return (
        <Reactive>{$ => {
            // Every preset is DATA on the same board instance: requirements
            // [] = no coverage chrome; maxVisible 99 = no overflow cap.
            const RequirementType = StructType({ area: StringType, shift: StringType, count: IntegerType });
            const PresetType = StructType({
                label: StringType,
                areas: ArrayType(StructType({ id: StringType, name: StringType })),
                shifts: ArrayType(StructType({ id: StringType, name: StringType, window: StringType })),
                people: ArrayType(StructType({ id: StringType, name: StringType })),
                assignments: ArrayType(StructType({ id: StringType, person: StringType, area: StringType, shift: StringType, state: Board.Types.State })),
                requirements: ArrayType(RequirementType),
                maxVisible: IntegerType,
                mode: Board.Types.Mode,
                summary: StringType,
            });
            const presets = $.const([
                {
                    label: "published",
                    areas: BOARD_PUBLISHED_AREAS_DATA,
                    shifts: [{ id: "am", name: "AM", window: "" }, { id: "pm", name: "PM", window: "" }],
                    people: BOARD_PUBLISHED_PEOPLE_DATA,
                    assignments: BOARD_PUBLISHED_DATA,
                    requirements: [],
                    maxVisible: 99n,
                    mode: variant("published", null),
                    summary: "published · Tue 2 Jul",
                },
                {
                    label: "coverage",
                    areas: BOARD_COVERAGE_AREAS_DATA,
                    shifts: BOARD_COVERAGE_SHIFTS_DATA,
                    people: BOARD_COVERAGE_PEOPLE_DATA,
                    assignments: BOARD_COVERAGE_DATA,
                    requirements: BOARD_COVERAGE_REQUIREMENTS_DATA,
                    maxVisible: 99n,
                    mode: variant("edit", null),
                    summary: "3 open · 1 over",
                },
                {
                    label: "overflow",
                    areas: [{ id: "maternity", name: "Maternity" }],
                    shifts: [{ id: "am", name: "AM", window: "" }, { id: "pm", name: "PM", window: "" }],
                    people: [
                        { id: "patel", name: "Patel, R." },
                        { id: "cho", name: "Cho, J." },
                        { id: "rivera", name: "Rivera, M." },
                        { id: "okafor", name: "Okafor, S." },
                        { id: "kim", name: "Kim, A." },
                    ],
                    assignments: BOARD_OVERFLOW_DATA,
                    requirements: [],
                    maxVisible: 3n,
                    mode: variant("edit", null),
                    summary: "5 in AM · capped at 3",
                },
            ], ArrayType(PresetType));
            const presetKeys = $.const(["published", "coverage", "overflow"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "board_preset", "published"));
            const pKey = $.let(presetBind.read());
            const onPreset = $.const(East.function([StringType], NullType, ($, next) => {
                $(presetBind.write(next));
            }));
            const sel = $.let(presets.filter((_$, o) => o.label.equal(pKey)).get(0n));

            const onAccept = $.const(East.function([CellRefType], NullType, _$ => null));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Preset", pKey,
                            <SegmentGroup value={pKey} onChange={onPreset} size="sm"
                                items={presetKeys.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                    ]}
                    preview={
                        <Board
                            id="board-variants"
                            mode={sel.mode}
                            areas={sel.areas}
                            area={a => ({ key: a.id, label: a.name })}
                            shifts={sel.shifts}
                            shift={sh => ({ key: sh.id, label: sh.name, sublabel: sh.window })}
                            people={sel.people}
                            person={p => ({ key: p.id, label: p.name })}
                            assignments={sel.assignments}
                            assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                            requirements={sel.requirements}
                            requirement={r => ({ area: r.area, shift: r.shift, required: r.count })}
                            maxVisible={sel.maxVisible}
                            summary={sel.summary}
                            onAccept={onAccept}
                        />
                    }
                    spec={[
                        Configurator.Spec("Assignments", East.print(sel.assignments.size())),
                    ]}
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});

/**
 * Review chrome (#265) — the shared commitBar foot (Approve all / Reject all /
 * Rerun) beside per-tile ghost accept.
 */
export const boardReview = example({
    keywords: ["Board", "review", "approve", "reject", "batch", "foot", "commitBar", "rerun", "accept", "ghost", "Reactive"],
    description: "Review board — the commit-bar foot and per-tile ghost accept over staged proposals",
    fn: East.function([], UIComponentType, (_$) => {
        const COMMITTED = variant("committed", null);
        const ADDED = variant("proposed", variant("added", null));
        const GHOST = variant("proposed", variant("model", null));
        return (
        <Reactive>{$ => {
            const onAccept = $.const(East.function([CellRefType], NullType, _$ => null));
            const onApproveAll = $.const(East.function([], NullType, _$ => null));
            const onRejectAll = $.const(East.function([], NullType, _$ => null));
            const onRerun = $.const(East.function([], NullType, _$ => null));
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
                        { id: "x1", person: "patel", area: "icu", shift: "am", state: COMMITTED },
                        { id: "x2", person: "cho", area: "icu", shift: "pm", state: GHOST },
                        { id: "x3", person: "cho", area: "ed", shift: "am", state: ADDED },
                    ]}
                    assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                    summary="1 model ghost · 1 operator draft"
                    onAccept={onAccept}
                    review={{
                        summary: <Text color="fg.muted">2 areas · 2 proposals staged</Text>,
                        onApproveAll: onApproveAll,
                        onRejectAll: onRejectAll,
                        onRerun: onRerun,
                    }}
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});

/** Fill (#320) — height="fill" in a bounded Box virtualizes the 200 area rows. */
export const boardFill = example({
    keywords: ["Board", "fill", "height", "#320", "virtual", "bounded", "Box", "scroll"],
    description: "Fill sizing — height=\"fill\" resolves against the bounded Box and virtualizes 200 area rows",
    fn: East.function([], UIComponentType, (_$) => {
        const COMMITTED = variant("committed", null);
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
        return (
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
    );
    }),
    inputs: [],
});
