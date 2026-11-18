/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Table's rows as a tree (#954), and what each parent shows in an
 * `aggregate` column: the wire's pre-order rows placed under their parents,
 * and every parent's subtotal composed bottom-up over what its children
 * show. Pure functions over the Table's value: the renderer (`index.tsx`)
 * draws what they make.
 *
 * @packageDocumentation
 */

import { compareFor, variant, FloatType, type ValueTypeOf } from "@elaraai/east";
import { Table } from "@elaraai/east-ui/internal";
import type { TableRowValue } from "./use-paged-rows.js";

/** East Table Cell value type */
export type TableCellValue = ValueTypeOf<typeof Table.Types.Cell>;

/**
 * One row of the table's tree (#954) — a wire row placed: its pre-order index
 * (the `rowIndex` every row reference carries), its path and its children.
 */
export interface TreeRow {
    /** Its position in the rows' pre-order — a flat table's data index. */
    index: number;
    /** Its index among its siblings at each depth. */
    path: bigint[];
    /** How deep it sits — 0 at the top. */
    depth: number;
    /** Its own cells. */
    cells: Map<string, TableCellValue>;
    /** Whether it declares itself collapsed (a parent's). */
    collapsed: boolean;
    /** Its children, in data order — TanStack's sub-rows. */
    subRows: TreeRow[];
}

/** The table's rows as a tree: the top-level rows, and every row in pre-order. */
export interface TableTree {
    roots: TreeRow[];
    all: TreeRow[];
}

/**
 * The table's rows as a tree (#954): the wire's pre-order stream, each row
 * placed under the nearest row before it one level shallower. A depth that
 * skips a level is read as one level below the row before it, and one below
 * zero as zero, so a malformed stream still draws every row.
 */
export function treeOf(rows: readonly TableRowValue[]): TableTree {
    const roots: TreeRow[] = [];
    const all: TreeRow[] = [];
    // The rows from the top down to the last row placed.
    const open: TreeRow[] = [];
    rows.forEach((row, index) => {
        const depth = Math.max(0, Math.min(Number(row.depth), open.length));
        open.length = depth;
        const parent = open[depth - 1];
        const siblings = parent === undefined ? roots : parent.subRows;
        const node: TreeRow = {
            index,
            path: [...(parent?.path ?? []), BigInt(siblings.length)],
            depth,
            cells: row.cells,
            collapsed: row.collapsed,
            subRows: [],
        };
        siblings.push(node);
        all.push(node);
        open.push(node);
    });
    return { roots, all };
}

/** A path as one key — what fold overrides persist under. */
export function pathKey(path: readonly bigint[]): string {
    return path.join(".");
}

/**
 * What each parent shows in the `aggregate` columns (#954): its children's
 * subtotal, composed bottom-up — `sum` / `mean` / `min` / `max` of what its
 * children show (a child parent its own subtotal, a leaf its own cell), and
 * `count` the leaf rows beneath it. Walked in REVERSE pre-order, so every
 * child is done before its parent, at any depth.
 *
 * @param tree - The table's tree
 * @param aggregates - Each aggregate column's key and aggregate tag
 * @returns Each parent's subtotal cells, by its pre-order index
 */
export function subtotalsOf(tree: TableTree, aggregates: ReadonlyMap<string, string>): Map<number, Map<string, TableCellValue>> {
    const out = new Map<number, Map<string, TableCellValue>>();
    if (aggregates.size === 0) return out;
    const drawn = (row: TreeRow, key: string) => out.get(row.index)?.get(key) ?? row.cells.get(key);
    for (let i = tree.all.length - 1; i >= 0; i--) {
        const row = tree.all[i]!;
        if (row.subRows.length === 0) continue;
        const cells = new Map<string, TableCellValue>();
        for (const [key, tag] of aggregates) {
            if (tag === "count") {
                // A leaf counts 1; a parent its own count.
                let n = 0n;
                for (const child of row.subRows) {
                    const shown = child.subRows.length === 0 ? undefined : drawn(child, key);
                    n += shown === undefined ? 1n : shown.type === "Integer" ? shown.value : 0n;
                }
                cells.set(key, variant("Integer", n) as TableCellValue);
                continue;
            }
            const values = row.subRows
                .map((child) => drawn(child, key))
                .filter((c): c is TableCellValue => c !== undefined);
            cells.set(key, computeAggregate(tag, values));
        }
        out.set(row.index, cells);
    }
    return out;
}

/** One decoded table cell — a LiteralValue variant ({ type, value }). */
export type TableCellVariant = TableCellValue;

/** A cell that holds a number — an Integer or a Float. */
export type NumberCell = Extract<TableCellVariant, { type: "Integer" | "Float" }>;

/** East's own order over cells: by kind, then by the kind's values (#954). */
const compareCell = compareFor(Table.Types.Cell);
const compareFloat = compareFor(FloatType);

/** Whether a cell holds a number. */
export function isNumberCell(cell: TableCellVariant): cell is NumberCell {
    return cell.type === "Integer" || cell.type === "Float";
}

/** A number cell's value as a Float — how an Integer meets a Float. */
export function asFloat(cell: NumberCell): number {
    return cell.type === "Integer" ? Number(cell.value) : cell.value;
}

/**
 * How two drawn cells order (#954): by East's order over cells, save that two
 * numbers compare as numbers — an Integer column's `mean` subtotal is a Float,
 * and it sorts among its siblings' Integers by value.
 */
export function compareDrawn(a: TableCellVariant, b: TableCellVariant): number {
    return a.type !== b.type && isNumberCell(a) && isNumberCell(b)
        ? compareFloat(asFloat(a), asFloat(b))
        : compareCell(a, b);
}

/**
 * A parent's subtotal in a `sum` / `mean` / `min` / `max` column (#954): the
 * aggregate of what its children show. A sum of Integers stays an Integer; a
 * mean is a Float; `min` / `max` pick by East's order over the column's values.
 * (`count` counts leaves, in {@link subtotalsOf}.)
 */
function computeAggregate(tag: string, cells: TableCellVariant[]): TableCellVariant {
    // A parent with nothing beneath it shows Null: no value, so no aggregate
    // over its siblings counts it.
    const shown = cells.filter((c) => c.type !== "Null");
    if (shown.length === 0) return variant("Null", null) as TableCellVariant;
    if (tag === "sum" || tag === "mean") {
        // Factory-validated: sum/mean columns are Integer or Float.
        const numbers = shown.filter(isNumberCell);
        if (numbers.length === 0) return variant("Null", null) as TableCellVariant;
        const integers = numbers.flatMap((c) => (c.type === "Integer" ? [c.value] : []));
        if (tag === "sum" && integers.length === numbers.length) {
            return variant("Integer", integers.reduce((sum, n) => sum + n, 0n)) as TableCellVariant;
        }
        const sum = numbers.reduce((acc, c) => acc + asFloat(c), 0);
        return variant("Float", tag === "mean" ? sum / numbers.length : sum) as TableCellVariant;
    }
    let best = shown[0]!;
    for (const c of shown) {
        const order = compareCell(c, best);
        if (tag === "min" ? order < 0 : order > 0) best = c;
    }
    return best;
}

