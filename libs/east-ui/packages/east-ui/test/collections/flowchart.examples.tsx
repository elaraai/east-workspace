/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, DateTimeType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Button, Drawer, Flowchart, HStack, Meter, Reactive, Slice, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";

export const flowchartMinimal = example({
    keywords: ["Flowchart", "states", "links", "lanes", "minimal", "planned", "observed"],
    description: "Minimal flowchart — six states across three phase lanes, one observed transition",
    fn: East.function([], UIComponentType, ($) => {
        const states = $.const([
            { code: "RMI", name: "Raw intake", phase: "prep" },
            { code: "CUT", name: "Cut blanks", phase: "prep" },
            { code: "WLD", name: "Welding", phase: "build" },
            { code: "ASM", name: "Assembled", phase: "build" },
            { code: "QAP", name: "QA passed", phase: "dispatch" },
            { code: "SHP", name: "Shipped", phase: "dispatch" },
        ]);
        const planned = variant("planned", null);
        const observed = variant("observed", null);
        const links = $.const([
            { src: "RMI", dst: "CUT", kind: planned },
            { src: "CUT", dst: "WLD", kind: planned },
            { src: "WLD", dst: "ASM", kind: planned },
            { src: "ASM", dst: "QAP", kind: planned },
            { src: "QAP", dst: "SHP", kind: observed },
        ]);
        return (
            <Flowchart
                states={states} state={s => ({ key: s.code, label: s.name, lane: s.phase })}
                links={links} link={l => ({ from: l.src, to: l.dst, kind: l.kind })}
                lanes={[{ key: "prep", label: "Prep" }, { key: "build", label: "Build" }, { key: "dispatch", label: "Dispatch" }]}
            />
        );
    }),
    inputs: [],
});

