/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, IntegerType, NullType, StringType, example, variant } from "@elaraai/east";
import { CellRefType, DragEventType, State, UIComponentType } from "@elaraai/east-ui";
import { Board, Library, Reactive, Text, VStack } from "@elaraai/east-ui";

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

export const boardPublished = example({
    keywords: ["Board", "assignment", "published", "committed", "read-only"],
    description: "Published day board — committed assignments only, no grips, pointer-immutable",
    fn: East.function([], UIComponentType, ($) => {
        const areas = $.const([
            { id: "icu", name: "ICU" },
            { id: "surgical", name: "Surgical" },
        ]);
        const shifts = $.const([
            { id: "am", name: "AM" },
            { id: "pm", name: "PM" },
        ]);
        const people = $.const([
            { id: "patel", name: "Patel, R." },
            { id: "cho", name: "Cho, J." },
        ]);
        const committed = variant("committed", null);
        const assignments = $.const([
            { id: "x1", person: "patel", area: "icu", shift: "am", state: committed },
            { id: "x2", person: "cho", area: "icu", shift: "pm", state: committed },
            { id: "x3", person: "cho", area: "surgical", shift: "am", state: variant("proposed", variant("added", null)) },
        ]);
        return (
            <Board
                id="board-published"
                areas={areas}
                area={a => ({ key: a.id, label: a.name })}
                shifts={shifts}
                shift={s => ({ key: s.id, label: s.name })}
                people={people}
                person={p => ({ key: p.id, label: p.name })}
                assignments={assignments}
                assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                summary="published · Tue 2 Jul"
            />
        );
    }),
    inputs: [],
});

export const boardCoverage = example({
    keywords: ["Board", "requirements", "coverage", "open", "slots", "understaffed", "overstaffed"],
    description: "Coverage day board — requirements render n/required numerals, open-slot placeholders, and under/over tones",
    fn: East.function([], UIComponentType, ($) => {
        const areas = $.const([
            { id: "emergency", name: "Emergency" },
            { id: "icu", name: "ICU" },
        ]);
        const shifts = $.const([
            { id: "am", name: "AM", window: "06:00–14:00" },
            { id: "pm", name: "PM", window: "14:00–22:00" },
        ]);
        const people = $.const([
            { id: "patel", name: "Patel, R." },
            { id: "cho", name: "Cho, J." },
            { id: "rivera", name: "Rivera, M." },
            { id: "okafor", name: "Okafor, S." },
        ]);
        const committed = variant("committed", null);
        const assignments = $.const([
            // Emergency AM — exact (2/2).
            { id: "x1", person: "patel", area: "emergency", shift: "am", state: committed },
            { id: "x2", person: "cho", area: "emergency", shift: "am", state: committed },
            // Emergency PM — understaffed (1/3, two open slots).
            { id: "x3", person: "rivera", area: "emergency", shift: "pm", state: committed },
            // ICU AM — overstaffed (3/2).
            { id: "x4", person: "okafor", area: "icu", shift: "am", state: committed },
            { id: "x5", person: "rivera", area: "icu", shift: "am", state: committed },
            { id: "x6", person: "cho", area: "icu", shift: "am", state: variant("proposed", variant("added", null)) },
        ]);
        const requirements = $.const([
            { area: "emergency", shift: "am", count: 2n },
            { area: "emergency", shift: "pm", count: 3n },
            { area: "icu", shift: "am", count: 2n },
            { area: "icu", shift: "pm", count: 1n },
        ]);
        return (
            <Board
                id="board-coverage"
                mode="edit"
                areas={areas}
                area={a => ({ key: a.id, label: a.name })}
                shifts={shifts}
                shift={s => ({ key: s.id, label: s.name, sublabel: s.window })}
                people={people}
                person={p => ({ key: p.id, label: p.name })}
                assignments={assignments}
                assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                requirements={requirements}
                requirement={r => ({ area: r.area, shift: r.shift, required: r.count })}
                summary="3 open · 1 over"
            />
        );
    }),
    inputs: [],
});

export const boardOverflow = example({
    keywords: ["Board", "maxVisible", "overflow", "popover", "multiple", "people"],
    description: "Overflow day board — a cell past maxVisible collapses behind a +N chip",
    fn: East.function([], UIComponentType, ($) => {
        const committed = variant("committed", null);
        const assignments = $.const([
            { id: "x1", person: "patel", area: "maternity", shift: "am", state: committed },
            { id: "x2", person: "cho", area: "maternity", shift: "am", state: committed },
            { id: "x3", person: "rivera", area: "maternity", shift: "am", state: committed },
            { id: "x4", person: "okafor", area: "maternity", shift: "am", state: committed },
            { id: "x5", person: "kim", area: "maternity", shift: "am", state: variant("proposed", variant("added", null)) },
            { id: "x6", person: "patel", area: "maternity", shift: "pm", state: committed },
        ]);
        return (
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
                assignments={assignments}
                assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                maxVisible={3}
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

export const boardWithLibrary = example({
    keywords: ["Board", "Library", "drag", "add", "onDrag", "canAssign", "page", "composition"],
    description: "Library + Board page — drag a person onto an (area, shift) cell to fire the add event; canAssign vetoes Kim on nights",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const lastBind = $.let(State.bind([StringType], "board_last_drop", "none yet"));
            // Forbidden cells render the invalid treatment (red outline + ⊘)
            // while dragging, and the drop is a no-op.
            const canAssign = $.const(East.function([StringType, StringType, StringType], BooleanType,
                (_$, person, _area, shift) => person.equal("kim").and(() => shift.equal("night")).not()));
            const onDrag = $.const(East.function([DragEventType], NullType, ($, event) => {
                $.matchTag(event, "add", ($, add) => {
                    $(lastBind.write(East.str`${add.from.key} → ${add.into.row} · ${add.into.slot}`));
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
