/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio summary table (#1671, TBL-2, TBL-3): its answers read into the
 * Table's value — a row a group of its first field, or, with a second, each
 * head of the first over its groups of the second, nested; each head's values
 * the query's own (`heads`), never a fold of the rows under it, whose mean
 * would be a mean of means; the total row the query's (`total`), each cell
 * after what made it; a value's cells on the wrong side of its goal marked,
 * its goal a small label after its header; each value's numbers in short, at
 * their column's scale (`1.81M`, `0.48M`); and a group's first N, then the
 * rest folded into Other where the fold is exact — else left out, which it
 * says. A page of its first group's groups at a time (#1667) — of its heads,
 * each over every group of the second it holds — and where the page stands.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { FloatType, OptionType, SortedMap, StringType, compareFor, none, some, variant, type EastType, type option } from "@elaraai/east";
import type { TableCellTone, TableRootValue, TableRowHead, TableTotalCell } from "@elaraai/east-ui-components";
import type { QueryWords } from "../../query/model/words.js";
import { rowsTable, type ResultColumn } from "../../query/results-table.js";
import type { VisualAnswer } from "../../query/visual/ask.js";
import type { ClickedGroup } from "../../query/visual/clicks.js";
import { topOf, type VisualAsk, type VisualValue } from "../../query/visual/print.js";
import { foldGroups, partsAt, readGroups, readTotal, type ReadGroup } from "../../query/visual/read.js";
import { capitalised } from "../../shared/capital.js";
import type { StudioMessages } from "../messages.js";
import {
    groupLabel, groupWords, placeOf, shortNumber, valueFieldFormat, valueHead, visualWords, wrongSideOfGoal,
    type VisualGroup, type VisualPlace, type VisualShown, type VisualSource, type VisualView,
} from "./values.js";

/** A summary table's view: its groups, its values, and whether it has a total row. */
export type SummaryView = Extract<Extract<VisualView, { type: "table" }>["value"], { type: "summary" }>["value"];

/** The key of a summary's label column: its groups' labels. */
export const SUMMARY_LABEL_KEY = "g";

/**
 * The key of a value's column: its index among the summary's values.
 *
 * @param index - The value's index
 * @returns Its column's key
 */
export function summaryValueKey(index: number): string {
    return `v${index}`;
}

const compareFloat = compareFor(FloatType);

/**
 * A summary, read from its answers.
 *
 * @property table - Its rows as the Table's value, in pre-order: a head, then its groups
 * @property totals - Its total row, each cell after what made it; `undefined` without one
 * @property tone - A cell's tone, by its row's pre-order index and its column's key: on the wrong side of its value's goal, negative
 * @property head - Whether a row is a head, by its pre-order index, with how many groups it holds
 * @property note - What a column's head says after its label, by its key: a value's goal — `goal 11.00`
 * @property number - A column's number in short, by its key, at the scale of the largest the column draws
 * @property place - Where its page stands among its first group's groups: what its foot says, and its pager pages
 * @property shown - What its first group's first N holds of how many, when it keeps fewer and no fold makes Other; `undefined` when it holds them all
 * @property clicked - The groups a row stands for, by its pre-order index: what a click on it is made on (TBL-6)
 */
export interface SummaryModel {
    /** Its rows as the Table's value, in pre-order: a head, then its groups. */
    readonly table: TableRootValue;
    /** Its total row, each cell after what made it; `undefined` without one. */
    readonly totals: readonly ReadonlyMap<string, TableTotalCell>[] | undefined;
    /** A cell's tone, by its row's pre-order index and its column's key. */
    readonly tone: (rowIndex: number, columnKey: string) => TableCellTone | undefined;
    /** Whether a row is a head, by its pre-order index, with how many groups it holds. */
    readonly head: (rowIndex: number) => TableRowHead | undefined;
    /** What a column's head says after its label, by its key: a value's goal. */
    readonly note: (columnKey: string) => string | undefined;
    /** A column's number in short, by its key, at the scale of the largest the column draws; `undefined` for a column of no value. */
    readonly number: (n: number, columnKey: string) => string | undefined;
    /** Where its page stands among its first group's groups. */
    readonly place: VisualPlace;
    /** What its first group's first N holds of how many, when it keeps fewer and no fold makes Other; `undefined` when it holds them all. */
    readonly shown: VisualShown | undefined;
    /** The groups a row stands for, by its pre-order index (TBL-6): a head's its own, a group under a head both; `undefined` for Other's. */
    readonly clicked: (rowIndex: number) => readonly ClickedGroup[] | undefined;
}

/** One row of a summary: its label, its values' parts, how deep it sits, a head's count, and the groups it stands for. */
interface SummaryRow {
    readonly label: string;
    readonly parts: ReadGroup["parts"];
    readonly depth: number;
    readonly head: TableRowHead | undefined;
    readonly clicked?: readonly ClickedGroup[];
}

/** A value of some parts; `undefined` for "no data". */
const valueAt = partsAt;

/**
 * Groups in their group's order: by key, as A to Z and as is natural; by the
 * first value, high or low, a group with none last.
 */
function ordered(groups: readonly ReadGroup[], dim: 0 | 1, group: VisualGroup, type: EastType): ReadGroup[] {
    switch (group.sort.type) {
        case "natural": case "label": {
            const compare = compareFor(type);
            return [...groups].sort((a, b) => compare(a.keys[dim], b.keys[dim]));
        }
        case "high": case "low": {
            const sign = group.sort.type === "high" ? -1 : 1;
            return [...groups].sort((a, b) => {
                const x = valueAt(a.parts, 0);
                const y = valueAt(b.parts, 0);
                if (x === undefined || y === undefined) return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0);
                return sign * compareFloat(x, y);
            });
        }
    }
}

