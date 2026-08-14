/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

import {
    ArrayType,
    BooleanType,
    DateTimeType,
    East,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    example,
    none,
    some,
    variant,
} from "@elaraai/east";
import { DragEventType, EventStateType, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import { Chart, Format, Plan, Reactive, Slice, Text } from "@elaraai/east-ui";

// The corpus: the §1 composition flagship, ONE example per row kind (each a
// mini variants panel — several rows on one canvas, one per config of that
// kind's grammar; statically shootable for the visual loop), and the
// library-DnD behavioral isolate. Every per-kind panel ALSO sweeps the shell
// options: rows in AND out of a group strip, single-line vs stacked two-line
// gutters, and the meta tag on and off. Fixtures are defined INLINE in each
// example's fn body (the automated docs extract only the fn body) and
// DERIVED with East expressions — a `week(n)` ISO-week function plus
// `East.Array.generate` — never hand-written per element; only
// individually-meaningful mock entries (runs, chips, marks) stay literal.

// ============================================================================
// planTargetState — the §1 flagship mirror (every row kind on one canvas)
// ============================================================================

export const planTargetState = example({
    keywords: [
        "Plan", "canvas", "axis", "window", "resolution", "now", "span", "run",
        "group", "heat", "buckets", "cards", "chip", "events", "mark", "chart",
        "layers", "drill", "rollup", "bands", "review", "footer", "milestone",
        "decision", "exception", "pinned", "port", "hovercard", "popover",
        "slice", "brush", "horizon", "toolbar", "affordances", "journeys",
        "journey", "of", "data-driven", "accessor", "target state",
    ],
    description: "The whole operation on one axis, data-driven — machines typed with the IR element types feed span.of (status/drill presence per row from Option fields), dock/crew/milestone datasets map through Plan.rows with the plain factories, a pinned coverage chart, a collapsed heat-strip group, slice chrome + the horizon brush, review, journeys, the generalized popover/hover resolvers over element refs, and a status footer",
    fn: East.function([], UIComponentType, (_$) => {
        // Domain data typed WITH the IR element types (Plan.Types.Run / Chip /
        // BucketEvent / EventMark …) — presence lives in the data as Option
        // fields, so mappers pass it through; no option plumbing anywhere.
        const HorizonRow = StructType({ key: StringType, at: DateTimeType, line: StringType });
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const MachineRow = StructType({
            id: StringType, cap: FloatType,
            status: OptionType(StatusValueType),          // ● dot — some machines only
            drill:  OptionType(Plan.Types.Drill),         // 96px drill — only M04 carries one
            runs:      ArrayType(Plan.Types.Run),
            decisions: ArrayType(Plan.Types.DecisionMark),
            ports:     ArrayType(Plan.Types.Port),
        });
        const DockRow = StructType({
            id: StringType, label: StringType,
            lanes: ArrayType(Plan.Types.Lane),
            events: ArrayType(Plan.Types.BucketEvent),
            markers: ArrayType(Plan.Types.CellMarker),
        });
        const CrewRow = StructType({
            id: StringType, name: StringType, hours: StringType,
            chips: ArrayType(Plan.Types.Chip),
        });
        const StreamRow = StructType({
            id: StringType, name: StringType,
            marks: ArrayType(Plan.Types.EventMark),
        });
        const cfg = Slice.config(HorizonRow, {
            fields: { at: { label: "Despatched" }, line: { label: "Line" } },
            rangeFieldId: "at",
            searchFieldIds: ["line"],
        });

        return (<Reactive>{$ => {
            // Monday of ISO week n, 2026 (W1 Monday = 2025-12-29). The §1
            // window is W27–W38 (half-open at W39); now = W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
                const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // The pinned coverage measure + the Line 2 load — one point per
            // window week, values paired off compact literal series.
            const covPcts = $.const(
                [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2],
                ArrayType(FloatType));
            const loadPcts = $.const(
                [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0],
                ArrayType(FloatType));
            const coverage = $.let(East.Array.generate(12n, MeasureRow, (_$2, i) =>
                ({ week: week(i.add(27n)), pct: covPcts.get(i) })));
            // 36 despatch orders spread over W21–W47 (26 weeks), lines alternating.
            const horizon = $.let(East.Array.generate(36n, HorizonRow, (_$2, i) => ({
                key: East.str`h${East.print(i.add(1n))}`,
                at: week(i.multiply(27n).divide(36n).add(21n)),
                line: i.remainder(2n).equal(0n).ifElse(() => "Line 1", () => "Line 2"),
            })));
            // The Line 1 machines — element arrays built with the value
            // builders (one call per element = presence per element); status
            // and drill are Option DATA the span.of accessors pass through.
            const machines = $.const([
                { id: "L1-M03", cap: 120.0, status: some(variant("success", null)), drill: none,
                  runs: [
                      Plan.run({ key: "set",  start: week(27n), end: week(28n), label: "SET", state: "actual" }),
                      Plan.run({ key: "b214", start: week(28n), end: week(31n), label: "RUN · B-214",
                                 quantity: "96 t", qty: 96, state: "in-progress" }),
                      Plan.run({ key: "cln",  start: week(31n), end: week(32n), label: "CLN", state: "confirmed" }),
                      Plan.run({ key: "b221", start: week(32n), end: week(35n), label: "RUN · B-221",
                                 quantity: "88 t", qty: 88, state: "recommended" }),
                  ],
                  decisions: [Plan.decision({ key: "d1", at: week(32n), applied: false })],
                  ports:     [Plan.port({ at: week(31n), label: "−24 t" })] },
                { id: "L1-M04", cap: 120.0, status: none,
                  drill: some(Plan.drill({
                      lines: ["120 t · FILL", "B-208 · 88 t · 73%"],
                      meter: 0.73,
                      series: [
                          { at: week(27n), value: 10.0 }, { at: week(29n), value: 96.0 },
                          { at: week(31n), value: 88.0 }, { at: week(34n), value: 64.0 }, { at: week(38n), value: 92.0 },
                      ],
                      events: ["LEVEL t · DAILY", "START 04 JUL", "TRANSFER W31 · −24 t", "QC W33"],
                      journey: "B-208",
                  })),
                  runs: [
                      Plan.run({ key: "b208", start: week(27n), end: week(30n), label: "RUN · B-208", quantity: "112 t", qty: 112, state: "actual" }),
                      Plan.run({ key: "hld",  start: week(30n), end: week(31n), label: "HLD", state: "confirmed" }),
                      Plan.run({ key: "qc",   start: week(31n), end: week(33n), label: "QC", state: "confirmed" }),
                      Plan.run({ key: "b231", start: week(33n), end: week(41n), label: "RUN · B-231", quantity: "104 t", qty: 104, state: "recommended" }),
                  ],
                  decisions: [], ports: [] },
                { id: "L1-M07", cap: 80.0, status: some(variant("warning", null)), drill: none,
                  runs: [
                      Plan.run({ key: "b197", start: week(27n), end: week(31n), label: "HLD · B-197",
                                 quantity: "2.6× dwell", state: "actual", status: "warning" }),
                      Plan.run({ key: "cln", start: week(34n), end: week(36n), label: "CLN", state: "recommended" }),
                  ],
                  decisions: [], ports: [] },
            ], ArrayType(MachineRow));
            // Docks / crews / milestone streams — element data as IR values.
            const dockRows = $.const([
                { id: "dock2", label: "Dock 2", lanes: [],
                  events: [
                      Plan.event({ key: "a1", at: week(27n), state: "confirmed" }),
                      Plan.event({ key: "a2", at: week(28n), state: "confirmed" }),
                      Plan.event({ key: "a3", at: week(29n), state: "confirmed" }),
                      Plan.event({ key: "a4", at: week(30n), state: "confirmed" }),
                      Plan.event({ key: "a5", at: week(31n), state: "recommended" }),
                      Plan.event({ key: "a6", at: week(33n), state: "recommended" }),
                      Plan.event({ key: "a7", at: week(35n), state: "confirmed" }),
                      Plan.event({ key: "a8", at: week(35n), state: "recommended" }),
                  ],
                  markers: [Plan.marker({ at: week(35n), status: "warning", message: "capacity breach — 2 allocations" })] },
            ], ArrayType(DockRow));
            const crews = $.const([
                { id: "crewA", name: "Crew A", hours: "152h → 168h", chips: [
                    Plan.chip({ key: "s1", from: week(27n), to: week(29n), label: "80h", state: "confirmed" }),
                    Plan.chip({ key: "s2", from: week(29n), to: week(31n), label: "72h", state: "confirmed" }),
                    Plan.chip({ key: "s3", from: week(31n), to: week(33n), label: "+64h", state: "recommended" }),
                    Plan.chip({ key: "s4", from: week(34n), to: week(35n), label: "48h", state: "estimated" }),
                    Plan.chip({ key: "s5", from: week(36n), to: week(38n), label: "+56h", state: "recommended" }),
                ] },
            ], ArrayType(CrewRow));
            const streams = $.const([
                { id: "milestones", name: "MILESTONES", marks: [
                    Plan.mark({ key: "kick", at: week(28n), kind: "milestone", label: "KICKOFF" }),
                    Plan.mark({ key: "d1", at: week(31n), kind: Plan.markKind.decision(true) }),
                    Plan.mark({ key: "rel", at: week(33n), kind: "milestone", label: "REL 2.4" }),
                    Plan.mark({ key: "audit", at: week(35n), kind: "exception", label: "AUDIT" }),
                    Plan.mark({ key: "d2", at: week(37n), kind: Plan.markKind.decision(false), label: "×3" }),
                ] },
            ], ArrayType(StreamRow));
            const slice = $.let(Slice.bind([HorizonRow], "ex.plan.target", cfg, Slice.state(), horizon, none));
            // The K8 journey resolver — called with an item key at interaction time.
            const journeys = $.const(East.function([StringType], Plan.Types.Journey, (_$2, item) => ({
                title: East.str`JOURNEY · ITEM ${item} · BORN 04 JUL · 118 T`,
                rows: [
                    { key: "anc", label: "B-208 · M05", sublabel: some("ancestor"),
                      runs: [Plan.run({ key: "a1", start: week(27n), end: week(29n), label: "RUN · 34 t", qty: 34, state: "actual" })] },
                    { key: "focus", label: "B-214 · M03", sublabel: some("focus item"),
                      runs: [Plan.run({ key: "f1", start: week(29n), end: week(33n), label: "RUN · 118 t", qty: 118, state: "in-progress" })] },
                    { key: "d60", label: "→ M04", sublabel: some("split 60%"),
                      runs: [Plan.run({ key: "s1", start: week(33n), end: week(35n), label: "DSP · 71 t", qty: 71, state: "recommended" })] },
                ],
                ribbons: [
                    { fromRow: "anc", fromRun: "a1", toRow: "focus", toRun: "f1", quantity: 34.0, label: "34 t" },
                    { fromRow: "focus", fromRun: "f1", toRow: "d60", toRun: "s1", quantity: 71.0, label: "71 t" },
                ],
                decisions: [Plan.decision({ key: "split", at: week(33n), applied: false })],
            })));
            // The generalized element resolvers — ONE stored popover / hover
            // function each over Plan.Types.ElementRef (refs carry the row
            // key on every arm); rich bodies build lazily at interaction
            // time, and a none result opens no surface.
            const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
                const noBody = $2.const(none, OptionType(UIComponentType));
                return ref.match({
                    run: (_$3, ev) => ev.run.equal("b221").ifElse(
                        () => some(<Text>Proposed by run 412 — fills the W32 idle window.</Text>),
                        () => noBody),
                    mark: (_$3, ev) => ev.row.equal("L1-M03").and(() => ev.mark.equal("d1")).ifElse(
                        () => some(<Text>Schedule B-221</Text>),
                        () => noBody),
                }, _$3 => noBody);
            }));
            const hover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
                const noBody = $2.const(none, OptionType(UIComponentType));
                return ref.match({
                    run: (_$3, ev) => ev.run.equal("b197").ifElse(
                        () => some(<Text>Waiting on QC gate 4 — 2.6× median dwell.</Text>),
                        () => noBody),
                }, _$3 => noBody);
            }));
            // Behavior props — bound once so memoized renderers keep identity.
            const onRowRef = $.const(East.function([Plan.Types.RowRef], NullType, (_$2, _r) => null));
            const onRunClick = $.const(East.function([Plan.Types.RunClickEvent], NullType, (_$2, _e) => null));
            const onGroupToggle = $.const(East.function([Plan.Types.GroupToggleEvent], NullType, (_$2, _e) => null));
            const onBatch = $.const(East.function([], NullType, (_$2) => null));
            return (
                <Plan
                    slice={{ slice, affordances: ["cohort", "filter", "search", "range", "resolution", "brush", "summary"] }}
                    axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", resolutions: ["month", "week", "day"], now: week(31n) })}
                    // The link graph (R1) — the W31 −24 t transfer: hover a
                    // linked machine for the links-focus control.
                    links={[
                        Plan.link({ from: "L1-M03", fromRun: "b214", to: "L1-M04", toRun: "qc", quantity: 24, label: "−24 t" }),
                    ]}
                    rows={[
                        // K3 · pinned KPI chart — singular chrome; charts are
                        // data-driven through their layers already.
                        Plan.chart({
                            key: "coverage", label: "COVERAGE", id: true, pinned: true,
                            value: "94.2%", status: "warning", height: "spark", expandable: true,
                            layers: [
                                Plan.layer(Chart.Line(coverage, { x: r => r.week, y: r => r.pct }), { breach: { below: 92 } }),
                                Chart.refLine({ y: 100, label: "TARGET 100" }),
                            ],
                        }),
                        // K1 · the machines, Table-style: data + accessors; the
                        // literal group is mock chrome around the data-driven rows.
                        Plan.group({
                            key: "line1", label: "Line 1", meta: "8 rs · 82%",
                            rows: Plan.span.of(machines, {
                                key: r => r.id, label: r => r.id, id: true,
                                value:  r => some(East.str`${East.Float.printFixed(r.cap, 0n)} t`),
                                status: r => r.status,          // Option<Status> straight from the row
                                drill:  r => r.drill,           // only M04 carries a payload
                                runs: r => r.runs, decisions: r => r.decisions, ports: r => r.ports,
                            }),
                        }),
                        // K4 · the collapsed Line 2 heat strip (mean summary).
                        Plan.group({
                            key: "line2", label: "Line 2", value: "98%", status: "warning", collapsed: true, summaryAggregate: "mean",
                            rows: [
                                Plan.heat({
                                    key: "l2-load", label: "L2 load", sub: "%/wk",
                                    cells: Plan.heatCells(
                                        East.Array.generate(12n, Plan.Types.HeatCell, (_$2, i) => ({
                                            at: week(i.add(27n)), value: some(loadPcts.get(i)),
                                            label: some(East.Float.printFixed(loadPcts.get(i), 0n)),
                                        })),
                                        { min: 0, max: 100, warnAt: 95 },
                                    ),
                                }),
                            ],
                        }),
                        // K2 · docks — data rows through the plain factory (the
                        // Gantt rowSpec shape); element arrays pass through IR-typed.
                        Plan.group({
                            key: "docks", label: "Docks · In", meta: "3 rs",
                            rows: Plan.rows(dockRows, (_$2, d) => Plan.buckets({
                                key: d.id, label: d.label, value: "load/wk",
                                lanes: d.lanes, events: d.events, markers: d.markers,
                            })),
                        }),
                        // K6 · crews (Roster chips).
                        Plan.rows(crews, (_$2, c) => Plan.cards({
                            key: c.id, label: c.name, sub: c.hours, stacked: true, chips: c.chips,
                        })),
                        // K7 · the milestone stream.
                        Plan.rows(streams, (_$2, s) => Plan.events({
                            key: s.id, label: s.name, id: true, value: East.print(s.marks.length()), marks: s.marks,
                        })),
                    ]}
                    review={{
                        summary: <Text>4 JOBS · 2 FLAGGED NEED A CALL · +6H FLOAT</Text>,
                        onApprove: onRowRef,
                        onReject: onRowRef,
                        onApproveAll: onBatch,
                        onRejectAll: onBatch,
                        onRerun: onBatch,
                    }}
                    journeys={journeys}
                    popover={popover}
                    hover={hover}
                    onSelect={onRowRef}
                    onDrill={onRowRef}
                    onRunClick={onRunClick}
                    onGroupToggle={onGroupToggle}
                    footer={[
                        { text: "512 RESOURCES · 12 GROUPS · 3 IN VIEW" },
                        { text: "318 OBSERVED · 966 PLANNED" },
                        { text: "3 EXCEPTIONS", tone: "warning" },
                        { text: "RUN 412 · W27–W38", end: true },
                    ]}
                />
            );
        }}</Reactive>);
    }),
    inputs: [],
});

