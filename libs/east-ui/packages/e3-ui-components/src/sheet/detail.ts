/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A cell's DETAIL (#844) — what a cell says beyond its value. A date cell
 * whose work has happened prints when it happened; its detail is the wanted
 * date it stands against. A column with a `detailCell` names an unrendered
 * cell whose text is its detail. The hover title and the strip (while the
 * ring rests on the cell) both show it.
 *
 * Pure: no React, no DOM.
 *
 * @packageDocumentation
 */

import { actualAgainst, formatWhen, type WhenLevel } from "./parse/date.js";
import type { SheetColumnMeta } from "./model.js";
import type { SheetCellValue } from "./values.js";
import type { SheetWords } from "./words.js";

/** A cell's detail — the strip's chips and meta, and the hover line. */
export interface CellDetail {
    chips: string[];
    meta: string;
    title: string;
}

/**
 * The detail of a column's cell in a row, if it has one — in the sheet's
 * words (#861).
 *
 * @param meta - The column
 * @param cells - The row's cells (the unrendered rule cells included)
 * @param words - The sheet's words
 * @returns The detail, or `undefined` when the cell says nothing beyond its value
 */
export function cellDetail(meta: SheetColumnMeta, cells: ReadonlyMap<string, SheetCellValue>, words: SheetWords): CellDetail | undefined {
    const { m } = words;
    if (meta.kind === "date" && meta.actual !== undefined) {
        const a = cells.get(meta.actual);
        if (a !== undefined && a.type === "DateTime") {
            const when = formatWhen(a.value, "time", words).text;
            const w = cells.get(meta.key);
            if (w === undefined || w.type !== "DateTime") return { chips: [m.detailHappened({ when })], meta: m.detailNoWanted(), title: m.detailHappenedTitle({ when }) };
            const level: WhenLevel = meta.level?.(cells) ?? "day";
            const wanted = formatWhen(w.value, level, words);
            const vs = actualAgainst(w.value, level, a.value, words);
            return {
                chips: [m.detailWanted({ text: wanted.text, tag: wanted.suffix }), m.detailHappened({ when })],
                meta: vs.words,
                title: m.detailTitle({ when, text: wanted.text, tag: wanted.suffix, words: vs.words }),
            };
        }
    }
    if (meta.detailCell !== undefined) {
        const c = cells.get(meta.detailCell);
        if (c !== undefined && c.type === "String" && c.value !== "") return { chips: c.value.split(" · "), meta: "", title: c.value };
    }
    return undefined;
}
