/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, DateTimeType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Flowchart, Reactive, Slice, State, UIComponentType } from "@elaraai/east-ui";

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
    keywords: ["Flowchart", "triggers", "evidence", "slice", "declared fields", "state class", "in-place", "unresolved", "freshness"],
    description: "Batch-plant flowchart — decision triggers, evidence-weighted links, a ×14 state class, an ↻ in-place loop, an unresolved ghost, and a bound slice with declared fields",
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
                { id: "l5", src: "P*", dst: "PRD", kind: planned, trigger: none, vol: some(199.5), n: some(13866n), at: stamp, grade: "A", vessels: ["T"] },
                { id: "l6", src: "PRD", dst: "CUR", kind: observed, trigger: none, vol: some(12.4), n: some(512n), at: stamp, grade: "B", vessels: ["T"] },
                { id: "l7", src: "CUR", dst: "BLD", kind: planned, trigger: some("blend"), vol: some(96.0), n: some(4403n), at: stamp, grade: "A", vessels: ["T"] },
                { id: "l8", src: "BLD", dst: "RTP", kind: planned, trigger: none, vol: some(96.0), n: some(4403n), at: stamp, grade: "A", vessels: ["T"] },
                { id: "l9", src: "RTP", dst: "PKD", kind: planned, trigger: none, vol: some(95.2), n: some(4361n), at: stamp, grade: "A", vessels: [] },
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
                    linkFields={{
                        vessels: { label: "Vessels", kind: "chips", value: l => l.vessels },
                        grade: { label: "Grade", value: l => l.grade, sliceField: "grade" },
                    }}
                    slice={slice} affordances={["filter", "search"]}
                    freshness={{ label: "evidence-2026.06", date: stamp }}
                    height="640"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartConnect = example({
    keywords: ["Flowchart", "connect", "linkMode", "onCreateLink", "onDeleteLink", "canConnect", "authoring"],
    description: "Link authoring — connect mode with a canConnect veto; drag an out-handle to another state to author a transition, Del removes the selected link",
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