// ============================================================================
// planVariants — THE configurator (preset axis over the row kinds)
// ============================================================================

// ============================================================================
// Per-kind examples — one canvas per row kind, one row per config variant
// ============================================================================

export const planSpanRows = example({
    keywords: ["Plan", "span", "run", "state", "estimated", "removed", "rejected", "decision", "port", "rollup", "union", "byStatus", "of", "groupBy", "nested", "bands", "unit", "group", "meta", "stacked", "gutter", "links", "link", "focus", "expand", "render"],
    description: "Span-row configs — the proposal flavours (forecast ghost, proposed cut, declined) on a single-line value gutter, quantities with a decision diamond and a port on a stacked two-line gutter (this row also declares expand-in-place — pure data; the root's expandRender resolver mounts the body — and sits in the link graph, so hovering it shows the links/expand controls), a nested union rollup parent with a meta tag (renderer-derived ×k bands), and the span.of byStatus form inside a group strip",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
            const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const MachineRow = StructType({ id: StringType, program: StringType, runs: ArrayType(Plan.Types.Run) });
        const machines = $.const([
            { id: "L1-M03", program: "Program A", runs: [
                Plan.run({ key: "b214", start: week(28n), end: week(31n), label: "RUN · B-214", qty: 96, state: "actual" }),
                Plan.run({ key: "b221", start: week(32n), end: week(35n), label: "RUN · B-221", qty: 88, state: "recommended" }),
            ] },
            { id: "L2-M11", program: "Program B", runs: [
                Plan.run({ key: "b241", start: week(29n), end: week(33n), label: "RUN · B-241", qty: 92, state: "confirmed" }),
            ] },
        ], ArrayType(MachineRow));
        // The R2 developer render — the ROOT's expandRender resolver, called
        // with the focused row's ref; ONE function serves every declaring row.
        const util = $.let(East.Array.generate(8n, MeasureRow, (_$2, i) =>
            ({ week: week(i.add(27n)), pct: i.multiply(13n).remainder(40n).toFloat().add(55.0) })));
        const expandRender = $.const(East.function([Plan.Types.RowRef], UIComponentType, (_$2, _ref) => (
            <Chart layers={[Chart.Column(util, { x: r => r.week, y: r => r.pct })]} height={100} grid={false} />
        )));
        // The generalized popover resolver — decision diamonds ride the mark
        // arm of the element ref.
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
            const noBody = $2.const(none, OptionType(UIComponentType));
            return ref.match({
                mark: (_$3, ev) => ev.mark.equal("d1").ifElse(
                    () => some(<Text>Approved by run 411.</Text>),
                    () => noBody),
            }, _$3 => noBody);
        }));
        return (
            <Plan
                expandRender={expandRender}
                popover={popover}
                // A denser gutter (meta + value + carets) — widen it (the
                // shared CSS-px height/width vocabulary).
                style={{ gutterWidth: "200px" }}
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                // The link graph (R1) — hover a linked row for the ⌁ control:
                // focusing gathers its transitive upstream/downstream family.
                // The edges deliberately cover the routing permutations:
                // cross-row overlaps (loopbacks), a same-row seam feed, an
                // upward loopback, and an off-window landing.
                links={[
                    Plan.link({ from: "m07", fromRun: "run", to: "m09", toRun: "a", quantity: 24, label: "24 t" }),
                    // Same-row: B-208's output feeds B-231 at the W31 seam.
                    Plan.link({ from: "m09", fromRun: "a", to: "m09", toRun: "b", quantity: 40, label: "40 t" }),
                    Plan.link({ from: "m09", fromRun: "b", to: "L1-M03", toRun: "b221", quantity: 88, label: "88 t" }),
                    // Adjacent rows under the rollup parent, overlapping runs.
                    Plan.link({ from: "L1-M03", fromRun: "b214", to: "L2-M11", toRun: "b241", quantity: 32, label: "32 t" }),
                    // Upward, several rows apart, overlapping — the rising loop.
                    Plan.link({ from: "L2-M11", fromRun: "b241", to: "m09", toRun: "b", quantity: 18, label: "18 t" }),
                    // A link landing BEYOND the window — the ribbon meets a
                    // runoff-style fade band at the despatch row's edge.
                    Plan.link({ from: "m09", fromRun: "b", to: "dsp", toRun: "d1", quantity: 91, label: "91 t" }),
                ]}
                rows={[
                    // Proposal flavours: forecast ghost · proposed cut · declined.
                    Plan.span({
                        key: "m07", label: "L1-M07", id: true, value: "80 t",
                        runs: [
                            Plan.run({ key: "run", start: week(27n), end: week(30n), label: "RUN · B-197", quantity: "64 t", state: "in-progress" }),
                            Plan.run({ key: "gho", start: week(30n), end: week(32n), label: "FORECAST", state: "estimated" }),
                            Plan.run({ key: "rem", start: week(33n), end: week(35n), label: "CUT", state: "removed" }),
                            Plan.run({ key: "rej", start: week(36n), end: week(38n), label: "DECLINED", state: "rejected" }),
                        ],
                    }),
                    // Quantities + an applied decision diamond + a quantity
                    // port, on a stacked two-line gutter (label over sub).
                    Plan.span({
                        key: "m09", label: "L1-M09", id: true, sub: "cap 120 t", stacked: true,
                        // R2 — pure data: the declaration marks the row
                        // expandable; the root's expandRender mounts below.
                        expand: { height: "152px", axis: "dim" },
                        runs: [
                            Plan.run({ key: "a", start: week(27n), end: week(31n), label: "RUN · B-208", quantity: "112 t", qty: 112, state: "actual" }),
                            Plan.run({ key: "b", start: week(31n), end: week(34n), label: "RUN · B-231", quantity: "104 t", qty: 104, state: "recommended" }),
                        ],
                        decisions: [Plan.decision({ key: "d1", at: week(31n), applied: true })],
                        ports: [Plan.port({ at: week(31n), label: "−24 t" })],
                    }),
                    // A nested union rollup parent — meta tags the member
                    // count; the ×k bands derive in the renderer.
                    Plan.span({
                        key: "prog-a", label: "Program A", value: "184 t", meta: "2 rs", rollup: "union", unit: "t",
                        rows: Plan.rows(machines, (_$2, m) => Plan.span({
                            key: m.id, label: m.id, id: true, runs: m.runs,
                        })),
                    }),
                    // Linked despatch whose run starts BEYOND the window —
                    // in links focus its landing renders as the edge fade.
                    Plan.span({
                        key: "dsp", label: "DESPATCH", id: true,
                        runs: [Plan.run({ key: "d1", start: week(39n), end: week(42n), label: "DSP · 91 t", qty: 91, state: "recommended" })],
                    }),
                    // The accessor form INSIDE a group strip: one byStatus
                    // rollup parent per program under the group band.
                    Plan.group({
                        key: "line2", label: "Line 2", meta: "2 rs",
                        rows: Plan.span.of(machines, {
                            key: r => r.id, label: r => r.id, id: true,
                            runs: r => r.runs,
                            groupBy: [r => r.program], rollup: "byStatus", unit: "t",
                        }),
                    }),
                ]}
            />
        );
    }),
    inputs: [],
});

