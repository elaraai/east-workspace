/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, IntegerType, NullType, OptionType, StringType, example, none, some, variant } from "@elaraai/east";
import { CellRefType, DragEventType, State, Status, UIComponentType } from "@elaraai/east-ui";
import { Library, Reactive, Roster, Text, VStack } from "@elaraai/east-ui";

export const rosterEdit = example({
    keywords: ["Roster", "shift", "edit", "ghost", "added", "removed", "drag", "summary"],
    description: "Edit-mode roster — committed, added, removed, and model-ghost shifts with the status strip",
    fn: East.function([], UIComponentType, ($) => {
        const people = $.const([
            { id: "patel", name: "Patel", target: "38h → 30h" },
            { id: "cho", name: "Cho", target: "26h → 38h" },
            { id: "rivera", name: "Rivera", target: "32h" },
            { id: "okafor", name: "Okafor", target: "24h" },
        ]);
        const committed = variant("committed", null);
        const added = variant("proposed", variant("added", null));
        const removed = variant("proposed", variant("removed", null));
        const ghost = variant("proposed", variant("model", null));
        const shifts = $.const([
            { id: "p1", person: "patel", day: "Mon", hours: 8n, state: committed },
            { id: "p2", person: "patel", day: "Tue", hours: 8n, state: committed },
            { id: "p3", person: "patel", day: "Wed", hours: 8n, state: removed },
            { id: "p4", person: "patel", day: "Fri", hours: 6n, state: committed },
            { id: "p5", person: "patel", day: "Sat", hours: 8n, state: removed },
            { id: "c1", person: "cho", day: "Mon", hours: 8n, state: committed },
            { id: "c2", person: "cho", day: "Tue", hours: 6n, state: committed },
            { id: "c3", person: "cho", day: "Wed", hours: 8n, state: added },
            { id: "c4", person: "cho", day: "Thu", hours: 8n, state: committed },
            { id: "c5", person: "cho", day: "Sat", hours: 8n, state: added },
            { id: "c6", person: "cho", day: "Sun", hours: 4n, state: ghost },
            { id: "r1", person: "rivera", day: "Mon", hours: 8n, state: committed },
            { id: "r2", person: "rivera", day: "Tue", hours: 8n, state: committed },
            { id: "r3", person: "rivera", day: "Wed", hours: 8n, state: committed },
            { id: "r4", person: "rivera", day: "Thu", hours: 8n, state: committed },
            { id: "r5", person: "rivera", day: "Sat", hours: 6n, state: ghost },
            { id: "o1", person: "okafor", day: "Tue", hours: 6n, state: committed },
            { id: "o2", person: "okafor", day: "Wed", hours: 6n, state: committed },
            { id: "o3", person: "okafor", day: "Thu", hours: 6n, state: committed },
            { id: "o4", person: "okafor", day: "Fri", hours: 6n, state: committed },
        ]);
        return (
            <Roster
                id="roster-se"
                sources={["people"]}
                mode="edit"
                people={people}
                person={p => ({ key: p.id, label: p.name, sublabel: p.target })}
                shifts={shifts}
                shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                summary="3 dirty · 1 new · 2 model-ghost"
            />
        );
    }),
    inputs: [],
});

export const rosterPublished = example({
    keywords: ["Roster", "shift", "published", "committed", "read-only", "days"],
    description: "Published work-week roster — committed shifts only, no grips, pointer-immutable",
    fn: East.function([], UIComponentType, ($) => {
        const people = $.const([
            { id: "patel", name: "Patel" },
            { id: "cho", name: "Cho" },
        ]);
        const committed = variant("committed", null);
        const shifts = $.const([
            { id: "p1", person: "patel", day: "Mon", hours: 8n, state: committed },
            { id: "p2", person: "patel", day: "Wed", hours: 8n, state: committed },
            { id: "c1", person: "cho", day: "Tue", hours: 6n, state: committed },
            { id: "c2", person: "cho", day: "Fri", hours: 6n, state: committed },
        ]);
        return (
            <Roster
                id="roster-published"
                people={people}
                person={p => ({ key: p.id, label: p.name })}
                shifts={shifts}
                shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                days={["Mon", "Tue", "Wed", "Thu", "Fri"]}
                summary="published · wk of Sep 16"
            />
        );
    }),
    inputs: [],
});

