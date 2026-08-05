/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, IntegerType, NullType, StringType, example, none, some, variant } from "@elaraai/east";
import { CellRefType, DragEventType, State, UIComponentType } from "@elaraai/east-ui";
import { Box, Configurator, Library, Reactive, Roster, SegmentGroup, Text, VStack } from "@elaraai/east-ui";

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
const ROSTER_PUBLISHED_DATA = [
    { id: "p1", person: "patel", day: "Mon", hours: 8n, state: COMMITTED },
    { id: "p2", person: "patel", day: "Wed", hours: 8n, state: COMMITTED },
    { id: "c1", person: "cho", day: "Tue", hours: 6n, state: COMMITTED },
    { id: "c2", person: "cho", day: "Fri", hours: 6n, state: COMMITTED },
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

/**
 * THE Roster configurator (pass 5) — ONE live work-week roster; the preset
 * axis is a pure DATA struct (people / shifts / days / sources / mode /
 * summary), so the edit grammar and the published read-only week flow through
 * the same instance.
 */
export const rosterVariants = example({
    keywords: ["Roster", "shift", "edit", "ghost", "added", "removed", "summary", "published", "committed", "read-only", "days", "mode", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "Roster configurator — a data-preset axis (edit / published) driving one live work-week roster; days, sources and mode all travel as data",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presets = $.const([
                {
                    label: "edit",
                    people: ROSTER_EDIT_PEOPLE_DATA,
                    shifts: ROSTER_EDIT_DATA,
                    mode: variant("edit", null),
                    summary: "3 dirty · 1 new · 2 model-ghost",
                },
                {
                    label: "published",
                    people: [
                        { id: "patel", name: "Patel", target: "" },
                        { id: "cho", name: "Cho", target: "" },
                    ],
                    shifts: ROSTER_PUBLISHED_DATA,
                    mode: variant("published", null),
                    summary: "published · wk of Sep 16",
                },
            ]);
            const presetKeys = $.const(["edit", "published"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "roster_preset", "edit"));
            const pKey = $.let(presetBind.read());
            const onPreset = $.const(East.function([StringType], NullType, ($, next) => {
                $(presetBind.write(next));
            }));
            const sel = $.let(presets.filter((_$, o) => o.label.equal(pKey)).get(0n));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Preset", pKey,
                            <SegmentGroup value={pKey} onChange={onPreset} size="sm"
                                items={presetKeys.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                    ]}
                    preview={
                        <Roster
                            id="roster-variants"
                            mode={sel.mode}
                            sources={["people"]}
                            people={sel.people}
                            person={p => ({ key: p.id, label: p.name, sublabel: p.target })}
                            shifts={sel.shifts}
                            shift={sh => ({ key: sh.id, person: sh.person, day: sh.day, hours: sh.hours, state: sh.state })}
                            days={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
                            summary={sel.summary}
                        />
                    }
                    spec={[
                        Configurator.Spec("Shifts", East.print(sel.shifts.size())),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Review chrome (#265) — the shared Decision column + commitBar foot beside
 * per-tile ghost accept: accept ONE ghost vs approve the LINE.
 */
export const rosterReview = example({
    keywords: ["Roster", "review", "approve", "reject", "approval", "decision", "batch", "ghost", "accept", "commitBar", "Reactive"],
    description: "Review roster — the Decision column and commit-bar foot beside per-tile ghost accept",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const onAccept = $.const(East.function([CellRefType], NullType, _$ => null));
            const onApprove = $.const(East.function([Roster.Types.ApproveEvent], NullType, _$ => null));
            const onReject = $.const(East.function([Roster.Types.ApproveEvent], NullType, _$ => null));
            const onApproveAll = $.const(East.function([], NullType, _$ => null));
            const onRejectAll = $.const(East.function([], NullType, _$ => null));
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
                        status: p.flagged.ifElse(() => some(variant("warning", null)), () => none),
                        approval: p.flagged.ifElse(() => some(variant("pending", null)), () => some(variant("approved", null))),
                    })}
                    shifts={[
                        { id: "p1", person: "patel", day: "Mon", hours: 8n, state: COMMITTED },
                        { id: "c1", person: "cho", day: "Tue", hours: 6n, state: GHOST },
                        { id: "c2", person: "cho", day: "Thu", hours: 6n, state: ADDED },
                        { id: "k1", person: "kim", day: "Wed", hours: 8n, state: COMMITTED },
                    ]}
                    shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                    days={["Mon", "Tue", "Wed", "Thu", "Fri"]}
                    onAccept={onAccept}
                    review={{
                        summary: <Text color="fg.muted">3 lines · 1 flagged needs a call</Text>,
                        onApprove: onApprove,
                        onReject: onReject,
                        onApproveAll: onApproveAll,
                        onRejectAll: onRejectAll,
                    }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** Fill (#320) — height="fill" in a bounded Box virtualizes the 200 person rows. */
export const rosterFill = example({
    keywords: ["Roster", "fill", "height", "#320", "virtual", "bounded", "Box", "scroll"],
    description: "Fill sizing — height=\"fill\" resolves against the bounded Box and virtualizes 200 person rows",
    fn: East.function([], UIComponentType, (_$) => (
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
    )),
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
 * IR-level drop validation (#261) folds into the DnD grammar — `canDrop`
 * receives the synthesized candidate event for every hovered cell; returning
 * `false` shows the ⊘ invalid stage and the drop is a no-op. Here Kim is
 * day-shift only: any `add` of the `kim` card onto a weekend column is
 * vetoed, and `move`s onto weekends are vetoed for everyone (weekend line-up
 * is committed). Delivered gestures log under the roster — a vetoed drop
 * stays visibly silent.
 */
export const rosterLibraryDnd = example({
    keywords: ["Roster", "Library", "DnD", "drag", "add", "move", "remove", "trash", "onDrag", "page", "composition", "canDrop", "veto", "invalid", "validation", "candidate", "drop"],
    description: "Library + Roster DnD — drag a person onto a cell (add), drag proposed chips between cells (move) or to the trash sink (remove), every gesture logging through the one onDrag grammar funnel; the canDrop stage vetoes Kim's card on weekend columns (⊘ while dragging, no LAST log) and every move onto weekends",
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
                            { id: "kim", name: "Kim, A.", role: "Mid SE · day-shift only" },
                        ]}
                        item={p => ({ key: p.id, label: p.name, sublabel: p.role, icon: "user" })}
                    />
                    <Roster
                        id="roster-se"
                        sources={["people"]}
                        mode="edit"
                        people={[{ id: "patel", name: "Patel" }, { id: "cho", name: "Cho" }, { id: "kim", name: "Kim" }]}
                        person={p => ({ key: p.id, label: p.name })}
                        shifts={[
                            { id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("committed", null) },
                            { id: "p2", person: "patel", day: "Fri", hours: 8n, state: variant("proposed", variant("added", null)) },
                            { id: "c1", person: "cho", day: "Tue", hours: 6n, state: variant("proposed", variant("added", null)) },
                        ]}
                        shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state })}
                        days={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
                        canDrop={canDrop}
                        onDrag={onDrag}
                    />
                    <Text.MonoLabel>{East.str`LAST DROP · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