export const planBucketRows = example({
    keywords: ["Plan", "buckets", "Planner", "lane", "lanes", "AM", "PM", "event", "tile", "marker", "tone", "stretch", "pulse", "icon", "hovercard", "popover", "mixed", "unbucketed", "group", "meta", "gutter"],
    description: "Bucket-row configs — an unbucketed weekly dock of resting ✓/plan tiles on a single-line value gutter, and an AM/PM-laned dock (two-line sub gutter) inside a meta-tagged group strip, carrying the full Planner tile grammar: tones, a pulsing proposal, a full-cell mixed tile, an icon tile with a popover, and a cell marker ring",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
            const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        // The generalized resolvers — tiles ride the event arm of the ref.
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
            const noBody = $2.const(none, OptionType(UIComponentType));
            return ref.match({
                event: (_$3, ev) => ev.event.equal("m5").ifElse(
                    () => some(<Text>Load 41 · 8 pallets</Text>),
                    () => noBody),
            }, _$3 => noBody);
        }));
        const hover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
            const noBody = $2.const(none, OptionType(UIComponentType));
            return ref.match({
                event: (_$3, ev) => ev.event.equal("m3").ifElse(
                    () => some(<Text>Urgent — overtime window</Text>),
                    () => noBody),
            }, _$3 => noBody);
        }));
        return (
            <Plan
                popover={popover}
                hover={hover}
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                rows={[
                    // Unbucketed: one slot per week column; resting tiles.
                    Plan.buckets({
                        key: "dock2", label: "Dock 2", value: "load/wk",
                        events: East.Array.generate(6n, Plan.Types.BucketEvent, ($2, i) => {
                            const confirmed = $2.const(variant("confirmed", null), EventStateType);
                            const recommended = $2.const(variant("proposed", variant("recommended", null)), EventStateType);
                            return Plan.event({
                                key: East.str`a${East.print(i)}`,
                                at: week(i.add(27n)),
                                state: i.remainder(3n).equal(2n).ifElse(() => recommended, () => confirmed),
                            });
                        }),
                        markers: [Plan.marker({ at: week(29n), status: "warning", message: "capacity 90%" })],
                    }),
                    // The AM/PM-laned dock inside a meta-tagged group strip;
                    // its sub line makes the two-line gutter.
                    Plan.group({
                        key: "outbound", label: "Docks · Out", meta: "1 rs",
                        rows: [Plan.buckets({
                            key: "dock5", label: "Dock 5", sub: "day · am/pm",
                            lanes: [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                            events: [
                                Plan.event({ key: "m1", at: week(27n), lane: "am", state: "confirmed" }),
                                Plan.event({ key: "m2", at: week(27n), lane: "pm", state: "confirmed", tone: "warning" }),
                                Plan.event({ key: "m3", at: week(28n), lane: "am", state: "recommended", animation: "pulse" }),
                                Plan.event({ key: "m4", at: week(29n), label: "MIXED", state: "confirmed", stretch: "horizontal", content: { horizontal: "center" } }),
                                Plan.event({ key: "m5", at: week(30n), lane: "pm", state: "recommended", icon: "truck" }),
                                Plan.event({ key: "m6", at: week(31n), lane: "am", label: "QC", state: "estimated" }),
                            ],
                            markers: [Plan.marker({ at: week(29n), status: "danger", message: "capacity breach" })],
                        })],
                    }),
                ]}
            />
        );
    }),
    inputs: [],
});