/**
 * A head's groups of the second, in their order: its first N, then the rest
 * folded into Other where the fold is exact — no distinct count among them;
 * else left out. Every group of a head on the page is answered.
 */
function cutAt(groups: readonly ReadGroup[], group: VisualGroup): { readonly kept: readonly ReadGroup[]; readonly other: ReadGroup | undefined } {
    if (group.top.type === "none" || groups.length <= Number(group.top.value)) return { kept: groups, other: undefined };
    const kept = groups.slice(0, Number(group.top.value));
    return { kept, other: foldGroups(groups.slice(kept.length)) };
}

/**
 * A summary's model, from its answers (TBL-2, TBL-3).
 *
 * @param summary - The summary
 * @param asks - Its asks, as the printer gave them
 * @param answers - Their answers
 * @param source - Its source
 * @param words - The words and formatters
 * @param m - The Studio's words
 * @param offset - Its page's first group of its first field, from 0
 * @returns The model; `undefined` when its groups' program did not answer
 *
 * @remarks
 * - **A page** of its first group's groups (#1667), in the order its program
 *   answered them — by key, or by the first value high or low — of its first
 *   N; Other, past them, on the last page.
 * - **One group**: a row a group.
 * - **Two groups**: each head of the first, its values from the `heads`
 *   program, in that order, over every group of the second it holds, in
 *   theirs — its first N, then Other. A head says how many groups it holds.
 * - **Other** folds its groups' parts — a sum's and a mean's add, a least
 *   takes the lesser — the first group's as its program answered it; it is
 *   left out where no fold is exact: a distinct count, which its first N
 *   then says it holds of how many.
 * - **The total row**, when asked, is the `total` program's: each value
 *   after its measure's word — `sum`, `ratio`.
 * - **A goal** marks each cell on its wrong side, the total's too.
 */
