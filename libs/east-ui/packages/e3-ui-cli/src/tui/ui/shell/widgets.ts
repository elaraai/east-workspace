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
import { center, displayWidth, padEnd, padStart, truncate } from '../../render/text.js';
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

function cellText(cell: TableRow['cells'][string] | undefined): string {
    return cell === undefined ? '' : typeof cell === 'string' ? cell : cell.text;
}

/**
 * Fits a column plan to a table's rows: a `grow` column first widens to
 * its longest cell (plus the gap, up to its cap), then the plan is fitted
 * to the width ({@link fitPlan}). The one pass over every row — the
 * dashboard computes it once per data change and keeps it.
 *
 * @param plan - The column plan (the last column takes the remainder)
 * @param rows - Every row
 * @param width - The row width
 * @returns The fitted plan
 */
export function tablePlan(plan: ColumnSpec[], rows: readonly TableRow[], width: number): ColumnSpec[] {
    const grown = plan.map(col => {
        if (col.grow === undefined) return col;
        const longest = rows.reduce((n, row) => Math.max(n, displayWidth(cellText(row.cells[col.key]))), displayWidth(col.title));
        return { ...col, width: Math.min(col.grow, Math.max(col.width, longest + 1)) };
    });
    return fitPlan(grown, width);
}

/**
 * One line of a table: the header (`row` null) or a row, with the
 * selection bar (`▌`) when selected. Cells are looked up by column key, so
 * a plan that drops a column at a narrow width leaves the others aligned;
 * a fixed cell that overflows ends in an ellipsis and keeps one cell of gap.
 *
 * @param fitted - The fitted plan ({@link tablePlan})
 * @param row - The row, or null for the header
 * @param selected - Whether the row is selected
 * @param width - The row width
 * @param g - The glyph set
 * @returns The line
 */
export function tableLine(fitted: readonly ColumnSpec[], row: TableRow | null, selected: boolean, width: number, g: Glyphs): Line {
    const line: Line = [t(' '), selected ? b(g.sel, 'brand') : t(row?.marker ?? ' ')];
    let used = 2;
    for (const col of fitted) {
        const raw = row === null ? col.title : row.cells[col.key] ?? '';
        const cell = typeof raw === 'string' ? { text: raw, tone: undefined } : raw;
        const budget = col.width === 0 ? Math.max(0, width - used) : col.width;
        // A fixed column keeps one cell of gap before the next; overflow ends in an ellipsis.
        const room = col.width === 0 ? budget : Math.max(1, budget - 1);
        const clipped = truncate(cell.text, room);
        const text = col.align === 'right' ? padStart(clipped, budget) : padEnd(clipped, budget);
        if (row === null) line.push(d(text));
        else if (selected) line.push(b(text, cell.tone));
        else line.push(t(text, cell.tone));
        used += budget;
    }
    return fitLine(line, width);
}

/**
 * A table: a header row, then the rows in `[top, top + visible)` with a
 * selection bar (`▌`) on `sel` — {@link tablePlan} then {@link tableLine}
 * per row.
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
    const fitted = tablePlan(plan, rows, width);
    const out: Line[] = [];
    if (header) out.push(tableLine(fitted, null, false, width, g));
    for (let i = top; i < Math.min(rows.length, top + visible); i++) out.push(tableLine(fitted, rows[i]!, i === sel, width, g));
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
 * The cell ranges of a tab strip's tabs (the geometry {@link tabStrip} draws).
 *
 * @param name - The leading name
 * @param tabs - The tab labels
 * @param g - The glyph set
 * @returns Each tab's `[x0, x1)` and index
 */
export function tabStripHits(name: string, tabs: string[], g: Glyphs): { index: number; x0: number; x1: number }[] {
    void g;
    let x = 1 + displayWidth(name) + 3;
    return tabs.map((label, i) => {
        const w = 2 + displayWidth(`${i + 1} ${label}`) + 2;
        const hit = { index: i, x0: x, x1: x + w };
        x += w + (i < tabs.length - 1 ? 1 : 0);
        return hit;
    });
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
