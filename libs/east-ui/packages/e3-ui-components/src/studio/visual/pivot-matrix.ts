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
 * from 0 to the 95th percentile of its values over every pair — whole steps
 * for a count — the top step closed (`≥12`), on the theme's heat tokens, its
 * text ink on the first three and paper on the last two. A group's first N,
 * then the rest folded into Other where the fold is exact; else left out,
 * which it says. A page of its rows at a time (#1667), each over every column
 * — the same columns on every page — and where the page stands.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { SortedMap, SortedSet, StringType, compareFor, none, some, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import type { Matrix } from "@elaraai/east-ui/internal";
import type { MatrixRootValue } from "@elaraai/east-ui-components";
import type { QueryWords } from "../../query/model/words.js";
import type { VisualAnswer } from "../../query/visual/ask.js";
import type { ClickedGroup } from "../../query/visual/clicks.js";
import { topOf, type VisualAsk } from "../../query/visual/print.js";
import { bucketStart, foldGroups, partsAt, readGroups, type ReadGroup } from "../../query/visual/read.js";
import { capitalised } from "../../shared/capital.js";
import type { StudioMessages } from "../messages.js";
import {
    axisLabel, bucketSpan, groupWords, placeOf, shortNumber, valueFieldFormat, visualWords,
    type VisualGroup, type VisualPlace, type VisualShown, type VisualSource, type VisualView,
} from "./values.js";

/** A pivot's view: its row group, its column group, its value, and whether it is a heat map. */
export type PivotView = Extract<Extract<VisualView, { type: "table" }>["value"], { type: "pivot" }>["value"];

/** A Matrix cell, decoded. */
type MatrixCell = ValueTypeOf<typeof Matrix.Types.Cell>;
/** A label, as the Matrix's columns and segments take it. */
type LabelValue = Extract<ValueTypeOf<typeof Matrix.Types.Column>["label"], { type: "some" }>["value"];

/** How many steps the heat ramp has (TBL-4). */
export const HEAT_STEPS = 5;

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
 * @property matrix - Its page's cells as the Matrix's value
 * @property heat - Its heat ramp's steps, for its legend; `undefined` with heat off
 * @property place - Where its page stands among its rows: what its foot says, and its pager pages
 * @property shown - What it holds of how many rows or columns, when a first N, or its columns' limit, leaves some out that no fold makes Other of; `undefined` when it holds them all
 * @property clicked - The groups a cell stands for, by its row's and its column's keys: what a click on it is made on (TBL-6)
 */
export interface PivotModel {
    /** Its page's cells as the Matrix's value. */
    readonly matrix: MatrixRootValue;
    /** Its heat ramp's steps, for its legend; `undefined` with heat off. */
    readonly heat: readonly HeatStep[] | undefined;
    /** Where its page stands among its rows. */
    readonly place: VisualPlace;
    /** What it holds of how many rows or columns, when some are left out that no fold makes Other of; `undefined` when it holds them all. */
    readonly shown: VisualShown | undefined;
    /** The groups a cell stands for, by its row's and its column's keys in the Matrix (TBL-6): its row's and its column's; `undefined` for a cell of Other's. */
    readonly clicked: (row: string, column: string) => readonly ClickedGroup[] | undefined;
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

/** One row or column of a pivot drawn: its label and the keys it holds — Other's the rest, which it says it is. */
interface Drawn {
    readonly label: string;
    readonly keys: readonly unknown[];
    readonly other?: boolean;
}

/** A side's keys, each labelled short as an axis labels it: `Apr`, of one year. */
function labelled(keys: readonly unknown[], group: VisualGroup, type: EastType, said: QueryWords, m: StudioMessages): Drawn[] {
    // What the side's date buckets share, which a short label leaves out.
    const unit = group.bucket.type === "some" ? group.bucket.value.type : undefined;
    const span = bucketSpan(unit === undefined ? [] : keys.map((key) => bucketStart(key as bigint, unit)), said.formatters);
    return keys.map((key) => ({ label: axisLabel(key, type, group, span, said, m), keys: [key] }));
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
 * @param offset - Its page's first row, from 0
 * @returns The model; `undefined` when its program did not answer
 *
 * @remarks
 * - **A page of rows** (#1667) in their group's order, as its program
 *   answered them — by key, or by a row's own value high or low — of its first
 *   N; Other, past them, on the last page, a cell a column as its program
 *   folded them.
 * - **The columns** are its columns program's, in their group's order — by
 *   key, or by a column's own value — the same on every page: its first N,
 *   then Other, which folds the page's pairs of every other column; at most
 *   the program's limit of them.
 * - **Other** is left out where no fold is exact — a distinct count — and the
 *   pivot says what it holds of how many.
 * - **Heat**: five equal steps from 0 to the 95th percentile of its values
 *   over every pair, by nearest rank, as its program answered it — each a
 *   whole number of a count, so its legend reads `0 3 6 9 ≥12`; a value at or
 *   past the fourth edge takes the top step, and one under 0 the first. A
 *   colour is a value's on every page.
 * - **A value** prints in short, at the scale of the largest drawn: `0.48M`
 *   beside `1.81M`.
 */
export function pivotModel(pivot: PivotView, asks: readonly VisualAsk[], answers: readonly VisualAnswer[], source: VisualSource, words: QueryWords, m: StudioMessages, offset = 0): PivotModel | undefined {
    const read = readGroups(asks, answers, [pivot.value], "groups");
    const [rowType, columnType] = read?.keyTypes ?? [];
    if (read === undefined || rowType === undefined || columnType === undefined) return undefined;
    const said = visualWords(words, m);
    // Each pair's group, by its row's key then its column's; the page's rows as the program answered them.
    const pairs = new SortedMap<unknown, SortedMap<unknown, ReadGroup>>([], compareFor(rowType));
    const rows: unknown[] = [];
    const seen = new SortedSet<unknown>([], compareFor(columnType));
    const columnsFirst: unknown[] = [];
    const see = (column: unknown) => {
        if (seen.has(column)) return;
        seen.add(column);
        columnsFirst.push(column);
    };
    for (const group of read.groups) {
        let row = pairs.get(group.keys[0]);
        if (row === undefined) {
            row = new SortedMap([], compareFor(columnType));
            pairs.set(group.keys[0], row);
            rows.push(group.keys[0]);
        }
        row.set(group.keys[1], group);
        see(group.keys[1]);
    }
    // Other's row, past the rows' first N: its cells by column, as the program folded them.
    const otherRow = new SortedMap<unknown, ReadGroup>([], compareFor(columnType));
    for (const group of read.other ?? []) {
        otherRow.set(group.keys[1], group);
        see(group.keys[1]);
    }
    // Other folds exactly any value but a distinct count.
    const exact = pivot.value.measure.type !== "distinct";
    // The rows: the page's, then Other on the last page.
    const top = topOf(pivot.rows);
    const place = placeOf(offset, rows.length, read.of, top);
    const rowSide: Drawn[] = [
        ...labelled(rows, pivot.rows, rowType, said, m),
        ...(read.other !== undefined && read.other.length > 0 && place.last >= place.total ? [{ label: m.other(), keys: [], other: true }] : []),
    ];
    const rowsHidden = top !== undefined && top < read.of && read.other === undefined ? read.of - top : 0;
    // The columns: the columns program's, in its order, the same on every page; its first N, then Other.
    const columns = readGroups(asks, answers, [pivot.value], "columns");
    const columnKeys = columns?.groups.map((group) => group.keys[0]) ?? orderedKeys(columnsFirst, pivot.columns, columnType);
    const columnsOf = columns?.of ?? columnKeys.length;
    const n = pivot.columns.top.type === "none" ? columnKeys.length : Math.min(columnKeys.length, Number(pivot.columns.top.value));
    const kept = columnKeys.slice(0, n);
    const keptSet = new SortedSet<unknown>(kept, compareFor(columnType));
    // Other's column folds the page's pairs of every column not kept.
    const rest = [...seen].filter((column) => !keptSet.has(column));
    const folds = pivot.columns.top.type === "some" && exact && rest.length > 0;
    const columnSide: Drawn[] = [...labelled(kept, pivot.columns, columnType, said, m), ...(folds ? [{ label: m.other(), keys: rest, other: true }] : [])];
    const columnsHidden = folds ? 0 : Math.max(0, columnsOf - kept.length);
    // A cell's value: its pair's, or Other's folded from the pairs it holds.
    const valueAt = (row: Drawn, column: Drawn): number | undefined => {
        const held = column.keys.flatMap((c) => {
            const group = row.other === true ? otherRow.get(c) : pairs.get(row.keys[0])?.get(c);
            return group === undefined ? [] : [group];
        });
        const folded = foldGroups(held);
        return folded === undefined ? undefined : partsAt(folded.parts, 0);
    };
    const grid = rowSide.map((row) => columnSide.map((column) => valueAt(row, column)));
    const declared = valueFieldFormat(pivot.value, source);
    const format = declared.type === "some" ? declared.value : undefined;
    const f = said.formatters;
    const drawn = grid.flat().filter((value): value is number => value !== undefined);
    // Each value in short, at the scale of the largest drawn; a step's edge with no zeros ending its decimals.
    const largest = drawn.reduce((most, value) => Math.max(most, Math.abs(value)), 0);
    const short = (value: number, trim: boolean) => shortNumber(value, format, f, largest === 0 ? undefined : largest, trim);
    // The ramp: five equal steps from 0 to the 95th percentile over every pair, as the program answered it — whole ones for a count.
    const heatTop = read.heat ?? 0;
    const counted = pivot.value.measure.type === "count" || pivot.value.measure.type === "distinct";
    const width = counted && heatTop > 0 ? Math.max(1, Math.ceil(heatTop / HEAT_STEPS)) : heatTop / HEAT_STEPS;
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
        rows: rowSide.map((row, i) => ({
            key: `r${i}`, value: row.label, sublabel: none, depth: 0n, collapsed: false,
            cells: new SortedMap(columnSide.map((_column, j): [string, MatrixCell] => [`c${j}`, cell(grid[i]![j])]), compareKeys),
        })),
        columns: columnSide.map((column, j) => ({ key: `c${j}`, label: some(labelOf(column.label)) })),
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
    const shown = rowsHidden > 0 ? { shown: place.total, of: read.of }
        : columnsHidden > 0 ? { shown: kept.length, of: columnsOf }
        : undefined;
    // A cell stands for its row's group and its column's: each side's one key, by the Matrix's own keys.
    const sideClicked = (side: readonly Drawn[], prefix: string, group: VisualGroup, type: EastType) => new Map(side.flatMap((held, i): [string, ClickedGroup][] => (
        held.other === true ? [] : [[`${prefix}${i}`, { group, key: held.keys[0], type }]]
    )));
    const rowsClicked = sideClicked(rowSide, "r", pivot.rows, rowType);
    const columnsClicked = sideClicked(columnSide, "c", pivot.columns, columnType);
    const clicked: PivotModel["clicked"] = (row, column) => {
        const [r, c] = [rowsClicked.get(row), columnsClicked.get(column)];
        return r === undefined || c === undefined ? undefined : [r, c];
    };
    return { matrix, heat, place, shown, clicked };
}
