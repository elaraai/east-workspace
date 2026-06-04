/**
 * Scratch type-level check: does the generic `<Matrix>` JSX tag preserve the
 * SAME schema inference as the `Matrix.Root` factory? Type-checked by tsc;
 * `@ts-expect-error` lines are negative tests that MUST error.
 */

import { Matrix } from "@elaraai/east-ui";
import { Matrix as MatrixTag } from "@elaraai/east-ui/jsx";

const data = [
    { name: "Alice", booked: 0.7 },
    { name: "Bob", booked: 0.4 },
];

// ── Factory baseline — config closures infer field-typed East values ────────
const viaFactory = Matrix.Root(data, {
    columns: [{ key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }],
    rowKey: r => r.name,
    cell: (r, _col) => Matrix.cell({ segments: [
        Matrix.segment({ fill: "brand", weight: r.booked }),
        Matrix.segment({ fill: "free", weight: r.booked.subtract(1.0).multiply(-1.0) }),
    ] }),
    legend: [{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }],
});

// ── JSX tag — MUST infer identically (config spread as flat props) ──────────
const viaTag = MatrixTag({
    data,
    columns: [{ key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }],
    rowKey: r => r.name,
    cell: (r, _col) => Matrix.cell({ segments: [
        Matrix.segment({ fill: "brand", weight: r.booked }),
        Matrix.segment({ fill: "free", weight: r.booked.subtract(1.0).multiply(-1.0) }),
    ] }),
    legend: [{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }],
});

const _bothAreUi: [typeof viaFactory, typeof viaTag] = [viaFactory, viaTag];
void _bothAreUi;

// ── Negative tests — MUST error (inference is real, not `any`) ──────────────

MatrixTag({
    data,
    columns: [{ key: "mon", label: "Mon" }],
    // @ts-expect-error — `r.nope` is not a field of the data element
    rowKey: r => r.nope,
    cell: (r, _col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked })] }),
});

MatrixTag({
    data,
    columns: [{ key: "mon", label: "Mon" }],
    rowKey: r => r.name,
    // @ts-expect-error — `r.booked` is a Float East value; `.toUpperCase` is not a method on it
    cell: (r, _col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.toUpperCase() })] }),
});
