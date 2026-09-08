/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared widgets — the scrollbar column every scrolling view uses, tables
 * with a selection bar, a section title line, a centred block (the refusal
 * / output-state screens), and the tab strip.
 *
 * @packageDocumentation
 */

import { fitPlan, scrollbar as scrollbarGeometry, type ColumnSpec } from '../../render/layout.js';
import { center, padEnd, padStart } from '../../render/text.js';
import type { Tone } from '../../render/theme.js';
import type { Glyphs } from '../../render/glyphs.js';
import { b, d, fitLine, lrLine, t, type Line } from '../lines.js';

/**
 * Appends the scrollbar column (`▲ … ▼` with a thumb) to `lines` when the
 * content overflows; otherwise pads them to the full width.
 *
 * @param lines - The visible rows (each already at most `width − 1` cells)
 * @param width - The row width including the scrollbar column
 * @param total - Total rows
 * @param visible - Visible rows (`lines.length`)
 * @param top - The first visible row
 * @param g - The glyph set
 * @returns The rows with the scrollbar column
 */
export function withScrollbar(lines: Line[], width: number, total: number, visible: number, top: number, g: Glyphs): Line[] {
    const h = lines.length;
    const geometry = scrollbarGeometry(Math.max(0, h - 2), total, visible, top);
    if (geometry === null) return lines.map(l => fitLine(l, width));
    return lines.map((line, i) => {
        const ch = i === 0 ? g.scrollUp : i === h - 1 ? g.scrollDown : (i - 1 >= geometry.pos && i - 1 < geometry.pos + geometry.thumb ? g.thumb : g.vbar);
        const tone: Tone = ch === g.thumb ? 'brand' : 'muted';
        return [...fitLine(line, width - 1), b(ch, tone)];
    });
}

/** One table row's cells (text per column key) and its tone / selection. */
export interface TableRow {
    cells: Record<string, string | { text: string; tone?: Tone | undefined } | undefined>;
    /** A marker in the gutter instead of the selection bar (`┆` for a changed row). */
    marker?: string | undefined;
}

/**
 * A table: a header row, then the rows in `[top, top + visible)` with a
 * selection bar (`▌`) on `sel`. Cells are looked up by column key, so a
 * plan that drops a column at a narrow width leaves the others aligned;
 * the plan is fitted to the width first ({@link fitPlan}).
 *
 * @param plan - The column plan (the last column takes the remainder)
 * @param rows - Every row
 * @param sel - The selected row (or −1)
 * @param top - The first visible row
 * @param visible - Visible rows
 * @param width - The row width
 * @param g - The glyph set
 * @param header - Whether to draw the header row
 * @returns The lines
 */
export function renderTable(plan: ColumnSpec[], rows: TableRow[], sel: number, top: number, visible: number, width: number, g: Glyphs, header = true): Line[] {
    const out: Line[] = [];
    const fitted = fitPlan(plan, width);
    const cellsOf = (row: TableRow | null, isHeader: boolean, selected: boolean): Line => {
        const line: Line = [t(' '), selected ? b(g.sel, 'brand') : t(row?.marker ?? ' ')];
        let used = 2;
        fitted.forEach((col) => {
            const raw = isHeader ? col.title : row?.cells[col.key] ?? '';
            const cell = typeof raw === 'string' ? { text: raw, tone: undefined } : raw;
            const budget = col.width === 0 ? Math.max(0, width - used) : col.width;
            const text = col.align === 'right' ? padStart(cell.text, budget) : padEnd(cell.text, budget);
            if (isHeader) line.push(d(text));
            else if (selected) line.push(b(text, cell.tone));
            else line.push(t(text, cell.tone));
            used += budget;
        });
        return line;
    };
    if (header) out.push(fitLine(cellsOf(null, true, false), width));
    for (let i = top; i < Math.min(rows.length, top + visible); i++) {
        out.push(fitLine(cellsOf(rows[i]!, false, i === sel), width));
    }
    return out;
}

/** A section title line: ` TITLE` with `right` flush right. */
export function sectionLine(title: string, right: string, width: number): Line {
    return lrLine([t(' '), b(title)], [d(right), t(' ')], width);
}

/**
 * A centred block: a blank, a bold title line, a blank, the body lines, a blank.
 *
 * @param glyph - The glyph before the title
 * @param tone - The title's tone
 * @param title - The title
 * @param body - The lines (each centred)
 * @param width - The row width
 * @returns The lines
 */
export function centredBlock(glyph: string, tone: Tone, title: string, body: string[], width: number): Line[] {
    const out: Line[] = [];
    out.push([t(' '.repeat(width))]);
    const heading = `${glyph}  ${title}`;
    out.push([b(center(heading, width), tone)]);
    out.push([t(' '.repeat(width))]);
    for (const line of body) out.push([t(center(line, width))]);
    out.push([t(' '.repeat(width))]);
    return out;
}

/**
 * A tab strip: ` name   ▌1 Output▐  2 Logs   3 Runs`.
 *
 * @param name - The leading name
 * @param tabs - The tab labels
 * @param active - The active tab index
 * @param g - The glyph set
 * @returns The spans
 */
export function tabStrip(name: string, tabs: string[], active: number, g: Glyphs): Line {
    const line: Line = [t(' '), b(name), t('   ')];
    tabs.forEach((label, i) => {
        if (i === active) line.push(b(`${g.tabL}${i + 1} ${label}${g.tabR}`, 'brand'));
        else line.push(d(` ${i + 1} ${label} `));
        if (i < tabs.length - 1) line.push(t(' '));
    });
    return line;
}
