/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The clipboard matrix (B§10): copy is tab-separated — dates `d/m/yyyy`,
 * numbers bare, a link cell as TWO columns (From, To) printed through the
 * grammar; paste lands at the selection, each cell parsed by its kind, a
 * stamped column skipped, a link column consuming two clipboard cells.
 *
 * @packageDocumentation
 */

import { formatDateClipboard } from "./parse/date.js";
import { formatNumberBare } from "./parse/quantity.js";
import { linkHalvesText } from "./parse/index.js";
import type { SheetColumnMeta } from "./model.js";
import type { SheetCellValue } from "./values.js";

/** A cell's clipboard text — one column, or two for a link. */
export function exportCell(cell: SheetCellValue | undefined, meta: SheetColumnMeta): string[] {
    if (meta.kind === "link" || meta.kind === "set") {
        if (cell === undefined || cell.type !== "Link") return meta.kind === "link" ? ["", ""] : [""];
        const [from, to] = linkHalvesText(cell.value);
        return meta.kind === "link" ? [from, to] : [to];
    }
    if (cell === undefined || cell.type === "Null") return [""];
    switch (cell.type) {
        case "DateTime": return [formatDateClipboard(cell.value)];
        case "Float": return [formatNumberBare(cell.value)];
        case "Integer": return [String(cell.value)];
        case "String": return [cell.value];
        case "Boolean": return [String(cell.value)];
        case "Link": return [linkHalvesText(cell.value).join(" > ")];
    }
    return [""];
}

/** A block of cells as tab-separated lines; `skipRow` leaves rows out (a group's band, #740 G9). */
export function exportMatrix(
    cellAt: (r: number, c: number) => SheetCellValue | undefined,
    columns: readonly SheetColumnMeta[],
    rect: { r0: number; r1: number; c0: number; c1: number },
    skipRow?: (r: number) => boolean,
): string {
    const lines: string[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
        if (skipRow?.(r) === true) continue;
        const cells: string[] = [];
        for (let c = rect.c0; c <= rect.c1; c++) {
            const meta = columns[c];
            if (meta === undefined) continue;
            cells.push(...exportCell(cellAt(r, c), meta));
        }
        lines.push(cells.join("\t"));
    }
    return lines.join("\n");
}

/** Clipboard text to a matrix of cells (a trailing newline drops). */
export function parseMatrix(text: string): string[][] {
    return text.replace(/\r/g, "").split("\n")
        .filter((x, i, a) => !(i === a.length - 1 && x === ""))
        .map((x) => x.split("\t"));
}

/** Two clipboard columns (From, To) become one link text — a lone cell is taken as typed. */
export function joinHalves(a: string, b: string | undefined): string {
    const A = a.trim();
    const B = (b ?? "").trim();
    if (b === undefined) return A;
    if (A === "") return B;
    if (B === "") return /\s*(?:->|=>|→|>)\s*|\s+[-–]\s+/.test(A) ? A : `${A} >`;
    return `${A} > ${B}`;
}

/** One pasted cell, resolved against the column it lands on. */
export interface PastedCell {
    /** Row offset from the paste anchor. */
    dr: number;
    /** The column index. */
    c: number;
    /** The text to parse. */
    text: string;
}

/**
 * Lay a clipboard matrix over the columns from an anchor column: a link
 * column consumes two cells; a stamped column is skipped (its clipboard cell
 * is consumed, nothing is written).
 */
export function layoutPaste(matrix: readonly (readonly string[])[], columns: readonly SheetColumnMeta[], c0: number): { cells: PastedCell[]; width: number } {
    const cells: PastedCell[] = [];
    let width = 1;
    matrix.forEach((line, dr) => {
        let k = 0;
        let c = c0;
        while (k < line.length && c < columns.length) {
            const meta = columns[c]!;
            let text = line[k++] ?? "";
            if (meta.kind === "link") text = joinHalves(text, k < line.length ? line[k++] : undefined);
            if (meta.kind !== "stamped" && meta.editable) cells.push({ dr, c, text });
            c++;
        }
        width = Math.max(width, c - c0);
    });
    return { cells, width };
}
