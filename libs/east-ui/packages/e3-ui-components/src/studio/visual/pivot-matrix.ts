/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio pivot (#1671, TBL-4): its answer read into the Matrix's value — a
 * row a group of its row field, a column a group of its column field, and at
 * each pair one cell holding its value, in short at the scale of the largest
 * drawn; a pair with no rows says "no data". Its heads are short, as an
 * axis's labels are (`Apr`). With heat on, each value takes one of five steps
 * from 0 to the 95th percentile of the values drawn — whole steps for a
 * count — the top step closed (`≥12`), on the theme's heat tokens, its text
 * ink on the first three and paper on the last two. A group's first N, then
 * the rest folded into Other where the fold is exact; else left out, which
 * it says.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { FloatType, SortedMap, SortedSet, StringType, compareFor, none, some, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import type { Matrix } from "@elaraai/east-ui/internal";
import type { MatrixRootValue } from "@elaraai/east-ui-components";
import type { QueryWords } from "../../query/model/words.js";
import type { VisualAnswer } from "../../query/visual/ask.js";
import type { VisualAsk } from "../../query/visual/print.js";
import { bucketStart, foldGroups, partsAt, readGroups, type ReadGroup } from "../../query/visual/read.js";
import { capitalised, type StudioMessages } from "../messages.js";
import {
    axisLabel, bucketSpan, groupWords, shortNumber, valueFieldFormat, visualWords,
    type VisualGroup, type VisualShown, type VisualSource, type VisualView,
} from "./values.js";

/** A pivot's view: its row group, its column group, its value, and whether it is a heat map. */
export type PivotView = Extract<Extract<VisualView, { type: "table" }>["value"], { type: "pivot" }>["value"];

/** A Matrix cell, decoded. */
type MatrixCell = ValueTypeOf<typeof Matrix.Types.Cell>;
/** A label, as the Matrix's columns and segments take it. */
type LabelValue = Extract<ValueTypeOf<typeof Matrix.Types.Column>["label"], { type: "some" }>["value"];

/** How many steps the heat ramp has (TBL-4). */
export const HEAT_STEPS = 5;

/** The heat percentile the ramp's top step closes at: a few outliers never wash the rest out. */
const HEAT_PERCENTILE = 0.95;

const compareFloat = compareFor(FloatType);
const compareKeys = compareFor(StringType);

/**
 * One step of a pivot's heat ramp, as its legend draws it.
 *
 * @property label - Its lower edge, printed — the top step's closed: `≥12`
 * @property name - Its range in words, for a screen reader: `3–6`
 */
export interface HeatStep {
    /** Its lower edge, printed — the top step's closed: `≥12`. */
    readonly label: string;
    /** Its range in words, for a screen reader: `3–6`. */
    readonly name: string;
}

/**
 * A pivot, read from its answer.
 *
 * @property matrix - Its cells as the Matrix's value
 * @property heat - Its heat ramp's steps, for its legend; `undefined` with heat off
 * @property shown - What it holds of how many groups, when it holds fewer; `undefined` when it holds them all
 */
export interface PivotModel {
    /** Its cells as the Matrix's value. */
    readonly matrix: MatrixRootValue;
    /** Its heat ramp's steps, for its legend; `undefined` with heat off. */
    readonly heat: readonly HeatStep[] | undefined;
    /** What it holds of how many groups, when it holds fewer; `undefined` when it holds them all. */
    readonly shown: VisualShown | undefined;
}

/** A label in the Matrix's form: its text alone. */
function labelOf(text: string): LabelValue {
    return { value: text, align: none, verticalAlign: none, color: none, fontWeight: none, fontStyle: none, fontSize: none };
}

/** A cell of one segment: its text, on a fill, under a colour of the theme's where it has one. */
function cellOf(text: string, fill: "neutral" | "brand" | "free", color: string): MatrixCell {
    return {
        segments: [{ fill: variant(fill, null), weight: 1, label: some(labelOf(text)), color: some(color), min: none, max: none, step: none }],
        markers: [], orientation: none, slot: none, popover: none,
    };
}

/** A level's keys in its group's order: by key, as A to Z and as is natural; as its program answered them, high or low. */
function orderedKeys(first: readonly unknown[], group: VisualGroup, type: EastType): unknown[] {
    if (group.sort.type === "high" || group.sort.type === "low") return [...first];
    const compare = compareFor(type);
    return [...first].sort(compare);
}

/** One side of a pivot drawn: each kept key's label and its keys — Other's the rest — and how many it left out. */
interface Side {
    readonly drawn: readonly { readonly label: string; readonly keys: readonly unknown[] }[];
    readonly hidden: number;
}

/** A side's first N keys, each labelled short as an axis labels it, then Other where it folds exactly. */
function sideOf(keys: readonly unknown[], group: VisualGroup, type: EastType, exact: boolean, said: QueryWords, m: StudioMessages): Side {
    const n = group.top.type === "none" ? keys.length : Number(group.top.value);
    // What the side's date buckets share, which a short label leaves out: `Apr`, of one year.
    const unit = group.bucket.type === "some" ? group.bucket.value.type : undefined;
    const span = bucketSpan(unit === undefined ? [] : keys.map((key) => bucketStart(key as bigint, unit)), said.formatters);
    const kept = keys.slice(0, n).map((key) => ({ label: axisLabel(key, type, group, span, said, m), keys: [key] }));
    const rest = keys.slice(n);
    if (rest.length === 0) return { drawn: kept, hidden: 0 };
    return exact ? { drawn: [...kept, { label: m.other(), keys: rest }], hidden: 0 } : { drawn: kept, hidden: rest.length };
}

/**
 * The value a ramp's top step closes at: the values' 95th percentile, by
 * nearest rank.
 */
function percentileOf(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort(compareFloat);
    return sorted[Math.max(0, Math.ceil(HEAT_PERCENTILE * sorted.length) - 1)]!;
}

/**
 * A pivot's model, from its answer (TBL-4).
 *
 * @param pivot - The pivot
 * @param asks - Its asks, as the printer gave them
 * @param answers - Their answers
 * @param source - Its source
 * @param words - The words and formatters
 * @param m - The Studio's words
 * @returns The model; `undefined` when its program did not answer
 *
 * @remarks
 * - **Rows and columns** in their groups' order: by key, as A to Z and as is
 *   natural; as the program ranked them, high or low.
 * - **Other**, past a group's first N, folds the pairs it holds — a sum's and
 *   a mean's parts add — and is left out where no fold is exact: a distinct
 *   count, or pairs the program cut at its limit.
 * - **Heat**: five equal steps from 0 to the 95th percentile of the values
 *   drawn, by nearest rank — each a whole number of a count, so its legend
 *   reads `0 3 6 9 ≥12`; a value at or past the fourth edge takes the top
 *   step, and one under 0 the first.
 * - **A value** prints in short, at the scale of the largest drawn: `0.48M`
 *   beside `1.81M`.
 */
export function pivotModel(pivot: PivotView, asks: readonly VisualAsk[], answers: readonly VisualAnswer[], source: VisualSource, words: QueryWords, m: StudioMessages): PivotModel | undefined {
    const read = readGroups(asks, answers, [pivot.value], "groups");
    const [rowType, columnType] = read?.keyTypes ?? [];
    if (read === undefined || rowType === undefined || columnType === undefined) return undefined;
    const said = visualWords(words, m);
    // Each pair's group, by its row's key then its column's; each side's keys as its program answered them.
    const pairs = new SortedMap<unknown, SortedMap<unknown, ReadGroup>>([], compareFor(rowType));
    const rows: unknown[] = [];
    const seen = new SortedSet<unknown>([], compareFor(columnType));
    const columnsFirst: unknown[] = [];
    for (const group of read.groups) {
        let row = pairs.get(group.keys[0]);
        if (row === undefined) {
            row = new SortedMap([], compareFor(columnType));
            pairs.set(group.keys[0], row);
            rows.push(group.keys[0]);
        }
        row.set(group.keys[1], group);
        if (!seen.has(group.keys[1])) {
            seen.add(group.keys[1]);
            columnsFirst.push(group.keys[1]);
        }
    }
    // Other folds exactly what every pair answered: no distinct count, and nothing cut.
    const cut = read.of > read.groups.length;
    const exact = !cut && pivot.value.measure.type !== "distinct";
    const rowSide = sideOf(orderedKeys(rows, pivot.rows, rowType), pivot.rows, rowType, exact, said, m);
    const columnSide = sideOf(orderedKeys(columnsFirst, pivot.columns, columnType), pivot.columns, columnType, exact, said, m);
    // A pair's value: its group's, or Other's folded from the groups it holds.
    const valueAt = (rowKeys: readonly unknown[], columnKeys: readonly unknown[]): number | undefined => {
        const held = rowKeys.flatMap((r) => columnKeys.flatMap((c) => {
            const group = pairs.get(r)?.get(c);
            return group === undefined ? [] : [group];
        }));
        const folded = foldGroups(held);
        return folded === undefined ? undefined : partsAt(folded.parts, 0);
    };
    const grid = rowSide.drawn.map((row) => columnSide.drawn.map((column) => valueAt(row.keys, column.keys)));
    const declared = valueFieldFormat(pivot.value, source);
    const format = declared.type === "some" ? declared.value : undefined;
    const f = said.formatters;
    const drawn = grid.flat().filter((value): value is number => value !== undefined);
    // Each value in short, at the scale of the largest drawn; a step's edge with no zeros ending its decimals.
    const largest = drawn.reduce((most, value) => Math.max(most, Math.abs(value)), 0);
    const short = (value: number, trim: boolean) => shortNumber(value, format, f, largest === 0 ? undefined : largest, trim);
    // The ramp: five equal steps from 0 to the 95th percentile of the values drawn — whole ones for a count.
    const top = percentileOf(drawn);
    const counted = pivot.value.measure.type === "count" || pivot.value.measure.type === "distinct";
    const width = counted && top > 0 ? Math.max(1, Math.ceil(top / HEAT_STEPS)) : top / HEAT_STEPS;
    const stepOf = (value: number) => (width <= 0 ? 0 : Math.min(HEAT_STEPS - 1, Math.max(0, Math.floor(value / width))));
    const cell = (value: number | undefined): MatrixCell => {
        if (value === undefined) return cellOf(m.noValue(), "free", "transparent");
        const text = short(value, false);
        if (!pivot.heat) return cellOf(text, "neutral", "transparent");
        // Ink on the first three steps, paper on the last two.
        const step = stepOf(value);
        return cellOf(text, step < 3 ? "neutral" : "brand", `heat.${step + 1}`);
    };
    const heat = !pivot.heat ? undefined : Array.from({ length: HEAT_STEPS }, (_, k): HeatStep => {
        const from = short(k * width, true);
        if (k === HEAT_STEPS - 1) return { label: m.heatTop({ from }), name: m.heatTop({ from }) };
        return { label: from, name: m.heatStep({ from, to: short((k + 1) * width, true) }) };
    });
    const matrix: MatrixRootValue = {
        rows: rowSide.drawn.map((row, i) => ({
            key: `r${i}`, value: row.label, sublabel: none, depth: 0n, collapsed: false,
            cells: new SortedMap(columnSide.drawn.map((_column, j): [string, MatrixCell] => [`c${j}`, cell(grid[i]![j])]), compareKeys),
        })),
        columns: columnSide.drawn.map((column, j) => ({ key: `c${j}`, label: some(labelOf(column.label)) })),
        rowHeader: some(capitalised(groupWords(pivot.rows, source, m) ?? "")),
        orientation: variant("horizontal", null),
        legend: none,
        minLabelSize: none,
        density: none,
        plotGutter: none,
        onCellClick: none,
        onSegmentClick: none,
        onSegmentChange: none,
        // "fill" is the renderer's own word for the height of the box the matrix is placed in.
        height: some("fill"),
        maxHeight: none,
    };
    const shown = cut ? { shown: read.groups.length, of: read.of }
        : rowSide.hidden > 0 ? { shown: rowSide.drawn.length, of: rowSide.drawn.length + rowSide.hidden }
        : columnSide.hidden > 0 ? { shown: columnSide.drawn.length, of: columnSide.drawn.length + columnSide.hidden }
        : undefined;
    return { matrix, heat, shown };
}