export const planChartRows = example({
    keywords: ["Plan", "chart", "layers", "spark", "expanded", "fixed", "refLine", "refBand", "refDot", "breach", "stacked", "series", "dual-axis", "swatches", "Area", "Band", "Scatter", "Column", "Line", "domain", "tickValues", "group", "meta", "gutter"],
    description: "Chart-row configs — one row per mark kind, each over its own series: a Line spark with a breach threshold, an Area cumulative fill, stacked Columns pairing two distinct series on a two-line sub gutter, a Scatter defect cloud, an expanded Line with refLine/refBand/refDot annotations, and a fixed 120px dual-axis composition (Chart.Root's domain/tickValues axis vocabulary) mixing Columns left with a Line + confidence Band right, inside a meta-tagged group strip",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
            const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const BandRow = StructType({ week: DateTimeType, lo: FloatType, hi: FloatType });
        // One derived series per mark: the coverage %, a cumulative output
        // ramp, two distinct line outputs, and a jittery defect cloud.
        const pcts = $.const([96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2], ArrayType(FloatType));
        const coverage = $.let(East.Array.generate(12n, MeasureRow, (_$2, i) => ({ week: week(i.add(27n)), pct: pcts.get(i) })));
        const cum = $.let(East.Array.generate(12n, MeasureRow, (_$2, i) => ({ week: week(i.add(27n)), pct: i.toFloat().multiply(14.0).add(40.0) })));
        const out1 = $.let(East.Array.generate(12n, MeasureRow, (_$2, i) => ({ week: week(i.add(27n)), pct: i.multiply(23n).remainder(17n).toFloat().add(28.0) })));
        const out2 = $.let(East.Array.generate(12n, MeasureRow, (_$2, i) => ({ week: week(i.add(27n)), pct: i.multiply(31n).remainder(13n).toFloat().add(14.0) })));
        const ppm = $.let(East.Array.generate(12n, MeasureRow, (_$2, i) => ({ week: week(i.add(27n)), pct: i.multiply(37n).remainder(60n).toFloat().add(120.0) })));
        const band = $.let(East.Array.generate(12n, BandRow, (_$2, i) => ({ week: week(i.add(27n)), lo: pcts.get(i).subtract(3.0), hi: pcts.get(i).add(3.0) })));
        return (
            <Plan
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                rows={[
                    // Line — the KPI spark with a breach threshold; the caret
                    // opens it to a custom 120px (expandedHeight, default 88).
                    Plan.chart({
                        key: "spark", label: "COVERAGE", id: true, value: "94.2%", status: "warning",
                        height: "spark", expandable: true, expandedHeight: "120px",
                        layers: [Plan.layer(Chart.Line(coverage, { x: r => r.week, y: r => r.pct }), { breach: { below: 92 } })],
                    }),
                    // Area — the cumulative fill.
                    Plan.chart({
                        key: "cum", label: "CUMULATIVE · t", id: true, value: "194 t",
                        layers: [Chart.Area(cum, { x: r => r.week, y: r => r.pct })],
                    }),
                    // Columns — two DISTINCT series stacked by one `stack` id,
                    // on a two-line gutter (label over sub).
                    Plan.chart({
                        key: "stacked", label: "OUTPUT · t", id: true, sub: "t/wk", stacked: true,
                        layers: [
                            Chart.Column(out1, { x: r => r.week, y: r => r.pct }, { stack: "out", key: "L1" }),
                            Chart.Column(out2, { x: r => r.week, y: r => r.pct }, { stack: "out", key: "L2" }),
                        ],
                    }),
                    // Scatter — the defect cloud.
                    Plan.chart({
                        key: "ppm", label: "DEFECTS · ppm", id: true, value: "161",
                        layers: [Chart.Scatter(ppm, { x: r => r.week, y: r => r.pct })],
                    }),
                    // Line + every annotation kind, at expanded density.
                    Plan.chart({
                        key: "refs", label: "COVERAGE + REFS", id: true, height: "expanded",
                        layers: [
                            Plan.layer(Chart.Line(coverage, { x: r => r.week, y: r => r.pct }), { breach: { below: 92 } }),
                            Chart.refLine({ y: 100, label: "TARGET 100" }),
                            Chart.refBand({ x: [week(34n), week(36n)], label: "CRUNCH" }),
                            Chart.refDot({ x: week(36n), y: 91.4, label: "LOW" }),
                        ],
                    }),
                    // The composed dual-axis chart inside a meta-tagged group;
                    // axes take Chart.Root's vocabulary — domain / tickValues.
                    // Output columns scale left; the coverage line + its
                    // confidence band scale right.
                    Plan.group({
                        key: "quality", label: "Quality", meta: "1 rs",
                        rows: [Plan.chart({
                            key: "dual", label: "OUT + COVERAGE", id: true, height: Plan.fixed("120px"),
                            left: { domain: [0, 60], tickValues: [0, 25, 50] }, right: { domain: [80, 105], tickValues: [85, 95, 105] },
                            swatches: [{ color: "ink.3", label: "out" }, { color: "brand.d", label: "cov · rh" }],
                            layers: [
                                Chart.Column(out1, { x: r => r.week, y: r => r.pct }),
                                Plan.layer(Chart.Line(coverage, { x: r => r.week, y: r => r.pct }), { axis: "right" }),
                                Plan.layer(Chart.Band(band, { x: r => r.week, low: r => r.lo, high: r => r.hi }), { axis: "right" }),
                            ],
                        })],
                    }),
                ]}
            />
        );
    }),
    inputs: [],
});

