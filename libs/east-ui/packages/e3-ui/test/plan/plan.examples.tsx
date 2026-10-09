/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

import {
    ArrayType,
    BooleanType,
    DateTimeType,
    DictType,
    East,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    RecursiveType,
    StringType,
    StructType,
    VariantType,
    example,
    none,
    some,
    variant,
} from "@elaraai/east";
import { DragEventType, Editing, EventStateType, State, StatusValueType, Style, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Button, Chart, Configurator, Format, HStack, Progress, Reactive, SegmentGroup, Select, Slice, Sparkline, Text, VStack } from "@elaraai/east-ui";
import { Data, Plan, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// The corpus — every canvas is DEFINED the one way (`Plan Data Interface.md`
// §3.5): `data` (RAW domain rows — print jobs, sheets, lifecycle states; row
// series discriminated by a field; no factory-built values in the data) +
// `series` (one `Plan.series.*` value per row series, `$.const`-bound and typed
// by the `Plan.Types.Series(Row)` constructor — its accessors DERIVE the
// canvas vocabulary from the raw fields client-side: labels, quantity
// displays, element values via the `Plan.run`/`chip`/`event` expression
// builders) + the root RESOLVER functions (`popover` / `hover` /
// `expandRender`). The series list IS the layout — one block per series, top
// to bottom — and hierarchy comes only from the data's own nesting (#822): a
// series' `children` walk what an entry holds, and a flat source is grouped in
// a data step first (`groupToDicts`). A row's id is its series and the path of
// entry keys to it (`Plan.ref`). The kind factories are subtree vocabulary only
// — the one-off chrome a `Plan.series.rows` entry places (`planTargetState`'s
// planned works).
//
// Every canvas binds its data from e3, so each runs on e3-web in the showcase
// (#1178): the source is an `e3.input` or an `e3.record` declared beside the
// example, its small literal default the dataset's initial value, bound in the
// body with `Data.bind`; a record an editing session commits to is paged with
// `Data.bindPaged` and written through its patch door (`Record.onApply`). A
// fixture made by a rule rather than written out — a slice's horizon, a
// stress source — is made where data is made, by an `e3.task` over a count.
// `State` holds only what the viewer owns: a configurator's axes, a pick, a
// gesture log, the interaction state. Instants are stored as instants, and a
// measure as its readings from its first week, which the series turn into
// points and cells; lifecycle states are plain `EventStateType` variants (the
// shared contracts vocabulary a plan dataset stores). Everything else an
// example needs — its series, axis, resolvers, presets and policy tables — is
// an East value bound once in its body. The declarations an example reaches
// travel with it into its docs and the plugin index.

// ============================================================================
// planTargetState — the data flagship: series over ONE raw source, every row
// kind, every series option, on a bounded canvas
// ============================================================================

/** A delivery on the horizon — the rows the slice narrows: when, which
 *  hall, whether it is at risk of running late, and the sheets booked so far
 *  (0 = nothing yet). */
export const TargetHorizonRow = StructType({ key: StringType, at: DateTimeType, hall: StringType, risk: StringType, sheets: FloatType });

/** How many deliveries the horizon holds — a small authored constant;
 *  {@link planTargetHorizon} makes the rows. */
export const planTargetHorizonCount = e3.input("plan_target_horizon_count", IntegerType, variant("value", 36n));

/**
 * The horizon's deliveries, generated from their count and spread over
 * the 27 weeks from W21: every third at risk of running late (the `Late
 * risk` cohort counts 12 of 36), every seventh with no sheets booked yet (the
 * `Empty` cohort).
 */
export const generateTargetHorizon = East.function([IntegerType], ArrayType(TargetHorizonRow), ($, count) => {
    // Monday of ISO week 1, 2026.
    const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
    return East.Array.generate(count, TargetHorizonRow, (_$, i) => ({
        key: East.str`h${East.print(i.add(1n))}`,
        at: w1.addWeeks(i.multiply(27n).divide(count).add(20n)),
        hall: i.remainder(2n).equal(0n).ifElse(() => "Hall 1", () => "Hall 2"),
        risk: i.remainder(3n).equal(0n).ifElse(() => "late", () => "on-time"),
        sheets: i.remainder(7n).equal(6n).ifElse(
            () => 0.0,
            () => i.multiply(11n).remainder(40n).toFloat().add(20.0)),
    }));
});

/** The task that generates the horizon — its output is the rows the slice narrows. */
export const planTargetHorizon = e3.task("plan_target_horizon", [planTargetHorizonCount], generateTargetHorizon);

/** A job on a press — the RAW record an ops dataset stores: its phase and
 *  optional job ticket, its window, optional sheets, lifecycle state and alert. */
export const TargetJob = StructType({
    key: StringType, phase: StringType, ticket: OptionType(StringType),
    start: DateTimeType, end: DateTimeType,
    sheets: OptionType(FloatType), state: EventStateType,
    alert: OptionType(StatusValueType),
});

/** A crew's shift — its window, its hours and its lifecycle state. */
export const TargetShift = StructType({
    key: StringType, from: DateTimeType, to: DateTimeType,
    hours: FloatType, state: EventStateType,
});

/** A van drop — its week and its lifecycle state. */
export const TargetAlloc = StructType({ key: StringType, at: DateTimeType, state: EventStateType });

/**
 * The ops row — every series' rows in ONE keyed source, discriminated by the
 * kind variant (the natural ops-dataset shape). The arms carry RAW fields: a
 * measure is its weekly readings from its first week, and presence — a
 * status, an expand declaration (`detail`) — is per-row Option data the
 * accessors pass through. A row that stands in a hall names it (`hall`), and a
 * data step groups those rows into their hall's entry (the `hall` arm, which
 * the dataset itself never stores). The row is recursive, so the hierarchy is
 * the data's own (#822): a hall holds its members, and a contract the presses
 * it books (`presses`), to whatever depth the data has. A press names the span
 * series that draws it (`series`): a hall's presses, the proposal flavours,
 * the detail line, a contract rolled up by union or by status, a delivery.
 */
export const TargetOpsRow = RecursiveType((self) => StructType({
    hall: OptionType(StringType),
    kind: VariantType({
        kpi: StructType({ name: StringType, headline: StringType, pinned: BooleanType,
                          from: DateTimeType, weekly: ArrayType(FloatType), detail: OptionType(Plan.Types.Expand) }),
        press: StructType({ series: StringType, rate: OptionType(FloatType), sub: OptionType(StringType),
                            status: OptionType(StatusValueType), detail: OptionType(Plan.Types.Expand),
                            jobs: ArrayType(TargetJob),
                            decisions: ArrayType(Plan.Types.DecisionMark),
                            ports: ArrayType(Plan.Types.Port),
                            presses: DictType(StringType, self) }),
        load: StructType({ name: StringType, sub: StringType, from: DateTimeType,
                           weekly: ArrayType(OptionType(FloatType)), detail: OptionType(Plan.Types.Expand) }),
        van: StructType({ name: StringType, region: StringType, sub: OptionType(StringType), detail: OptionType(Plan.Types.Expand),
                          lanes: ArrayType(Plan.Types.Lane), drops: ArrayType(TargetAlloc),
                          tiles: ArrayType(Plan.Types.BucketEvent), markers: ArrayType(Plan.Types.CellMarker) }),
        crew: StructType({ name: StringType, pool: BooleanType, sub: OptionType(StringType), value: OptionType(StringType),
                           detail: OptionType(Plan.Types.Expand), shifts: ArrayType(TargetShift), chips: ArrayType(Plan.Types.Chip) }),
        stream: StructType({ name: StringType, cadence: OptionType(StringType), detail: OptionType(Plan.Types.Expand),
                             marks: ArrayType(Plan.Types.EventMark) }),
        tally: StructType({ name: StringType, detail: OptionType(Plan.Types.Expand), cells: ArrayType(Plan.Types.TableCell) }),
        finisher: StructType({ name: StringType, jobs: ArrayType(TargetJob), util: ArrayType(FloatType),
                               sheets: ArrayType(Plan.Types.TableCell) }),
        hall: StructType({ members: DictType(StringType, self) }),
    }),
}));

/**
 * The ONE ops source — every series' rows in one KEYED collection, RAW: no
 * display strings the accessors can derive, no built elements; the instants an
 * element record stores ride the axis's `time` arm. A key is its entry's
 * identity, never its place: a row's id is the series that made it and the
 * path of keys to it (`Plan.ref("presses", "Hall 1", "H1-P03")`), which is
 * what `links`, `popover`, `ui` and `onSelect` speak — the layout is the
 * series list. Weeks W27–W38.
 */
export const planTargetOps = e3.input("plan_target_ops", DictType(StringType, TargetOpsRow), variant("value", new Map([
    // ── The pinned KPI ──
    ["ontime", { hall: none, kind: variant("kpi", { name: "On-time", headline: "94.2%", pinned: true,
      from: new Date("2026-06-29T00:00:00Z"), weekly: [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2],
      detail: some({ height: some("150px"), axis: variant("keep", null) }) }) }],
    // ── Deliveries — Van 1's drops are raw, its tiles derived; Van 2's are
    // stored tile records in its AM/PM lanes. Van 1's Aug 24 cell holds two
    // drops, more than its room: a `+n` holds the rest. ──
    ["van1", { hall: none, kind: variant("van", { name: "Van 1", region: "local", sub: some("drops/wk"), detail: none, lanes: [],
      drops: [
          { key: "a0", at: new Date("2026-06-29T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a1", at: new Date("2026-07-06T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a2", at: new Date("2026-07-13T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
          { key: "a3", at: new Date("2026-07-20T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a4", at: new Date("2026-07-27T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a5", at: new Date("2026-08-03T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
          { key: "a6", at: new Date("2026-08-10T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
          { key: "a7", at: new Date("2026-08-24T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a8", at: new Date("2026-08-24T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
      ],
      tiles: [],
      markers: [
          { at: variant("time", new Date("2026-07-13T00:00:00Z")), lane: none, status: variant("warning", null), message: "capacity 90%" },
          { at: variant("time", new Date("2026-08-24T00:00:00Z")), lane: none, status: variant("warning", null), message: "capacity breach — 2 drops" },
      ] }) }],
    ["van2", { hall: none, kind: variant("van", { name: "Van 2", region: "regional", sub: some("day · am/pm"),
      detail: some({ height: some("112px"), axis: variant("keep", null) }),
      lanes: [{ key: "am", label: some("AM") }, { key: "pm", label: some("PM") }],
      drops: [],
      tiles: [
          { key: "m1", at: variant("time", new Date("2026-06-29T00:00:00Z")), lane: some("am"), label: none, icon: none, state: variant("confirmed", null),
            tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
          { key: "m2", at: variant("time", new Date("2026-06-29T00:00:00Z")), lane: some("pm"), label: none, icon: none, state: variant("confirmed", null),
            tone: some(variant("warning", null)), color: none, colorPalette: none, stretch: none, content: none, animation: none },
          { key: "m3", at: variant("time", new Date("2026-07-06T00:00:00Z")), lane: some("am"), label: none, icon: none, state: variant("proposed", variant("recommended", null)),
            tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: some(variant("pulse", null)) },
          { key: "m4", at: variant("time", new Date("2026-07-13T00:00:00Z")), lane: none, label: some("MIXED"), icon: none, state: variant("confirmed", null),
            tone: none, color: none, colorPalette: none, stretch: some(variant("horizontal", null)),
            content: some({ horizontal: some(variant("center", null)), vertical: none }), animation: none },
          { key: "m5", at: variant("time", new Date("2026-07-20T00:00:00Z")), lane: some("pm"), label: none,
            icon: some({ prefix: "fas", name: "truck", label: none, style: none }),
            state: variant("proposed", variant("recommended", null)),
            tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
          { key: "m6", at: variant("time", new Date("2026-07-27T00:00:00Z")), lane: some("am"), label: some("PROOF"), icon: none, state: variant("estimated", null),
            tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
          // The colour channels: `color` is a raw token override,
          // `colorPalette` recolours the whole lifecycle treatment.
          { key: "m7", at: variant("time", new Date("2026-08-03T00:00:00Z")), lane: some("am"), label: some("S-A"), icon: none, state: variant("confirmed", null),
            tone: none, color: some("teal.solid"), colorPalette: none, stretch: none, content: none, animation: none },
          { key: "m8", at: variant("time", new Date("2026-08-03T00:00:00Z")), lane: some("pm"), label: some("S-B"), icon: none, state: variant("confirmed", null),
            tone: none, color: none, colorPalette: some(variant("brand", null)), stretch: none, content: none, animation: none },
      ],
      markers: [{ at: variant("time", new Date("2026-07-13T00:00:00Z")), lane: none, status: variant("danger", null), message: "capacity breach" }] }) }],
    // ── The halls' presses and loads: each names its hall, and the data
    // step groups them under it. ──
    ["H1-P03", { hall: some("Hall 1"), kind: variant("press", { series: "presses", rate: some(12.0), sub: none,
      status: some(variant("success", null)), detail: none,
      jobs: [
          { key: "mr", phase: "MAKEREADY", ticket: none, start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-06T00:00:00Z"), sheets: none, state: variant("actual", null), alert: none },
          { key: "j4642", phase: "RUN", ticket: some("J-4642"), start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), sheets: some(96.0), state: variant("in-progress", null), alert: none },
          { key: "wash", phase: "WASH-UP", ticket: none, start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), sheets: none, state: variant("confirmed", null), alert: none },
          { key: "j4663", phase: "RUN", ticket: some("J-4663"), start: new Date("2026-08-03T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), sheets: some(88.0), state: variant("proposed", variant("recommended", null)), alert: none },
      ],
      decisions: [{ key: "d1", at: variant("time", new Date("2026-08-03T00:00:00Z")), applied: false }],
      ports: [{ at: variant("time", new Date("2026-07-27T00:00:00Z")), label: some("−24 k sheets") }],
      presses: new Map() }) }],
    ["H1-P04", { hall: some("Hall 1"), kind: variant("press", { series: "presses", rate: some(12.0), sub: none, status: none,
      // The expand declaration — a stored plain-data record; presence is a
      // per-row fact, and the ROOT's expandRender mounts the body.
      detail: some({ height: some("152px"), axis: variant("keep", null) }),
      jobs: [
          { key: "j4624", phase: "RUN", ticket: some("J-4624"), start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), sheets: some(112.0), state: variant("actual", null), alert: none },
          { key: "plates", phase: "PLATES", ticket: none, start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), sheets: none, state: variant("confirmed", null), alert: none },
          { key: "proof", phase: "PROOF", ticket: none, start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), sheets: none, state: variant("confirmed", null), alert: none },
          { key: "j4693", phase: "RUN", ticket: some("J-4693"), start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-10-05T00:00:00Z"), sheets: some(104.0), state: variant("proposed", variant("recommended", null)), alert: none },
      ],
      decisions: [], ports: [], presses: new Map() }) }],
    ["H1-P05", { hall: some("Hall 1"), kind: variant("press", { series: "presses", rate: some(8.0), sub: none,
      status: some(variant("warning", null)), detail: none,
      jobs: [
          { key: "j4591", phase: "PLATES", ticket: some("J-4591"), start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), sheets: none, state: variant("actual", null), alert: some(variant("warning", null)) },
          { key: "wash", phase: "WASH-UP", ticket: none, start: new Date("2026-08-17T00:00:00Z"), end: new Date("2026-08-31T00:00:00Z"), sheets: none, state: variant("proposed", variant("recommended", null)), alert: none },
      ],
      decisions: [], ports: [], presses: new Map() }) }],
    // A load reading nothing in the week of 17 August: its cell is no data.
    ["h1-load", { hall: some("Hall 1"), kind: variant("load", { name: "H1 load", sub: "%/wk", from: new Date("2026-06-29T00:00:00Z"),
      weekly: [some(46.0), some(58.0), some(66.0), some(72.0), some(84.0), some(90.0), some(96.0), none, some(92.0), some(88.0), some(81.0), some(77.0)],
      detail: some({ height: some("132px"), axis: variant("keep", null) }) }) }],
    ["H2-P11", { hall: some("Hall 2"), kind: variant("press", { series: "presses", rate: some(10.0), sub: none, status: none, detail: none,
      jobs: [{ key: "j4723", phase: "RUN", ticket: some("J-4723"), start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), sheets: some(92.0), state: variant("confirmed", null), alert: none }],
      decisions: [], ports: [], presses: new Map() }) }],
    ["H2-P12", { hall: some("Hall 2"), kind: variant("press", { series: "presses", rate: some(10.0), sub: none, status: none, detail: none,
      jobs: [{ key: "j4594", phase: "RUN", ticket: some("J-4594"), start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), sheets: some(64.0), state: variant("proposed", variant("recommended", null)), alert: none }],
      decisions: [], ports: [], presses: new Map() }) }],
    ["h2-load", { hall: some("Hall 2"), kind: variant("load", { name: "H2 load", sub: "%/wk", from: new Date("2026-06-29T00:00:00Z"),
      weekly: [some(46.0), some(52.0), some(58.0), some(61.0), some(66.0), some(72.0), some(78.0), some(84.0), some(90.0), some(96.0), some(98.0), some(92.0)],
      detail: none }) }],
    ["H3-P21", { hall: some("Hall 3"), kind: variant("press", { series: "presses", rate: some(6.0), sub: none, status: none, detail: none,
      jobs: [{ key: "j4903", phase: "RUN", ticket: some("J-4903"), start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), sheets: some(48.0), state: variant("confirmed", null), alert: none }],
      decisions: [], ports: [], presses: new Map() }) }],
    ["H3-P22", { hall: some("Hall 3"), kind: variant("press", { series: "presses", rate: some(6.0), sub: none, status: none, detail: none,
      jobs: [{ key: "j4906", phase: "RUN", ticket: some("J-4906"), start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-09-07T00:00:00Z"), sheets: some(54.0), state: variant("proposed", variant("recommended", null)), alert: none }],
      decisions: [], ports: [], presses: new Map() }) }],
    ["h3-load", { hall: some("Hall 3"), kind: variant("load", { name: "H3 load", sub: "%/wk", from: new Date("2026-06-29T00:00:00Z"),
      weekly: [some(38.0), some(42.0), some(47.0), some(51.0), some(55.0), some(61.0), some(66.0), some(70.0), some(75.0), some(80.0), some(83.0), some(78.0)],
      detail: none }) }],
    // ── The span grammar: proposal flavours (a forecast ghost, a proposed
    // cut, a declined run) ──
    ["H1-P07", { hall: none, kind: variant("press", { series: "flavours", rate: some(8.0), sub: none, status: none, detail: none,
      jobs: [
          { key: "run", phase: "RUN", ticket: some("J-4580"), start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), sheets: some(64.0), state: variant("in-progress", null), alert: none },
          { key: "gho", phase: "FORECAST", ticket: none, start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), sheets: none, state: variant("estimated", null), alert: none },
          { key: "rem", phase: "CUT", ticket: none, start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), sheets: none, state: variant("proposed", variant("removed", null)), alert: none },
          { key: "rej", phase: "DECLINED", ticket: none, start: new Date("2026-08-31T00:00:00Z"), end: new Date("2026-09-14T00:00:00Z"), sheets: none, state: variant("rejected", null), alert: none },
      ],
      decisions: [], ports: [], presses: new Map() }) }],
    // …sheets, an applied decision and a port on a two-line gutter, its
    // expand declaration dimming the axis behind the render…
    ["H1-P09", { hall: none, kind: variant("press", { series: "detail", rate: none, sub: some("12k sheets/h"), status: none,
      detail: some({ height: some("152px"), axis: variant("dim", null) }),
      jobs: [
          { key: "a", phase: "RUN", ticket: some("J-4624"), start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), sheets: some(112.0), state: variant("actual", null), alert: none },
          { key: "b", phase: "RUN", ticket: some("J-4693"), start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), sheets: some(104.0), state: variant("proposed", variant("recommended", null)), alert: none },
      ],
      decisions: [{ key: "d1", at: variant("time", new Date("2026-07-27T00:00:00Z")), applied: true }],
      ports: [{ at: variant("time", new Date("2026-07-27T00:00:00Z")), label: some("−24 k sheets") }],
      presses: new Map() }) }],
    // …a contract and the presses it books — its row rolls their runs up
    // into union bands (renderer-derived)…
    ["Contract A", { hall: none, kind: variant("press", { series: "rollup", rate: none, sub: none, status: none, detail: none,
      jobs: [], decisions: [], ports: [],
      presses: new Map([
          ["H1-P03", { hall: none, kind: variant("press", { series: "rollup", rate: none, sub: none, status: none, detail: none,
            jobs: [
                { key: "j4642", phase: "RUN", ticket: some("J-4642"), start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), sheets: some(96.0), state: variant("actual", null), alert: none },
                { key: "j4663", phase: "RUN", ticket: some("J-4663"), start: new Date("2026-08-03T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), sheets: some(88.0), state: variant("proposed", variant("recommended", null)), alert: none },
            ],
            decisions: [], ports: [], presses: new Map() }) }],
          ["H2-P11", { hall: none, kind: variant("press", { series: "rollup", rate: none, sub: none, status: none, detail: none,
            jobs: [{ key: "j4723", phase: "RUN", ticket: some("J-4723"), start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), sheets: some(92.0), state: variant("confirmed", null), alert: none }],
            decisions: [], ports: [], presses: new Map() }) }],
      ]) }) }],
    // …a linked delivery whose run starts BEYOND the window — in links focus
    // its landing is a slot on the plot's edge…
    ["dlv", { hall: none, kind: variant("press", { series: "delivery", rate: none, sub: none, status: none, detail: none,
      jobs: [{ key: "d1", phase: "DELIVER", ticket: none, start: new Date("2026-09-21T00:00:00Z"), end: new Date("2026-10-12T00:00:00Z"), sheets: some(91.0), state: variant("proposed", variant("recommended", null)), alert: none }],
      decisions: [], ports: [], presses: new Map() }) }],
    // …and a contract rolled up by status.
    ["Contract B", { hall: none, kind: variant("press", { series: "contracts", rate: none, sub: none, status: none, detail: none,
      jobs: [], decisions: [], ports: [],
      presses: new Map([
          ["H2-P12", { hall: none, kind: variant("press", { series: "contracts", rate: none, sub: none, status: none, detail: none,
            jobs: [
                { key: "r1", phase: "RUN", ticket: some("J-4594"), start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), sheets: some(64.0), state: variant("actual", null), alert: none },
                { key: "r2", phase: "RUN", ticket: some("J-4606"), start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), sheets: some(40.0), state: variant("proposed", variant("recommended", null)), alert: none },
            ],
            decisions: [], ports: [], presses: new Map() }) }],
      ]) }) }],
    // ── A second heat series of the same kind, its own entry ──
    ["quality", { hall: none, kind: variant("load", { name: "Quality index", sub: "%", from: new Date("2026-06-29T00:00:00Z"),
      weekly: [some(94.0), some(95.0), some(96.0), some(95.0), some(97.0), some(96.0), some(93.0), some(92.0), some(94.0), some(95.0), some(96.0), some(97.0)],
      detail: none }) }],
    // ── Crews — Crew A's chips derive from raw shifts; the relief pool's are
    // chip records stored as they draw. ──
    ["crewA", { hall: none, kind: variant("crew", { name: "Crew A", pool: false, sub: some("152h → 168h"), value: none,
      detail: some({ height: some("120px"), axis: variant("keep", null) }),
      shifts: [
          { key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), hours: 80.0, state: variant("confirmed", null) },
          { key: "s2", from: new Date("2026-07-13T00:00:00Z"), to: new Date("2026-07-27T00:00:00Z"), hours: 56.0, state: variant("proposed", variant("removed", null)) },
          { key: "s3", from: new Date("2026-07-27T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z"), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
          { key: "s4", from: new Date("2026-08-17T00:00:00Z"), to: new Date("2026-08-24T00:00:00Z"), hours: 48.0, state: variant("estimated", null) },
          { key: "s5", from: new Date("2026-08-31T00:00:00Z"), to: new Date("2026-09-14T00:00:00Z"), hours: 56.0, state: variant("proposed", variant("recommended", null)) },
      ],
      chips: [] }) }],
    ["crewB", { hall: none, kind: variant("crew", { name: "Crew B", pool: true, sub: none, value: some("128h"), detail: none, shifts: [],
      chips: [
          { key: "b1", from: variant("time", new Date("2026-07-06T00:00:00Z")), to: variant("time", new Date("2026-07-27T00:00:00Z")), label: "96h", state: variant("confirmed", null),
            icon: some({ prefix: "fas", name: "user-group", label: none, style: none }) },
          { key: "b2", from: variant("time", new Date("2026-08-10T00:00:00Z")), to: variant("time", new Date("2026-08-31T00:00:00Z")), label: "+32h", state: variant("proposed", variant("recommended", null)), icon: none },
      ] }) }],
    // ── Instant marks — every kind: milestones, decisions applied and
    // pending, an exception, a custom icon; the releases on a cadence. ──
    ["milestones", { hall: none, kind: variant("stream", { name: "Milestones", cadence: none,
      detail: some({ height: some("112px"), axis: variant("dim", null) }),
      marks: [
          { key: "kick", at: variant("time", new Date("2026-07-06T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
          { key: "d1", at: variant("time", new Date("2026-07-27T00:00:00Z")), kind: variant("decision", { applied: true }), icon: none, label: none },
          { key: "rel", at: variant("time", new Date("2026-08-10T00:00:00Z")), kind: variant("milestone", null),
            icon: some({ prefix: "fas", name: "rocket", label: none, style: none }), label: some("REL 2.4") },
          { key: "audit", at: variant("time", new Date("2026-08-24T00:00:00Z")), kind: variant("exception", null), icon: none, label: some("AUDIT") },
          { key: "d2", at: variant("time", new Date("2026-09-07T00:00:00Z")), kind: variant("decision", { applied: false }), icon: none, label: some("×3") },
      ] }) }],
    ["releases", { hall: none, kind: variant("stream", { name: "Releases", cadence: some("6-wk cadence"), detail: none,
      marks: [
          { key: "r1", at: variant("time", new Date("2026-07-13T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("2.3") },
          { key: "r2", at: variant("time", new Date("2026-08-31T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("2.4") },
      ] }) }],
    // ── Delivered sheets, a week apiece — negatives, and a week with none;
    // its render draws its own canvas, so the shared lines leave its row. ──
    ["delivered", { hall: none, kind: variant("tally", { name: "Delivered · k",
      detail: some({ height: some("120px"), axis: variant("off", null) }),
      cells: [
          { at: variant("time", new Date("2026-06-29T00:00:00Z")), value: some(128.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-06T00:00:00Z")), value: some(134.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-13T00:00:00Z")), value: some(119.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-20T00:00:00Z")), value: some(-96.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(-88.0), text: none, tone: none },
          { at: variant("time", new Date("2026-08-03T00:00:00Z")), value: none, text: none, tone: none },
          { at: variant("time", new Date("2026-08-10T00:00:00Z")), value: some(151.0), text: none, tone: none },
          { at: variant("time", new Date("2026-08-17T00:00:00Z")), value: some(162.0), text: none, tone: none },
          { at: variant("time", new Date("2026-08-24T00:00:00Z")), value: some(144.0), text: none, tone: none },
      ] }) }],
    // ── The finishing line's machines — each one shown three ways ──
    ["FN-1", { hall: none, kind: variant("finisher", { name: "Folder FN-1",
      jobs: [{ key: "f1", phase: "FOLD", ticket: some("J-4642"), start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), sheets: some(96.0), state: variant("confirmed", null), alert: none }],
      util: [46.0, 52.0, 58.0, 66.0, 72.0, 78.0, 84.0, 80.0, 74.0, 68.0, 62.0, 58.0],
      sheets: [
          { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(48.0), text: none, tone: none },
          { at: variant("time", new Date("2026-08-03T00:00:00Z")), value: some(-8.0), text: none, tone: none },
      ] }) }],
    ["FN-2", { hall: none, kind: variant("finisher", { name: "Cutter FN-2",
      jobs: [{ key: "f2", phase: "CUT", ticket: some("J-4663"), start: new Date("2026-08-24T00:00:00Z"), end: new Date("2026-09-07T00:00:00Z"), sheets: some(88.0), state: variant("proposed", variant("recommended", null)), alert: none }],
      util: [30.0, 34.0, 38.0, 42.0, 46.0, 50.0, 54.0, 58.0, 62.0, 66.0, 70.0, 74.0],
      sheets: [
          { at: variant("time", new Date("2026-08-24T00:00:00Z")), value: some(44.0), text: none, tone: none },
          { at: variant("time", new Date("2026-08-31T00:00:00Z")), value: some(44.0), text: none, tone: none },
      ] }) }],
])));

/**
 * The data flagship: every row kind on one axis, from ONE raw ops source bound
 * from e3, laid out by a series list — the list IS the layout (#822), and a
 * row's id is its series and the path of keys to it.
 *
 * - **The data step.** The source is flat: a row standing in a hall names it.
 *   One `groupToDicts` makes each hall an entry holding its rows, and the
 *   halls join the rest of the source — hierarchy is the data's own.
 * - **Every row kind.** A pinned KPI chart (spark, breach, its value scale);
 *   bucket rows — tiles derived from raw drops with cell markers, and stored
 *   tile records in AM/PM lanes with tones, colours, stretch, content, a pulse
 *   and an icon; one group strip per hall, nesting its presses and its load,
 *   Hall 2 resting as its members' mean; span rows — proposal flavours, an
 *   applied decision and a port on a two-line gutter, contracts rolling the
 *   presses they book up by union and by status, a delivery past the window;
 *   a collapsed section of a second heat series; cards rows — chips derived
 *   from hours × lifecycle, and stored chips with an icon; event rows with
 *   every mark kind; a table row; a `views` series showing one machine three
 *   ways; and literal rows (`Plan.series.rows` + `Plan.span`, a planned
 *   shutdown rolling up two trades' runs).
 * - **Links** between runs (`Plan.ref`), each weighed by its quantity: the
 *   routing permutations — forward, a same-row seam feed, loopbacks, a rising
 *   loop, a landing past the window — and the W31 transfer between two
 *   presses.
 * - **Expand in place** on a row of every kind: each row declares it as data
 *   (`detail`), the root renders the plot (`expandRender`) and the gutter
 *   (`expandGutter`), and the unfocused rows collapse to strips.
 * - **The series are picked** (`Plan.pick`): the library's Series tab lists
 *   them, one hidden to start.
 * - **A bound `ui` state** held by the host, its controls beside the frame: a
 *   picker brings a press into view, buttons fold and open the halls and
 *   expand the KPI, and a readout says what the state holds.
 * - **Popover, hover and every callback** over the element refs and row ids,
 *   a section's strip among them (`Plan.sectionRef`).
 * - **The slice** over a horizon an e3 task generates (cohort, filter, search,
 *   range, resolution, brush, summary), and the status footer.
 * - **A bounded host**: the Plan fills it (`style.height: "fill"`), and the
 *   canvas scrolls its own rows in main.
 * - **Its narrow layout**: below 480px of CONTAINER width — a phone, a pane, a
 *   box — the same definition reflows to three tabs over one slice (Groups ·
 *   Rows · Measures), the halls as hottest-first strip cards and the rows as
 *   cards; only the box changes.
 */
export const planTargetState = example({
    keywords: [
        "Plan", "canvas", "data", "series", "match", "axis", "window", "resolution", "now", "data step",
        "span", "run", "group", "groups", "strip", "section", "heat", "buckets", "cards", "chip", "events", "mark", "chart",
        "table", "views", "rows", "layers", "rollup", "union", "byStatus", "bands", "footer", "milestone",
        "decision", "exception", "pinned", "port", "hovercard", "popover", "hover",
        "slice", "brush", "horizon", "toolbar", "affordances", "cohort", "filter", "search", "summary",
        "expand", "expandRender", "expandGutter", "keep", "dim", "off", "collapse", "context strip",
        "resolver", "data-driven", "accessor", "raw", "target state", "flagship",
        "layout", "row id", "Plan.ref", "Plan.sectionRef", "links", "link", "focus", "quantity", "Plan.quantity", "unit",
        "onSelect", "onElementClick", "onGroupToggle", "onGrainChange", "callback", "ElementRef",
        "estimated", "removed", "rejected", "proposal", "flavours", "stacked", "gutter", "two-line",
        "children", "Plan.children", "nested", "recursive", "RecursiveType", "groupToDicts", "grouping",
        "summaryAggregate", "collapsed", "member count", "heterogeneous",
        "lane", "lanes", "AM", "PM", "tile", "marker", "tone", "color", "colorPalette", "stretch", "pulse", "icon",
        "lifecycle", "confirmed", "recommended", "same kind", "own entry", "duplicate",
        "one asset", "multiple views", "literal", "Plan.span", "series.rows", "kind factory", "chrome",
        "pick", "Plan.pick", "library", "Plan.library.series", "Series tab", "hidden", "eye",
        "ui", "UiState", "Plan.uiState", "State.bind", "controlled", "selected", "fold", "open", "charts",
        "scroll to row", "external", "write back", "Select", "Button",
        "fill", "height", "bounded", "Box", "scroll", "virtual", "virtualization", "id",
        "Reactive", "Data.bind", "bound", "e3.input", "e3.task", "generated", "dataset", "#822", "#824", "#590", "#320",
        "state", "event", "label", "format", "readings", "variant", "row", "sub", "spark", "expanded", "R2", "markKind", "applied",
        "Planner", "Roster", "mixed", "unbucketed", "sum per unit", "Series", "one source", "one-off", "subtree", "parent",
        "step down", "nesting", "Pick", "Panel", "panel", "pickItems", "kind icon", "toggle", "show", "hide", "choose",
        "persisted", "same entity", "adjacent", "seek", "order", "State", "bind", "selection", "deep link",
        "sizing", "maxHeight", "variable", "estimateSize", "interleave",
        "narrow", "mobile", "phone", "responsive", "compact", "container", "breakpoint", "tabs", "Groups", "Rows", "Measures",
        "hottest", "two-finger", "pan", "review", "§10",
    ],
    description: "The data flagship — every row kind on one axis from one raw ops source bound from e3, grouped by hall in one data step: a pinned KPI, bucket rows derived and stored in lanes, a group strip per hall, span rows with proposal flavours, decisions and ports, contracts rolling up by union and by status, links weighed by quantity, a collapsed section, cards and event rows, a table, a views series and literal rows; expand in place on a row of every kind, the series picked in the library's Series tab, a bound ui state the host drives beside the frame, popover, hover and every callback, slice chrome over a horizon an e3 task generates, and the Plan filling a bounded host; in a box under 480px the same canvas is its narrow layout (Groups · Rows · Measures)",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(TargetHorizonRow, {
            fields: {
                at: { label: "Delivered", format: { date: "MMM D" } },
                hall: { label: "Hall" },
                risk: { label: "Risk", hints: ["late", "on-time"] },
                sheets: { label: "Sheets" },
            },
            rangeFieldId: "at",
            searchFieldIds: ["hall"],
        });

        return (<Reactive>{$ => {
            // The ONE ops source, bound from e3 — every series reads it.
            const ops = $.let(Data.bind(planTargetOps));
            // The horizon the slice narrows — the deliveries a task
            // generates (the canvas rows are the ops source; the slice is
            // chrome over THESE).
            const horizon = $.let(Data.bind(planTargetHorizon));
            // Monday of ISO week n, 2026 (W1 Monday = 2025-12-29). The
            // window is W27–W38 (half-open at W39); now = W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($2, n) => {
                const w1 = $2.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));

            // ── The data step ──────────────────────────────────────────
            // Hierarchy is the DATA's (#822): one `groupToDicts` makes each
            // hall an entry holding the rows that stand in it, keyed as the
            // source keys them, and the halls join the rest of the source.
            const raw = $.let(ops.read());
            const halls = $.let(raw.filter((_$2, r) => r.unwrap().hall.hasTag("some"))
                .groupToDicts((_$2, r) => r.unwrap().hall.unwrap("some"), (_$2, _r, k) => k));
            const rows = $.let(raw.filter((_$2, r) => r.unwrap().hall.hasTag("none"))
                .union(halls.map((_$2, members) => East.value({ hall: none, kind: variant("hall", { members }) }, TargetOpsRow))));

            // ── What the accessors share ───────────────────────────────
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            // A measure's weekly readings, from its first week, as a chart's
            // points, and as heat cells printing their values — a week with
            // none read the no-data cell.
            const weeklyPoints = $.const(East.function([DateTimeType, ArrayType(FloatType)], ArrayType(MeasureRow), (_$2, from, weekly) =>
                East.Array.generate(weekly.size(), MeasureRow, (_$3, i) => ({ week: from.addWeeks(i), pct: weekly.get(i) }))));
            const weeklyCells = $.const(East.function([DateTimeType, ArrayType(OptionType(FloatType))], ArrayType(Plan.Types.HeatCell), (_$2, from, weekly) =>
                East.Array.generate(weekly.size(), Plan.Types.HeatCell, ($3, i) => {
                    const value = $3.let(weekly.get(i), OptionType(FloatType));
                    const label = $3.let(none, OptionType(StringType));
                    $3.match(value, { some: ($4, v) => { $4.assign(label, some(East.Float.printFixed(v, 0n))); } });
                    return { at: Plan.at.time(from.addWeeks(i)), value, label };
                })));
            // A press's rate, a thousand sheets an hour, as its gutter value.
            const rateText = $.const(East.function([OptionType(FloatType)], OptionType(StringType), (_$2, rate) => rate.match({
                some: (_$3, k) => East.value(some(East.str`${East.Float.printFixed(k, 0n)}k/h`), OptionType(StringType)),
                none: (_$3) => East.value(none, OptionType(StringType)),
            })));
            // Raw jobs → runs: ONE bound mapping function — the bar label and
            // the quantity derive CLIENT-SIDE from the raw phase/ticket/sheets
            // fields. A quantity is ONE value — the number, its unit and how it
            // prints (#824) — so the bar's caption and a rollup's sum can never
            // disagree. The run is written as a RECORD, so its instants are
            // spelled with `Plan.at.time` — the `Plan.run` builder would wrap a
            // DateTime field by itself.
            const sheetsFormat = $.const(Format.Number({ maximumFractionDigits: 0n }));
            const jobRuns = $.const(East.function([ArrayType(TargetJob)], ArrayType(Plan.Types.Run), (_$2, jobs) =>
                jobs.map(($3, j) => {
                    const noQuantity = $3.const(none, OptionType(Plan.Types.Quantity));
                    const quantity = $3.let(j.sheets.match({
                        some: (_$4, t) => East.value(some(Plan.quantity(t, { unit: "k sheets", format: sheetsFormat })), OptionType(Plan.Types.Quantity)),
                        none: (_$4) => noQuantity,
                    }), OptionType(Plan.Types.Quantity));
                    const label = $3.let(j.ticket.match({
                        some: (_$4, b) => East.str`${j.phase} · ${b}`,
                        none: (_$4) => j.phase,
                    }), StringType);
                    const run = $3.let({
                        key: j.key, start: Plan.at.time(j.start), end: Plan.at.time(j.end), label,
                        quantity, state: j.state, status: j.alert,
                        moved: none, icon: none,
                    }, Plan.Types.Run);
                    return run;
                })));
            // Raw shifts → chips: hours print as the chip label, an ADDED
            // proposal wearing the `+` prefix — display derives from the
            // lifecycle, down to the proposal's flavour (a `removed` shift is
            // a proposal too, and `+` would read as its opposite).
            const shiftChips = $.const(East.function([ArrayType(TargetShift)], ArrayType(Plan.Types.Chip), (_$2, shifts) =>
                shifts.map(($3, s) => {
                    const hrs = $3.let(East.Float.printFixed(s.hours, 0n), StringType);
                    const label = $3.let(s.state.match({
                        proposed: (_$4, p) => p.hasTag("removed").ifElse(
                            () => East.str`${hrs}h`,
                            () => East.str`+${hrs}h`),
                    }, _$4 => East.str`${hrs}h`), StringType);
                    return Plan.chip({ key: s.key, from: s.from, to: s.to, label, state: s.state });
                })));
            const whole = $.const(Format.Number({ maximumFractionDigits: 0n }));

            // ── The series — the list IS the layout (#822): one block per
            // series, top to bottom, a section titling the blocks beneath
            // it. Every one is picked (below), so the whole list is an East
            // value typed by the constructor. ──
            const all = $.const([
                // The KPI, pinned under the ruler: its gutter opens the spark
                // to the expanded chart, and it declares expand-in-place too,
                // its plot keeping its value scale.
                Plan.series.chart(TargetOpsRow, {
                    key: "ontime", title: "On-time",
                    match: r => r.kind.hasTag("kpi"),
                    label: r => r.kind.unwrap("kpi").name, id: true,
                    pinned: r => r.kind.unwrap("kpi").pinned,
                    value: r => some(r.kind.unwrap("kpi").headline),
                    status: _r => some(variant("warning", null)),
                    expand: r => r.kind.unwrap("kpi").detail,
                    height: "spark", expandable: true,
                    left: { domain: [80, 110], tickValues: [80, 100] },
                    layers: r => [
                        Plan.layer(Chart.Line(weeklyPoints(r.kind.unwrap("kpi").from, r.kind.unwrap("kpi").weekly), { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                        Chart.refLine({ y: 100, label: "TARGET 100" }),
                    ],
                }),
                Plan.series.section(TargetOpsRow, { key: "vans-local", title: "Deliveries · Local", meta: "1 row", value: "9 drops", status: "warning" }, [
                    // Raw drops → resting tiles, in the accessor.
                    Plan.series.buckets(TargetOpsRow, {
                        key: "vans", title: "Vans",
                        match: r => r.kind.hasTag("van").and(() => r.kind.unwrap("van").region.equal("local")),
                        label: r => r.kind.unwrap("van").name,
                        sub: r => r.kind.unwrap("van").sub,
                        events: r => r.kind.unwrap("van").drops.map((_$2, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                        markers: r => r.kind.unwrap("van").markers,
                    }),
                ]),
                Plan.series.section(TargetOpsRow, { key: "vans-regional", title: "Deliveries · Regional", meta: "1 row" }, [
                    // Stored tile records pass straight through, in their lanes.
                    Plan.series.buckets(TargetOpsRow, {
                        key: "regional", title: "Regional",
                        match: r => r.kind.hasTag("van").and(() => r.kind.unwrap("van").region.equal("regional")),
                        label: r => r.kind.unwrap("van").name,
                        sub: r => r.kind.unwrap("van").sub,
                        expand: r => r.kind.unwrap("van").detail,
                        lanes: r => r.kind.unwrap("van").lanes,
                        events: r => r.kind.unwrap("van").tiles,
                        markers: r => r.kind.unwrap("van").markers,
                    }),
                ]),
                // One strip PER HALL — the data step's entries — its members
                // stepped down into (`Plan.children`) and laid out like a
                // top-level list: the hall's presses, then its load. Hall 2
                // rests folded, as its DECLARED mean strip with its member
                // count; the host's state folds Hall 3.
                Plan.series.group(TargetOpsRow, {
                    key: "halls", title: "Halls",
                    match: r => r.kind.hasTag("hall"),
                    label: (_r, hall) => hall,
                    collapsed: (_r, hall) => hall.equal("Hall 2"),
                    summaryAggregate: "mean",
                    children: Plan.children(r => r.kind.unwrap("hall").members, [
                        Plan.series.span(TargetOpsRow, {
                            key: "presses", title: "Presses",
                            match: r => r.kind.hasTag("press"),
                            label: (_r, k) => k, id: true,
                            value: r => rateText(r.kind.unwrap("press").rate),
                            status: r => r.kind.unwrap("press").status,
                            expand: r => r.kind.unwrap("press").detail,
                            runs: r => jobRuns(r.kind.unwrap("press").jobs),
                            decisions: r => r.kind.unwrap("press").decisions,
                            ports: r => r.kind.unwrap("press").ports,
                        }),
                        Plan.series.heat(TargetOpsRow, {
                            key: "hall-load", title: "Hall load",
                            match: r => r.kind.hasTag("load"),
                            label: r => r.kind.unwrap("load").name,
                            sub: r => some(r.kind.unwrap("load").sub),
                            expand: r => r.kind.unwrap("load").detail,
                            cells: r => Plan.heatCells(weeklyCells(r.kind.unwrap("load").from, r.kind.unwrap("load").weekly), { min: 0, max: 100, warnAt: 95 }),
                        }),
                    ]),
                }),
                // The span grammar — proposal flavours (a forecast ghost, a
                // proposed cut, a declined run)…
                Plan.series.span(TargetOpsRow, {
                    key: "flavours", title: "Flavours",
                    match: r => r.kind.hasTag("press").and(() => r.kind.unwrap("press").series.equal("flavours")),
                    label: (_r, k) => k, id: true,
                    value: r => rateText(r.kind.unwrap("press").rate),
                    runs: r => jobRuns(r.kind.unwrap("press").jobs),
                }),
                // …sheets, an applied decision and a port on a stacked two-line gutter…
                Plan.series.span(TargetOpsRow, {
                    key: "detail", title: "Detail",
                    match: r => r.kind.hasTag("press").and(() => r.kind.unwrap("press").series.equal("detail")),
                    label: (_r, k) => k, id: true, stacked: true,
                    sub: r => r.kind.unwrap("press").sub,
                    expand: r => r.kind.unwrap("press").detail,
                    runs: r => jobRuns(r.kind.unwrap("press").jobs),
                    decisions: r => r.kind.unwrap("press").decisions,
                    ports: r => r.kind.unwrap("press").ports,
                }),
                // …a contract's presses nest under it (`children` — more of
                // this series, to any depth), and its row rolls their runs up…
                Plan.series.span(TargetOpsRow, {
                    key: "rollup", title: "Rollup",
                    match: r => r.kind.hasTag("press").and(() => r.kind.unwrap("press").series.equal("rollup")),
                    label: (_r, k) => k, id: true,
                    runs: r => jobRuns(r.kind.unwrap("press").jobs),
                    children: r => r.kind.unwrap("press").presses, rollup: "union",
                }),
                // …a delivery whose run lands past the window…
                Plan.series.span(TargetOpsRow, {
                    key: "delivery", title: "Deliveries",
                    match: r => r.kind.hasTag("press").and(() => r.kind.unwrap("press").series.equal("delivery")),
                    label: (_r, k) => k, id: true,
                    runs: r => jobRuns(r.kind.unwrap("press").jobs),
                }),
                // …and a contract rolled up by status, under a section.
                Plan.series.section(TargetOpsRow, { key: "contract-block", title: "Contracts", meta: "1 row" }, [
                    Plan.series.span(TargetOpsRow, {
                        key: "contracts", title: "Contracts",
                        match: r => r.kind.hasTag("press").and(() => r.kind.unwrap("press").series.equal("contracts")),
                        label: (_r, k) => k, id: true,
                        runs: r => jobRuns(r.kind.unwrap("press").jobs),
                        children: r => r.kind.unwrap("press").presses, rollup: "byStatus",
                    }),
                ]),
                // A section folded to start, resting as its strip — its
                // members' mean — with its value and status; a second heat
                // series of the same KIND, its own entry.
                Plan.series.section(TargetOpsRow, { key: "quality-block", title: "Quality", meta: "1 row", value: "95%", status: "warning", collapsed: true, summaryAggregate: "mean" }, [
                    Plan.series.heat(TargetOpsRow, {
                        key: "quality", title: "Quality index", subtitle: "same kind, own entry",
                        match: r => r.kind.hasTag("load"),
                        label: r => r.kind.unwrap("load").name,
                        sub: r => some(r.kind.unwrap("load").sub),
                        cells: r => Plan.heatCells(weeklyCells(r.kind.unwrap("load").from, r.kind.unwrap("load").weekly), { min: 0, max: 100 }),
                    }),
                ]),
                // Chips derived from raw shifts on a two-line gutter…
                Plan.series.cards(TargetOpsRow, {
                    key: "crews", title: "Crews",
                    match: r => r.kind.hasTag("crew").and(() => r.kind.unwrap("crew").pool.not()),
                    label: r => r.kind.unwrap("crew").name, stacked: true,
                    sub: r => r.kind.unwrap("crew").sub,
                    expand: r => r.kind.unwrap("crew").detail,
                    chips: r => shiftChips(r.kind.unwrap("crew").shifts),
                }),
                // …and chip records stored as they draw, one with an icon.
                Plan.series.section(TargetOpsRow, { key: "relief", title: "Relief pool", meta: "1 row" }, [
                    Plan.series.cards(TargetOpsRow, {
                        key: "pool", title: "Pool",
                        match: r => r.kind.hasTag("crew").and(() => r.kind.unwrap("crew").pool),
                        label: r => r.kind.unwrap("crew").name,
                        value: r => r.kind.unwrap("crew").value,
                        chips: r => r.kind.unwrap("crew").chips,
                    }),
                ]),
                Plan.series.events(TargetOpsRow, {
                    key: "milestones", title: "Milestones",
                    match: r => r.kind.hasTag("stream").and(() => r.kind.unwrap("stream").cadence.hasTag("none")),
                    label: r => r.kind.unwrap("stream").name, id: true,
                    value: r => some(East.print(r.kind.unwrap("stream").marks.length())),
                    expand: r => r.kind.unwrap("stream").detail,
                    marks: r => r.kind.unwrap("stream").marks,
                }),
                Plan.series.section(TargetOpsRow, { key: "programs", title: "Programs", meta: "1 row" }, [
                    Plan.series.events(TargetOpsRow, {
                        key: "releases", title: "Releases",
                        match: r => r.kind.hasTag("stream").and(() => r.kind.unwrap("stream").cadence.hasTag("some")),
                        label: r => r.kind.unwrap("stream").name, id: true, stacked: true,
                        sub: r => r.kind.unwrap("stream").cadence,
                        marks: r => r.kind.unwrap("stream").marks,
                    }),
                ]),
                Plan.series.table(TargetOpsRow, {
                    key: "delivered", title: "Delivered sheets",
                    match: r => r.kind.hasTag("tally"),
                    label: r => r.kind.unwrap("tally").name,
                    expand: r => r.kind.unwrap("tally").detail,
                    cells: r => r.kind.unwrap("tally").cells,
                    format: whole,
                }),
                // ONE machine, THREE views — a `views` series gives each
                // machine one row per member series, adjacent and in this
                // order: its jobs, its utilisation, its sheets. The label stays
                // the machine; the gutter's sub-line names the view.
                Plan.series.views(TargetOpsRow, {
                    key: "finishers", title: "Finishing", subtitle: "one machine, three views",
                    match: r => r.kind.hasTag("finisher"),
                }, [
                    Plan.series.span(TargetOpsRow, {
                        key: "finisher-jobs", title: "Finisher jobs",
                        label: r => r.kind.unwrap("finisher").name, id: true,
                        runs: r => jobRuns(r.kind.unwrap("finisher").jobs),
                    }),
                    Plan.series.chart(TargetOpsRow, {
                        key: "finisher-util", title: "Finisher · utilisation",
                        label: r => r.kind.unwrap("finisher").name, stacked: true, sub: _r => some("utilisation %"), height: "spark",
                        layers: r => [Chart.Line(weeklyPoints(week(27n), r.kind.unwrap("finisher").util), { x: p => p.week, y: p => p.pct })],
                    }),
                    Plan.series.table(TargetOpsRow, {
                        key: "finisher-sheets", title: "Finisher · sheets",
                        label: r => r.kind.unwrap("finisher").name, stacked: true, sub: _r => some("sheets · plan Δ"),
                        cells: r => r.kind.unwrap("finisher").sheets,
                        format: whole,
                    }),
                ]),
                // Rows no dataset holds — the planned shutdown, written out
                // once. `Plan.span` nests: the parent DECLARES its rollup and
                // the canvas derives the band from its two rows' runs.
                Plan.series.rows(TargetOpsRow, { key: "works", title: "Planned works", subtitle: "literal rows" }, [
                    Plan.span({
                        key: "shutdown", label: "Shutdown", rollup: "union", rows: [
                            Plan.span({ key: "elec", label: "Electrical", runs: [
                                Plan.run({ key: "iso", start: week(33n), end: week(34n), label: "ISOLATE", state: "confirmed" }),
                            ] }),
                            Plan.span({ key: "mech", label: "Mechanical", runs: [
                                Plan.run({ key: "rollers", start: week(34n), end: week(36n), label: "ROLLERS", state: "recommended" }),
                            ] }),
                        ],
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(TargetOpsRow)));
            // The series are PICKED: the library's Series tab lists every one
            // by title, subtitle and kind, each with its eye, and the canvas
            // shows those switched on, in this order. Which are off is the
            // viewer's own state, persisted under its key; Programs starts off.
            const shown = $.let(Plan.pick("ex.plan.target.pick", all, { hidden: ["programs"] }));
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) },
                resolution: "week", resolutions: ["month", "week", "day"], now: week(31n),
            }));
            // The toolbar is SEEDED slice state: the applied window is the
            // range chip (`JUN 29 – SEP 20 · 84d`), and two saved cohorts sit
            // beside the filter builder with `Late risk` active — their
            // counts are live over the horizon, never printed. A slice range
            // is CLOSED — both ends inclusive — so the twelve weeks W27–W38
            // end the millisecond before W39.
            const slice = $.let(Slice.bind([TargetHorizonRow], "ex.plan.target", cfg, Slice.state({
                range: some(variant("datetime", { from: week(27n), to: week(39n).addMilliseconds(-1n) })),
                cohorts: [
                    { id: "late", name: "Late risk", filters: [variant("string", { fieldId: "risk", op: variant("eq", "late") })] },
                    { id: "empty", name: "Empty", filters: [variant("float", { fieldId: "sheets", op: variant("lte", 0.0) })] },
                ],
                activeCohorts: new Set(["late"]),
            }), horizon.read(), none));

            // ── Expand in place ────────────────────────────────────────
            // ONE resolver serves every declaring row, called with the row's
            // id at interaction time. The canvas hands it the PLOT column with
            // the shared grid and now line drawn behind it, so `Sparkline` —
            // the axis-free chart — fills that column edge to edge and lines up
            // with the buckets above.
            const util = $.let(East.Array.generate(12n, FloatType, (_$2, i) =>
                i.multiply(19n).remainder(48n).toFloat().add(50.0)));
            const expandRender = $.const(East.function([Plan.Types.RowId], UIComponentType, (_$2, _id) => (
                <Sparkline data={util} type="area" color="link" width="100%" height="100%" />
            )));
            // The GUTTER half: an expanded row's gutter grows with it, and what
            // fills the room is the author's — identity lines, then a fill
            // meter (the shared Progress at its smallest size).
            const GutterFacts = StructType({ a: StringType, b: StringType, fill: FloatType });
            const expandGutter = $.const(East.function([Plan.Types.RowId], UIComponentType, ($2, id) => {
                const facts = $2.const(new Map([
                    ["ontime", { a: "TARGET 100 · MIN 92", b: "BREACH W34–W36 · 3 wk", fill: 0.94 }],
                    ["van2", { a: "8 TILES · 2 LANES", b: "BREACH W29", fill: 0.6 }],
                    ["H1-P04", { a: "12k/h · FILL", b: "J-4624 · 112 k sheets · 74%", fill: 0.74 }],
                    ["h1-load", { a: "MEAN 73 · PEAK 96", b: "BREACH W33 · 1 wk", fill: 0.96 }],
                    ["H1-P09", { a: "12k sheets/h · FILL", b: "J-4693 · 104 k sheets · 81%", fill: 0.81 }],
                    ["crewA", { a: "152h → 168h", b: "1 CUT · 2 PROPOSED", fill: 0.9 }],
                    ["milestones", { a: "5 MARKS", b: "1 EXCEPTION · W34", fill: 0.2 }],
                    ["delivered", { a: "NET 754 k sheets", b: "2 SHORT WEEKS", fill: 0.55 }],
                ]), DictType(StringType, GutterFacts));
                const blank = $2.const({ a: "", b: "", fill: 0.0 }, GutterFacts);
                // A row's id is its series and the path of keys to it — its
                // last key is its entry's, which the facts are keyed by.
                const path = $2.let(id.unwrap("entry").path);
                const f = $2.let(facts.get(path.get(path.size().subtract(1n)), () => blank));
                return (
                    <Box>
                        <Text>{f.a}</Text>
                        <Text>{f.b}</Text>
                        <Box width="108px">
                            <Progress value={f.fill.multiply(100.0)} size="xs" tone="brand" />
                        </Box>
                    </Box>
                );
            }));

            // ── Popover and hover ──────────────────────────────────────
            // ONE stored function each over Plan.Types.ElementRef — every arm
            // carries the row's id; rich bodies build lazily at interaction
            // time, and a none result opens no surface.
            const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
                const noBody = $2.const(none, OptionType(UIComponentType));
                const p03 = $2.const(Plan.ref("presses", "Hall 1", "H1-P03"));
                const p09 = $2.const(Plan.ref("detail", "H1-P09"));
                // A section's header is a row too: its strip's cells name it.
                const quality = $2.const(Plan.sectionRef("quality-block"));
                return ref.match({
                    run: (_$3, ev) => ev.run.equal("j4663").ifElse(
                        () => some(<Text>Proposed by run 412 — fills the W32 idle window.</Text>),
                        () => noBody),
                    mark: (_$3, ev) => East.equal(ev.row, p03).and(() => ev.mark.equal("d1")).ifElse(
                        () => some(<Text>Schedule J-4663</Text>),
                        () => East.equal(ev.row, p09).and(() => ev.mark.equal("d1")).ifElse(
                            () => some(<Text>Approved by run 411.</Text>),
                            () => ev.mark.equal("rel").ifElse(
                                () => some(<Text>Go/no-go review.</Text>),
                                () => noBody))),
                    event: (_$3, ev) => ev.event.equal("m5").ifElse(
                        () => some(<Text>Load 41 · 8 pallets</Text>),
                        () => noBody),
                    chip: (_$3, ev) => ev.chip.equal("s3").ifElse(
                        () => some(<Text>Overtime proposal.</Text>),
                        () => noBody),
                    cell: (_$3, ev) => East.equal(ev.row, quality).ifElse(
                        () => some(<Text>Quality held above 92 all quarter.</Text>),
                        () => noBody),
                }, _$3 => noBody);
            }));
            const hover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
                const noBody = $2.const(none, OptionType(UIComponentType));
                return ref.match({
                    run: (_$3, ev) => ev.run.equal("j4591").ifElse(
                        () => some(<Text>Waiting on proof 4 — 2.6× median dwell.</Text>),
                        () => noBody),
                    event: (_$3, ev) => ev.event.equal("m3").ifElse(
                        () => some(<Text>Urgent — overtime window</Text>),
                        () => noBody),
                }, _$3 => noBody);
            }));
            // Behavior props — bound once so memoized renderers keep identity.
            const onRow = $.const(East.function([Plan.Types.RowId], NullType, (_$2, _id) => null));
            // ONE element callback (#824) — a run, tile, mark, chip, cell or
            // link ribbon, by the same ref the popover resolver receives.
            const onElementClick = $.const(East.function([Plan.Types.ElementRef], NullType, (_$2, _ref) => null));
            const onGroupToggle = $.const(East.function([Plan.Types.GroupToggleEvent], NullType, (_$2, _e) => null));
            const onGrainChange = $.const(East.function([Plan.Types.Grain], NullType, (_$2, _g) => null));

            // ── The bound ui state, held by the host ───────────────────
            // The canvas's selection, the rows folded or opened against what
            // they declare, the expanded charts, and a row to bring into view
            // — in `State.bind` at `Plan.Types.UiState`, seeded by
            // `Plan.uiState(…)`. The canvas reads it and writes the user's
            // actions back; the host's controls write it too. Every row is
            // named by its id: a hall is `Plan.ref("halls", hall)`, a press
            // `Plan.ref("presses", hall, press)`. Hall 3 starts folded.
            const ui = $.let(State.bind([Plan.Types.UiState], "ex.plan.target.ui",
                Plan.uiState({ collapsed: [Plan.ref("halls", "Hall 3")] })));
            const now = $.let(ui.read());
            const hallIds = $.let(halls.toArray((_$2, _g, hall) => Plan.ref("halls", hall)));
            const fleet = $.let(raw.filter((_$2, r) => r.unwrap().kind.hasTag("press").and(() => r.unwrap().hall.hasTag("some"))));
            const kpi = $.const(Plan.ref("ontime", "ontime"));
            // Bring a press into view: select it, and REQUEST its focus — the
            // canvas opens its hall if it is folded, scrolls to it, and clears
            // the request once it has.
            const goTo = $.const(East.function([StringType], NullType, ($2, key) => {
                const s = $2.let(ui.read());
                const id = $2.let(Plan.ref("presses", fleet.get(key).unwrap().hall.unwrap("some"), key));
                $2(ui.write(East.value({
                    selected: some(id), collapsed: s.collapsed, expanded: s.expanded, charts: s.charts, focus: some(id),
                }, Plan.Types.UiState)));
            }));
            const foldAll = $.const(East.function([], NullType, ($2) => {
                const s = $2.let(ui.read());
                $2(ui.write(East.value({
                    selected: s.selected, collapsed: hallIds, expanded: [], charts: s.charts, focus: s.focus,
                }, Plan.Types.UiState)));
            }));
            const openAll = $.const(East.function([], NullType, ($2) => {
                const s = $2.let(ui.read());
                $2(ui.write(East.value({
                    selected: s.selected, collapsed: [], expanded: hallIds, charts: s.charts, focus: s.focus,
                }, Plan.Types.UiState)));
            }));
            const noCharts = $.const([], ArrayType(Plan.Types.RowId));
            const kpiChart = $.const([kpi], ArrayType(Plan.Types.RowId));
            const chart = $.const(East.function([], NullType, ($2) => {
                const s = $2.let(ui.read());
                const charts = $2.let(s.charts.size().greater(0n).ifElse(() => noCharts, () => kpiChart));
                $2(ui.write(East.value({
                    selected: s.selected, collapsed: s.collapsed, expanded: s.expanded, charts, focus: s.focus,
                }, Plan.Types.UiState)));
            }));
            // The picker's presses are the source's own keys.
            const keys = $.let(fleet.toArray((_$2, _r, k) => k));
            const picked = $.let(now.selected.match({
                some: (_$2, id) => East.print(id),
                none: (_$2) => "nothing",
            }), StringType);
            return (
                <VStack gap="2" align="stretch">
                    <HStack gap="2">
                        <Select value="H3-P22" onChange={goTo} size="sm"
                            items={keys.map((_$2, k) => Select.Item(k, East.str`Go to ${k}`))} />
                        <Button size="xs" onClick={foldAll}>Fold halls</Button>
                        <Button size="xs" onClick={openAll}>Open halls</Button>
                        <Button size="xs" onClick={chart}>On-time chart</Button>
                    </HStack>
                    {/* A bounded host: the Plan fills it, and the canvas
                        scrolls its own rows in main. */}
                    <Box height="720px">
                        <Plan
                            id="target"
                            slice={{ slice, affordances: ["cohort", "filter", "search", "range", "resolution", "brush", "summary"] }}
                            axis={axis}
                            // The link graph (R1) — the edges cover the routing
                            // permutations: forward, a same-row seam feed,
                            // loopbacks, a rising loop and a landing past the
                            // window; then the W31 transfer between two presses,
                            // its `text` the author's way of saying it. Each moves
                            // a QUANTITY (#824): its value weighs the ribbon and its
                            // caption prints on it. Hover a linked row for its
                            // links-focus control.
                            links={[
                                Plan.link({ key: "l1", from: Plan.ref("flavours", "H1-P07"), fromRun: "run", to: Plan.ref("detail", "H1-P09"), toRun: "a", quantity: Plan.quantity(24, { unit: "k sheets" }) }),
                                Plan.link({ key: "l2", from: Plan.ref("detail", "H1-P09"), fromRun: "a", to: Plan.ref("detail", "H1-P09"), toRun: "b", quantity: Plan.quantity(40, { unit: "k sheets" }) }),
                                Plan.link({ key: "l3", from: Plan.ref("detail", "H1-P09"), fromRun: "b", to: Plan.ref("rollup", "Contract A", "H1-P03"), toRun: "j4663", quantity: Plan.quantity(88, { unit: "k sheets" }) }),
                                Plan.link({ key: "l4", from: Plan.ref("rollup", "Contract A", "H1-P03"), fromRun: "j4642", to: Plan.ref("rollup", "Contract A", "H2-P11"), toRun: "j4723", quantity: Plan.quantity(32, { unit: "k sheets" }) }),
                                Plan.link({ key: "l5", from: Plan.ref("rollup", "Contract A", "H2-P11"), fromRun: "j4723", to: Plan.ref("detail", "H1-P09"), toRun: "b", quantity: Plan.quantity(18, { unit: "k sheets" }) }),
                                Plan.link({ key: "l6", from: Plan.ref("detail", "H1-P09"), fromRun: "b", to: Plan.ref("delivery", "dlv"), toRun: "d1", quantity: Plan.quantity(91, { unit: "k sheets" }) }),
                                Plan.link({
                                    key: "t-w31",
                                    from: Plan.ref("presses", "Hall 1", "H1-P03"), fromRun: "j4642",
                                    to: Plan.ref("presses", "Hall 1", "H1-P04"), toRun: "proof",
                                    quantity: Plan.quantity(24, { unit: "k sheets", text: "−24 k sheets" }),
                                }),
                            ]}
                            data={rows}
                            pick={shown}
                            library={[Plan.library.series()]}
                            ui={ui}
                            expandRender={expandRender}
                            expandGutter={expandGutter}
                            popover={popover}
                            hover={hover}
                            onSelect={onRow}
                            onElementClick={onElementClick}
                            onGroupToggle={onGroupToggle}
                            onGrainChange={onGrainChange}
                            footer={[
                                { text: "512 RESOURCES · 12 GROUPS · 3 IN VIEW" },
                                { text: "318 OBSERVED · 966 PLANNED" },
                                { text: "3 EXCEPTIONS", tone: "warning" },
                                { text: "RUN 412 · W27–W38", end: true },
                            ]}
                            style={{ height: "fill" }}
                        />
                    </Box>
                    <Text.MonoLabel>{East.str`SELECTED · ${picked} · ${East.print(now.collapsed.size())} FOLDED · ${East.print(now.expanded.size())} OPENED`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>);
    }),
    inputs: [],
});

// ============================================================================
// planVariants — THE Plan configurator (#571): axis presets × style sweeps
// ============================================================================

/** A press job, its label already composed. */
export const VariantsJob = StructType({
    key: StringType, label: StringType,
    start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** One fortnightly reading of a measure. */
export const VariantsMeasure = StructType({ week: DateTimeType, pct: FloatType });
/** A van drop. */
export const VariantsAlloc = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
/** A crew shift, its label already composed. */
export const VariantsShift = StructType({
    key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
});
/** One table reading — a bucket's instant and its value, if it has one. */
export const VariantsReading = StructType({ at: DateTimeType, value: OptionType(FloatType) });
/**
 * ONE flat source: `series` names the series that claims the row, and every
 * channel a row's kind does not read stays empty.
 */
export const VariantsOpsRow = StructType({
    series: StringType, label: StringType,
    sub: OptionType(StringType),
    jobs: ArrayType(VariantsJob),
    points: ArrayType(VariantsMeasure),
    cells: ArrayType(Plan.Types.HeatCell),
    allocs: ArrayType(VariantsAlloc),
    act: ArrayType(VariantsReading),
    plan: ArrayType(VariantsReading),
    shifts: ArrayType(VariantsShift),
    marks: ArrayType(Plan.Types.EventMark),
});

/**
 * Every row kind on purpose: the density sweep re-rhythms them all at once —
 * compact tightens the shared row and the bars in it, while a two-line gutter
 * keeps its floor and a stacked table a line per position — and the gutter
 * sweep re-widths every label. The readings are fortnightly from W27.
 */
export const planVariantsOps = e3.input("plan_variants_ops", DictType(StringType, VariantsOpsRow), variant("value", new Map([
    ["util", { series: "util", label: "Util %", sub: none, jobs: [],
      points: [
          { week: new Date("2026-06-29T00:00:00Z"), pct: 46.0 }, { week: new Date("2026-07-13T00:00:00Z"), pct: 58.0 },
          { week: new Date("2026-07-27T00:00:00Z"), pct: 66.0 }, { week: new Date("2026-08-10T00:00:00Z"), pct: 72.0 },
          { week: new Date("2026-08-24T00:00:00Z"), pct: 84.0 }, { week: new Date("2026-09-07T00:00:00Z"), pct: 96.0 },
      ],
      cells: [], allocs: [], act: [], plan: [], shifts: [], marks: [] }],
    ["p03", { series: "press", label: "H1-P03", sub: some("12k sheets/h"),
      jobs: [
          { key: "j4642", label: "RUN · J-4642", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("in-progress", null) },
          { key: "j4663", label: "RUN · J-4663", start: new Date("2026-08-03T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
      ],
      points: [], cells: [], allocs: [], act: [], plan: [], shifts: [], marks: [] }],
    ["p04", { series: "press", label: "H1-P04", sub: none,
      jobs: [
          { key: "j4624", label: "RUN · J-4624", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("actual", null) },
      ],
      points: [], cells: [], allocs: [], act: [], plan: [], shifts: [], marks: [] }],
    ["load", { series: "load", label: "H2 load", sub: some("%/wk"), jobs: [], points: [],
      cells: [
          { at: variant("time", new Date("2026-06-29T00:00:00Z")), value: some(46.0), label: some("46") },
          { at: variant("time", new Date("2026-07-13T00:00:00Z")), value: some(58.0), label: some("58") },
          { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(66.0), label: some("66") },
          { at: variant("time", new Date("2026-08-10T00:00:00Z")), value: some(72.0), label: some("72") },
          { at: variant("time", new Date("2026-08-24T00:00:00Z")), value: some(84.0), label: some("84") },
          { at: variant("time", new Date("2026-09-07T00:00:00Z")), value: some(96.0), label: some("96") },
      ],
      allocs: [], act: [], plan: [], shifts: [], marks: [] }],
    ["van1", { series: "van", label: "Van 1", sub: none, jobs: [], points: [], cells: [],
      allocs: [
          { key: "a1", at: new Date("2026-07-06T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a2", at: new Date("2026-07-27T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
          { key: "a3", at: new Date("2026-08-10T00:00:00Z"), state: variant("confirmed", null) },
      ],
      act: [], plan: [], shifts: [], marks: [] }],
    // Delivered sheets and their signed Δ against plan — the table row's
    // two positions.
    ["desp", { series: "desp", label: "Delivered · k", sub: none, jobs: [], points: [], cells: [], allocs: [],
      act: [
          { at: new Date("2026-06-29T00:00:00Z"), value: some(69.0) }, { at: new Date("2026-07-13T00:00:00Z"), value: some(87.0) },
          { at: new Date("2026-07-27T00:00:00Z"), value: some(99.0) }, { at: new Date("2026-08-10T00:00:00Z"), value: some(108.0) },
          { at: new Date("2026-08-24T00:00:00Z"), value: some(126.0) }, { at: new Date("2026-09-07T00:00:00Z"), value: some(144.0) },
      ],
      plan: [
          { at: new Date("2026-06-29T00:00:00Z"), value: some(-24.0) }, { at: new Date("2026-07-13T00:00:00Z"), value: some(-12.0) },
          { at: new Date("2026-07-27T00:00:00Z"), value: some(-4.0) }, { at: new Date("2026-08-10T00:00:00Z"), value: some(2.0) },
          { at: new Date("2026-08-24T00:00:00Z"), value: some(14.0) }, { at: new Date("2026-09-07T00:00:00Z"), value: some(26.0) },
      ],
      shifts: [], marks: [] }],
    ["crewA", { series: "crew", label: "Crew A", sub: none, jobs: [], points: [], cells: [], allocs: [], act: [], plan: [],
      shifts: [
          { key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), label: "80h", state: variant("confirmed", null) },
          { key: "s2", from: new Date("2026-07-27T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z"), label: "+64h", state: variant("proposed", variant("recommended", null)) },
      ],
      marks: [] }],
    ["ms", { series: "ms", label: "Milestones", sub: none, jobs: [], points: [], cells: [], allocs: [], act: [], plan: [], shifts: [],
      marks: [
          { key: "k", at: variant("time", new Date("2026-07-13T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
          { key: "a", at: variant("time", new Date("2026-08-17T00:00:00Z")), kind: variant("exception", null), icon: none, label: some("AUDIT") },
      ] }],
    ["p11", { series: "gpress", label: "H3-P11", sub: none,
      jobs: [
          { key: "j4903", label: "RUN · J-4903", start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), state: variant("confirmed", null) },
      ],
      points: [], cells: [], allocs: [], act: [], plan: [], shifts: [], marks: [] }],
])));

/**
 * THE Plan configurator — the slot-2 variant-space surface the retired Gantt /
 * Planner configurators held (#571). ONE live canvas; every axis feeds it as
 * an expression. The window presets are whole `Plan.axis` VALUES riding a
 * typed preset struct: the ops week window, the year roadmap at month
 * resolution, and the 14-day sprint at day resolution with `ddd DD` labels
 * (the #309 pinned-day-columns contract the Planner's `day` preset and the
 * AlignedStack date-axis panel guarded). The style sweeps ride `style` —
 * density rhythm and gutter width — over a canvas holding every row kind, so
 * one click re-rhythms them all; every callback (select / element click /
 * group toggle / grain change) logs to the aside, the retired configurators'
 * pattern. The canvas reads a source bound from e3; the configurator's axes
 * are the viewer's own state. Fill sizing, and each kind's whole grammar, are
 * `planTargetState`'s — the measure rows' `planMeasures`'.
 */
export const planVariants = example({
    keywords: [
        "Plan", "configurator", "Configurator", "variants", "preset", "axis", "window",
        "resolution", "month", "week", "day", "roadmap", "sprint", "ops", "format",
        "ddd", "#309", "density", "condensed", "compact", "comfortable", "gutterWidth",
        "gutter", "style", "onSelect", "onElementClick", "ElementRef", "onGroupToggle", "onGrainChange",
        "callback", "aside", "Reactive", "State", "SegmentGroup", "Select", "getTag",
        "every row kind", "span", "chart", "expandable", "heat", "buckets", "table",
        "tableSeries", "vertical", "cards", "events", "group", "section", "row id", "print",
        "Data.bind", "bound", "e3.input",
    ],
    description: "Plan configurator — axis window presets (ops week / year roadmap / 14-day sprint) with density and gutter-width sweeps over every row kind on one live canvas bound from e3; every callback logs to the aside",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The source, bound from e3 — every row kind, one flat dataset.
            const ops = $.let(Data.bind(planVariantsOps));
            // Monday of ISO week n, 2026 — the ops window is W27–W38
            // (half-open at W39), now = W31; the roadmap preset walks the
            // whole ISO year and the sprint preset a 14-day slice of it.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const series = $.const([
                // The spark's gutter opens it to the expanded chart, at any density.
                Plan.series.chart(VariantsOpsRow, {
                    key: "util", title: "Utilisation",
                    match: r => r.series.equal("util"),
                    label: r => r.label, id: true, height: "spark", expandable: true,
                    layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })],
                }),
                Plan.series.span(VariantsOpsRow, {
                    key: "press", title: "Press jobs",
                    match: r => r.series.equal("press"),
                    label: r => r.label, id: true, sub: r => r.sub,
                    runs: r => r.jobs.map((_$, j) => Plan.run({
                        key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                    })),
                }),
                Plan.series.heat(VariantsOpsRow, {
                    key: "load", title: "Hall load",
                    match: r => r.series.equal("load"),
                    label: r => r.label, sub: r => r.sub,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                }),
                Plan.series.buckets(VariantsOpsRow, {
                    key: "van", title: "Van drops",
                    match: r => r.series.equal("van"),
                    label: r => r.label,
                    events: r => r.allocs.map((_$, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                }),
                // The positions STACKED — the row grows a line per position.
                Plan.series.table(VariantsOpsRow, {
                    key: "desp", title: "Deliveries",
                    match: r => r.series.equal("desp"),
                    label: r => r.label, split: "vertical",
                    series: r => [
                        Plan.tableSeries({ strong: true, cells: Plan.tableCells(r.act) }),
                        Plan.tableSeries({
                            tone: "muted",
                            format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                            cells: Plan.tableCells(r.plan),
                        }),
                    ],
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.cards(VariantsOpsRow, {
                    key: "crew", title: "Crew shifts",
                    match: r => r.series.equal("crew"),
                    label: r => r.label,
                    chips: r => r.shifts.map((_$, s) =>
                        Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
                }),
                Plan.series.events(VariantsOpsRow, {
                    key: "ms", title: "Milestones",
                    match: r => r.series.equal("ms"),
                    label: r => r.label, id: true,
                    marks: r => r.marks,
                }),
                // A section header, so the group-toggle callback has something to fire on.
                Plan.series.section(VariantsOpsRow, { key: "hall3", title: "Hall 3", meta: "1 row" }, [
                    Plan.series.span(VariantsOpsRow, {
                        key: "gpress", title: "Grouped jobs",
                        match: r => r.series.equal("gpress"),
                        label: r => r.label, id: true,
                        runs: r => r.jobs.map((_$, j) => Plan.run({
                            key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                        })),
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(VariantsOpsRow)));
            // Every preset is DATA — a whole axis value in a typed struct, so
            // switching presets swaps window, resolution, format and now
            // through ONE expression-fed prop.
            const presets = $.const([
                { key: "ops", axis: Plan.axis({
                    window: { min: week(27n), max: week(39n) },
                    resolution: "week", resolutions: ["month", "week", "day"], now: week(31n),
                }) },
                { key: "roadmap", axis: Plan.axis({
                    window: { min: week(1n), max: week(53n) },
                    resolution: "month", format: "MMM", now: week(31n),
                }) },
                { key: "sprint", axis: Plan.axis({
                    window: { min: week(30n), max: week(32n) },
                    resolution: "day", format: "ddd DD", now: week(31n),
                }) },
            ], ArrayType(StructType({ key: StringType, axis: Plan.Types.Axis })));
            const presetKeys = $.const(["ops", "roadmap", "sprint"], ArrayType(StringType));
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));
            const gutters = $.const(["168px", "200px", "240px"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "plan_variants_preset", "ops"));
            const densityBind = $.let(State.bind([StringType], "plan_variants_density", "compact"));
            const gutterBind = $.let(State.bind([StringType], "plan_variants_gutter", "168px"));
            const lastEventBind = $.let(State.bind([StringType], "plan_variants_last_event", ""));
            const pKey = $.let(presetBind.read());
            const dKey = $.let(densityBind.read());
            const gKey = $.let(gutterBind.read());
            const lastEvent = $.let(lastEventBind.read());
            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onGutter = $.const(East.function([StringType], NullType, ($, next) => { $(gutterBind.write(next)); }));

            // The interactive surface — every callback writes the aside line,
            // naming the row by its id (the series that made it and the path
            // of keys to it) in its `.east` text.
            const onSelect = $.const(East.function([Plan.Types.RowId], NullType, ($, id) => {
                $(lastEventBind.write(East.str`onSelect · ${East.print(id)}`));
            }));
            // ONE callback for every element (#824) — the ref's arm says which
            // kind was clicked, and each arm names its row and element.
            const onElementClick = $.const(East.function([Plan.Types.ElementRef], NullType, ($, ref) => {
                $(lastEventBind.write(East.str`onElementClick · ${ref.getTag()} · ${East.print(ref)}`));
            }));
            const onGroupToggle = $.const(East.function([Plan.Types.GroupToggleEvent], NullType, ($, ev) => {
                const state = $.let(ev.expanded.ifElse(() => "expanded", () => "collapsed"), StringType);
                $(lastEventBind.write(East.str`onGroupToggle · ${East.print(ev.row)} → ${state}`));
            }));
            const onGrainChange = $.const(East.function([Plan.Types.Grain], NullType, ($, grain) => {
                $(lastEventBind.write(East.str`onGrainChange · ${grain.getTag()}`));
            }));

            const sel = $.let(presets.filter((_$, o) => o.key.equal(pKey)).get(0n, _$ => presets.get(0n)));
            const densitySel = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
            return (
                <Configurator
                    controls={[
                        Configurator.Control("Preset", pKey,
                            <Select value={pKey} onChange={onPreset} size="sm"
                                items={presetKeys.map((_$, s) => Select.Item(s, s))} />),
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Gutter", gKey,
                            <SegmentGroup value={gKey} onChange={onGutter} size="sm"
                                items={gutters.map((_$, g) => SegmentGroup.Item(g, <Text>{g}</Text>))} />),
                    ]}
                    preview={
                        <Plan
                            axis={sel.axis}
                            data={ops}
                            series={series}
                            onSelect={onSelect}
                            onElementClick={onElementClick}
                            onGroupToggle={onGroupToggle}
                            onGrainChange={onGrainChange}
                            style={{ density: densitySel, gutterWidth: gKey }}
                        />
                    }
                    live
                    aside={{
                        label: "Events · Reactive",
                        body: (
                            <Badge colorPalette="brand" variant="outline">
                                {East.equal(lastEvent.length(), 0n).ifElse(_$ => "Interact with the canvas", _$ => lastEvent)}
                            </Badge>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Resolution", sel.axis.unwrap("time").resolution.getTag()),
                        Configurator.Spec("Rows", East.print(ops.read().size())),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planMeasures — measure rows over weekly readings, folded to the resolution
// the slice states (#824)
// ============================================================================

/**
 * A measure — its readings a week apiece from W23, the window's first week, a
 * week with none read nothing: `readings` the series its row draws, and
 * `second` the set a row pairs with it — the stacked columns' second hall, the
 * dual chart's on-time line, a table's Δ against plan; `lo` / `hi` a band's
 * bounds; and a finishing line's capacity, stored in the element vocabulary
 * itself (`segments`). A measure nests (`children`): a hall holds its presses,
 * a top its contracts, a contract its orders — the hierarchy is the data's own
 * (#822), to whatever depth it has.
 */
export const Measure = RecursiveType((self) => StructType({
    series: StringType, label: StringType,
    sub: OptionType(StringType), value: OptionType(StringType),
    readings: ArrayType(OptionType(FloatType)),
    second: ArrayType(OptionType(FloatType)),
    lo: ArrayType(FloatType), hi: ArrayType(FloatType),
    segments: ArrayType(Plan.Types.SegmentCell),
    children: DictType(StringType, self),
}));

/** On-time %, a week apiece from W23: July's weeks run under the 92 breach. */
const MEASURE_ON_TIME = [some(96.1), some(96.4), some(96.8), some(97.0), some(96.2), some(91.0), some(89.4), some(88.9), some(90.6), some(93.8), some(94.0), some(94.2)];

/** Sheets printed, thousands a week — Hall 1's, then Hall 2's. */
const MEASURE_PRINTED_H1 = [some(28.0), some(34.0), some(40.0), some(29.0), some(35.0), some(41.0), some(30.0), some(36.0), some(42.0), some(31.0), some(37.0), some(43.0)];
const MEASURE_PRINTED_H2 = [some(14.0), some(19.0), some(24.0), some(16.0), some(21.0), some(26.0), some(18.0), some(23.0), some(15.0), some(20.0), some(25.0), some(17.0)];

/** An order's delivered sheets, thousands a week — the week of 3 August none. */
const MEASURE_ACT = [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)];

/** The Δ against plan beside them — some weeks none. */
const MEASURE_DELTA = [some(-8.0), some(-6.5), some(-5.0), none, some(-2.0), some(-0.5), some(1.0), none, some(4.0), some(5.5), some(7.0), none];

/** What left as the sheets came in. */
const MEASURE_OUT = [some(-12.0), some(-15.0), some(-18.0), some(-21.0), some(-24.0), some(-27.0), some(-30.0), some(-33.0), some(-36.0), some(-39.0), some(-42.0), some(-45.0)];

/**
 * Twelve weeks of every measure, W23–W34 — from the first Monday of June, so
 * the first month's column starts with the first week; the weeks after now
 * (W27) read ahead.
 */
export const planMeasureReadings = e3.input("plan_measure_readings", DictType(StringType, Measure), variant("value", new Map([
    // ── Output ──
    ["spark", { series: "spark", label: "On-time", sub: none, value: some("94.2%"),
      readings: MEASURE_ON_TIME, second: [], lo: [], hi: [], segments: [], children: new Map() }],
    // A running total: each week the sheets printed so far.
    ["cum", { series: "cum", label: "Cumulative · k", sub: none, value: some("194 k sheets"),
      readings: [some(40.0), some(54.0), some(68.0), some(82.0), some(96.0), some(110.0), some(124.0), some(138.0), some(152.0), some(166.0), some(180.0), some(194.0)],
      second: [], lo: [], hi: [], segments: [], children: new Map() }],
    ["stacked", { series: "stacked", label: "Printed · k", sub: some("k/wk"), value: none,
      readings: MEASURE_PRINTED_H1, second: MEASURE_PRINTED_H2, lo: [], hi: [], segments: [], children: new Map() }],
    ["ppm", { series: "ppm", label: "Defects · ppm", sub: none, value: some("161"),
      readings: [some(120.0), some(157.0), some(134.0), some(171.0), some(148.0), some(125.0), some(162.0), some(139.0), some(176.0), some(153.0), some(130.0), some(167.0)],
      second: [], lo: [], hi: [], segments: [], children: new Map() }],
    ["refs", { series: "refs", label: "On-time + refs", sub: none, value: none,
      readings: MEASURE_ON_TIME, second: [], lo: [], hi: [], segments: [], children: new Map() }],
    // Output columns on the left axis; the on-time line and its ±3 band on the right.
    ["dual", { series: "dual", label: "Out + on-time", sub: none, value: none,
      readings: MEASURE_PRINTED_H1, second: MEASURE_ON_TIME,
      lo: [93.1, 93.4, 93.8, 94.0, 93.2, 88.0, 86.4, 85.9, 87.6, 90.8, 91.0, 91.2],
      hi: [99.1, 99.4, 99.8, 100.0, 99.2, 94.0, 92.4, 91.9, 93.6, 96.8, 97.0, 97.2],
      segments: [], children: new Map() }],
    // ── Load ──
    // A hall with no readings of its own: its row is its presses' per-bucket
    // mean. H1-P03 read nothing in the week of 29 June; H1-P04 nothing in
    // August, which folds to a month with no data.
    ["hall1", { series: "depth", label: "Hall 1", sub: none, value: none, readings: [], second: [], lo: [], hi: [], segments: [],
      children: new Map([
          ["p03h", { series: "depth", label: "H1-P03", sub: none, value: none, second: [], lo: [], hi: [], segments: [], children: new Map(),
            readings: [some(46.0), some(52.0), some(58.0), some(61.0), none, some(72.0), some(78.0), some(84.0), some(90.0), some(96.0), some(98.0), some(92.0)] }],
          ["p04h", { series: "depth", label: "H1-P04", sub: none, value: none, second: [], lo: [], hi: [], segments: [], children: new Map(),
            readings: [some(44.0), some(50.0), some(55.0), some(60.0), some(63.0), some(70.0), some(74.0), some(80.0), some(86.0), none, none, none] }],
      ]) }],
    ["peak", { series: "peak", label: "Hall 2 peak %", sub: none, value: none,
      readings: [some(45.0), some(62.0), some(79.0), some(46.0), some(63.0), some(80.0), some(47.0), some(64.0), some(81.0), some(48.0), some(65.0), some(82.0)],
      second: [], lo: [], hi: [], segments: [], children: new Map() }],
    // Crew A's booked fraction of its hours, a week apiece.
    ["booked", { series: "booked", label: "Crew A", sub: some("booked h"), value: none,
      readings: [some(0.9), some(0.84), some(0.79), some(0.74), some(0.68), some(0.62), some(0.57), some(0.52), some(0.46), some(0.41), some(0.35), some(0.3)],
      second: [], lo: [], hi: [], segments: [], children: new Map() }],
    // ── Finishing ──
    // Capacity compositions — plain `{ fill, weight, label }` records. June's
    // and August's are their month's only one, so they keep their labels.
    ["finishing", { series: "segments", label: "Finishing line", sub: some("capacity"), value: none,
      readings: [], second: [], lo: [], hi: [], children: new Map(),
      segments: [
          { at: variant("time", new Date("2026-06-29T00:00:00Z")), segments: [
              { fill: variant("success", null), weight: 60.0, label: some("60%") },
              { fill: variant("warning", null), weight: 25.0, label: some("25%") },
              { fill: variant("slack", null), weight: 15.0, label: none },
          ] },
          { at: variant("time", new Date("2026-07-06T00:00:00Z")), segments: [
              { fill: variant("success", null), weight: 70.0, label: some("70%") },
              { fill: variant("slack", null), weight: 30.0, label: none },
          ] },
          { at: variant("time", new Date("2026-07-13T00:00:00Z")), segments: [
              { fill: variant("danger", null), weight: 40.0, label: some("40%") },
              { fill: variant("free", null), weight: 60.0, label: none },
          ] },
          { at: variant("time", new Date("2026-08-10T00:00:00Z")), segments: [
              { fill: variant("success", null), weight: 55.0, label: some("55%") },
              { fill: variant("warning", null), weight: 30.0, label: some("30%") },
              { fill: variant("slack", null), weight: 15.0, label: none },
          ] },
      ] }],
    // ── Deliveries ──
    // Two levels of nesting — a top holds its contracts, a contract its
    // orders; every level with no readings of its own is a subtotal.
    ["deliveries", { series: "orders", label: "Deliveries", sub: none, value: none, readings: [], second: [], lo: [], hi: [], segments: [],
      children: new Map([
          ["contract-a", { series: "orders", label: "Contract A", sub: none, value: none, readings: [], second: [], lo: [], hi: [], segments: [],
            children: new Map([
                ["j6188", { series: "orders", label: "J-6188", sub: none, value: none, readings: MEASURE_ACT, second: [], lo: [], hi: [], segments: [], children: new Map() }],
                ["j6204", { series: "orders", label: "J-6204", sub: none, value: none, readings: MEASURE_ACT, second: [], lo: [], hi: [], segments: [], children: new Map() }],
            ]) }],
          ["contract-b", { series: "orders", label: "Contract B", sub: none, value: none, readings: [], second: [], lo: [], hi: [], segments: [],
            children: new Map([
                ["j6219", { series: "orders", label: "J-6219", sub: none, value: none, readings: MEASURE_ACT, second: [], lo: [], hi: [], segments: [], children: new Map() }],
            ]) }],
      ]) }],
    ["reprints", { series: "orders", label: "Reprints", sub: none, value: none, readings: [], second: [], lo: [], hi: [], segments: [],
      children: new Map([
          ["contract-b", { series: "orders", label: "Contract B", sub: none, value: none, readings: [], second: [], lo: [], hi: [], segments: [],
            children: new Map([
                ["rp-0031", { series: "orders", label: "RP-0031", sub: none, value: none, readings: MEASURE_ACT, second: [], lo: [], hi: [], segments: [], children: new Map() }],
            ]) }],
      ]) }],
    // Footer emphasis, a negative and the em-dash: July read nothing at all.
    ["net", { series: "net", label: "Net flow", sub: none, value: none,
      readings: [some(22.0), some(-26.0), some(8.0), some(-4.0), some(12.0), none, none, none, none, some(-30.0), some(12.0), some(6.0)],
      second: [], lo: [], hi: [], segments: [], children: new Map() }],
    // Multi-value rows — the actuals and the Δ per row. The SPLIT (how the
    // positions sit against each other) and the GUTTER (one line or two) are
    // independent choices, so all four combinations are here: the pair that
    // reads well depends on the numbers, not on the split.
    ["actplan", { series: "actplan", label: "Act · Δ plan", sub: some("k/wk"), value: none,
      readings: MEASURE_ACT, second: MEASURE_DELTA, lo: [], hi: [], segments: [], children: new Map() }],
    ["inout", { series: "inout", label: "In / out", sub: none, value: none,
      readings: MEASURE_ACT, second: MEASURE_OUT, lo: [], hi: [], segments: [], children: new Map() }],
    // Horizontal, on a ONE-line gutter — the pair reads as a single fact
    // ("booked beside free"), so a sub label would only repeat it.
    ["sidebyside", { series: "sidebyside", label: "Booked · free", sub: none, value: none,
      readings: MEASURE_ACT, second: MEASURE_OUT, lo: [], hi: [], segments: [], children: new Map() }],
    // Vertical, on a TWO-line gutter — the stack needs the unit spelled out,
    // because the positions are the same measure at two times.
    ["overunder", { series: "overunder", label: "Act / plan", sub: some("k/wk"), value: none,
      readings: MEASURE_ACT, second: MEASURE_DELTA, lo: [], hi: [], segments: [], children: new Map() }],
    // NESTED and multi-value: the subtotal parent mirrors its members, an act
    // subtotal beside a Δ subtotal.
    ["lots", { series: "lot", label: "Lots", sub: none, value: none, readings: [], second: [], lo: [], hi: [], segments: [],
      children: new Map([
          ["lt-1", { series: "lot", label: "LT-2201", sub: none, value: none, readings: MEASURE_ACT, second: MEASURE_DELTA, lo: [], hi: [], segments: [], children: new Map() }],
          ["lt-2", { series: "lot", label: "LT-2202", sub: none, value: none, readings: MEASURE_ACT, second: MEASURE_DELTA, lo: [], hi: [], segments: [], children: new Map() }],
      ]) }],
    // The same, STACKED: members and their subtotal both put the two positions
    // on their own lines, so the parent has to grow too.
    ["stacks", { series: "stack", label: "Stacks", sub: none, value: none, readings: [], second: [], lo: [], hi: [], segments: [],
      children: new Map([
          ["st-1", { series: "stack", label: "ST-3301", sub: none, value: none, readings: MEASURE_ACT, second: MEASURE_OUT, lo: [], hi: [], segments: [], children: new Map() }],
          ["st-2", { series: "stack", label: "ST-3302", sub: none, value: none, readings: MEASURE_ACT, second: MEASURE_OUT, lo: [], hi: [], segments: [], children: new Map() }],
      ]) }],
    // A balance: the paper in stock, thousands of sheets, each week's close.
    ["stock", { series: "stock", label: "Paper stock · k", sub: none, value: none,
      readings: [some(420.0), some(398.0), some(376.0), some(354.0), some(332.0), some(310.0), some(288.0), some(266.0), some(244.0), some(222.0), some(200.0), some(178.0)],
      second: [], lo: [], hi: [], segments: [], children: new Map() }],
])));

/** A week the canvas shows — the rows its slice narrows. */
export const MeasureWeek = StructType({ week: DateTimeType });

/**
 * Measure rows — the chart, heat and table grammars over weekly readings, and
 * the temporal fold (#824) that shows them at whatever resolution the slice
 * states. At MONTH, where it opens, every row shows ONE value per month — the
 * fold of its weeks there — where it would stack four or five on top of each
 * other. Each cell builder and chart layer declares its fold, defaulting to
 * what its values mean: a heat level, a weight fraction and a line by `mean`,
 * a table numeral and a column by `sum`. A row overrides it where the meaning
 * differs — peak load by `max`; a running total and a closing stock by
 * `last`; and the dual chart's output columns by `mean`, so its fixed scale
 * holds at every resolution. A bucket with ONE week keeps it as it is, and a
 * month with no reading is no data.
 *
 * - **Chart rows**: a line with its breach (July's mean falls under 92), an
 *   area, columns stacked by series id on a two-line gutter, a scatter that
 *   draws every reading, every annotation (`refLine`, `refBand`, `refDot`) at
 *   expanded density, and a fixed-height dual-axis composition — columns
 *   left, a line and its band right, swatches, domains and ticks.
 * - **Heat rows**: colour depth under a hall averaging its presses on its
 *   `scale`, with the no-data hatch — a week, and a whole month, with no
 *   reading — weight bars whose planned tail is pale, and status segments.
 * - **Table rows**: subtotals at every depth of the data's nesting, footer
 *   emphasis with a negative and the em-dash, and multi-value positions —
 *   strong and muted, signed, `rollup` — in every split × gutter combination.
 *
 * The switch is the toolbar's (#1258): a slice bound over the weeks the
 * canvas shows declares the `resolution` affordance, and the axis the
 * resolutions it offers, so the toolbar's segment switches MONTH and WEEK. A
 * switch keeps the canvas's column count — three months, then the first three
 * weeks — and the horizon brush moves the window across the twelve.
 */
export const planMeasures = example({
    keywords: [
        "Plan", "measures", "data", "series", "chart", "layers", "spark", "expanded", "fixed", "refLine",
        "refBand", "refDot", "breach", "stacked", "dual-axis", "swatches", "Area", "Band", "Scatter", "Column",
        "Line", "domain", "tickValues", "heat", "Matrix", "cells", "depth", "aggregate", "mean", "children",
        "nested", "recursive", "RecursiveType", "scale", "warnAt", "heatCells", "weightCells", "segmentCells",
        "segment", "no-data", "hatch", "table", "tableCells", "subtotal", "sum", "format", "emphasis", "footer",
        "em-dash", "neg", "tableSeries", "split", "horizontal", "vertical", "multi-value", "multi-cell", "two-line",
        "strong", "muted", "rollup", "mirror", "position", "fold", "temporal fold", "resolution", "week", "month",
        "rebucket", "bucket", "max", "last", "count", "default", "override", "layer", "Plan.layer", "column",
        "line", "Slice", "Slice.bind", "affordances", "toolbar", "range", "brush", "section", "match", "gutter",
        "raw", "readings", "Reactive", "Data.bind", "bound", "e3.input", "#824", "#1258",
    ],
    description: "Measure rows over weekly readings bound from e3, at MONTH to start — chart rows (a line with its breach, an area, stacked columns, a scatter, every annotation, and a fixed dual-axis composition with its band and swatches), heat rows (colour depth under a hall averaging its presses on its scale with the no-data hatch, weight bars with a planned tail, status segments) and table rows (subtotals at every depth, footer emphasis with a negative and the em-dash, multi-value positions in every split × gutter combination); each row folds a month's weeks by what its values mean, or by its override (peak load by max, a running total and the paper stock by last, the dual chart's columns by mean), and the toolbar's resolution segment, over a slice of the weeks shown, switches MONTH and WEEK",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(MeasureWeek, {
            fields: { week: { label: "Week", format: { date: "MMM D" } } },
            rangeFieldId: "week",
        });
        return (<Reactive>{$ => {
            const measures = $.let(Data.bind(planMeasureReadings));
            // Monday of ISO week n, 2026 — twelve weeks, W23–W34.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const Point = StructType({ week: DateTimeType, v: FloatType });
            const BandPoint = StructType({ week: DateTimeType, lo: FloatType, hi: FloatType });
            const Weekly = StructType({ at: DateTimeType, value: OptionType(FloatType) });
            // A measure's readings from W23, as each row kind reads them: a
            // chart's points (a week with no reading draws none), heat cells
            // printing their values (a week with none the no-data hatch),
            // booked fractions (the weeks after now the planned, pale tail),
            // and table cells (a week with none the em-dash).
            const points = $.const(East.function([ArrayType(OptionType(FloatType))], ArrayType(Point), ($, readings) =>
                readings.filterMap((_$2, r, i) => r.match({
                    some: (_$3, v) => East.value(some({ week: week(i.add(23n)), v }), OptionType(Point)),
                    none: (_$3) => East.value(none, OptionType(Point)),
                }))));
            const band = $.const(East.function([ArrayType(FloatType), ArrayType(FloatType)], ArrayType(BandPoint), ($, lo, hi) =>
                East.Array.generate(lo.size(), BandPoint, (_$2, i) => ({ week: week(i.add(23n)), lo: lo.get(i), hi: hi.get(i) }))));
            const heat = $.const(East.function([ArrayType(OptionType(FloatType))], ArrayType(Plan.Types.HeatCell), ($, readings) =>
                East.Array.generate(readings.size(), Plan.Types.HeatCell, ($2, i) => {
                    const value = $2.let(readings.get(i), OptionType(FloatType));
                    const label = $2.let(none, OptionType(StringType));
                    $2.match(value, { some: ($3, v) => { $3.assign(label, some(East.Float.printFixed(v, 0n))); } });
                    return { at: Plan.at.time(week(i.add(23n))), value, label };
                })));
            const booked = $.const(East.function([ArrayType(OptionType(FloatType))], ArrayType(Plan.Types.WeightCell), ($, readings) =>
                readings.filterMap((_$2, r, i) => r.match({
                    some: (_$3, f) => East.value(some({ at: Plan.at.time(week(i.add(23n))), fraction: f, planned: i.add(23n).greater(27n) }), OptionType(Plan.Types.WeightCell)),
                    none: (_$3) => East.value(none, OptionType(Plan.Types.WeightCell)),
                }))));
            const weekly = $.const(East.function([ArrayType(OptionType(FloatType))], ArrayType(Weekly), ($, readings) =>
                East.Array.generate(readings.size(), Weekly, (_$2, i) => ({ at: week(i.add(23n)), value: readings.get(i) }))));
            const whole = $.const(Format.Number({ maximumFractionDigits: 0n }));
            const series = $.const([
                Plan.series.section(Measure, { key: "output", title: "Output", meta: "5 rows" }, [
                    // A level: the on-time line folds a month's weeks by their
                    // MEAN, a line's default — and July's falls through the
                    // breach. Its caret opens it to a custom 120px
                    // (expandedHeight, default 88).
                    Plan.series.chart(Measure, {
                        key: "spark", title: "On-time",
                        match: r => r.series.equal("spark"),
                        label: r => r.label, id: true,
                        value: r => r.value, status: _r => some(variant("warning", null)),
                        height: "spark", expandable: true, expandedHeight: "120px",
                        layers: r => [Plan.layer(Chart.Line(points(r.readings), { x: p => p.week, y: p => p.v }), { breach: { below: 92 } })],
                    }),
                    // A running total — a month shows where it CLOSED.
                    Plan.series.chart(Measure, {
                        key: "cum", title: "Cumulative",
                        match: r => r.series.equal("cum"),
                        label: r => r.label, id: true, value: r => r.value,
                        layers: r => [Plan.layer(Chart.Area(points(r.readings), { x: p => p.week, y: p => p.v }), { fold: "last" })],
                    }),
                    // Amounts — the two halls' columns stacked by one series id,
                    // each month their weeks' SUM, on a two-line gutter (label
                    // over sub).
                    Plan.series.chart(Measure, {
                        key: "stacked", title: "Stacked",
                        match: r => r.series.equal("stacked"),
                        label: r => r.label, id: true, stacked: true, sub: r => r.sub,
                        layers: r => [
                            Plan.layer(Chart.Column(points(r.readings), { x: p => p.week, y: p => p.v }), { series: "H1" }),
                            Plan.layer(Chart.Column(points(r.second), { x: p => p.week, y: p => p.v }), { series: "H2" }),
                        ],
                    }),
                    // A scatter draws every reading, folded or not.
                    Plan.series.chart(Measure, {
                        key: "ppm", title: "Ppm",
                        match: r => r.series.equal("ppm"),
                        label: r => r.label, id: true, value: r => r.value,
                        layers: r => [Chart.Scatter(points(r.readings), { x: p => p.week, y: p => p.v })],
                    }),
                    // A line and every annotation kind, at expanded density.
                    Plan.series.chart(Measure, {
                        key: "refs", title: "Refs",
                        match: r => r.series.equal("refs"),
                        label: r => r.label, id: true,
                        height: "expanded",
                        layers: r => [
                            Plan.layer(Chart.Line(points(r.readings), { x: p => p.week, y: p => p.v }), { breach: { below: 92 } }),
                            Chart.refLine({ y: 100, label: "TARGET 100" }),
                            Chart.refBand({ x: [week(29n), week(31n)], label: "CRUNCH" }),
                            Chart.refDot({ x: week(30n), y: 88.9, label: "LOW" }),
                        ],
                    }),
                ]),
                // The composed dual-axis chart; its axes take Chart.Root's
                // vocabulary — domain / tickValues. Output columns scale left,
                // folded by their MEAN, a week's average, so the fixed 0–60
                // scale holds at every resolution; the on-time line and its
                // band scale right.
                Plan.series.section(Measure, { key: "quality", title: "Quality", meta: "1 row" }, [
                    Plan.series.chart(Measure, {
                        key: "dual", title: "Dual",
                        match: r => r.series.equal("dual"),
                        label: r => r.label, id: true,
                        height: Plan.fixed("120px"),
                        left: { domain: [0, 60], tickValues: [0, 25, 50] },
                        right: { domain: [80, 105], tickValues: [85, 95, 105] },
                        swatches: [{ color: "ink.3", label: "out" }, { color: "brand.d", label: "on-time · rh" }],
                        layers: r => [
                            Plan.layer(Chart.Column(points(r.readings), { x: p => p.week, y: p => p.v }), { fold: "mean" }),
                            Plan.layer(Chart.Line(points(r.second), { x: p => p.week, y: p => p.v }), { axis: "right" }),
                            Plan.layer(Chart.Band(band(r.lo, r.hi), { x: p => p.week, low: p => p.lo, high: p => p.hi }), { axis: "right" }),
                        ],
                    }),
                ]),
                Plan.series.section(Measure, { key: "load", title: "Load", meta: "5 rows" }, [
                    // A hall's presses nest under it, and its row is their
                    // per-bucket MEAN — painted on `scale`, the scale a parent's
                    // DERIVED cells take (#824).
                    Plan.series.heat(Measure, {
                        key: "depth", title: "Depth",
                        match: r => r.series.equal("depth"),
                        label: r => r.label, id: true,
                        cells: r => Plan.heatCells(heat(r.readings), { min: 0, max: 100, warnAt: 95 }),
                        children: r => r.children, aggregate: "mean",
                        scale: { min: 0, max: 100, warnAt: 95 },
                    }),
                    // The same kind of reading, folded by its MAX — the peak a
                    // month hit, printed through the declared format.
                    Plan.series.heat(Measure, {
                        key: "peak", title: "Peak load",
                        match: r => r.series.equal("peak"),
                        label: r => r.label,
                        cells: r => Plan.heatCells(heat(r.readings), { min: 0, max: 100, fold: "max", format: whole }),
                    }),
                    // A fraction of each week booked — a month's is its weeks'
                    // mean, pale only when every one of them is planned.
                    Plan.series.heat(Measure, {
                        key: "booked", title: "Booked",
                        match: r => r.series.equal("booked"),
                        label: r => r.label, sub: r => r.sub,
                        cells: r => Plan.weightCells(booked(r.readings)),
                    }),
                ]),
                Plan.series.section(Measure, { key: "finishing", title: "Finishing", meta: "1 row" }, [
                    // A month of several weeks sums each fill, and draws no
                    // in-bar label: a label described one week.
                    Plan.series.heat(Measure, {
                        key: "segments", title: "Segments",
                        match: r => r.series.equal("segments"),
                        label: r => r.label, sub: r => r.sub,
                        cells: r => Plan.segmentCells(r.segments),
                    }),
                ]),
                Plan.series.section(Measure, { key: "deliveries", title: "Deliveries", meta: "21 rows" }, [
                    // Each order nests under its contract, each contract under its
                    // top (`children`, to any depth), and every parent sums its
                    // children.
                    Plan.series.table(Measure, {
                        key: "orders", title: "Orders",
                        match: r => r.series.equal("orders"),
                        label: r => r.label,
                        cells: r => Plan.tableCells(weekly(r.readings)),
                        children: r => r.children, aggregate: "sum",
                        format: whole,
                    }),
                    Plan.series.table(Measure, {
                        key: "net", title: "Net",
                        match: r => r.series.equal("net"),
                        label: r => r.label, emphasis: "footer",
                        cells: r => Plan.tableCells(weekly(r.readings)),
                        format: whole,
                    }),
                    // Per-POSITION style declared ONCE, in the CONFIG — a strong
                    // rolled-up actual beside its muted, always-signed plan Δ.
                    Plan.series.table(Measure, {
                        key: "actplan", title: "Actual vs plan",
                        match: r => r.series.equal("actplan"),
                        label: r => r.label, stacked: true, sub: r => r.sub,
                        series: r => [
                            Plan.tableSeries({ strong: true, rollup: true, cells: Plan.tableCells(weekly(r.readings)) }),
                            Plan.tableSeries({
                                tone: "muted",
                                format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                                cells: Plan.tableCells(weekly(r.second)),
                            }),
                        ],
                        format: whole,
                    }),
                    // The VERTICAL split stacks the positions; the row grows.
                    Plan.series.table(Measure, {
                        key: "inout", title: "Inout",
                        match: r => r.series.equal("inout"),
                        label: r => r.label, split: "vertical",
                        series: r => [
                            Plan.tableSeries({ cells: Plan.tableCells(weekly(r.readings)) }),
                            Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(weekly(r.second)) }),
                        ],
                        format: whole,
                    }),
                    // HORIZONTAL on a ONE-line gutter — the other half of the pair
                    // above: the split is a cell-layout choice and the gutter a
                    // label choice, so neither implies the other.
                    Plan.series.table(Measure, {
                        key: "sidebyside", title: "Side by side",
                        match: r => r.series.equal("sidebyside"),
                        label: r => r.label, split: "horizontal",
                        series: r => [
                            Plan.tableSeries({ strong: true, cells: Plan.tableCells(weekly(r.readings)) }),
                            Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(weekly(r.second)) }),
                        ],
                        format: whole,
                    }),
                    // A MULTI-VALUE series under a subtotal parent — every position
                    // rolls up, so the parent shows an act subtotal beside a Δ
                    // subtotal instead of collapsing to one number and looking
                    // complete. Flag a position `rollup: true` to narrow it back to
                    // that one.
                    Plan.series.table(Measure, {
                        key: "lot", title: "Lot",
                        match: r => r.series.equal("lot"),
                        label: r => r.label,
                        series: r => [
                            Plan.tableSeries({ strong: true, cells: Plan.tableCells(weekly(r.readings)) }),
                            Plan.tableSeries({
                                tone: "muted",
                                format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                                cells: Plan.tableCells(weekly(r.second)),
                            }),
                        ],
                        children: r => r.children, aggregate: "sum",
                        format: whole,
                    }),
                    // NESTED and VERTICAL — the subtotal stacks its positions the
                    // way its members do. The parent's positions carry no values
                    // of their own (they are derived), so its height comes from
                    // its members' count: a parent that read its own empty cells
                    // as one line would render as two.
                    Plan.series.table(Measure, {
                        key: "stack", title: "Stack",
                        match: r => r.series.equal("stack"),
                        label: r => r.label, split: "vertical",
                        series: r => [
                            Plan.tableSeries({ strong: true, cells: Plan.tableCells(weekly(r.readings)) }),
                            Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(weekly(r.second)) }),
                        ],
                        children: r => r.children, aggregate: "sum",
                        format: whole,
                    }),
                    // VERTICAL on a TWO-line gutter — the remaining combination,
                    // and the one that grows the row in BOTH directions at once.
                    Plan.series.table(Measure, {
                        key: "overunder", title: "Over / under",
                        match: r => r.series.equal("overunder"),
                        label: r => r.label, split: "vertical", stacked: true, sub: r => r.sub,
                        series: r => [
                            Plan.tableSeries({ strong: true, rollup: true, cells: Plan.tableCells(weekly(r.readings)) }),
                            Plan.tableSeries({
                                tone: "muted",
                                format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                                cells: Plan.tableCells(weekly(r.second)),
                            }),
                        ],
                        format: whole,
                    }),
                    // A balance — a month shows where it CLOSED, its last week.
                    Plan.series.table(Measure, {
                        key: "stock", title: "Paper stock",
                        match: r => r.series.equal("stock"),
                        label: r => r.label,
                        cells: r => Plan.tableCells(weekly(r.readings)), fold: "last",
                        format: whole,
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(Measure)));
            // The weeks the canvas shows — the rows its slice narrows.
            const weeks = $.let(East.Array.generate(12n, MeasureWeek, (_$2, i) => ({ week: week(i.add(23n)) })));
            // The resolution is the slice's, MONTH to start, and the window
            // its range. A slice range is CLOSED — both ends inclusive — so
            // the twelve weeks W23–W34 end the millisecond before W35.
            const slice = $.let(Slice.bind([MeasureWeek], "ex.plan.measures", cfg, Slice.state({
                range: some(variant("datetime", { from: week(23n), to: week(35n).addMilliseconds(-1n) })),
                resolution: some(variant("month", null)),
            }), weeks, none));
            const axis = $.const(Plan.axis({
                window: { min: week(23n), max: week(35n) },
                resolution: "month", resolutions: ["month", "week"], now: week(27n),
            }));
            return (
                <Plan
                    axis={axis}
                    data={measures}
                    series={series}
                    slice={{ slice, affordances: ["range", "resolution", "brush"] }}
                />
            );
        }}</Reactive>);
    }),
    inputs: [],
});

// ============================================================================
// planRowDrop — `data`'s rows edited in place: cards dropped from the Plan's
// library panel, runs moved and resized, one checked Save (#880, #825, #1259)
// ============================================================================

/** A job, its label already composed. */
export const DropJob = StructType({
    key: StringType, label: StringType,
    start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** A van drop. */
export const DropAlloc = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
/** A crew shift, its label already composed. */
export const DropShift = StructType({
    key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
});
/** A press a hall holds — its jobs; its name is its key. */
export const DropPress = StructType({ jobs: ArrayType(DropJob) });
/** One row of the ops record — `series` names the series that claims it;
 *  `readings` are fortnightly from W27; a hall holds its presses
 *  (`presses`), the hierarchy the data's own. */
export const DropOpsRow = StructType({
    series: StringType, label: StringType,
    jobs: ArrayType(DropJob),
    readings: ArrayType(FloatType),
    allocs: ArrayType(DropAlloc),
    nums: ArrayType(Plan.Types.TableCell),
    shifts: ArrayType(DropShift),
    marks: ArrayType(Plan.Types.EventMark),
    presses: DictType(StringType, DropPress),
});

/**
 * The ops RECORD every gesture drafts and Save commits to — its initial state
 * the genesis commit. The droppable and inert kinds interleave, and Hall 3 is
 * an entry holding its two presses, H3-P11 already running four jobs, so one
 * more is refused.
 */
export const planDropOps = e3.record("plan_drop_ops", DictType(StringType, DropOpsRow), new Map([
    ["util",  { series: "util", label: "Util %", jobs: [], readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0],
                allocs: [], nums: [], shifts: [], marks: [], presses: new Map() }],
    ["p03",   { series: "press", label: "H1-P03", readings: [], allocs: [], nums: [], shifts: [], marks: [], presses: new Map(),
                jobs: [{ key: "j4642", label: "RUN · J-4642", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("in-progress", null) }] }],
    ["p04",   { series: "press", label: "H1-P04", readings: [], allocs: [], nums: [], shifts: [], marks: [], presses: new Map(),
                jobs: [{ key: "j4624", label: "RUN · J-4624", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("confirmed", null) }] }],
    ["load",  { series: "load", label: "H2 load", jobs: [], readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0],
                allocs: [], nums: [], shifts: [], marks: [], presses: new Map() }],
    ["van1", { series: "van", label: "Van 1", jobs: [], readings: [], nums: [], shifts: [], marks: [], presses: new Map(),
                allocs: [{ key: "a1", at: new Date("2026-07-13T00:00:00Z"), state: variant("confirmed", null) }] }],
    ["desp",  { series: "table", label: "Delivered · k", jobs: [], readings: [], allocs: [], shifts: [], marks: [], presses: new Map(),
                nums: [
                    { at: variant("time", new Date("2026-07-06T00:00:00Z")), value: some(128.0), text: none, tone: none },
                    { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(-96.0), text: none, tone: none },
                ] }],
    ["crewA", { series: "crew", label: "Crew A", jobs: [], readings: [], allocs: [], nums: [], marks: [], presses: new Map(),
                shifts: [{ key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), label: "80h", state: variant("confirmed", null) }] }],
    ["ms",    { series: "strm", label: "Milestones", jobs: [], readings: [], allocs: [], nums: [], shifts: [], presses: new Map(),
                marks: [{ key: "k", at: variant("time", new Date("2026-07-13T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("KICKOFF") }] }],
    // A HALL, holding its presses: a gesture on one of them drafts the hall,
    // the entry they ride in. H3-P11 already runs four jobs.
    ["hall3", { series: "hall", label: "Hall 3", jobs: [], readings: [], allocs: [], nums: [], shifts: [], marks: [],
                presses: new Map([
                    ["H3-P11", { jobs: [
                        { key: "j4897", label: "RUN · J-4897", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-13T00:00:00Z"), state: variant("confirmed", null) },
                        { key: "j4903", label: "RUN · J-4903", start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), state: variant("confirmed", null) },
                        { key: "j4911", label: "RUN · J-4911", start: new Date("2026-08-17T00:00:00Z"), end: new Date("2026-08-31T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
                        { key: "j4918", label: "RUN · J-4918", start: new Date("2026-08-31T00:00:00Z"), end: new Date("2026-09-14T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
                    ] }],
                    ["H3-P12", { jobs: [
                        { key: "j4925", label: "RUN · J-4925", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("confirmed", null) },
                    ] }],
                ]) }],
]));

/** The ops record's patch door — every Save commits through it. */
export const planDropOpsPatch = e3.mutation.patch(planDropOps);

/** A card in the palette — a thing a row of its family takes. */
export const DropCard = StructType({ name: StringType, family: StringType, note: StringType });

/** The palette's cards, by key — a card's key is what a drop names it by. */
export const planDropCards = e3.input("plan_drop_cards", DictType(StringType, DropCard), variant("value", new Map([
    ["job-poster",  { name: "Poster run",  family: "job",       note: "job · presses" }],
    ["job-leaflet", { name: "Leaflet run", family: "job",       note: "job · presses" }],
    ["dlv-van",     { name: "Van 3",       family: "delivery",  note: "delivery · vans" }],
    ["shf-night",   { name: "Night shift", family: "shift",     note: "shift · crews" }],
    ["mst-check",   { name: "Press check", family: "milestone", note: "milestone · streams" }],
    // Of a family no row takes, so every row refuses it — the ⊘ stage
    // everywhere, which is what a card with nowhere to go looks like.
    ["pallet",      { name: "PALLET",      family: "other",     note: "fits nowhere" }],
])));

/**
 * `data`'s rows edited in place (#880) — the Plan as a drag TARGET, a
 * heterogeneous one, which is what makes it different from every other target
 * in the grammar, and its own runs moved and resized (#825).
 *
 * The palette is the Plan's own library panel (#1259): `Plan.library.tab`
 * lists the cards, grouped by family, and a card drags from it onto the rows
 * that take one — by the pointer, or from the keyboard: Space picks a card up,
 * the arrows carry it from row to row and along a row's buckets, Space drops
 * it and Escape cancels, and every step is said to a screen reader. The Plan
 * takes its own panel's cards with no `id` or `sources`.
 *
 * Roster, Board and Blend have ONE kind of cell, so "can you drop here" is a
 * question about the cell's contents. A Plan's rows are nine different things,
 * so the question is answered at three levels:
 *
 *  1. **Structurally, by series.** A card lands only on a row whose series
 *     declares `edit` — WHERE it lands (`items`, the entry's list the row's
 *     elements come from) and HOW it becomes one (`create`, from the drop: the
 *     card, the row and the bucket's instant). Only the kinds holding discrete
 *     scheduled objects can — `span` (runs), `buckets` (tiles), `events`
 *     (marks), `cards` (chips). A `chart` / `heat` / `table` row renders
 *     DERIVED values, and section headers and group strips are wayfinding:
 *     they register no cell and never light up during a drag.
 *  2. **By policy, with `canDrop`.** Of the rows that can receive, this canvas
 *     admits only the matching FAMILY: a job goes on a press, a delivery on
 *     a van, a shift on a crew, a milestone on a stream. The `PALLET` card
 *     is of a family no row takes and is therefore refused everywhere — the ⊘
 *     stage on every row, which is what a card with nowhere to go should look
 *     like.
 *  3. **As a draft.** A drop is a gesture of the editing session: the entry is
 *     drafted with the new item in its list and its rows derived again —
 *     drawn at once with the pending mark, undone with ⌘Z — and Save writes
 *     every draft as ONE checked batch, one commit through the record's patch
 *     door (`Record.onApply`).
 *
 * A press's run moves along its press or onto another press and resizes by
 * either end: its series names the job's key and the instant fields a move
 * writes (`key`, `start`, `end`). It moves in whole weeks, or in days with
 * Shift held; from the keyboard, Space on a focused run picks it up: ←/→ move
 * it a week, Shift+←/→ its end, Alt+←/→ its start, ↑/↓ carry it to another
 * press, and Space drops it.
 *
 * Hall 3 is an entry of its own, holding its presses (`Plan.children`): its
 * row rolls their runs up and takes no drop, and every gesture on one of its
 * presses lands on the press row, one level down, yet drafts the HALL — the
 * source's top-level entry, which the whole subtree rides in. A job moved
 * between a Hall 1 press and a Hall 3 one leaves one entry and joins the
 * other, as one gesture over both.
 *
 * `ready` is the author's check over a drafted entry: a press holding more
 * than four jobs — an entry of its own, or one a hall holds — is refused, by
 * name, and Save waits until it is fixed. H3-P11 already holds four, so a job
 * dropped or moved onto it holds Save until one leaves. `onPatch` hears each
 * gesture as it is made, and the footer says the last one.
 *
 * The Plan is bounded shorter than its rows, so the Hall 3 presses start below
 * the fold: a card held at the canvas's bottom edge scrolls them there (#608).
 */
export const planRowDrop = example({
    keywords: [
        "Plan", "library", "panel", "Plan.library.tab", "palette", "DnD", "drag", "drop", "canDrop",
        "edit", "items", "create", "add", "target", "surface", "cell", "slot", "row kind", "selective", "veto",
        "invalid", "span", "buckets", "events", "cards", "chart", "heat", "table", "section", "row id", "row text",
        "droppable", "inert", "bucket instant", "editing", "session", "onApply", "onPatch", "ready",
        "Readiness", "Editing.Types.Readiness", "draft", "drafts", "transaction", "Save", "undo", "redo",
        "discard", "history", "pending", "Plan.Types.PatchEvent", "Reactive", "State", "re-derive", "#880",
        "move", "resize", "run", "key", "start", "end", "Shift", "snap", "cross-row", "Plan.Types.Move", "#825",
        "nested", "children", "Plan.children", "top-level entry", "rollup",
        "auto-scroll", "keyboard", "Space", "screen reader", "announcements", "#608", "footer", "#1259",
        "Record", "Record.bind", "Record.onApply", "e3.record", "patch", "commit", "Data.bindPaged", "Data.bind",
    ],
    description: "The Plan's editing session over an e3 record — cards dragged from the Plan's library panel land only on a series that declares `edit`, `canDrop` admits only the matching family, runs move and resize, a gesture on a hall's press drafts the hall, `ready` refuses a crowded press, and every gesture is a draft saved as one checked batch, one commit through the record's patch door",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The source is a RECORD: the canvas pages it, and each Save is
            // one commit through its patch door.
            const ops = $.let(Data.bindPaged(planDropOps));
            const record = $.let(Record.bind(planDropOps, [planDropOpsPatch]));
            // The palette the cards come from, by key.
            const cards = $.let(Data.bind(planDropCards));
            const palette = $.let(cards.read());
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            // A row's fortnightly readings from W27, as a chart's points and as
            // heat cells printing their values.
            const points = $.const(East.function([ArrayType(FloatType)], ArrayType(MeasureRow), ($, readings) =>
                East.Array.generate(readings.size(), MeasureRow, (_$, i) => ({ week: week(i.multiply(2n).add(27n)), pct: readings.get(i) }))));
            const cells = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), ($, readings) =>
                East.Array.generate(readings.size(), Plan.Types.HeatCell, (_$, i) => ({
                    at: Plan.at.time(week(i.multiply(2n).add(27n))),
                    value: some(readings.get(i)),
                    label: some(East.Float.printFixed(readings.get(i), 0n)),
                }))));
            // Everything a drop creates is a PROPOSAL — it is a suggestion the
            // host has not committed, and the lifecycle is how the canvas says so.
            const ADDED = variant("proposed", variant("added", null));

            // ── The policy table the host owns ───────────────────────────
            // Which FAMILY of card each row will take. A drop cell names its
            // row by the canonical TEXT of the row's id — the series that made
            // it and the path of keys to it — so the table is keyed by that
            // text. A row absent from this map takes nothing — which is how
            // the inert kinds would behave even if they did register a cell.
            const rowAccepts = $.const(new Map([
                [East.print(Plan.ref("press", "p03")), "job"],
                [East.print(Plan.ref("press", "p04")), "job"],
                [East.print(Plan.ref("gpress", "hall3", "H3-P11")), "job"],
                [East.print(Plan.ref("gpress", "hall3", "H3-P12")), "job"],
                [East.print(Plan.ref("van", "van1")), "delivery"],
                [East.print(Plan.ref("crew", "crewA")), "shift"],
                [East.print(Plan.ref("strm", "ms")), "milestone"],
            ]), DictType(StringType, StringType));

            // ── The drop veto ────────────────────────────────────────────
            // Consulted with the candidate event the pointer's CURRENT bucket
            // would produce, so the ⊘ appears while dragging rather than after,
            // and once more before the drop becomes a draft. A card is vetted
            // by its family; a run moved or resized is the canvas's own, which
            // lands only on a row of its item type, so the veto lets it through.
            const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) => {
                const yes = $.const(true, BooleanType);
                return event.match({
                    add: ($, add) => {
                        const row = $.let(add.into.row);
                        const card = $.let(add.from.key);
                        return rowAccepts.has(row)
                            .and(_$ => palette.has(card))
                            .and(_$ => rowAccepts.get(row).equal(palette.get(card).family));
                    },
                }, _$ => yes);
            }));

            // ── The session ──────────────────────────────────────────────
            // Every gesture is a DRAFT of the entry it touched — a hall's
            // press drafts the hall — drawn at once, marked pending, and the
            // history item undoes, redoes, discards and saves it. `ready`
            // checks each drafted entry: a press holding more than four jobs
            // — the entry itself, or one of a hall's presses — is refused, by
            // name.
            const ready = $.const(East.function([DropOpsRow, StringType], Editing.Types.Readiness, ($, row, _key) => {
                const crowded = $.let(row.presses.filter((_$, p) => p.jobs.size().greater(4n)).toArray((_$, p, name) => ({
                    field: "jobs", message: East.str`${name} holds ${East.print(p.jobs.size())} jobs — at most 4`,
                })));
                $.if(row.jobs.size().greater(4n), ($) => {
                    $(crowded.pushLast({
                        field: "jobs", message: East.str`${row.label} holds ${East.print(row.jobs.size())} jobs — at most 4`,
                    }));
                });
                $.if(crowded.size().greater(0n), ($) => {
                    $.return(East.value(variant("invalid", crowded), Editing.Types.Readiness));
                });
                return East.value(variant("ready", null), Editing.Types.Readiness);
            }));
            // Every gesture, as it is made — a drop, a move, an undo — into a
            // log the viewer keeps, which the footer says.
            const lastBind = $.let(State.bind([StringType], "ex.plan.lastdrop", "none yet"));
            const onPatch = $.const(East.function([Plan.Types.PatchEvent(DropOpsRow)], NullType, ($, event) => {
                $(lastBind.write(East.str`${event.origin.getTag()} · ${event.label}`));
            }));
            const last = $.let(lastBind.read());

            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n),
            }));
            return (
                <Plan
                    axis={axis}
                    data={ops}
                    // The palette — the Plan's own library panel, its cards
                    // grouped by family. A card drags onto the rows that take
                    // one; `canDrop` is the policy. A drop becomes a draft of
                    // the session — without `editing` no card lands, since
                    // nothing could hold it.
                    library={[Plan.library.tab(palette, {
                        name: "Palette", icon: "palette",
                        label: c => c.name, meta: c => some(c.note), group: c => c.family,
                    })]}
                    canDrop={canDrop}
                    editing={{ onApply: Record.onApply(record, { keyed: true }), onPatch, ready }}
                    series={[
                        // INERT — a chart plots a derived series, so there
                        // is nothing a card could become here.
                        Plan.series.chart(DropOpsRow, {
                            key: "util", title: "Utilisation",
                            match: r => r.series.equal("util"),
                            label: r => r.label, id: true, height: "spark",
                            layers: r => [Chart.Line(points(r.readings), { x: p => p.week, y: p => p.pct })],
                        }),
                        // RECEIVES and MOVES — runs are discrete scheduled
                        // objects. A dropped job joins the press's `jobs`, a
                        // fortnight long from the bucket the pointer named;
                        // a run moves and resizes — the job found by `key`,
                        // the run's own key, and a move writing `start` and
                        // `end`. Keys stay unique on a press: a drop or a move
                        // that would repeat one is refused, so a new job's key
                        // names its card and place.
                        Plan.series.span(DropOpsRow, {
                            key: "press", title: "Press jobs",
                            match: r => r.series.equal("press"),
                            label: r => r.label, id: true,
                            runs: r => r.jobs.map((_$, j) => Plan.run({
                                key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                            })),
                            edit: {
                                items: "jobs",
                                key: "key", start: "start", end: "end",
                                create: (drop, r) => ({
                                    key: East.str`drop-${drop.from.key}-${East.print(r.jobs.size())}`,
                                    label: palette.get(drop.from.key).name,
                                    start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addWeeks(2n),
                                    state: ADDED,
                                }),
                            },
                        }),
                        // INERT — an intensity field has no object to add to.
                        Plan.series.heat(DropOpsRow, {
                            key: "load", title: "Hall load",
                            match: r => r.series.equal("load"),
                            label: r => r.label,
                            cells: r => Plan.heatCells(cells(r.readings), { min: 0, max: 100 }),
                        }),
                        // RECEIVES — a dropped delivery becomes a tile in
                        // the bucket under the pointer.
                        Plan.series.buckets(DropOpsRow, {
                            key: "van", title: "Van drops",
                            match: r => r.series.equal("van"),
                            label: r => r.label,
                            events: r => r.allocs.map((_$, a) =>
                                Plan.event({ key: a.key, at: a.at, state: a.state })),
                            edit: {
                                items: "allocs",
                                create: (drop, r) => ({
                                    key: East.str`drop-${drop.from.key}-${East.print(r.allocs.size())}`,
                                    at: drop.at.unwrap("time"), state: ADDED,
                                }),
                            },
                        }),
                        // INERT — the cells are computed numbers.
                        Plan.series.table(DropOpsRow, {
                            key: "table", title: "Delivered sheets",
                            match: r => r.series.equal("table"),
                            label: r => r.label,
                            cells: r => r.nums,
                            format: Format.Number({ maximumFractionDigits: 0n }),
                        }),
                        // RECEIVES — a dropped shift becomes a chip.
                        Plan.series.cards(DropOpsRow, {
                            key: "crew", title: "Crew shifts",
                            match: r => r.series.equal("crew"),
                            label: r => r.label,
                            chips: r => r.shifts.map((_$, s) => Plan.chip({
                                key: s.key, from: s.from, to: s.to, label: s.label, state: s.state,
                            })),
                            edit: {
                                items: "shifts",
                                create: (drop, r) => ({
                                    key: East.str`drop-${drop.from.key}-${East.print(r.shifts.size())}`,
                                    from: drop.at.unwrap("time"), to: drop.at.unwrap("time").addWeeks(2n),
                                    label: palette.get(drop.from.key).name, state: ADDED,
                                }),
                            },
                        }),
                        // RECEIVES — a dropped milestone becomes a mark at
                        // the instant, the one kind with no duration.
                        Plan.series.events(DropOpsRow, {
                            key: "strm", title: "Milestones",
                            match: r => r.series.equal("strm"),
                            label: r => r.label, id: true,
                            marks: r => r.marks,
                            edit: {
                                items: "marks",
                                create: (drop, r) => ({
                                    key: East.str`drop-${drop.from.key}-${East.print(r.marks.size())}`,
                                    at: drop.at, kind: variant("milestone", null), icon: none,
                                    label: some(palette.get(drop.from.key).name),
                                }),
                            },
                        }),
                        // A SECTION's header is inert. Under it, a HALL: an
                        // entry holding its presses, stepped down into
                        // through a plain field — which is what lets a
                        // gesture on a press write back into its hall. The
                        // hall's row rolls their runs up and takes no drop; a
                        // press of it receives, and its runs move — onto the
                        // Hall 1 presses too.
                        Plan.series.section(DropOpsRow, { key: "hall-block", title: "Halls", meta: "nested" }, [
                            Plan.series.span(DropOpsRow, {
                                key: "halls", title: "Halls",
                                match: r => r.series.equal("hall"),
                                label: r => r.label,
                                runs: _r => [], rollup: "union",
                                children: Plan.children(r => r.presses, [
                                    Plan.series.span(DropPress, {
                                        key: "gpress", title: "Hall presses",
                                        label: (_p, k) => k, id: true,
                                        runs: p => p.jobs.map((_$, j) => Plan.run({
                                            key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                                        })),
                                        edit: {
                                            items: "jobs",
                                            key: "key", start: "start", end: "end",
                                            create: (drop, p) => ({
                                                key: East.str`drop-${drop.from.key}-${East.print(p.jobs.size())}`,
                                                label: palette.get(drop.from.key).name,
                                                start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addWeeks(2n),
                                                state: ADDED,
                                            }),
                                        },
                                    }),
                                ]),
                            }),
                        ]),
                    ]}
                    footer={[{ text: East.str`LAST GESTURE · ${last}`, end: true }]}
                    // Shorter than its rows: the last ones start below the
                    // fold, and a card held at the bottom edge scrolls there.
                    style={{ height: "360px" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planNumberAxis — the `number` axis (#631): day 1..8 with AM/PM lanes
// ============================================================================

/** An order on the horizon — its day (an integer day index) and its hall. */
export const NumberHorizonRow = StructType({ key: StringType, day: IntegerType, hall: StringType });

/** How many orders the horizon holds; {@link planNumberHorizon} makes them. */
export const planNumberHorizonCount = e3.input("plan_number_horizon_count", IntegerType, variant("value", 24n));

/** The horizon's orders, generated from their count — two a day from day 1,
 *  the halls in turn: twelve days behind an eight-day window. */
export const generateNumberHorizon = East.function([IntegerType], ArrayType(NumberHorizonRow), (_$, count) =>
    East.Array.generate(count, NumberHorizonRow, (_$2, i) => ({
        key: East.str`o${East.print(i.add(1n))}`,
        day: i.divide(2n).add(1n),
        hall: i.remainder(2n).equal(0n).ifElse(() => "Hall 1", () => "Hall 2"),
    })));

/** The task that generates the horizon. */
export const planNumberHorizon = e3.task("plan_number_horizon", [planNumberHorizonCount], generateNumberHorizon);

/** A van drop — its day (a plain number), lane and lifecycle state. */
export const NumberAlloc = StructType({ key: StringType, day: FloatType, lane: StringType, state: EventStateType });
/** A job — its days. */
export const NumberJob = StructType({ key: StringType, label: StringType, start: FloatType, end: FloatType, state: EventStateType });
/** A crew shift — its days and hours. */
export const NumberShift = StructType({ key: StringType, from: FloatType, to: FloatType, hours: FloatType, state: EventStateType });
/** A milestone — its day. */
export const NumberMark = StructType({ key: StringType, day: FloatType, label: StringType });
/** A chart point — a day and a value. */
export const NumberPoint = StructType({ day: FloatType, sheets: FloatType });
/** A table reading — a day and its value. */
export const NumberReading = StructType({ at: FloatType, value: OptionType(FloatType) });
/** RAW rows — every instant is a plain number (a day index). */
export const NumberOpsRow = StructType({
    series: StringType, label: StringType, value: OptionType(StringType), sub: OptionType(StringType),
    allocations: ArrayType(NumberAlloc), jobs: ArrayType(NumberJob), shifts: ArrayType(NumberShift),
    marks: ArrayType(NumberMark), points: ArrayType(NumberPoint), sheets: ArrayType(NumberReading),
    cells: ArrayType(Plan.Types.HeatCell),
});

/** The rows — the keys are the entries' identities; the series list is the layout. */
export const planNumberOps = e3.input("plan_number_ops", DictType(StringType, NumberOpsRow), variant("value", new Map([
    ["van1", { series: "van", label: "Van 1", value: none, sub: some("drops/day"),
      jobs: [], shifts: [], marks: [], points: [], sheets: [], cells: [],
      allocations: [
          { key: "a1", day: 1.0, lane: "am", state: variant("confirmed", null) },
          { key: "a2", day: 1.0, lane: "pm", state: variant("confirmed", null) },
          { key: "a3", day: 2.0, lane: "am", state: variant("confirmed", null) },
          { key: "a4", day: 3.0, lane: "pm", state: variant("proposed", variant("recommended", null)) },
          { key: "a5", day: 5.0, lane: "am", state: variant("proposed", variant("recommended", null)) },
          { key: "a6", day: 6.0, lane: "pm", state: variant("confirmed", null) },
          { key: "a7", day: 8.0, lane: "am", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["van2", { series: "van", label: "Van 2", value: none, sub: some("drops/day"),
      jobs: [], shifts: [], marks: [], points: [], sheets: [], cells: [],
      allocations: [
          { key: "b1", day: 2.0, lane: "pm", state: variant("confirmed", null) },
          { key: "b2", day: 4.0, lane: "am", state: variant("confirmed", null) },
          { key: "b3", day: 4.0, lane: "pm", state: variant("proposed", variant("recommended", null)) },
          { key: "b4", day: 7.0, lane: "am", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["p03", { series: "press", label: "H1-P03", value: some("12k/h"), sub: none,
      allocations: [], shifts: [], marks: [], points: [], sheets: [], cells: [],
      jobs: [
          { key: "mr", label: "MAKEREADY", start: 1.0, end: 2.0, state: variant("actual", null) },
          { key: "j4642", label: "RUN · J-4642", start: 2.0, end: 5.0, state: variant("in-progress", null) },
          { key: "j4663", label: "RUN · J-4663", start: 6.0, end: 8.0, state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["p04", { series: "press", label: "H1-P04", value: some("8k/h"), sub: none,
      allocations: [], shifts: [], marks: [], points: [], sheets: [], cells: [],
      jobs: [
          { key: "j4624", label: "RUN · J-4624", start: 1.0, end: 4.0, state: variant("actual", null) },
          { key: "proof", label: "PROOF", start: 4.0, end: 5.0, state: variant("confirmed", null) },
          { key: "j4693", label: "RUN · J-4693", start: 5.0, end: 9.0, state: variant("proposed", variant("recommended", null)) },
      ] }],
    // Heat cells as STORED records — the instant spelled explicitly.
    ["load", { series: "load", label: "Hall load", value: none, sub: none,
      allocations: [], jobs: [], shifts: [], marks: [], points: [], sheets: [],
      cells: [
          { at: variant("number", 1.0), value: some(40.0), label: some("40") },
          { at: variant("number", 2.0), value: some(69.0), label: some("69") },
          { at: variant("number", 3.0), value: some(43.0), label: some("43") },
          { at: variant("number", 4.0), value: some(72.0), label: some("72") },
          { at: variant("number", 5.0), value: some(46.0), label: some("46") },
          { at: variant("number", 6.0), value: some(75.0), label: some("75") },
          { at: variant("number", 7.0), value: some(49.0), label: some("49") },
          { at: variant("number", 8.0), value: some(78.0), label: some("78") },
      ] }],
    ["out", { series: "out", label: "Printed · k", value: some("612 k sheets"), sub: none,
      allocations: [], jobs: [], shifts: [], marks: [], sheets: [], cells: [],
      points: [
          { day: 1.0, sheets: 60.0 }, { day: 2.0, sheets: 77.0 }, { day: 3.0, sheets: 94.0 }, { day: 4.0, sheets: 71.0 },
          { day: 5.0, sheets: 88.0 }, { day: 6.0, sheets: 65.0 }, { day: 7.0, sheets: 82.0 }, { day: 8.0, sheets: 99.0 },
      ] }],
    ["desp", { series: "table", label: "Delivered · k", value: none, sub: none,
      allocations: [], jobs: [], shifts: [], marks: [], points: [], cells: [],
      sheets: [
          { at: 1.0, value: some(80.0) }, { at: 2.0, value: some(103.0) }, { at: 3.0, value: some(126.0) }, { at: 4.0, value: some(149.0) },
          { at: 5.0, value: some(102.0) }, { at: 6.0, value: some(125.0) }, { at: 7.0, value: some(148.0) }, { at: 8.0, value: some(101.0) },
      ] }],
    ["crewA", { series: "crew", label: "Crew A", value: none, sub: none,
      allocations: [], jobs: [], marks: [], points: [], sheets: [], cells: [],
      shifts: [
          { key: "s1", from: 1.0, to: 3.0, hours: 24.0, state: variant("confirmed", null) },
          { key: "s2", from: 3.0, to: 6.0, hours: 36.0, state: variant("confirmed", null) },
          { key: "s3", from: 6.0, to: 8.0, hours: 24.0, state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["ms", { series: "ms", label: "Milestones", value: none, sub: none,
      allocations: [], jobs: [], shifts: [], points: [], sheets: [], cells: [],
      marks: [
          { key: "kick", day: 2.0, label: "KICKOFF" },
          { key: "rel", day: 6.0, label: "REL" },
      ] }],
])));

/**
 * The `number` axis — the retired Planner's `plannerPoint` canvas on the
 * Plan: eight days at step 1, AM/PM lanes in the bucket rows, `now` at day
 * 5. Every kind positions on the one numeric scale, and every instant in the
 * raw data is a plain number: a `FloatType` field wraps to the `number` arm
 * through the element builders (`Plan.run({ start: j.start })`), a chart
 * layer's numeric x accessor lands its columns on the same arm, `Plan.tableCells`
 * reads a numeric `at`, and the heat cells stored as RECORDS spell it out with
 * the `number` arm. The slice's range field is an integer day, so the horizon
 * brush and the range chip ride the slice's `integer` arm exactly as they ride
 * `datetime` on a time axis — a closed range, so the eight days `[1, 9)` read
 * `1–8`; there is no resolution segment — `step` is the declaration.
 */
export const planNumberAxis = example({
    keywords: [
        "Plan", "axis", "number", "numeric", "step", "Plan.axis.number", "Plan.at", "instant",
        "day", "AM", "PM", "lanes", "buckets", "Planner", "plannerPoint", "brush", "integer", "range", "inclusive",
        "format", "now", "typed axis", "#631", "raw", "Data.bind", "bound", "e3.input", "e3.task",
    ],
    description: "The number axis over rows bound from e3 — day 1..8 at step 1 with AM/PM lanes (the retired Planner's plannerPoint), every row kind on the numeric scale, the horizon brush over the slice's integer range, read inclusive",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(NumberHorizonRow, {
            fields: { day: { label: "Day" }, hall: { label: "Hall" } },
            rangeFieldId: "day",
        });
        return (<Reactive>{$ => {
            const ops = $.let(Data.bind(planNumberOps));
            // The slice's horizon — twelve days of orders behind an eight-day
            // window, which a task generates.
            const horizon = $.let(Data.bind(planNumberHorizon));
            const series = $.const([
                Plan.series.section(NumberOpsRow, { key: "vans-local", title: "Deliveries · Local", meta: "2 rows" }, [
                    Plan.series.buckets(NumberOpsRow, {
                        key: "van", title: "Vans",
                        match: r => r.series.equal("van"),
                        label: r => r.label, sub: r => r.sub,
                        // The Planner's AM/PM lanes — sub-slots of each day column.
                        lanes: _r => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                        // `a.day` is a FloatType field — the builder wraps it to the number arm.
                        events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.day, lane: a.lane, state: a.state })),
                    }),
                ]),
                Plan.series.span(NumberOpsRow, {
                    key: "press", title: "Presses",
                    match: r => r.series.equal("press"),
                    label: r => r.label, id: true, value: r => r.value,
                    runs: r => r.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })),
                }),
                Plan.series.heat(NumberOpsRow, {
                    key: "load", title: "Hall load",
                    match: r => r.series.equal("load"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 90 }),
                }),
                Plan.series.chart(NumberOpsRow, {
                    key: "out", title: "Output",
                    match: r => r.series.equal("out"),
                    label: r => r.label, id: true, value: r => r.value, height: "expanded",
                    // A numeric x accessor lands the columns on the number arm.
                    layers: r => [Chart.Column(r.points, { x: p => p.day, y: p => p.sheets })],
                }),
                Plan.series.table(NumberOpsRow, {
                    key: "table", title: "Deliveries",
                    match: r => r.series.equal("table"),
                    label: r => r.label,
                    // A `{ at: FloatType, value }` record wraps by its field type.
                    cells: r => Plan.tableCells(r.sheets),
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.cards(NumberOpsRow, {
                    key: "crew", title: "Crews",
                    match: r => r.series.equal("crew"),
                    label: r => r.label,
                    chips: r => r.shifts.map((_$, s) => Plan.chip({
                        key: s.key, from: s.from, to: s.to,
                        label: East.str`${East.Float.printFixed(s.hours, 0n)}h`, state: s.state,
                    })),
                }),
                Plan.series.events(NumberOpsRow, {
                    key: "ms", title: "Milestones",
                    match: r => r.series.equal("ms"),
                    label: r => r.label, id: true,
                    marks: r => r.marks.map((_$, m) => Plan.mark({ key: m.key, at: m.day, kind: "milestone", label: m.label })),
                }),
            ], ArrayType(Plan.Types.Series(NumberOpsRow)));
            // The horizon's range field is an INTEGER day, so the brush, the
            // range chip and the window keys write the slice's `integer` arm:
            // a closed range, both ends inclusive — the eight days `[1, 9)`
            // are `1–8`.
            const slice = $.let(Slice.bind([NumberHorizonRow], "ex.plan.number", cfg, Slice.state({
                range: some(variant("integer", { from: 1n, to: 8n })),
            }), horizon.read(), none));
            // The declaration: `[1, 9)` ÷ 1 = eight day columns, the divider at 5.
            const axis = $.const(Plan.axis.number({
                window: { min: 1, max: 9 }, step: 1, now: 5, format: Chart.format.number(),
            }));
            return (
                <Plan
                    axis={axis}
                    data={ops}
                    series={series}
                    slice={{ slice, affordances: ["filter", "range", "brush", "summary"] }}
                    footer={[{ text: "8 STEPS · NOW 5" }]}
                />
            );
        }}</Reactive>);
    }),
    inputs: [],
});

// ============================================================================
// planOrdinalAxis — the `ordinal` axis (#631): workflow phases
// ============================================================================

/** A job — the phases it spans, by name. */
export const OrdinalJob = StructType({ key: StringType, label: StringType, start: StringType, end: StringType, state: EventStateType });
/** A bindery slot — the phase it sits in. */
export const OrdinalAlloc = StructType({ key: StringType, phase: StringType, state: EventStateType });
/** A crew shift — the phases it covers. */
export const OrdinalShift = StructType({ key: StringType, from: StringType, to: StringType, label: StringType, state: EventStateType });
/** A gate — its phase, and whether it holds the work. */
export const OrdinalMark = StructType({ key: StringType, phase: StringType, label: StringType, exception: BooleanType });
/** A chart point — a phase and a count. */
export const OrdinalPoint = StructType({ phase: StringType, n: FloatType });
/** A table reading — a phase and its value. */
export const OrdinalReading = StructType({ at: StringType, value: OptionType(FloatType) });
/** RAW rows — every instant is a phase NAME. */
export const OrdinalOrderRow = StructType({
    series: StringType, label: StringType, value: OptionType(StringType), sub: OptionType(StringType),
    jobs: ArrayType(OrdinalJob), allocations: ArrayType(OrdinalAlloc), shifts: ArrayType(OrdinalShift),
    marks: ArrayType(OrdinalMark), points: ArrayType(OrdinalPoint), counts: ArrayType(OrdinalReading),
    cells: ArrayType(Plan.Types.HeatCell),
});

/** The jobs, bindery slots, loads and gates of a six-phase workflow. */
export const planOrdinalOrders = e3.input("plan_ordinal_orders", DictType(StringType, OrdinalOrderRow), variant("value", new Map([
    ["j6188", { series: "job", label: "J-6188", value: some("96 k sheets"), sub: none,
      allocations: [], shifts: [], marks: [], points: [], counts: [], cells: [],
      jobs: [
          { key: "plates", label: "PLATES", start: "PREPRESS", end: "PLATES", state: variant("actual", null) },
          { key: "print", label: "PRINT · J-4642", start: "PRINT", end: "FINISH", state: variant("in-progress", null) },
          { key: "deliver", label: "BIND + DELIVER", start: "BIND", end: "DELIVER", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["j6204", { series: "job", label: "J-6204", value: some("54 k sheets"), sub: none,
      allocations: [], shifts: [], marks: [], points: [], counts: [], cells: [],
      jobs: [
          { key: "prepress", label: "PREPRESS", start: "PREPRESS", end: "PREPRESS", state: variant("actual", null) },
          { key: "print", label: "PRINT · J-4663", start: "PLATES", end: "BIND", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["bindery", { series: "bindery", label: "Bindery 2", value: none, sub: some("slots"),
      jobs: [], shifts: [], marks: [], points: [], counts: [], cells: [],
      allocations: [
          { key: "a1", phase: "PLATES", state: variant("confirmed", null) }, { key: "a2", phase: "PRINT", state: variant("confirmed", null) },
          { key: "a3", phase: "PRINT", state: variant("proposed", variant("recommended", null)) }, { key: "a4", phase: "BIND", state: variant("proposed", variant("recommended", null)) },
      ] }],
    // Heat cells as STORED records — the phase spelled on the `ordinal` arm.
    ["load", { series: "load", label: "Phase load", value: none, sub: none,
      jobs: [], allocations: [], shifts: [], marks: [], points: [], counts: [],
      cells: [
          { at: variant("ordinal", "PREPRESS"), value: some(35.0), label: some("35") },
          { at: variant("ordinal", "PLATES"), value: some(66.0), label: some("66") },
          { at: variant("ordinal", "PRINT"), value: some(37.0), label: some("37") },
          { at: variant("ordinal", "FINISH"), value: some(68.0), label: some("68") },
          { at: variant("ordinal", "BIND"), value: some(39.0), label: some("39") },
          { at: variant("ordinal", "DELIVER"), value: some(70.0), label: some("70") },
      ] }],
    ["wip", { series: "wip", label: "WIP · jobs", value: some("31"), sub: none,
      jobs: [], allocations: [], shifts: [], marks: [], counts: [], cells: [],
      points: [
          { phase: "PREPRESS", n: 4.0 }, { phase: "PLATES", n: 11.0 }, { phase: "PRINT", n: 18.0 },
          { phase: "FINISH", n: 5.0 }, { phase: "BIND", n: 12.0 }, { phase: "DELIVER", n: 19.0 },
      ] }],
    ["count", { series: "count", label: "Jobs in phase", value: none, sub: none,
      jobs: [], allocations: [], shifts: [], marks: [], points: [], cells: [],
      counts: [
          { at: "PREPRESS", value: some(12.0) }, { at: "PLATES", value: some(23.0) }, { at: "PRINT", value: some(34.0) },
          { at: "FINISH", value: some(15.0) }, { at: "BIND", value: none }, { at: "DELIVER", value: some(37.0) },
      ] }],
    ["crew", { series: "crew", label: "Crew B", value: none, sub: none,
      jobs: [], allocations: [], marks: [], points: [], counts: [], cells: [],
      shifts: [
          { key: "s1", from: "PREPRESS", to: "PLATES", label: "prepress crew", state: variant("confirmed", null) },
          { key: "s2", from: "PRINT", to: "DELIVER", label: "+ bindery crew", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["gates", { series: "gates", label: "Gates", value: none, sub: none,
      jobs: [], allocations: [], shifts: [], points: [], counts: [], cells: [],
      marks: [
          { key: "g1", phase: "FINISH", label: "HOLD", exception: true },
          { key: "g2", phase: "DELIVER", label: "RELEASE", exception: false },
      ] }],
])));

/**
 * The `ordinal` axis — a workflow of six phases, each a bucket, in declared
 * order. Instants are the phase VALUES: a run's `start` / `end` are phase
 * names (an interval covers `[start, end]` in phase order — on an ordinal
 * axis the end names the LAST bucket covered, since values are buckets, not
 * edges), a tile sits in a phase, a chart's string x accessor lands its
 * columns on the phase arm, `Plan.tableCells` reads a string `at`, and a
 * record written as data spells its phase on the `ordinal` arm. There is no
 * slice range for an ordinal axis — the list IS the window, so the horizon
 * brush does not mount and the window keys idle; `now` names a phase.
 */
export const planOrdinalAxis = example({
    keywords: [
        "Plan", "axis", "ordinal", "phase", "phases", "workflow", "stage", "Plan.axis.ordinal",
        "Plan.at", "instant", "values", "list", "span", "buckets", "heat", "chart", "table",
        "cards", "events", "Planner", "typed axis", "#631", "raw", "Data.bind", "bound", "e3.input",
    ],
    description: "The ordinal axis over rows bound from e3 — six workflow phases as the buckets, in declared order; jobs span phases, tiles and cells sit in them, a string x accessor lands a chart on them",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders = $.let(Data.bind(planOrdinalOrders));
            const PHASES = $.const(["PREPRESS", "PLATES", "PRINT", "FINISH", "BIND", "DELIVER"], ArrayType(StringType));
            const EXCEPTION = $.const(variant("exception", null), Plan.Types.EventMarkKind);
            const MILESTONE = $.const(variant("milestone", null), Plan.Types.EventMarkKind);
            const series = $.const([
                Plan.series.section(OrdinalOrderRow, { key: "job-block", title: "Jobs", meta: "2 rows" }, [
                    Plan.series.span(OrdinalOrderRow, {
                        key: "job", title: "Jobs",
                        match: r => r.series.equal("job"),
                        label: r => r.label, id: true, value: r => r.value,
                        // `j.start` / `j.end` are StringType fields — the builder wraps them to the ordinal arm.
                        runs: r => r.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })),
                    }),
                ]),
                Plan.series.buckets(OrdinalOrderRow, {
                    key: "bindery", title: "Bindery",
                    match: r => r.series.equal("bindery"),
                    label: r => r.label, sub: r => r.sub,
                    events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.phase, state: a.state })),
                }),
                Plan.series.heat(OrdinalOrderRow, {
                    key: "load", title: "Phase load",
                    match: r => r.series.equal("load"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 90 }),
                }),
                Plan.series.chart(OrdinalOrderRow, {
                    key: "wip", title: "WIP",
                    match: r => r.series.equal("wip"),
                    label: r => r.label, id: true, value: r => r.value, height: "expanded",
                    // A string x accessor lands the columns on the ordinal arm.
                    layers: r => [Chart.Column(r.points, { x: p => p.phase, y: p => p.n })],
                }),
                Plan.series.table(OrdinalOrderRow, {
                    key: "count", title: "Counts",
                    match: r => r.series.equal("count"),
                    label: r => r.label,
                    cells: r => Plan.tableCells(r.counts),
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.cards(OrdinalOrderRow, {
                    key: "crew", title: "Crews",
                    match: r => r.series.equal("crew"),
                    label: r => r.label,
                    chips: r => r.shifts.map((_$, s) => Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
                }),
                Plan.series.events(OrdinalOrderRow, {
                    key: "gates", title: "Gates",
                    match: r => r.series.equal("gates"),
                    label: r => r.label, id: true,
                    marks: r => r.marks.map((_$, m) => Plan.mark({
                        key: m.key, at: m.phase, label: m.label,
                        kind: m.exception.ifElse(() => EXCEPTION, () => MILESTONE),
                    })),
                }),
            ], ArrayType(Plan.Types.Series(OrdinalOrderRow)));
            // The declaration: the list IS the axis — one bucket per phase, `now` at PRINT.
            const axis = $.const(Plan.axis.ordinal({ values: PHASES, now: "PRINT" }));
            return (
                <Plan
                    axis={axis}
                    data={orders}
                    series={series}
                    footer={[{ text: "6 PHASES · NOW PRINT" }]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// slicePlanChrome — a Plan with the `slice` chrome option
//    Exercises: the rail on the timeline canvas (filter · search · range
//    over the row type's datetime field) plus the horizon brush.
// ============================================================================

/** A task on the plan — its owner and its window. */
export const SliceJob = StructType({ task: StringType, owner: StringType, start: DateTimeType, end: DateTimeType });

/** The plan's tasks — the rows the slice narrows. */
export const planSliceJobs = e3.input("plan_slice_jobs", ArrayType(SliceJob), variant("value", [
    { task: "Planning",    owner: "Team A", start: new Date("2024-01-01T00:00:00Z"), end: new Date("2024-01-15T00:00:00Z") },
    { task: "Design",      owner: "Team B", start: new Date("2024-01-10T00:00:00Z"), end: new Date("2024-02-01T00:00:00Z") },
    { task: "Development", owner: "Team C", start: new Date("2024-01-20T00:00:00Z"), end: new Date("2024-03-15T00:00:00Z") },
    { task: "Testing",     owner: "Team A", start: new Date("2024-03-01T00:00:00Z"), end: new Date("2024-03-30T00:00:00Z") },
]));

export const slicePlanChrome = example({
    keywords: ["Slice", "Plan", "slice", "chrome", "filter", "search", "range", "brush", "timeline", "Data.bind", "bound", "e3.input"],
    description: "Ops plan — Plan with the `slice` chrome option over tasks bound from e3: a header rail (`filter`, `search`, `range`) plus the `brush` affordance — drag a window on the horizon strip to set the slice's range; rows fed explicitly via `Slice.rows` and re-keyed into the canvas's keyed collection",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(SliceJob, {
            fields: { task: { label: "Task" }, owner: { label: "Owner" }, start: { label: "Start" } },
            searchFieldIds: ["task", "owner"],
            rangeFieldId: "start",
        });
        return (
            <Reactive>{$ => {
                const tasks = $.let(Data.bind(planSliceJobs));
                const slice = $.let(Slice.bind([SliceJob], "ex.slice.plan.chrome", cfg, Slice.state({
                    filters: [variant("string", { fieldId: "owner", op: variant("eq", "Team A") })],
                }), tasks.read(), none));
                // The narrowed rows re-key into the canvas's keyed collection
                // (#568) — the task name is the row identity here.
                const narrowed = $.let(Slice.rows([SliceJob], slice));
                const jobs = $.let(narrowed.toDict((_$, j) => j.task, (_$, j) => j));
                const series = $.const([
                    Plan.series.span(SliceJob, {
                        key: "jobs", title: "Jobs",
                        label: r => r.task, id: true,
                        sub: r => some(r.owner),
                        runs: (r, k) => [Plan.run({
                            key: k, start: r.start, end: r.end,
                            label: r.task, state: variant("confirmed", null),
                        })],
                    }),
                ], ArrayType(Plan.Types.Series(SliceJob)));
                const axis = $.const(Plan.axis({
                    window: { min: new Date("2024-01-01"), max: new Date("2024-04-01") },
                    resolution: "week", now: new Date("2024-01-20"),
                }));
                return (
                    <Plan
                        axis={axis}
                        data={jobs}
                        series={series}
                        slice={{ slice, affordances: ["filter", "search", "range", "brush"] }}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