export function summaryModel(summary: SummaryView, asks: readonly VisualAsk[], answers: readonly VisualAnswer[], source: VisualSource, words: QueryWords, m: StudioMessages, offset = 0): SummaryModel | undefined {
    const values = summary.values;
    const leaves = readGroups(asks, answers, values, "groups");
    const [first, second] = summary.rows;
    if (leaves === undefined || first === undefined) return undefined;
    const said = visualWords(words, m);
    const label = (key: unknown, type: EastType | undefined, group: VisualGroup) => (type === undefined ? m.other() : groupLabel(key, type, group, said, m));
    const rows: SummaryRow[] = [];
    const heads = second === undefined ? undefined : readGroups(asks, answers, values, "heads");
    // What it pages: its first group's groups — its heads, with a second — of their first N.
    const paged = heads ?? leaves;
    const top = topOf(first);
    const place = placeOf(offset, paged.groups.length, paged.of, top);
    // Other, past the first N, closes the last page: the rest folded, as the program answered it.
    const other = place.last >= place.total ? paged.other?.[0] : undefined;
    // A first N that no fold makes Other of says what it holds of how many.
    const shown = top !== undefined && top < paged.of && paged.other === undefined ? { shown: top, of: paged.of } : undefined;
    if (second === undefined || heads === undefined) {
        // One group: a row a group.
        for (const group of leaves.groups) {
            rows.push({
                label: label(group.keys[0], leaves.keyTypes[0], first), parts: group.parts, depth: 0, head: undefined,
                clicked: [{ group: first, key: group.keys[0], type: leaves.keyTypes[0]! }],
            });
        }
        if (other !== undefined) rows.push({ label: m.other(), parts: other.parts, depth: 0, head: undefined });
    } else {
        // Two groups: each head over its groups, which the groups' program answers under its key.
        const headType = heads.keyTypes[0]!;
        const groupType = leaves.keyTypes[1]!;
        const under = new SortedMap<unknown, ReadGroup[]>([], compareFor(leaves.keyTypes[0]!));
        for (const group of leaves.groups) {
            const held = under.get(group.keys[0]);
            if (held === undefined) under.set(group.keys[0], [group]);
            else held.push(group);
        }
        for (const head of heads.groups) {
            const groups = under.get(head.keys[0]) ?? [];
            const headed: ClickedGroup = { group: first, key: head.keys[0], type: headType };
            rows.push({ label: label(head.keys[0], headType, first), parts: head.parts, depth: 0, head: { count: groups.length }, clicked: [headed] });
            const inner = cutAt(ordered(groups, 1, second, groupType), second);
            for (const group of inner.kept) {
                rows.push({
                    label: label(group.keys[1], groupType, second), parts: group.parts, depth: 1, head: undefined,
                    clicked: [headed, { group: second, key: group.keys[1], type: groupType }],
                });
            }
            if (inner.other !== undefined) rows.push({ label: m.other(), parts: inner.other.parts, depth: 1, head: undefined });
        }
        // Other's head: the heads past the first N, folded — the query's own heads, so a mean is still the query's.
        if (other !== undefined) rows.push({ label: m.other(), parts: other.parts, depth: 0, head: {} });
    }
    // The columns: the groups' labels, then each value, headed by its name and its unit, its goal a note after them.
    const heads_ = values.map((value) => valueHead(value, source, said, m));
    const firstWords = groupWords(first, source, m) ?? "";
    const columns: ResultColumn[] = [
        { key: SUMMARY_LABEL_KEY, type: StringType, field: undefined, header: m.labelHeader({ first: capitalised(firstWords), second: second === undefined ? undefined : groupWords(second, source, m) }) },
        ...values.map((_value, i): ResultColumn => ({ key: summaryValueKey(i), type: OptionType(FloatType), field: undefined, header: heads_[i]!.header, format: heads_[i]!.format })),
    ];
    const cells = (row: SummaryRow) => Object.fromEntries([
        [SUMMARY_LABEL_KEY, row.label],
        ...values.map((_value, i): [string, option<number>] => {
            const at = valueAt(row.parts, i);
            return [summaryValueKey(i), at === undefined ? none : some(at)];
        }),
    ]);
    // A value on its goal's wrong side, named for a screen reader.
    const missed = (value: VisualValue, at: number | undefined): TableCellTone | undefined =>
        (at !== undefined && wrongSideOfGoal(value, at) ? { tone: "negative", label: m.goalMissed({ over: value.better.type === "lower" }) } : undefined);
    const tones = new Map<number, Map<string, TableCellTone>>();
    rows.forEach((row, index) => values.forEach((value, i) => {
        const tone = missed(value, valueAt(row.parts, i));
        if (tone === undefined) return;
        const held = tones.get(index) ?? new Map<string, TableCellTone>();
        held.set(summaryValueKey(i), tone);
        tones.set(index, held);
    }));
    const headOf = new Map(rows.flatMap((row, index): [number, TableRowHead][] => (row.head === undefined ? [] : [[index, row.head]])));
    // The total row: the query's, each value after what made it.
    const total = summary.total ? readTotal(asks, answers, values) : undefined;
    const totals = total === undefined ? undefined : [new Map<string, TableTotalCell>([
        [SUMMARY_LABEL_KEY, { value: variant("String", m.totalRow()) }],
        ...values.map((value, i): [string, TableTotalCell] => {
            const at = valueAt(total.parts, i);
            return [summaryValueKey(i), {
                value: at === undefined ? variant("String", m.noValue()) : variant("Float", at),
                label: m.measureWord({ measure: value.measure.type }),
                tone: missed(value, at),
            }];
        }),
    ])];
    // Each value's numbers in short, at its column's scale: the largest it draws, its total among them.
    const at = new Map(values.map((_value, i): [string, number] => [summaryValueKey(i), i]));
    const scales = values.map((_value, i) => Math.max(0, ...[...rows.map((row) => valueAt(row.parts, i)), total === undefined ? undefined : valueAt(total.parts, i)]
        .flatMap((value) => (value === undefined ? [] : [Math.abs(value)]))));
    const declared = values.map((value) => valueFieldFormat(value, source));
    return {
        table: rowsTable(columns, rows.map(cells), said, rows.map((row) => row.depth)),
        totals,
        tone: (rowIndex, columnKey) => tones.get(rowIndex)?.get(columnKey),
        head: (rowIndex) => headOf.get(rowIndex),
        note: (columnKey) => {
            const i = at.get(columnKey);
            return i === undefined ? undefined : heads_[i]!.goal;
        },
        number: (n, columnKey) => {
            const i = at.get(columnKey);
            if (i === undefined) return undefined;
            const format = declared[i]!;
            return shortNumber(n, format.type === "some" ? format.value : undefined, said.formatters, scales[i] === 0 ? undefined : scales[i]);
        },
        place,
        shown,
        clicked: (rowIndex) => rows[rowIndex]?.clicked,
    };
}
