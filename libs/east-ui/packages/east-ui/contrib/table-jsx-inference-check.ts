/**
 * Scratch type-level check: does the generic `<Table>` JSX tag preserve the
 * SAME schema inference as the `Table.Root` factory?
 *
 * `<Table data={…} columns={…} />` desugars to `Table(props)`, so calling the
 * tag function with an object literal exercises the identical inference path.
 * This file is type-checked by tsc (no runtime); `@ts-expect-error` lines are
 * negative tests — they MUST error, or tsc fails the build.
 */

import { East } from "@elaraai/east";
import { Table, Badge, Stack, Text, UIComponentType } from "@elaraai/east-ui";
import { Table as TableTag } from "@elaraai/east-ui/jsx";

const data = East.value([
    { name: "Alice", skills: ["TypeScript", "React"], metadata: { level: "Senior", years: 5n } },
    { name: "Bob", skills: ["Python"], metadata: { level: "Mid", years: 3n } },
]);

// ── 1. Factory baseline — value closures infer field-typed East values ──────
const viaFactory = Table.Root(
    data,
    {
        name: { header: "Name" },
        skills: {
            header: "Skills",
            // `skills` is an East ArrayType<StringType> value → `.size()` exists
            value: (skills) => skills.size(),
        },
        metadata: {
            header: "Experience",
            // `meta` is an East StructType value → `.years` is a field
            value: (meta) => meta.years,
            render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                const row = $.let(data.get(ctx.rowIndex));
                return Text.Root(East.str`${row.metadata.level} (${row.metadata.years} yrs)`);
            }),
        },
    },
    { variant: "line", striped: true, footer: { name: { content: Text.Root("2 people") } } },
);

// ── 2. JSX tag — MUST infer identically (closures, render, footer keys) ─────
const viaTag = TableTag({
    data,
    columns: {
        name: { header: "Name" },
        skills: {
            header: "Skills",
            value: (skills) => skills.size(),
            render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                const row = $.let(data.get(ctx.rowIndex));
                return Stack.HStack(
                    row.skills.map((_$, s) => Badge.Root(s, { variant: "subtle", colorPalette: "blue" })),
                    { gap: "1", wrap: "wrap" },
                );
            }),
        },
        metadata: {
            header: "Experience",
            value: (meta) => meta.years,
        },
    },
    variant: "line",
    striped: true,
    footer: { name: { content: Text.Root("2 people") } },
});

// Both paths produce an East UIComponentType expression.
const _bothAreUi: [typeof viaFactory, typeof viaTag] = [viaFactory, viaTag];
void _bothAreUi;

// ── 3. Negative tests — these MUST error (inference is real, not `any`) ─────

TableTag({
    data,
    columns: {
        // @ts-expect-error — `nope` is not a field of the data element
        nope: { header: "X" },
    },
});

TableTag({
    data,
    columns: {
        skills: {
            header: "Skills",
            // @ts-expect-error — `skills` is an array East value; `.toUpperCase` is not a method on it
            value: (skills) => skills.toUpperCase(),
        },
    },
});

TableTag({
    data,
    columns: { name: { header: "Name" } },
    // @ts-expect-error — `bogus` is not a valid column key for the footer map
    footer: { bogus: { value: "x" } },
});

TableTag({
    data,
    columns: {
        metadata: {
            header: "Experience",
            // @ts-expect-error — `meta` is a struct East value; `.notAField` does not exist
            value: (meta) => meta.notAField,
        },
    },
});
