/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, IntegerType, NullType, OptionType, StringType, example, none, some, variant } from "@elaraai/east";
import { CellRefType, DragEventType, State, Status, UIComponentType } from "@elaraai/east-ui";
import { Box, Library, Reactive, Roster, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

// Shared shift-state values for the hoisted fixtures.
const COMMITTED = variant("committed", null);
const ADDED = variant("proposed", variant("added", null));
const REMOVED = variant("proposed", variant("removed", null));
const GHOST = variant("proposed", variant("model", null));

const ROSTER_EDIT_PEOPLE_DATA = [
    { id: "patel", name: "Patel", target: "38h → 30h" },
    { id: "cho", name: "Cho", target: "26h → 38h" },
    { id: "rivera", name: "Rivera", target: "32h" },
    { id: "okafor", name: "Okafor", target: "24h" },
];
const ROSTER_EDIT_DATA = [
    { id: "p1", person: "patel", day: "Mon", hours: 8n, state: COMMITTED },
    { id: "p2", person: "patel", day: "Tue", hours: 8n, state: COMMITTED },
    { id: "p3", person: "patel", day: "Wed", hours: 8n, state: REMOVED },
    { id: "p4", person: "patel", day: "Fri", hours: 6n, state: COMMITTED },
    { id: "p5", person: "patel", day: "Sat", hours: 8n, state: REMOVED },
    { id: "c1", person: "cho", day: "Mon", hours: 8n, state: COMMITTED },
    { id: "c2", person: "cho", day: "Tue", hours: 6n, state: COMMITTED },
    { id: "c3", person: "cho", day: "Wed", hours: 8n, state: ADDED },
    { id: "c4", person: "cho", day: "Thu", hours: 8n, state: COMMITTED },
    { id: "c5", person: "cho", day: "Sat", hours: 8n, state: ADDED },
    { id: "c6", person: "cho", day: "Sun", hours: 4n, state: GHOST },
    { id: "r1", person: "rivera", day: "Mon", hours: 8n, state: COMMITTED },
    { id: "r2", person: "rivera", day: "Tue", hours: 8n, state: COMMITTED },
    { id: "r3", person: "rivera", day: "Wed", hours: 8n, state: COMMITTED },
    { id: "r4", person: "rivera", day: "Thu", hours: 8n, state: COMMITTED },
    { id: "r5", person: "rivera", day: "Sat", hours: 6n, state: GHOST },
    { id: "o1", person: "okafor", day: "Tue", hours: 6n, state: COMMITTED },
    { id: "o2", person: "okafor", day: "Wed", hours: 6n, state: COMMITTED },
    { id: "o3", person: "okafor", day: "Thu", hours: 6n, state: COMMITTED },
    { id: "o4", person: "okafor", day: "Fri", hours: 6n, state: COMMITTED },
];
const ROSTER_PUBLISHED_PEOPLE_DATA = [
    { id: "patel", name: "Patel" },
    { id: "cho", name: "Cho" },
];
const ROSTER_PUBLISHED_DATA = [
    { id: "p1", person: "patel", day: "Mon", hours: 8n, state: COMMITTED },
    { id: "p2", person: "patel", day: "Wed", hours: 8n, state: COMMITTED },
    { id: "c1", person: "cho", day: "Tue", hours: 6n, state: COMMITTED },
    { id: "c2", person: "cho", day: "Fri", hours: 6n, state: COMMITTED },
];
const ROSTER_SCROLL_PEOPLE_DATA = [
    { id: "patel", name: "Patel", target: "38h" }, { id: "cho", name: "Cho", target: "26h" },
    { id: "rivera", name: "Rivera", target: "32h" }, { id: "okafor", name: "Okafor", target: "24h" },
    { id: "nguyen", name: "Nguyen", target: "20h" }, { id: "kim", name: "Kim", target: "22h" },
    { id: "sato", name: "Sato", target: "30h" }, { id: "diaz", name: "Diaz", target: "28h" },
];
const ROSTER_SCROLL_DATA = [
    { id: "s1", person: "patel", day: "Mon", hours: 8n, state: COMMITTED },
    { id: "s2", person: "cho", day: "Tue", hours: 8n, state: COMMITTED },
    { id: "s3", person: "rivera", day: "Wed", hours: 8n, state: COMMITTED },
    { id: "s4", person: "okafor", day: "Thu", hours: 6n, state: COMMITTED },
    { id: "s5", person: "nguyen", day: "Fri", hours: 6n, state: COMMITTED },
    { id: "s6", person: "sato", day: "Mon", hours: 8n, state: COMMITTED },
];
const ROSTER_FILL_PEOPLE_DATA = East.Array.range(0n, 200n).map((_$, i) => ({
    id: East.str`p${i}`,
    name: East.str`Person ${i}`,
    target: "38h",
}));
const ROSTER_FILL_DATA = [
    { id: "s1", person: "p0", day: "Mon", hours: 8n, state: COMMITTED },
    { id: "s2", person: "p1", day: "Tue", hours: 8n, state: COMMITTED },
    { id: "s3", person: "p2", day: "Wed", hours: 8n, state: COMMITTED },
    { id: "s4", person: "p15", day: "Thu", hours: 6n, state: COMMITTED },
    { id: "s5", person: "p199", day: "Fri", hours: 6n, state: COMMITTED },
];

export const rosterModes = example({
    keywords: ["Roster", "shift", "edit", "ghost", "added", "removed", "drag", "summary", "published", "committed", "read-only", "days"],
    description: "Roster mode pair — edit (committed, added, removed, and model-ghost shifts with the status strip) above published (a work-week roster with committed shifts only, no grips, pointer-immutable)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">EDIT</Text>
                    <Roster
                        id="roster-se"
                        sources={["people"]}
                        mode="edit"
                        people={ROSTER_EDIT_PEOPLE_DATA}
                        person={p => ({ key: p.id, label: p.name, sublabel: p.target })}
                        shifts={ROSTER_EDIT_DATA}
                        shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                        summary="3 dirty · 1 new · 2 model-ghost"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PUBLISHED</Text>
                    <Roster
                        id="roster-published"
                        people={ROSTER_PUBLISHED_PEOPLE_DATA}
                        person={p => ({ key: p.id, label: p.name })}
                        shifts={ROSTER_PUBLISHED_DATA}
                        shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                        days={["Mon", "Tue", "Wed", "Thu", "Fri"]}
                        summary="published · wk of Sep 16"
                    />
                </VStack>
            </VStack>
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
    description: "IR-level canDrop veto — Kim's card can't land on weekend columns (⊘ while dragging, no LAST log), moves onto weekends are vetoed for all; allowed gestures log through onDrag",
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
            // Delivered gestures log under the roster — a vetoed drop stays
            // visibly silent.
            const lastBind = $.let(State.bind([StringType], "roster_veto_last", "none yet"));
            const onDrag = $.const(East.function([DragEventType], NullType, ($, event) => {
                $.match(event, {
                    add: ($, add) => { $(lastBind.write(East.str`add · ${add.from.key} → ${add.into.row} · ${add.into.slot}`)); },
                    move: ($, mv) => { $(lastBind.write(East.str`move · ${mv.to.row} · ${mv.to.slot}`)); },
                    remove: ($, rm) => { $(lastBind.write(East.str`remove · ${rm.from.row} · ${rm.from.slot} → ${rm.to.getTag()}`)); },
                    resize: (_$) => {},
                });
            }));
            const last = $.let(lastBind.read());
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
                        onDrag={onDrag}
                    />
                    <Text.MonoLabel>{East.str`LAST · ${last}`}</Text.MonoLabel>
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

export const rosterLibraryDnd = example({
    keywords: ["Roster", "Library", "DnD", "drag", "add", "move", "remove", "trash", "onDrag", "page", "composition"],
    description: "Library + Roster DnD — drag a person onto a cell (add), drag proposed chips between cells (move) or to the trash sink (remove); every gesture logs through the one onDrag grammar funnel",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const lastBind = $.let(State.bind([StringType], "roster_last_drop", "none yet"));
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

export const rosterFill = example({
    keywords: ["Roster", "maxHeight", "bounded", "scroll", "virtual", "sizing", "#320", "fill", "height", "Box"],
    description: "Roster sizing panel (#320) — scroll (maxHeight=\"180px\" caps the component; eight people overflow so it clips mid-row and scrolls within), fill (height=\"fill\": the roster fills a fixed 180px Box and scrolls within it; two hundred people overflow the box so only the visible person rows plus overscan mount)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SCROLL</Text>
                    <Roster
                        id="roster-scroll"
                        people={ROSTER_SCROLL_PEOPLE_DATA}
                        person={p => ({ key: p.id, label: p.name, sublabel: p.target })}
                        shifts={ROSTER_SCROLL_DATA}
                        shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                        maxHeight="180px"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FILL</Text>
                    <Box height="180px">
                        <Roster
                            id="roster-fill"
                            people={ROSTER_FILL_PEOPLE_DATA}
                            person={p => ({ key: p.id, label: p.name, sublabel: p.target })}
                            shifts={ROSTER_FILL_DATA}
                            shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                            height="fill"
                        />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
