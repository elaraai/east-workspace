/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Plan>` tag — see the export's JSDoc.
 */

import {
    Plan as PlanFactory,
    type PlanConfig,
    type PlanAxisKindLiteral,
    type PlanNamespace,
} from "../../collections/plan/index.js";
import type { UIElement } from "../runtime.js";

/** The tag's call — `Plan.Root`, generic in the axis kind `K` that `axis` fixes. */
function PlanTag<K extends PlanAxisKindLiteral = PlanAxisKindLiteral>(props: PlanConfig<K>): UIElement {
    return PlanFactory.Root(props);
}

// The tag IS the root, so `Root` is the one factory member it does not carry.
// Derived, never hand-listed: a member added to `PlanNamespace` rides the tag
// with no edit here (#814).
const { Root: _root, ...authoring } = PlanFactory;

/**
 * `<Plan>` — the axis-aligned composite canvas: one shared axis
 * (`{ time | number | ordinal }` — a window ÷ resolution or step, or an
 * ordinal list, = `n` buckets) over heterogeneous rows — span rows
 * (Gantt state-runs), bucket rows (Planner allocation lanes), chart rows
 * (Chart layers consumed as data), heat/table rows (Matrix cells / bucketed
 * numerals), cards rows (Roster chips), event marks and group strips —
 * sliced and reviewed as one surface.
 *
 * A canvas is its `data` — a keyed collection of raw entries, or a paged
 * source of one — and its `series`: one `Plan.series.*` value per row series,
 * whose accessors derive each canvas row from the raw fields (`Plan.pick`
 * makes the list one the user picks from). The list IS the layout — one block
 * per series, top to bottom — and hierarchy comes only from the data's own
 * nesting (#822): a series' `children` walk what an entry holds, to any depth
 * (`Plan.children` steps down to another entry type), and a flat source is
 * grouped in a data step first (`groupToDicts`). `Plan.series.section` titles
 * a block and `Plan.series.views` shows one entry several ways. Every row has
 * a typed id — its series and the path of entry keys to it (`Plan.ref`).
 *
 * Content comes from the value builders (`Plan.run` / `event` / `chip` /
 * `mark` / `marker` / `decision` / `port` / `segment` / the cell builders,
 * instants via `Plan.at.*`), the axis from `Plan.axis` (`time`) /
 * `Plan.axis.number` / `Plan.axis.ordinal` — its window stated, or supplied by
 * a bound slice — and rows no dataset holds from the kind factories
 * (`Plan.span` / `buckets` / `chart` / `heat` / `table` / `cards` / `events` /
 * `group`), placed by a `Plan.series.rows` entry. Props are
 * {@link PlanConfig}; maps to `Plan.Root`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, StringType, StructType, VariantType, variant } from "@elaraai/east";
 * import { EventStateType, Format, Plan, UIComponentType } from "@elaraai/east-ui";
 *
 * const canvas = East.function([], UIComponentType, ($) => {
 *     // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
 *     const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
 *         const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
 *         return w1.addWeeks(n.subtract(1n));
 *     }));
 *     // The RAW domain shape — series discriminated by a variant field
 *     // (the natural ops-dataset form; the same rows page from a dataset).
 *     const JobRow = StructType({
 *         batch: StringType, start: DateTimeType, end: DateTimeType,
 *         tonnes: FloatType, state: EventStateType,
 *     });
 *     const ShiftRow = StructType({
 *         key: StringType, from: DateTimeType, to: DateTimeType,
 *         hours: FloatType, state: EventStateType,
 *     });
 *     const OpsRow = StructType({
 *         line: StringType,
 *         kind: VariantType({
 *             machine: StructType({ jobs: ArrayType(JobRow) }),
 *             crew:    StructType({ shifts: ArrayType(ShiftRow) }),
 *         }),
 *     });
 *     const ops = $.const(new Map([
 *         ["L1-M03", { line: "Line 1", kind: variant("machine", { jobs: [
 *             { batch: "B-214", start: week(28n), end: week(31n), tonnes: 96.0, state: variant("in-progress", null) },
 *             { batch: "B-221", start: week(32n), end: week(35n), tonnes: 88.0, state: variant("proposed", variant("recommended", null)) },
 *         ] }) }],
 *         ["L1-M04", { line: "Line 1", kind: variant("machine", { jobs: [
 *             { batch: "B-208", start: week(27n), end: week(30n), tonnes: 112.0, state: variant("actual", null) },
 *         ] }) }],
 *         ["L2-M11", { line: "Line 2", kind: variant("machine", { jobs: [
 *             { batch: "B-241", start: week(29n), end: week(33n), tonnes: 92.0, state: variant("confirmed", null) },
 *         ] }) }],
 *         ["crewA", { line: "Line 1", kind: variant("crew", { shifts: [
 *             { key: "s1", from: week(27n), to: week(29n), hours: 80.0, state: variant("confirmed", null) },
 *             { key: "s2", from: week(31n), to: week(33n), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
 *         ] }) }],
 *     ]), DictType(StringType, OpsRow));
 *     // Hierarchy is the DATA's (#822): one `groupToDicts` groups the rows
 *     // into the canvas's blocks — each machine under its line, the crews
 *     // under one "Crews" block. An entry of the result holds its rows.
 *     const blocks = $.let(ops.groupToDicts(
 *         ($, r) => r.kind.hasTag("crew").ifElse(() => "Crews", () => r.line),
 *         ($, _r, k) => k));
 *     const Block = DictType(StringType, OpsRow);
 *     // The series — real East values bound in the body, typed by the
 *     // constructor. The list IS the layout: one block per series, top to
 *     // bottom. The accessors are where raw fields become canvas vocabulary:
 *     // labels, quantity displays and chip text all derive CLIENT-SIDE,
 *     // inside each series' `derive`.
 *     const series = $.const([
 *         // One row per line, its machines stepped down into
 *         // (`Plan.children`) and their runs rolled up into its bands —
 *         // which sum the runs' quantities, unit by unit.
 *         Plan.series.span(Block, {
 *             key: "lines", title: "Lines",
 *             match: (_b, name) => name.equal("Crews").not(),
 *             label: (_b, name) => name,
 *             runs: _b => [],
 *             rollup: "union",
 *             children: Plan.children((b) => b, [
 *                 Plan.series.span(OpsRow, {
 *                     key: "machines", title: "Machines",
 *                     match: r => r.kind.hasTag("machine"),
 *                     label: (_r, k) => k, id: true,
 *                     runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
 *                         key: j.batch, start: j.start, end: j.end,
 *                         label: East.str`RUN · ${j.batch}`,
 *                         // A quantity is one value: the bar prints `96 t`,
 *                         // and the line's band sums the tonnes.
 *                         quantity: Plan.quantity(j.tonnes, { unit: "t", format: Format.Number({ maximumFractionDigits: 0n }) }),
 *                         state: j.state,
 *                     })),
 *                 }),
 *             ]),
 *         }),
 *         // One strip per matching block — here the one "Crews" block,
 *         // wearing its member count.
 *         Plan.series.group(Block, {
 *             key: "crews", title: "Crews",
 *             match: (_b, name) => name.equal("Crews"),
 *             label: (_b, name) => name,
 *             children: Plan.children((b) => b, [
 *                 Plan.series.cards(OpsRow, {
 *                     key: "crew-shifts", title: "Crew shifts",
 *                     match: r => r.kind.hasTag("crew"),
 *                     label: (_r, k) => k,
 *                     chips: r => r.kind.unwrap("crew").shifts.map(($, s) => {
 *                         const hrs = $.let(East.Float.printFixed(s.hours, 0n), StringType);
 *                         // `+` marks ADDED hours — a removed proposal keeps the
 *                         // plain figure (see planCardRows for the full ladder).
 *                         const label = $.let(s.state.match({
 *                             proposed: (_$, p) => p.hasTag("removed").ifElse(
 *                                 () => East.str`${hrs}h`,
 *                                 () => East.str`+${hrs}h`),
 *                         }, _$ => East.str`${hrs}h`), StringType);
 *                         return Plan.chip({ key: s.key, from: s.from, to: s.to, label, state: s.state });
 *                     }),
 *                 }),
 *             ]),
 *         }),
 *         Plan.series.rows(Block, { key: "chrome", title: "Milestones", subtitle: "one-off chrome" },
 *             [Plan.events({ key: "ms", label: "MILESTONES", id: true, marks: [
 *                 Plan.mark({ key: "kick", at: week(28n), kind: "milestone", label: "KICKOFF" }),
 *                 Plan.mark({ key: "rel", at: week(33n), kind: "milestone", label: "REL 2.4" }),
 *             ] })]),
 *     ], ArrayType(Plan.Types.Series(Block)));
 *     const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
 *     return (
 *         <Plan
 *             axis={axis}
 *             data={blocks}
 *             series={series}
 *         />
 *     );
 * });
 * ```
 *
 * @remarks
 * Carries the factory namespace except `Root` (the tag is the root):
 * `Plan.axis` (+ `.time` / `.number` / `.ordinal`), `Plan.at`,
 * `Plan.series.*`, `Plan.children`, `Plan.ref` / `Plan.sectionRef`,
 * `Plan.pick` / `Plan.pickItems`, the kind factories, the value and cell
 * builders, `Plan.quantity`, `Plan.link`, `Plan.layer` / `Plan.fixed` (chart
 * channels), `Plan.markKind`, `Plan.uiState` (a bound `ui` state's seed), and
 * `Plan.Types.*`. Replaces `Gantt`, `Planner` and
 * `AlignedStack`.
 *
 * The tag is generic in the canvas's axis kind `K`, inferred from `axis`:
 * a series whose instants ride another arm is a compile error at the tag
 * (see `PlanConfig`).
 */
export const Plan: {
    <K extends PlanAxisKindLiteral = PlanAxisKindLiteral>(props: PlanConfig<K>): UIElement;
} & Omit<PlanNamespace, "Root"> = Object.assign(PlanTag, authoring);