export const planHeatRows = example({
    keywords: ["Plan", "heat", "Matrix", "cells", "depth", "aggregate", "mean", "scale", "warnAt", "weightCells", "segmentCells", "segment", "no-data", "hatch", "group", "meta", "gutter"],
    description: "Heat-row configs — colour-depth cells with a warn ring and a no-data hatch under a meta-tagged aggregate-mean parent (renderer-derived), booked-vs-free weight bars with a planned tail on a two-line sub gutter, and status-segment compositions inside a group strip",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
            const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const pcts = $.const(
            [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0],
            ArrayType(FloatType));
        const cells = $.let(East.Array.generate(12n, Plan.Types.HeatCell, (_$2, i) => ({
            at: week(i.add(27n)),
            value: i.equal(4n).ifElse(() => none, () => some(pcts.get(i))),   // W31 = no data
            label: i.equal(4n).ifElse(() => none, () => some(East.Float.printFixed(pcts.get(i), 0n))),
        })));
        return (
            <Plan
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                rows={[
                    // Aggregate parent (mean, DECLARED — cells derive in the
                    // renderer) with the meta tag; leaves are single-line ids.
                    Plan.heat({
                        key: "line1", label: "Line 1", meta: "2 rs", aggregate: "mean", scale: { min: 0, max: 100, warnAt: 95 },
                        rows: [
                            Plan.heat({ key: "m03h", label: "L1-M03", id: true, cells: Plan.heatCells(cells, { min: 0, max: 100, warnAt: 95 }) }),
                            Plan.heat({ key: "m04h", label: "L1-M04", id: true, cells: Plan.heatCells(cells, { min: 0, max: 100, warnAt: 95 }) }),
                        ],
                    }),
                    // Booked-vs-free weight bars on a two-line sub gutter; the
                    // planned tail renders pale.
                    Plan.heat({
                        key: "booked", label: "Crew A", sub: "booked h",
                        cells: Plan.weightCells(East.Array.generate(6n, Plan.Types.WeightCell, (_$2, i) => ({
                            at: week(i.multiply(2n).add(27n)),
                            fraction: i.toFloat().multiply(-0.11).add(0.9),
                            planned: i.greaterEqual(3n),
                        }))),
                    }),
                    // Status-segment compositions inside a group strip.
                    Plan.group({
                        key: "packing", label: "Packing", meta: "1 rs",
                        rows: [Plan.heat({
                            key: "pack", label: "Pack line", sub: "capacity",
                            cells: Plan.segmentCells([
                                { at: week(27n), segments: [Plan.segment({ fill: "success", weight: 60, label: "60%" }), Plan.segment({ fill: "warning", weight: 25, label: "25%" }), Plan.segment({ fill: "slack", weight: 15 })] },
                                { at: week(28n), segments: [Plan.segment({ fill: "success", weight: 70, label: "70%" }), Plan.segment({ fill: "slack", weight: 30 })] },
                                { at: week(29n), segments: [Plan.segment({ fill: "danger", weight: 40, label: "40%" }), Plan.segment({ fill: "free", weight: 60 })] },
                            ]),
                        })],
                    }),
                ]}
            />
        );
    }),
    inputs: [],
});

