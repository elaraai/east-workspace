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
 * after what made it; a value's cells on the wrong side of its goal marked;
 * and a group's first N, then the rest folded into Other where the fold is
 * exact — else left out, which it says.
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
import type { VisualAsk, VisualValue } from "../../query/visual/print.js";
import { foldGroups, partsAt, readGroups, readTotal, type ReadGroup, type ReadGroups } from "../../query/visual/read.js";
import { capitalised, type StudioMessages } from "../messages.js";
import { groupLabel, groupWords, valueHead, visualWords, wrongSideOfGoal, type VisualGroup, type VisualShown, type VisualSource, type VisualView } from "./values.js";

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
 * @property shown - What it holds of how many groups, when it holds fewer; `undefined` when it holds them all
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
    /** What it holds of how many groups, when it holds fewer; `undefined` when it holds them all. */
    readonly shown: VisualShown | undefined;
}

/** One row of a summary: its label, its values' parts, how deep it sits, and a head's count. */
interface SummaryRow {
    readonly label: string;
    readonly parts: ReadGroup["parts"];
    readonly depth: number;
    readonly head: TableRowHead | undefined;
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
 * A level's groups, already in order: its first N, then the rest folded into
 * Other where the fold is exact — complete, and no distinct count among them;
 * else left out, and counted.
 */
function cutAt(groups: readonly ReadGroup[], group: VisualGroup, complete: boolean): { readonly kept: readonly ReadGroup[]; readonly other: ReadGroup | undefined; readonly hidden: number } {
    if (group.top.type === "none" || groups.length <= Number(group.top.value)) return { kept: groups, other: undefined, hidden: 0 };
    const kept = groups.slice(0, Number(group.top.value));
    const rest = groups.slice(kept.length);
    const other = complete ? foldGroups(rest) : undefined;
    return { kept, other, hidden: other === undefined ? rest.length : 0 };
}

/** What a level holds of how many groups, when it holds fewer. */
function shownOf(read: ReadGroups, hidden: number, kept: number): SummaryModel["shown"] {
    if (read.of > read.groups.length) return { shown: read.groups.length, of: read.of };
    return hidden > 0 ? { shown: kept, of: kept + hidden } : undefined;
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
 * @returns The model; `undefined` when its groups' program did not answer
 *
 * @remarks
 * - **One group**: a row a group, in its order — by key, or by the first
 *   value high or low — its first N then Other.
 * - **Two groups**: each head of the first, its values from the `heads`
 *   program, in that order, over its groups of the second, in theirs; the
 *   first N heads then Other, which folds the heads past them; under each
 *   head its first N groups then Other. A head says how many groups it holds.
 * - **Other** folds its groups' parts — a sum's and a mean's add, a least
 *   takes the lesser — and is left out where no fold is exact: a distinct
 *   count, or groups its program cut at its limit.
 * - **The total row**, when asked, is the `total` program's: each value
 *   after its measure's word — `sum`, `ratio`.
 * - **A goal** marks each cell on its wrong side, the total's too.
 */
export function summaryModel(summary: SummaryView, asks: readonly VisualAsk[], answers: readonly VisualAnswer[], source: VisualSource, words: QueryWords, m: StudioMessages): SummaryModel | undefined {
    const values = summary.values;
    const leaves = readGroups(asks, answers, values, "groups");
    const [first, second] = summary.rows;
    if (leaves === undefined || first === undefined) return undefined;
    const said = visualWords(words, m);
    const label = (key: unknown, type: EastType | undefined, group: VisualGroup) => (type === undefined ? m.other() : groupLabel(key, type, group, said, m));
    const rows: SummaryRow[] = [];
    let shown: SummaryModel["shown"];
    const heads = second === undefined ? undefined : readGroups(asks, answers, values, "heads");
    if (second === undefined || heads === undefined) {
        // One group: a row a group, its first N then Other.
        const level = cutAt(ordered(leaves.groups, 0, first, leaves.keyTypes[0]!), first, leaves.of <= leaves.groups.length);
        for (const group of level.kept) rows.push({ label: label(group.keys[0], leaves.keyTypes[0], first), parts: group.parts, depth: 0, head: undefined });
        if (level.other !== undefined) rows.push({ label: m.other(), parts: level.other.parts, depth: 0, head: undefined });
        shown = shownOf(leaves, level.hidden, level.kept.length);
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
        // Every group of a head is answered, unless the groups' program was cut.
        const complete = leaves.of <= leaves.groups.length;
        const level = cutAt(heads.groups, first, heads.of <= heads.groups.length);
        for (const head of level.kept) {
            const groups = under.get(head.keys[0]) ?? [];
            rows.push({ label: label(head.keys[0], headType, first), parts: head.parts, depth: 0, head: { count: groups.length } });
            const inner = cutAt(ordered(groups, 1, second, groupType), second, complete);
            for (const group of inner.kept) rows.push({ label: label(group.keys[1], groupType, second), parts: group.parts, depth: 1, head: undefined });
            if (inner.other !== undefined) rows.push({ label: m.other(), parts: inner.other.parts, depth: 1, head: undefined });
        }
        // Other's head: the heads past the first N, folded — the query's own heads, so a mean is still the query's.
        if (level.other !== undefined) rows.push({ label: m.other(), parts: level.other.parts, depth: 0, head: {} });
        shown = shownOf(heads, level.hidden, level.kept.length) ?? (complete ? undefined : { shown: leaves.groups.length, of: leaves.of });
    }
    // The columns: the groups' labels, then each value, headed by its name, its unit and its goal.
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
    return {
        table: rowsTable(columns, rows.map(cells), said, rows.map((row) => row.depth)),
        totals,
        tone: (rowIndex, columnKey) => tones.get(rowIndex)?.get(columnKey),
        head: (rowIndex) => headOf.get(rowIndex),
        shown,
    };
}