export const rosterInteractive = example({
    keywords: ["Roster", "Reactive", "State", "onDrag", "onAccept", "interactive", "trash", "remove", "drag-to-trash"],
    description: "Edit roster whose onDrag / onAccept callbacks count interactions — dragging a proposed chip also raises the shared trash sink (#267): drop on it to deliver remove/trash through the same onDrag",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const dragBind = $.let(State.bind([IntegerType], "roster_drags", 0n));
            const acceptBind = $.let(State.bind([IntegerType], "roster_accepts", 0n));
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
                    <Roster
                        id="roster-live"
                        sources={["people"]}
                        mode="edit"
                        people={[{ id: "patel", name: "Patel" }, { id: "cho", name: "Cho" }]}
                        person={p => ({ key: p.id, label: p.name })}
                        shifts={[
                            { id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("proposed", variant("added", null)) },
                            { id: "p2", person: "patel", day: "Wed", hours: 4n, state: variant("proposed", variant("model", null)) },
                            { id: "c1", person: "cho", day: "Tue", hours: 6n, state: variant("proposed", variant("added", null)) },
                        ]}
                        shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                        days={["Mon", "Tue", "Wed"]}
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
 * IR-level drop validation (#261) — `canDrop` receives the synthesized
 * candidate event for every hovered cell; returning `false` shows the ⊘
 * invalid stage and the drop is a no-op. Here Kim is day-shift only: any
 * `add` of the `kim` card onto a weekend column is vetoed, and `move`s onto
 * weekends are vetoed for everyone (weekend line-up is committed).
 */
export const rosterCanDrop = example({
    keywords: ["Roster", "canDrop", "veto", "invalid", "drag", "validation", "candidate", "drop"],
    description: "IR-level canDrop veto — Kim's card can't land on weekend columns (⊘ while dragging), moves onto weekends are vetoed for all",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) => {
                const weekend = $.const(East.function([StringType], BooleanType, (_$, day) =>
                    East.equal(day, "Sat").or(_$ => East.equal(day, "Sun"))));
                return event.match({
                    add: (_$, add) => East.equal(add.from.key, "kim").and(_$ => weekend(add.into.slot)).not(),
                    move: (_$, mv) => weekend(mv.to.slot).not(),
                    remove: (_$) => East.value(true),
                    resize: (_$) => East.value(true),
                });
            }));
            return (
                <VStack gap="4" align="stretch">
                    <Library
                        id="people"
                        data={[
                            { id: "patel", name: "Patel, R.", role: "Senior SE" },
                            { id: "kim", name: "Kim, A.", role: "Mid SE · day-shift only" },
                        ]}
                        item={p => ({ key: p.id, label: p.name, sublabel: p.role, icon: "user" })}
                    />
                    <Roster
                        id="roster-wk"
                        sources={["people"]}
                        mode="edit"
                        people={[{ id: "patel", name: "Patel" }, { id: "kim", name: "Kim" }]}
                        person={p => ({ key: p.id, label: p.name })}
                        shifts={[
                            { id: "p1", person: "patel", day: "Fri", hours: 8n, state: variant("proposed", variant("added", null)) },
                        ]}
                        shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                        days={["Fri", "Sat", "Sun"]}
                        canDrop={canDrop}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Row-level review (#265) — the shared Decision column + commitBar foot on a
 * roster, composing with per-tile ghost accept. The flagged line carries a
 * model ghost: clicking the ghost's ✓ accepts ONE shift (`onAccept`), while
 * the row's Approve signs off the LINE (`review.onApprove({ rowIndex })`) —
 * two complementary granularities; the interplay is host-owned.
 */
export const rosterReview = example({
    keywords: ["Roster", "review", "approve", "reject", "approval", "decision", "batch", "ghost", "accept", "granularity"],
    description: "Row-level review on a roster — Decision column + batch foot beside per-tile ghost accept (accept ONE ghost vs approve the LINE)",
    fn: East.function([], UIComponentType, ($) => {
        const onAccept = $.const(East.function([CellRefType], NullType, _$ => null));
        return (
            <Roster
                id="roster-review"
                mode="edit"
                people={[
                    { id: "patel", name: "Patel", flagged: false },
                    { id: "cho", name: "Cho", flagged: true },
                    { id: "kim", name: "Kim", flagged: false },
                ]}
                person={p => ({
                    key: p.id,
                    label: p.name,
                    status: p.flagged.ifElse(
                        _$ => East.value(some(variant("warning", null)), OptionType(Status.Types.Value)),
                        _$ => East.value(none, OptionType(Status.Types.Value)),
                    ),
                    approval: p.flagged.ifElse(
                        _$ => East.value(some(variant("pending", null)), OptionType(Roster.Types.Approval)),
                        _$ => East.value(some(variant("approved", null)), OptionType(Roster.Types.Approval)),
                    ),
                })}
                shifts={[
                    { id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("committed", null) },
                    { id: "c1", person: "cho", day: "Tue", hours: 6n, state: variant("proposed", variant("model", null)) },
                    { id: "c2", person: "cho", day: "Thu", hours: 6n, state: variant("proposed", variant("added", null)) },
                    { id: "k1", person: "kim", day: "Wed", hours: 8n, state: variant("committed", null) },
                ]}
                shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                days={["Mon", "Tue", "Wed", "Thu", "Fri"]}
                onAccept={onAccept}
                review={{
                    summary: <Text color="fg.muted">3 lines · 1 flagged needs a call</Text>,
                    onApprove: East.function([Roster.Types.ApproveEvent], NullType, _$ => null),
                    onReject: East.function([Roster.Types.ApproveEvent], NullType, _$ => null),
                    onApproveAll: East.function([], NullType, _$ => null),
                    onRejectAll: East.function([], NullType, _$ => null),
                }}
            />
        );
    }),
    inputs: [],
});

export const rosterWithLibrary = example({
    keywords: ["Roster", "Library", "drag", "add", "onDrag", "page", "composition"],
    description: "Library + Roster page — drag a person onto a cell to fire the add event",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const lastBind = $.let(State.bind([StringType], "roster_last_drop", "none yet"));
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
                            { id: "patel", name: "Patel, R.", role: "Senior SE" },
                            { id: "cho", name: "Cho, J.", role: "Senior SE" },
                            { id: "kim", name: "Kim, A.", role: "Mid SE" },
                        ]}
                        item={p => ({ key: p.id, label: p.name, sublabel: p.role, icon: "user" })}
                    />
                    <Roster
                        id="roster-se"
                        sources={["people"]}
                        mode="edit"
                        people={[{ id: "patel", name: "Patel" }, { id: "cho", name: "Cho" }]}
                        person={p => ({ key: p.id, label: p.name })}
                        shifts={[
                            { id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("committed", null) },
                            { id: "c1", person: "cho", day: "Tue", hours: 6n, state: variant("proposed", variant("added", null)) },
                        ]}
                        shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                        days={["Mon", "Tue", "Wed", "Thu", "Fri"]}
                        onDrag={onDrag}
                    />
                    <Text.MonoLabel>{East.str`LAST DROP · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
