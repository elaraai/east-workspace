/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, DateTimeType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Drawer, Flowchart, Meter, Reactive, Slice, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";

export const flowchartMinimal = example({
    keywords: ["Flowchart", "states", "links", "lanes", "minimal", "planned", "observed"],
    description: "Minimal flowchart — six states across three phase lanes, one observed transition",
    fn: East.function([], UIComponentType, ($) => {
        const states = $.const([
            { code: "ARV", name: "Arrived", phase: "intake" },
            { code: "SCN", name: "Scanned", phase: "intake" },
            { code: "SRT", name: "Sorting", phase: "sort" },
            { code: "SRD", name: "Sorted", phase: "sort" },
            { code: "LDD", name: "Loaded", phase: "dispatch" },
            { code: "DSP", name: "Dispatched", phase: "dispatch" },
        ]);
        const planned = variant("planned", null);
        const observed = variant("observed", null);
        const links = $.const([
            { src: "ARV", dst: "SCN", kind: planned },
            { src: "SCN", dst: "SRT", kind: planned },
            { src: "SRT", dst: "SRD", kind: planned },
            { src: "SRD", dst: "LDD", kind: planned },
            { src: "LDD", dst: "DSP", kind: observed },
        ]);
        return (
            <Flowchart
                states={states} state={s => ({ key: s.code, label: s.name, lane: s.phase })}
                links={links} link={l => ({ from: l.src, to: l.dst, kind: l.kind })}
                lanes={[{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "dispatch", label: "Dispatch" }]}
            />
        );
    }),
    inputs: [],
});

