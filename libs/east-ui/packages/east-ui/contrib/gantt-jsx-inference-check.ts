/**
 * Scratch type-level check: does the generic `<Gantt>` JSX tag preserve the
 * SAME schema inference as the `Gantt.Root` factory — including the per-row
 * `rowSpec` callback whose `row` parameter is the data element? Type-checked
 * by tsc; `@ts-expect-error` lines are negative tests that MUST error.
 */

import { Gantt, UIComponentType } from "@elaraai/east-ui";
import { Gantt as GanttTag } from "@elaraai/east-ui/jsx";
import { East } from "@elaraai/east";
void UIComponentType;

const data = East.value([
    { task: "Planning", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
    { task: "Design", owner: "Bob", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
]);

// ── Factory baseline — rowSpec.row and column closures infer field values ───
const viaFactory = Gantt.Root(
    data,
    {
        task: { header: "Task" },
        owner: { header: "Owner", value: (owner) => owner.length() },
    },
    row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
    { striped: true },
);

// ── JSX tag — MUST infer identically (data/columns/rowSpec flat props) ──────
const viaTag = GanttTag({
    data,
    columns: {
        task: { header: "Task" },
        owner: { header: "Owner", value: (owner) => owner.length() },
    },
    rowSpec: row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
    striped: true,
});

const _bothAreUi: [typeof viaFactory, typeof viaTag] = [viaFactory, viaTag];
void _bothAreUi;

// ── Negative tests — MUST error (inference is real, not `any`) ──────────────

GanttTag({
    data,
    columns: ["task", "owner"],
    // @ts-expect-error — `row.nope` is not a field of the data element
    rowSpec: row => ({ tasks: [Gantt.Task({ start: row.nope, end: row.end })] }),
});

GanttTag({
    data,
    // @ts-expect-error — `bogus` is not a field of the data element
    columns: ["task", "bogus"],
    rowSpec: row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
});

GanttTag({
    data,
    columns: {
        // @ts-expect-error — `owner` is a String East value; `.toFixed` is not a method on it
        owner: { header: "Owner", value: (owner) => owner.toFixed(2) },
    },
    rowSpec: row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
});