export const flowchartPlant = example({
    keywords: ["Flowchart", "triggers", "evidence", "slice", "hover", "linkHover", "state class", "in-place", "unresolved", "freshness", "onAddLane"],
    description: "Batch-plant flowchart — decision triggers, evidence-weighted links, a ×14 state class, an ↻ in-place loop, an unresolved ghost, a bound slice, dev-defined hover cards, and the + LANE affordance",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const KindType = Flowchart.Types.Kind;
            const LinkRow = StructType({
                id: StringType, src: StringType, dst: StringType, kind: KindType,
                trigger: OptionType(StringType), vol: OptionType(FloatType), n: OptionType(IntegerType),
                at: DateTimeType, grade: StringType, vessels: ArrayType(StringType),
            });
            const states = $.const(East.value([
                { code: "FDS", name: "Feedstock", phase: "infeed", slots: none },
                { code: "STL", name: "Settled feed", phase: "infeed", slots: none },
                { code: "RCT", name: "Reacting", phase: "reaction", slots: none },
                { code: "RCD", name: "Reacted", phase: "reaction", slots: none },
                { code: "P*", name: "Press slots (class)", phase: "press", slots: some(14n) },
                { code: "PRD", name: "Pressed", phase: "press", slots: none },
                { code: "CUR", name: "Curing", phase: "curing", slots: none },
                { code: "BLD", name: "Blend", phase: "curing", slots: none },
                { code: "RTP", name: "Ready to pack", phase: "packaging", slots: none },
                { code: "PKD", name: "Packed", phase: "packaging", slots: none },
            ], ArrayType(StructType({
                code: StringType, name: StringType, phase: StringType, slots: OptionType(IntegerType),
            }))));
            const stamp = new Date("2026-06-30T00:00:00Z");
            const planned = variant("planned", null);
            const observed = variant("observed", null);
            const links = $.const(East.value([
                { id: "l1", src: "FDS", dst: "STL", kind: planned, trigger: none, vol: some(210.3), n: some(24911n), at: stamp, grade: "A", vessels: ["R"] },
                { id: "l2", src: "STL", dst: "RCT", kind: planned, trigger: none, vol: some(88.1), n: some(6210n), at: stamp, grade: "A", vessels: ["R"] },
                { id: "l3", src: "RCT", dst: "RCT", kind: planned, trigger: none, vol: none, n: some(2n), at: stamp, grade: "A", vessels: ["R"] },
                { id: "l4", src: "RCT", dst: "P*", kind: planned, trigger: some("press"), vol: some(199.5), n: some(13866n), at: stamp, grade: "A", vessels: ["R", "T"] },
                { id: "l5", src: "P*", dst: "PRD", kind: planned, trigger: none, vol: some(197.9), n: some(13791n), at: stamp, grade: "A", vessels: ["T"] },
                { id: "l6", src: "PRD", dst: "CUR", kind: observed, trigger: none, vol: some(12.4), n: some(512n), at: stamp, grade: "B", vessels: ["T"] },
                { id: "l7", src: "CUR", dst: "BLD", kind: planned, trigger: some("blend"), vol: some(96.0), n: some(4403n), at: stamp, grade: "A", vessels: ["T"] },
                { id: "l8", src: "BLD", dst: "RTP", kind: planned, trigger: none, vol: some(94.7), n: some(4350n), at: stamp, grade: "A", vessels: ["T"] },
                { id: "l9", src: "RTP", dst: "PKD", kind: planned, trigger: none, vol: some(93.8), n: some(4311n), at: stamp, grade: "A", vessels: [] },
                { id: "l10", src: "PKD", dst: "TFP", kind: planned, trigger: none, vol: none, n: none, at: stamp, grade: "A", vessels: [] },
            ], ArrayType(LinkRow)));
            const cfg = Slice.config(LinkRow, {
                fields: {
                    grade: { label: "Grade" },
                    src: { label: "From" },
                    dst: { label: "To" },
                },
                searchFieldIds: ["src", "dst"],
            });
            const slice = $.let(Slice.bind([LinkRow], "flowchart-plant", cfg, Slice.state({}), links, none));
            // Hover content is DEV-DEFINED (the Schematic contract): the
            // builder receives the hovered key and returns arbitrary UI.
            const linkHover = $.const(East.function([StringType], UIComponentType, ($, key) => {
                const row = $.let(links.filter(($, l) => East.equal(l.id, key)).get(0n));
                return (
                    <VStack gap="1" align="stretch">
                        <Text fontFamily="mono" fontWeight="bold" textStyle="body-sm">{East.str`${row.src} → ${row.dst}`}</Text>
                        <Text textStyle="caption" color="fg.muted">{East.str`grade ${row.grade} · ${row.vessels.length()} vessels`}</Text>
                    </VStack>
                );
            }));
            const stateHover = $.const(East.function([StringType], UIComponentType, (_$, key) => (
                <Text fontFamily="mono" textStyle="body-sm">{East.str`state ${key}`}</Text>
            )));
            const onAddLane = $.const(East.function([], NullType, (_$) => null));
            return (
                <Flowchart
                    states={states}
                    state={s => ({ key: s.code, label: s.name, lane: s.phase, members: s.slots })}
                    links={Slice.rows([LinkRow], slice)}
                    link={l => ({
                        key: l.id, from: l.src, to: l.dst, kind: l.kind, trigger: l.trigger,
                        evidence: { volume: l.vol, count: l.n, measuredAt: some(l.at), unit: "kt" },
                    })}
                    lanes={[
                        { key: "infeed", label: "Infeed" }, { key: "reaction", label: "Reaction" },
                        { key: "press", label: "Press" }, { key: "curing", label: "Curing" },
                        { key: "packaging", label: "Packaging" },
                    ]}
                    triggers={[
                        { id: "press", name: "press", who: "press-scheduler" },
                        { id: "blend", name: "blend", who: "blend-planner" },
                    ]}
                    trigger={t => ({ key: t.id, label: t.name, owner: t.who })}
                    linkHover={linkHover} stateHover={stateHover}
                    onAddLane={onAddLane}
                    slice={slice} affordances={["filter", "search"]}
                    freshness={{ label: "evidence-2026.06", date: stamp }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartConnect = example({
    keywords: ["Flowchart", "connect", "linkMode", "onCreateLink", "onDeleteLink", "canConnect", "authoring"],
    description: "Link authoring — connect mode with a canConnect veto; drag any handle to another state to author a transition, Del removes the selected link",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const LinkRow = StructType({ src: StringType, dst: StringType });
            const links = $.let(State.bind([ArrayType(LinkRow)], "flowchart.connect.links", [
                { src: "RMI", dst: "CUT" },
                { src: "CUT", dst: "ASM" },
            ]));
            const onCreate = $.const(East.function([Flowchart.Types.LinkCreateEvent], NullType, ($, e) => {
                const next = $.let(links.read());
                $(next.append([{ src: e.from, dst: e.to }]));
                $(links.write(next));
            }));
            const onDelete = $.const(East.function([StringType], NullType, ($, key) => {
                $(links.write(links.read().filter(($, l) =>
                    East.equal(East.str`${l.src}→${l.dst}`, key).not())));
            }));
            const canConnect = $.const(East.function([StringType, StringType], BooleanType,
                (_$, from, to) => East.equal(from, to).not()));
            return (
                <Flowchart
                    states={[
                        { code: "RMI", name: "Raw intake", phase: "prep" },
                        { code: "CUT", name: "Cut blanks", phase: "prep" },
                        { code: "ASM", name: "Assembled", phase: "build" },
                        { code: "QAP", name: "QA passed", phase: "build" },
                    ]}
                    state={s => ({ key: s.code, label: s.name, lane: s.phase })}
                    links={links.read()}
                    link={l => ({ key: East.str`${l.src}→${l.dst}`, from: l.src, to: l.dst })}
                    lanes={[{ key: "prep", label: "Prep" }, { key: "build", label: "Build" }]}
                    orientation="TD"
                    linkMode="connect"
                    onCreateLink={onCreate} onDeleteLink={onDelete} canConnect={canConnect}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartBuilder = example({
    keywords: ["Flowchart", "Reactive", "State", "builder", "add", "onAddLane", "onCreateLink", "onDeleteLink", "interactive", "edit", "phases"],
    description: "Interactive builder — State-bound lanes, states and links: + LANE appends a phase, Add state drops a node into the newest phase, drag any handle to author a link (Del removes the selected one)",
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
            const addState = $.const(East.function([], NullType, ($) => {
                const ls = $.let(lanes.read());
                const next = $.let(states.read());
                const n = $.let(next.length().add(1n));
                $(next.append([{
                    code: East.str`S${n}`,
                    name: East.str`State ${n}`,
                    phase: ls.get(ls.length().subtract(1n)).key,
                }]));
                $(states.write(next));
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
            const canConnect = $.const(East.function([StringType, StringType], BooleanType,
                (_$, from, to) => East.equal(from, to).not()));
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="3">
                        <Button size="sm" variant="outline" onClick={addState}>Add state</Button>
                        <Text textStyle="caption" color="fg.muted">+ LANE adds a phase · drag any handle to link · Del removes the selected link</Text>
                    </HStack>
                    <Flowchart
                        states={states.read()} state={s => ({ key: s.code, label: s.name, lane: s.phase })}
                        links={links.read()} link={l => ({ key: East.str`${l.src}→${l.dst}`, from: l.src, to: l.dst })}
                        lanes={lanes.read()} lane={r => ({ key: r.key, label: r.label })}
                        linkMode="connect"
                        onAddLane={addLane}
                        onCreateLink={onCreate} onDeleteLink={onDelete} canConnect={canConnect}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartHoverCards = example({
    keywords: ["Flowchart", "hover", "stateHover", "linkHover", "triggerHover", "Meter", "card", "glance"],
    description: "Dev-defined hover cards — stateHover renders a utilisation Meter, linkHover the evidence glance, triggerHover the owning role (arbitrary UI in the standard 400ms shell)",
    fn: East.function([], UIComponentType, ($) => {
        const StateRow = StructType({ code: StringType, name: StringType, phase: StringType, util: FloatType });
        const LinkRow = StructType({ id: StringType, src: StringType, dst: StringType, vol: FloatType, n: IntegerType, decision: OptionType(StringType) });
        const states = $.const(East.value([
            { code: "MIX", name: "Mixing", phase: "prep", util: 72.0 },
            { code: "FIL", name: "Filling", phase: "line", util: 91.0 },
            { code: "CAP", name: "Capping", phase: "line", util: 64.0 },
            { code: "PAL", name: "Palletised", phase: "out", util: 38.0 },
        ], ArrayType(StateRow)));
        const links = $.const(East.value([
            { id: "m-f", src: "MIX", dst: "FIL", vol: 182.4, n: 9210n, decision: some("release") },
            { id: "f-c", src: "FIL", dst: "CAP", vol: 180.9, n: 9184n, decision: none },
            { id: "c-p", src: "CAP", dst: "PAL", vol: 179.7, n: 9102n, decision: none },
        ], ArrayType(LinkRow)));
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
                    <Text textStyle="caption" color="fg.muted">{East.str`${row.vol} kt · ${row.n} transfers`}</Text>
                </VStack>
            );
        }));
        const triggerHover = $.const(East.function([StringType], UIComponentType, (_$, key) => (
            <VStack gap="1" align="stretch">
                <Text fontFamily="mono" fontWeight="bold" textStyle="body-sm">{East.str`decision · ${key}`}</Text>
                <Text textStyle="caption" color="fg.muted">owner · line-scheduler</Text>
            </VStack>
        )));
        return (
            <Flowchart
                states={states} state={s => ({ key: s.code, label: s.name, lane: s.phase })}
                links={links}
                link={l => ({ key: l.id, from: l.src, to: l.dst, trigger: l.decision,
                    evidence: { volume: some(l.vol), count: some(l.n), unit: "kt" } })}
                lanes={[{ key: "prep", label: "Prep" }, { key: "line", label: "Line" }, { key: "out", label: "Outbound" }]}
                triggers={[{ id: "release", name: "release", who: "line-scheduler" }]}
                trigger={t => ({ key: t.id, label: t.name, owner: t.who })}
                stateHover={stateHover} linkHover={linkHover} triggerHover={triggerHover}
            />
        );
    }),
    inputs: [],
});

export const flowchartDrawerDetail = example({
    keywords: ["Flowchart", "Drawer", "onSelectLink", "onSelectState", "drill", "detail", "click", "open"],
    description: "Click-to-drill — onSelectState / onSelectLink open a programmatic Drawer with the entity's detail (detail surfaces are host-owned; the flowchart stays a picture)",
    fn: East.function([], UIComponentType, ($) => {
        const StateRow = StructType({ code: StringType, name: StringType, phase: StringType });
        const LinkRow = StructType({ id: StringType, src: StringType, dst: StringType, vol: FloatType, n: IntegerType });
        const states = $.const(East.value([
            { code: "RMI", name: "Raw intake", phase: "prep" },
            { code: "CUT", name: "Cut blanks", phase: "prep" },
            { code: "ASM", name: "Assembled", phase: "build" },
            { code: "QAP", name: "QA passed", phase: "build" },
        ], ArrayType(StateRow)));
        const links = $.const(East.value([
            { id: "r-c", src: "RMI", dst: "CUT", vol: 44.2, n: 1204n },
            { id: "c-a", src: "CUT", dst: "ASM", vol: 43.1, n: 1181n },
            { id: "a-q", src: "ASM", dst: "QAP", vol: 42.8, n: 1170n },
        ], ArrayType(LinkRow)));
        const onSelectLink = $.const(East.function([StringType], NullType, ($, key) => {
            const row = $.let(links.filter(($, l) => East.equal(l.id, key)).get(0n));
            $(Drawer.open(East.value({
                body: [
                    <VStack gap="3" align="stretch">
                        <Text textStyle="body-sm">{East.str`Volume ${row.vol} kt across ${row.n} transfers.`}</Text>
                        <Meter value={row.vol} max={50.0} tone="success" label={<Text textStyle="caption" color="fg.muted">share of line cap</Text>} />
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
                links={links} link={l => ({ key: l.id, from: l.src, to: l.dst,
                    evidence: { volume: some(l.vol), count: some(l.n), unit: "kt" } })}
                lanes={[{ key: "prep", label: "Prep" }, { key: "build", label: "Build" }]}
                onSelectLink={onSelectLink} onSelectState={onSelectState}
            />
        );
    }),
    inputs: [],
});