export const flowchartDepot = example({
    keywords: ["Flowchart", "triggers", "evidence", "slice", "hover", "linkHover", "state class", "in-place", "unresolved", "freshness", "onAddLane"],
    description: "Parcel-depot flowchart — decision triggers, evidence-weighted links, a ×14 state class, an ↻ in-place loop, an unresolved ghost, a bound slice, dev-defined hover cards on states, links AND trigger diamonds, and the + LANE affordance",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const KindType = Flowchart.Types.Kind;
            const LinkRow = StructType({
                id: StringType, src: StringType, dst: StringType, kind: KindType,
                trigger: OptionType(StringType), parcels: OptionType(FloatType), n: OptionType(IntegerType),
                at: DateTimeType, service: StringType, units: ArrayType(StringType),
            });
            const states = $.const(East.value([
                { code: "ARV", name: "Arrived", phase: "intake", slots: none },
                { code: "SCN", name: "Scanned", phase: "intake", slots: none },
                { code: "IND", name: "Inducting", phase: "induct", slots: none },
                { code: "LBL", name: "Labelled", phase: "induct", slots: none },
                { code: "CH*", name: "Sort chutes (class)", phase: "sort", slots: some(14n) },
                { code: "SRD", name: "Sorted", phase: "sort", slots: none },
                { code: "HLD", name: "Held", phase: "hold", slots: none },
                { code: "CLR", name: "Cleared", phase: "hold", slots: none },
                { code: "LDD", name: "Loaded", phase: "dispatch", slots: none },
                { code: "DSP", name: "Dispatched", phase: "dispatch", slots: none },
            ], ArrayType(StructType({
                code: StringType, name: StringType, phase: StringType, slots: OptionType(IntegerType),
            }))));
            const stamp = new Date("2026-06-30T00:00:00Z");
            const planned = variant("planned", null);
            const observed = variant("observed", null);
            const links = $.const(East.value([
                { id: "l1", src: "ARV", dst: "SCN", kind: planned, trigger: none, parcels: some(18460.0), n: some(412n), at: stamp, service: "standard", units: ["C"] },
                { id: "l2", src: "SCN", dst: "IND", kind: planned, trigger: none, parcels: some(7720.0), n: some(171n), at: stamp, service: "standard", units: ["C"] },
                { id: "l3", src: "IND", dst: "IND", kind: planned, trigger: none, parcels: none, n: some(2n), at: stamp, service: "standard", units: ["C"] },
                { id: "l4", src: "IND", dst: "CH*", kind: planned, trigger: some("route"), parcels: some(17350.0), n: some(386n), at: stamp, service: "standard", units: ["C", "T"] },
                { id: "l5", src: "CH*", dst: "SRD", kind: planned, trigger: none, parcels: some(17210.0), n: some(383n), at: stamp, service: "standard", units: ["T"] },
                { id: "l6", src: "SRD", dst: "HLD", kind: observed, trigger: none, parcels: some(1080.0), n: some(24n), at: stamp, service: "express", units: ["T"] },
                { id: "l7", src: "HLD", dst: "CLR", kind: planned, trigger: some("customs"), parcels: some(8350.0), n: some(186n), at: stamp, service: "standard", units: ["T"] },
                { id: "l8", src: "CLR", dst: "LDD", kind: planned, trigger: none, parcels: some(8240.0), n: some(183n), at: stamp, service: "standard", units: ["T"] },
                { id: "l9", src: "LDD", dst: "DSP", kind: planned, trigger: none, parcels: some(8160.0), n: some(181n), at: stamp, service: "standard", units: [] },
                { id: "l10", src: "DSP", dst: "DLV", kind: planned, trigger: none, parcels: none, n: none, at: stamp, service: "standard", units: [] },
            ], ArrayType(LinkRow)));
            const cfg = Slice.config(LinkRow, {
                fields: {
                    service: { label: "Service" },
                    src: { label: "From" },
                    dst: { label: "To" },
                },
                searchFieldIds: ["src", "dst"],
            });
            const slice = $.let(Slice.bind([LinkRow], "flowchart-depot", cfg, Slice.state({}), links, none));
            // Hover content is DEV-DEFINED (the Schematic contract): the
            // builder receives the hovered key and returns arbitrary UI.
            const linkHover = $.const(East.function([StringType], UIComponentType, ($, key) => {
                const row = $.let(links.filter(($, l) => East.equal(l.id, key)).get(0n));
                return (
                    <VStack gap="1" align="stretch">
                        <Text fontFamily="mono" fontWeight="bold" textStyle="body-sm">{East.str`${row.src} → ${row.dst}`}</Text>
                        <Text textStyle="caption" color="fg.muted">{East.str`service ${row.service} · ${row.units.length()} units`}</Text>
                    </VStack>
                );
            }));
            const stateHover = $.const(East.function([StringType], UIComponentType, (_$, key) => (
                <Text fontFamily="mono" textStyle="body-sm">{East.str`state ${key}`}</Text>
            )));
            const triggers = $.const([
                { id: "route", name: "route", who: "sort-planner" },
                { id: "customs", name: "customs", who: "customs-desk" },
            ]);
            const triggerHover = $.const(East.function([StringType], UIComponentType, ($, key) => {
                const row = $.let(triggers.filter(($, t) => East.equal(t.id, key)).get(0n));
                return (
                    <VStack gap="1" align="stretch">
                        <Text fontFamily="mono" fontWeight="bold" textStyle="body-sm">{East.str`decision · ${row.name}`}</Text>
                        <Text textStyle="caption" color="fg.muted">{East.str`owner · ${row.who}`}</Text>
                    </VStack>
                );
            }));
            const onAddLane = $.const(East.function([], NullType, (_$) => null));
            return (
                <Flowchart
                    states={states}
                    state={s => ({ key: s.code, label: s.name, lane: s.phase, members: s.slots })}
                    links={Slice.rows([LinkRow], slice)}
                    link={l => ({
                        key: l.id, from: l.src, to: l.dst, kind: l.kind, trigger: l.trigger,
                        evidence: { volume: l.parcels, count: l.n, measuredAt: some(l.at), unit: "parcels" },
                    })}
                    lanes={[
                        { key: "intake", label: "Intake" }, { key: "induct", label: "Induct" },
                        { key: "sort", label: "Sort" }, { key: "hold", label: "Hold" },
                        { key: "dispatch", label: "Dispatch" },
                    ]}
                    triggers={triggers}
                    trigger={t => ({ key: t.id, label: t.name, owner: t.who })}
                    linkHover={linkHover} stateHover={stateHover} triggerHover={triggerHover}
                    onAddLane={onAddLane}
                    slice={slice} affordances={["filter", "search"]}
                    freshness={{ label: "evidence-2026.06", date: stamp }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The connect-mode authoring session (old flowchartConnect) folds in here —
 * the canConnect veto, header click-to-rename and × lane removal join the
 * builder's State-bound editing loop; `linkMode="connect"` + drag any handle
 * is the one link-authoring grammar.
 */
export const flowchartBuilder = example({
    keywords: ["Flowchart", "Reactive", "State", "builder", "onAddState", "onEditState", "onMoveState", "onAddLane", "onRenameLane", "onDeleteLane", "onCreateLink", "onDeleteLink", "canConnect", "connect", "linkMode", "authoring", "interactive", "edit", "phases", "ghost"],
    description: "Interactive builder — State-bound lanes, states and links: + LANE, + STATE ghosts, double-click edit, cross-lane drag, handle-drag linking with Del delete and an intake-only canConnect veto",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const LaneRow = StructType({ key: StringType, label: StringType });
            const StateRow = StructType({ code: StringType, name: StringType, phase: StringType });
            const LinkRow = StructType({ src: StringType, dst: StringType });
            const lanes = $.let(State.bind([ArrayType(LaneRow)], "flowchart.builder.lanes", [
                { key: "p1", label: "Phase 1" }, { key: "p2", label: "Phase 2" },
            ]));
            const states = $.let(State.bind([ArrayType(StateRow)], "flowchart.builder.states", [
                { code: "S1", name: "State 1", phase: "p1" },
                { code: "S2", name: "State 2", phase: "p2" },
            ]));
            const links = $.let(State.bind([ArrayType(LinkRow)], "flowchart.builder.links", [
                { src: "S1", dst: "S2" },
            ]));
            const addLane = $.const(East.function([], NullType, ($) => {
                const next = $.let(lanes.read());
                const n = $.let(next.length().add(1n));
                $(next.append([{ key: East.str`p${n}`, label: East.str`Phase ${n}` }]));
                $(lanes.write(next));
            }));
            const renameLane = $.const(East.function([Flowchart.Types.LaneRenameEvent], NullType, ($, e) => {
                $(lanes.write(lanes.read().map(($, l) =>
                    East.equal(l.key, e.key).ifElse(
                        () => East.value({ key: l.key, label: e.label }, LaneRow),
                        () => l,
                    ))));
            }));
            const deleteLane = $.const(East.function([StringType], NullType, ($, key) => {
                // Host-owned cascade: drop the lane row only — states in it
                // fall into the LAST lane (they stay visible).
                $(lanes.write(lanes.read().filter(($, l) => East.equal(l.key, key).not())));
            }));
            const addState = $.const(East.function([Flowchart.Types.StateAddEvent], NullType, ($, e) => {
                const next = $.let(states.read());
                $(next.append([{ code: e.key, name: e.label, phase: e.lane }]));
                $(states.write(next));
            }));
            const editState = $.const(East.function([Flowchart.Types.StateEditEvent], NullType, ($, e) => {
                $(states.write(states.read().map(($, s) =>
                    East.equal(s.code, e.key).ifElse(
                        () => East.value({ code: e.code, name: e.label, phase: s.phase }, StateRow),
                        () => s,
                    ))));
                // Rekey link endpoints so edges follow the renamed state.
                $(links.write(links.read().map(($, l) => East.value({
                    src: East.equal(l.src, e.key).ifElse(() => e.code, () => l.src),
                    dst: East.equal(l.dst, e.key).ifElse(() => e.code, () => l.dst),
                }, LinkRow))));
            }));
            const moveState = $.const(East.function([Flowchart.Types.StateMoveEvent], NullType, ($, e) => {
                $(states.write(states.read().map(($, s) =>
                    East.equal(s.code, e.key).ifElse(
                        () => East.value({ code: s.code, name: s.name, phase: e.lane }, StateRow),
                        () => s,
                    ))));
            }));
            const onCreate = $.const(East.function([Flowchart.Types.LinkCreateEvent], NullType, ($, e) => {
                const next = $.let(links.read());
                $(next.append([{ src: e.from, dst: e.to }]));
                $(links.write(next));
            }));
            const onDelete = $.const(East.function([StringType], NullType, ($, key) => {
                $(links.write(links.read().filter(($, l) =>
                    East.equal(East.str`${l.src}→${l.dst}`, key).not())));
            }));
            // Connection validator (the no-snap veto stage): S1 is the intake —
            // authored links never point INTO it, so a connect draft simply
            // refuses to snap onto S1 as a target. Self-drop stays allowed
            // (↻ in-place), which is why the veto is target-only rather than
            // the from ≠ to rule.
            const canConnect = $.const(East.function([StringType, StringType], BooleanType,
                (_$, _from, to) => East.equal(to, "S1").not()));
            return (
                <VStack gap="3" align="stretch">
                    <Flowchart
                        states={states.read()} state={s => ({ key: s.code, label: s.name, lane: s.phase })}
                        links={links.read()} link={l => ({ key: East.str`${l.src}→${l.dst}`, from: l.src, to: l.dst })}
                        lanes={lanes.read()} lane={r => ({ key: r.key, label: r.label })}
                        linkMode="connect"
                        onAddLane={addLane} onRenameLane={renameLane} onDeleteLane={deleteLane}
                        onAddState={addState} onEditState={editState} onMoveState={moveState}
                        onCreateLink={onCreate} onDeleteLink={onDelete} canConnect={canConnect}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Inspection depth ladder on ONE canvas (old flowchartHoverCards +
 * flowchartDrawerDetail) — hover for the dev-defined glance card, click for
 * the host-owned Drawer detail. The two never fight: hover is transient and
 * read-only, click commits to the drawer.
 */
export const flowchartDetail = example({
    keywords: ["Flowchart", "hover", "stateHover", "linkHover", "triggerHover", "Meter", "card", "glance", "Drawer", "onSelectLink", "onSelectState", "drill", "detail", "click", "open"],
    description: "Hover glances + click-to-drill on one canvas — stateHover/linkHover/triggerHover cards plus onSelectState/onSelectLink opening a programmatic Drawer",
    fn: East.function([], UIComponentType, ($) => {
        const StateRow = StructType({ code: StringType, name: StringType, phase: StringType, util: FloatType });
        const LinkRow = StructType({ id: StringType, src: StringType, dst: StringType, parcels: FloatType, n: IntegerType, decision: OptionType(StringType) });
        const states = $.const([
            { code: "UNL", name: "Unloading", phase: "intake", util: 68.0 },
            { code: "IND", name: "Inducting", phase: "sort", util: 87.0 },
            { code: "SRT", name: "Sorting", phase: "sort", util: 59.0 },
            { code: "LDG", name: "Loading", phase: "out", util: 41.0 },
        ], ArrayType(StateRow));
        const links = $.const([
            { id: "u-i", src: "UNL", dst: "IND", parcels: 15860.0, n: 352n, decision: some("release") },
            { id: "i-s", src: "IND", dst: "SRT", parcels: 15730.0, n: 349n, decision: none },
            { id: "s-l", src: "SRT", dst: "LDG", parcels: 15630.0, n: 347n, decision: none },
        ], ArrayType(LinkRow));
        // --- hover glances: dev-defined cards in the standard 400ms shell ---
        const stateHover = $.const(East.function([StringType], UIComponentType, ($, key) => {
            const row = $.let(states.filter(($, s) => East.equal(s.code, key)).get(0n));
            return (
                <VStack gap="2" align="stretch" minWidth="180px">
                    <Text fontFamily="mono" fontWeight="bold" textStyle="body-sm">{East.str`${row.code} · ${row.name}`}</Text>
                    <Meter value={row.util} tone="success" label={<Text textStyle="caption" color="fg.muted">util</Text>} />
                </VStack>
            );
        }));
        const linkHover = $.const(East.function([StringType], UIComponentType, ($, key) => {
            const row = $.let(links.filter(($, l) => East.equal(l.id, key)).get(0n));
            return (
                <VStack gap="1" align="stretch">
                    <Text fontFamily="mono" fontWeight="bold" textStyle="body-sm">{East.str`${row.src} → ${row.dst}`}</Text>
                    <Text textStyle="caption" color="fg.muted">{East.str`${row.parcels} parcels · ${row.n} cage moves`}</Text>
                </VStack>
            );
        }));
        const triggerHover = $.const(East.function([StringType], UIComponentType, (_$, key) => (
            <VStack gap="1" align="stretch">
                <Text fontFamily="mono" fontWeight="bold" textStyle="body-sm">{East.str`decision · ${key}`}</Text>
                <Text textStyle="caption" color="fg.muted">owner · dock-scheduler</Text>
            </VStack>
        )));
        // --- click-to-drill: the same entities open a host-owned Drawer ---
        const onSelectLink = $.const(East.function([StringType], NullType, ($, key) => {
            const row = $.let(links.filter(($, l) => East.equal(l.id, key)).get(0n));
            $(Drawer.open(East.value({
                body: [
                    <VStack gap="3" align="stretch">
                        <Text textStyle="body-sm">{East.str`${row.parcels} parcels across ${row.n} cage moves.`}</Text>
                        <Meter value={row.parcels} max={18000.0} tone="success" label={<Text textStyle="caption" color="fg.muted">share of sorter capacity</Text>} />
                    </VStack>,
                ],
                eyebrow: some("Transition"),
                title: some(East.str`${row.src} → ${row.dst}`),
                description: some("Selected from the flowchart"),
                style: none,
            }, Drawer.Types.OpenInput)));
        }));
        const onSelectState = $.const(East.function([StringType], NullType, ($, key) => {
            const row = $.let(states.filter(($, s) => East.equal(s.code, key)).get(0n));
            $(Drawer.open(East.value({
                body: [
                    <VStack gap="2" align="stretch">
                        <Text textStyle="body-sm">{East.str`${row.name} sits in the ${row.phase} phase.`}</Text>
                        <Text textStyle="caption" color="fg.muted">Open upstream / downstream analyses from here.</Text>
                    </VStack>,
                ],
                eyebrow: some("State"),
                title: some(East.str`${row.code} · ${row.name}`),
                description: some("Selected from the flowchart"),
                style: none,
            }, Drawer.Types.OpenInput)));
        }));
        return (
            <Flowchart
                states={states} state={s => ({ key: s.code, label: s.name, lane: s.phase })}
                links={links}
                link={l => ({ key: l.id, from: l.src, to: l.dst, trigger: l.decision,
                    evidence: { volume: some(l.parcels), count: some(l.n), unit: "parcels" } })}
                lanes={[{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "out", label: "Outbound" }]}
                triggers={[{ id: "release", name: "release", who: "dock-scheduler" }]}
                trigger={t => ({ key: t.id, label: t.name, owner: t.who })}
                stateHover={stateHover} linkHover={linkHover} triggerHover={triggerHover}
                onSelectLink={onSelectLink} onSelectState={onSelectState}
            />
        );
    }),
    inputs: [],
});
