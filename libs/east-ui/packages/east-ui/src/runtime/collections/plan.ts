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
} from "../../collections/plan/index.js";
import type { UIElement } from "../runtime.js";

/**
 * `<Plan>` — the axis-aligned composite canvas: one shared axis
 * (`{ time | number | ordinal }` — a window ÷ resolution or step, or an
 * ordinal list, = `n` buckets) over heterogeneous rows — span rows
 * (Gantt state-runs), bucket rows (Planner allocation lanes), chart rows
 * (Chart layers consumed as data), heat/table rows (Matrix cells / bucketed
 * numerals), cards rows (Roster chips), event marks and group strips —
 * sliced and reviewed as one surface.
 *
 * Rows are built with the kind factories (`Plan.span` / `buckets` / `chart` /
 * `heat` / `table` / `cards` / `events` / `group`, the data-driven
 * `Plan.rows`, and the accessor `.of` forms); content with the value builders
 * (`Plan.run` / `event` / `chip` / `mark` / `marker` / `decision` / `port` /
 * `segment` / cell builders, instants via `Plan.at.*`); the axis with
 * `Plan.axis` (`time`) / `Plan.axis.number` / `Plan.axis.ordinal`. Maps to
 * `Plan.Root`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Plan, UIComponentType } from "@elaraai/east-ui";
 *
 * const canvas = East.function([], UIComponentType, _$ => (
 *     <Plan
 *         axis={Plan.axis({
 *             window: { min: new Date("2026-06-29"), max: new Date("2026-09-21") },
 *             resolution: "week", now: new Date("2026-07-27"),
 *         })}
 *         rows={[
 *             Plan.span({
 *                 key: "m03", label: "L1-M03", id: true, sub: "120 t",
 *                 runs: [
 *                     Plan.run({ key: "set", start: new Date("2026-06-29"), end: new Date("2026-07-06"), label: "SET", state: "actual" }),
 *                     Plan.run({ key: "run", start: new Date("2026-07-06"), end: new Date("2026-07-27"), label: "RUN · B-214", quantity: "96 t", state: "in-progress" }),
 *                     Plan.run({ key: "next", start: new Date("2026-08-03"), end: new Date("2026-08-24"), label: "RUN · B-221", quantity: "88 t", state: "recommended" }),
 *                 ],
 *             }),
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries the whole authoring namespace — `Plan.axis` (+ `.time` / `.number` /
 * `.ordinal`), `Plan.at`, the kind factories, the value builders,
 * `Plan.layer` / `Plan.fixed` (chart channels), `Plan.markKind`, and
 * `Plan.Types.*`. Replaces `Gantt`, `Planner` and `AlignedStack`.
 *
 * The tag is generic in the canvas's axis kind `K`, inferred from `axis`:
 * a series whose instants ride another arm is a compile error at the tag
 * (see `PlanConfig`).
 */
export const Plan: {
    <K extends PlanAxisKindLiteral = PlanAxisKindLiteral>(props: PlanConfig<K>): UIElement;
    axis: typeof PlanFactory.axis;
    at: typeof PlanFactory.at;
    span: typeof PlanFactory.span;
    buckets: typeof PlanFactory.buckets;
    chart: typeof PlanFactory.chart;
    heat: typeof PlanFactory.heat;
    table: typeof PlanFactory.table;
    cards: typeof PlanFactory.cards;
    events: typeof PlanFactory.events;
    group: typeof PlanFactory.group;
    series: typeof PlanFactory.series;
    run: typeof PlanFactory.run;
    decision: typeof PlanFactory.decision;
    port: typeof PlanFactory.port;
    event: typeof PlanFactory.event;
    lane: typeof PlanFactory.lane;
    marker: typeof PlanFactory.marker;
    chip: typeof PlanFactory.chip;
    mark: typeof PlanFactory.mark;
    link: typeof PlanFactory.link;
    markKind: typeof PlanFactory.markKind;
    heatCells: typeof PlanFactory.heatCells;
    weightCells: typeof PlanFactory.weightCells;
    segmentCells: typeof PlanFactory.segmentCells;
    segment: typeof PlanFactory.segment;
    tableCells: typeof PlanFactory.tableCells;
    tableSeries: typeof PlanFactory.tableSeries;
    layer: typeof PlanFactory.layer;
    fixed: typeof PlanFactory.fixed;
    pick: typeof PlanFactory.pick;
    pickItems: typeof PlanFactory.pickItems;
    Types: typeof PlanFactory.Types;
} = Object.assign(
    function Plan<K extends PlanAxisKindLiteral = PlanAxisKindLiteral>(props: PlanConfig<K>): UIElement {
        return PlanFactory.Root(props);
    },
    {
        axis: PlanFactory.axis,
        at: PlanFactory.at,
        span: PlanFactory.span,
        buckets: PlanFactory.buckets,
        chart: PlanFactory.chart,
        heat: PlanFactory.heat,
        table: PlanFactory.table,
        cards: PlanFactory.cards,
        events: PlanFactory.events,
        group: PlanFactory.group,
        series: PlanFactory.series,
        run: PlanFactory.run,
        decision: PlanFactory.decision,
        port: PlanFactory.port,
        event: PlanFactory.event,
        lane: PlanFactory.lane,
        marker: PlanFactory.marker,
        chip: PlanFactory.chip,
        mark: PlanFactory.mark,
        link: PlanFactory.link,
        markKind: PlanFactory.markKind,
        heatCells: PlanFactory.heatCells,
        weightCells: PlanFactory.weightCells,
        segmentCells: PlanFactory.segmentCells,
        segment: PlanFactory.segment,
        tableCells: PlanFactory.tableCells,
        tableSeries: PlanFactory.tableSeries,
        layer: PlanFactory.layer,
        fixed: PlanFactory.fixed,
        pick: PlanFactory.pick,
        pickItems: PlanFactory.pickItems,
        Types: PlanFactory.Types,
    },
);
