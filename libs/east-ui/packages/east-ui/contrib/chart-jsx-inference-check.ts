/**
 * Scratch type-level check for the `<Chart>` JSX tag.
 *
 * `Chart.Root(layers, options?)` is NOT generic — it takes already-built
 * `ChartLayer`s. The row inference lives in `Chart.Line<Row>(rows, encoding)`,
 * whose encoding closures (`x: r => r.month`) infer `r` from `rows` at the
 * `Chart.Line` call. So `<Chart layers={[Chart.Line(rows, { x: r => r.x })]} />`
 * infers at construction; the leaf tag forwards the resulting layers verbatim.
 * This file proves that — the closures stay inferred and bad fields error.
 * `@ts-expect-error` lines are negatives that MUST error.
 */

import { Chart } from "@elaraai/east-ui";
import { Chart as ChartTag } from "@elaraai/east-ui/jsx";
import { East } from "@elaraai/east";

const rows = East.value([
    { month: "Jan", sales: 10.0, mac: 4.0, linux: 2.0 },
    { month: "Feb", sales: 14.0, mac: 6.0, linux: 3.0 },
]);

// ── Factory baseline — encoding closures infer field-typed row values ───────
const viaFactory = Chart.Root(
    [Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { color: "teal.solid" })],
    { grid: true, tooltip: true },
);

// ── JSX tag — same layers accepted; encoding closures infer identically ─────
const viaTag = ChartTag({
    layers: [
        Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { color: "teal.solid" }),
        Chart.Line(rows, { x: r => r.month, columns: { Mac: r => r.mac, Linux: r => r.linux } }),
    ],
    grid: true,
    tooltip: true,
});

const _bothAreUi: [typeof viaFactory, typeof viaTag] = [viaFactory, viaTag];
void _bothAreUi;

// ── Negative tests — MUST error (Chart.Line's inference is real) ────────────

ChartTag({
    // @ts-expect-error — `r.nope` is not a field of the row
    layers: [Chart.Line(rows, { x: r => r.nope, y: r => r.sales })],
});

ChartTag({
    // @ts-expect-error — `r.month` is a String row value; `y` needs a numeric accessor
    layers: [Chart.Line(rows, { x: r => r.month, y: r => r.month })],
});