export const planTableRows = example({
    keywords: ["Plan", "table", "cells", "tableCells", "subtotal", "aggregate", "sum", "format", "emphasis", "footer", "of", "groupBy", "nested", "depth", "em-dash", "neg", "group", "meta", "gutter", "series", "tableSeries", "split", "horizontal", "vertical", "multi-value", "strong", "muted", "rollup"],
    description: "Table-row configs — three-level nesting under a two-line parent gutter (Despatches → Program A → order leaves; every declared level derives its subtotal from the level below), a footer-emphasis net line with a negative tone and the muted em-dash, multi-series cells (per-POSITION style declared once per series — a strong actual beside a muted signed Δ, horizontal; and a vertical stack that grows the row), and the table.of accessor form inside a group strip (section/program parents print their aggregate-tag meta)",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
            const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const RawCell = StructType({ at: DateTimeType, value: OptionType(FloatType) });
        const OrderRow = StructType({ key: StringType, name: StringType, section: StringType, program: StringType, raw: ArrayType(RawCell) });
        const raw = $.let(East.Array.generate(12n, RawCell, (_$2, i) => ({
            at: week(i.add(27n)),
            value: i.equal(9n).ifElse(() => none, () => some(i.toFloat().multiply(7.0).add(40.0))),
        })));
        const orders = $.let([
            { key: "s1", name: "OR-1188", section: "Orders", program: "Program A", raw },
            { key: "s2", name: "OR-1204", section: "Orders", program: "Program A", raw },
            { key: "s3", name: "OR-1219", section: "Orders", program: "Program B", raw },
            { key: "s4", name: "RT-0031", section: "Returns", program: "Program B", raw },
        ], ArrayType(OrderRow));
        return (
            <Plan
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                rows={[
                    // THREE declared levels — Despatches derives from Program
                    // A's DERIVED subtotal plus Program B's leaf cells; every
                    // row's numerals print through the shared Format spec. The
                    // top parent takes the two-line sub gutter.
                    Plan.table({
                        key: "despatch", label: "Despatches", sub: "t/wk", aggregate: "sum",
                        format: Format.Number({ maximumFractionDigits: 0n }),
                        rows: [
                            Plan.table({
                                key: "prog-a", label: "Program A", aggregate: "sum",
                                format: Format.Number({ maximumFractionDigits: 0n }),
                                rows: [
                                    Plan.table({ key: "or-1188", label: "OR-1188", cells: Plan.tableCells(raw),
                                        format: Format.Number({ maximumFractionDigits: 0n }) }),
                                    Plan.table({ key: "or-1204", label: "OR-1204", cells: Plan.tableCells(raw),
                                        format: Format.Number({ maximumFractionDigits: 0n }) }),
                                ],
                            }),
                            Plan.table({ key: "prog-b", label: "Program B", cells: Plan.tableCells(raw),
                                format: Format.Number({ maximumFractionDigits: 0n }) }),
                        ],
                    }),
                    // Footer emphasis + negative tone + the muted em-dash.
                    Plan.table({
                        key: "net", label: "Net flow", emphasis: "footer",
                        format: Format.Number({ maximumFractionDigits: 0n }),
                        cells: Plan.tableCells([
                            { at: week(27n), value: some(22.0) }, { at: week(28n), value: some(-26.0) },
                            { at: week(29n), value: none },
                        ]),
                    }),
                    // MULTI-SERIES cells — per-POSITION style declared ONCE on
                    // the series (wire-lean: cells stay raw floats). A strong
                    // actual beside its muted, always-signed plan Δ.
                    Plan.table({
                        key: "actplan", label: "Act · Δ plan", sub: "t/wk", stacked: true,
                        format: Format.Number({ maximumFractionDigits: 0n }),
                        series: [
                            Plan.tableSeries({ strong: true, rollup: true, cells: Plan.tableCells(raw) }),
                            Plan.tableSeries({
                                tone: "muted",
                                format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                                cells: Plan.tableCells(East.Array.generate(12n, RawCell, (_$2, i) => ({
                                    at: week(i.add(27n)),
                                    value: i.remainder(4n).equal(3n).ifElse(
                                        () => none,
                                        () => some(i.toFloat().multiply(1.5).subtract(8.0))),
                                }))),
                            }),
                        ],
                    }),
                    // The VERTICAL split stacks the positions; the row grows.
                    Plan.table({
                        key: "inout", label: "In / out", split: "vertical",
                        format: Format.Number({ maximumFractionDigits: 0n }),
                        series: [
                            Plan.tableSeries({ cells: Plan.tableCells(raw) }),
                            Plan.tableSeries({
                                tone: "muted",
                                cells: Plan.tableCells(East.Array.generate(12n, RawCell, (_$2, i) => ({
                                    at: week(i.add(27n)),
                                    value: some(i.toFloat().multiply(-3.0).subtract(12.0)),
                                }))),
                            }),
                        ],
                    }),
                    // The accessor form inside a group strip: two groupBy
                    // levels — subtotal parents per discovered section, then
                    // per program — each printing its aggregate-tag meta.
                    Plan.group({
                        key: "sections", label: "By section", meta: "4 rs",
                        rows: Plan.table.of(orders, {
                            key: r => r.key, label: r => r.name,
                            cells: r => Plan.tableCells(r.raw),
                            groupBy: [r => r.section, r => r.program], aggregate: "sum",
                            format: Format.Number({ maximumFractionDigits: 0n }),
                        }),
                    }),
                ]}
            />
        );
    }),
    inputs: [],
});

