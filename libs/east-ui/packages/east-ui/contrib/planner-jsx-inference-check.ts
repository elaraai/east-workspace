/**
 * Scratch type-level check: do the generic `<Planner.Point>` / `<Planner.Span>`
 * JSX member tags preserve the SAME schema inference as `Planner.Point` /
 * `Planner.Span`? The members are generic functions on an object, so this also
 * checks that member-expression JSX (`<Planner.Point .../>`) keeps inference.
 * Type-checked by tsc; `@ts-expect-error` lines are negatives that MUST error.
 */

import { Planner } from "@elaraai/east-ui";
import { Planner as PlannerTag } from "@elaraai/east-ui/jsx";

const data = [
    { name: "api-01", role: "Lead", team: "Web" },
    { name: "cache", role: "Service", team: "Web" },
];

// ── Factory baseline — config closures infer field-typed East values ────────
const viaFactory = Planner.Point(data, {
    axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }], range: { min: 1, max: 8 } }),
    groupBy: r => r.team,
    columns: [{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }],
    events: _r => [Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "x", state: "committed" })],
});

// ── JSX member tag — MUST infer identically (config spread as flat props) ───
const viaTag = PlannerTag.Point({
    data,
    axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }], range: { min: 1, max: 8 } }),
    groupBy: r => r.team,
    columns: [{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }],
    events: _r => [Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "x", state: "committed" })],
});

// Span member infers the same way.
const viaSpan = PlannerTag.Span({
    data,
    axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }], range: { min: 1, max: 8 } }),
    columns: [{ key: "name", value: r => r.name }],
    events: _r => [Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "x", state: "committed" })],
});

const _allUi: [typeof viaFactory, typeof viaTag, typeof viaSpan] = [viaFactory, viaTag, viaSpan];
void _allUi;

// ── Negative tests — MUST error (inference is real, not `any`) ──────────────

PlannerTag.Point({
    data,
    axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }], range: { min: 1, max: 8 } }),
    // @ts-expect-error — `r.nope` is not a field of the data element
    groupBy: r => r.nope,
    columns: [{ key: "name", value: r => r.name }],
    events: _r => [Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "x", state: "committed" })],
});

PlannerTag.Point({
    data,
    axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }], range: { min: 1, max: 8 } }),
    // @ts-expect-error — `r.name` is a String East value; `.toFixed` is not a method on it
    columns: [{ key: "name", value: r => r.name.toFixed(2) }],
    events: _r => [Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "x", state: "committed" })],
});