export const planCardRows = example({
    keywords: ["Plan", "cards", "Roster", "chip", "lifecycle", "confirmed", "recommended", "removed", "estimated", "icon", "popover", "stacked", "format", "axis", "group", "meta", "gutter"],
    description: "Cards-row configs — the chip lifecycle (confirmed tint, proposed dashed, removed strikethrough, estimated ghost) with an icon chip and a popover, on a stacked two-line gutter, plus a single-line value row inside a meta-tagged group strip, under a custom `axis.format` ruler (date-pattern tokens instead of the ISO-week default)",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
            const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        // The generalized popover resolver — chips ride the chip arm.
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
            const noBody = $2.const(none, OptionType(UIComponentType));
            return ref.match({
                chip: (_$3, ev) => ev.chip.equal("s3").ifElse(
                    () => some(<Text>Overtime proposal.</Text>),
                    () => noBody),
            }, _$3 => noBody);
        }));
        return (
            <Plan
                popover={popover}
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n), format: "D MMM" })}
                rows={[
                    Plan.cards({
                        key: "crewA", label: "Crew A", sub: "152h → 168h", stacked: true,
                        chips: [
                            Plan.chip({ key: "s1", from: week(27n), to: week(29n), label: "80h", state: "confirmed", icon: "user-group" }),
                            Plan.chip({ key: "s2", from: week(29n), to: week(31n), label: "56h", state: "removed" }),
                            Plan.chip({ key: "s3", from: week(31n), to: week(33n), label: "+64h", state: "recommended" }),
                            Plan.chip({ key: "s4", from: week(34n), to: week(35n), label: "48h", state: "estimated" }),
                        ],
                    }),
                    // A single-line value row inside a meta-tagged group strip.
                    Plan.group({
                        key: "pool", label: "Relief pool", meta: "1 rs",
                        rows: [Plan.cards({
                            key: "crewB", label: "Crew B", value: "128h",
                            chips: [
                                Plan.chip({ key: "b1", from: week(28n), to: week(31n), label: "96h", state: "confirmed" }),
                                Plan.chip({ key: "b2", from: week(33n), to: week(36n), label: "+32h", state: "recommended" }),
                            ],
                        })],
                    }),
                ]}
            />
        );
    }),
    inputs: [],
});

export const planEventRows = example({
    keywords: ["Plan", "events", "mark", "milestone", "decision", "exception", "markKind", "applied", "icon", "label", "popover", "group", "meta", "stacked", "gutter"],
    description: "Event-row configs — milestone dots, pending and applied decision diamonds, an exception triangle, a custom FA glyph swap and a clustered ×3 label on a single-line gutter, plus a stacked two-line release stream inside a meta-tagged group strip",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
            const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        // The generalized popover resolver — event marks ride the mark arm.
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
            const noBody = $2.const(none, OptionType(UIComponentType));
            return ref.match({
                mark: (_$3, ev) => ev.mark.equal("rel").ifElse(
                    () => some(<Text>Go/no-go review.</Text>),
                    () => noBody),
            }, _$3 => noBody);
        }));
        return (
            <Plan
                popover={popover}
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                rows={[
                    Plan.events({
                        key: "ms", label: "MILESTONES", id: true, value: "5",
                        marks: [
                            Plan.mark({ key: "kick", at: week(28n), kind: "milestone", label: "KICKOFF" }),
                            Plan.mark({ key: "d1", at: week(31n), kind: Plan.markKind.decision(true) }),
                            Plan.mark({ key: "rel", at: week(33n), kind: "milestone", icon: "rocket", label: "REL 2.4" }),
                            Plan.mark({ key: "audit", at: week(35n), kind: "exception", label: "AUDIT" }),
                            Plan.mark({ key: "d2", at: week(37n), kind: Plan.markKind.decision(false), label: "×3" }),
                        ],
                    }),
                    // A stacked two-line stream inside a meta-tagged group.
                    Plan.group({
                        key: "programs", label: "Programs", meta: "1 rs",
                        rows: [Plan.events({
                            key: "release", label: "RELEASES", id: true, sub: "6-wk cadence", stacked: true,
                            marks: [
                                Plan.mark({ key: "r1", at: week(29n), kind: "milestone", label: "2.3" }),
                                Plan.mark({ key: "r2", at: week(36n), kind: "milestone", label: "2.4" }),
                            ],
                        })],
                    }),
                ]}
            />
        );
    }),
    inputs: [],
});

export const planGroupedRows = example({
    keywords: ["Plan", "group", "groups", "strip", "summary", "summaryAggregate", "collapsed", "rows", "groupBy", "heterogeneous", "meta", "nesting"],
    description: "Group configs — a literal expanded group with meta chrome around mixed kinds, a collapsed group resting as its DECLARED mean strip, and the Plan.rows grouped form discovering group strips from data",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
            const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const LineRow = StructType({ id: StringType, line: StringType, cells: ArrayType(Plan.Types.HeatCell) });
        const pcts = $.const(
            [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0],
            ArrayType(FloatType));
        const cells = $.let(East.Array.generate(12n, Plan.Types.HeatCell, (_$2, i) => ({
            at: week(i.add(27n)), 
            value: some(pcts.get(i)), 
            label: some(East.Float.printFixed(pcts.get(i), 0n)),
        })));
        const lines = $.let([
            { id: "L1-M03", line: "Line 1", cells },
            { id: "L1-M04", line: "Line 1", cells },
            { id: "L2-M11", line: "Line 2", cells },
        ], ArrayType(LineRow));
        return (
            <Plan
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                rows={[
                    // Literal group chrome around mixed kinds.
                    Plan.group({
                        key: "line1", label: "Line 1", meta: "2 rs · 82%",
                        rows: [
                            Plan.span({ key: "m03", label: "L1-M03", id: true, runs: [
                                Plan.run({ key: "r", start: week(28n), end: week(31n), label: "RUN · B-214", state: "in-progress" }),
                            ] }),
                            Plan.heat({ key: "m03h", label: "L1-M03 load", cells: Plan.heatCells(cells, { min: 0, max: 100 }) }),
                        ],
                    }),
                    // Collapsed, resting as its DECLARED mean strip.
                    Plan.group({
                        key: "line2", label: "Line 2", value: "98%", status: "warning", collapsed: true, summaryAggregate: "mean",
                        rows: [Plan.heat({ key: "l2", label: "L2 load", cells: Plan.heatCells(cells, { min: 0, max: 100, warnAt: 95 }) })],
                    }),
                    // Data-driven: one strip per discovered line value.
                    Plan.rows(lines, {
                        groupBy: [{ by: r => r.line, collapsed: true }],
                        summaryAggregate: "mean",
                        row: (_$2, r) => Plan.heat({ key: r.id, label: r.id, id: true, cells: Plan.heatCells(r.cells) }),
                    }),
                ]}
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// planLibraryDnd — row-library composition (the DnD behavioral isolate)
// ============================================================================

export const planLibraryDnd = example({
    keywords: [
        "Plan", "library", "template", "make", "binding", "DnD", "drag", "drop",
        "onDrag", "canDrop", "sources", "add", "reorder", "compose",
    ],
    description: "Row-library composition — templates carrying their binding via make(), the Plan declared as a DnD target with the shared onDrag funnel and a canDrop veto",
    fn: East.function([], UIComponentType, ($) => {
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const ShiftRow = StructType({
            key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
        });
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
            const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const loadPcts = $.const([46.0, 58.0, 66.0, 78.0, 90.0, 98.0], ArrayType(FloatType));
        const load = $.let(East.Array.generate(6n, MeasureRow, (_$2, i) =>
            ({ week: week(i.multiply(2n).add(27n)), pct: loadPcts.get(i) })));
        const shifts = $.const([
            { key: "s1", from: week(27n), to: week(29n), label: "80h", state: variant("confirmed", null) },
            { key: "s2", from: week(31n), to: week(33n), label: "+64h", state: variant("proposed", variant("recommended", null)) },
        ], ArrayType(ShiftRow));
        // Templates carry their BINDING: `make` builds the live subtree from
        // the captured data, so a dropped row renders immediately.
        const makeUtil = $.const(East.function([], ArrayType(Plan.Types.Row), (_$2) =>
            Plan.chart({
                key: "util", label: "UTIL %", id: true, height: "spark",
                layers: [Chart.Column(load, { x: r => r.week, y: r => r.pct })],
            })));
        const makeCrew = $.const(East.function([], ArrayType(Plan.Types.Row), (_$2) =>
            Plan.cards({
                key: "crew", label: "Crew A", sub: "152h", stacked: true,
                chips: shifts.map((_$3, s) => Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
            })));
        const onDrag = $.const(East.function([DragEventType], NullType, (_$2, _e) => null));
        const canDrop = $.const(East.function([DragEventType], BooleanType, (_$2, _e) => true));
        return (
            <Plan
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                rows={[
                    Plan.span({
                        key: "m03", label: "L1-M03", id: true,
                        runs: [Plan.run({ key: "r", start: week(28n), end: week(31n), label: "RUN · B-214", state: "in-progress" })],
                    }),
                ]}
                library={[
                    Plan.template({ key: "util", label: "Chart", sublabel: "utilisation %", kind: "chart", make: makeUtil }),
                    Plan.template({ key: "crew", label: "Cards", sublabel: "crew assignments", kind: "cards", icon: "user-group", make: makeCrew }),
                ]}
                id="plan" sources={["row-library"]}
                onDrag={onDrag}
                canDrop={canDrop}
            />
        );
    }),
    inputs: [],
});
