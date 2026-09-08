/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lines and spans — the unit every view renders. A `Line` is a list of
 * styled spans that together fill exactly one terminal row; the shell pads
 * or truncates each line to the frame width, so views never wrap and the
 * scroll math stays exact.
 *
 * @packageDocumentation
 */

import type { Glyphs } from '../render/glyphs.js';
import { displayWidth, padEnd, truncate } from '../render/text.js';
import type { Theme, Tone } from '../render/theme.js';
import type { ShellLayout } from '../render/layout.js';

/** One styled run of text. */
export interface Span {
    text: string;
    tone?: Tone | undefined;
    bold?: boolean | undefined;
    dim?: boolean | undefined;
    inverse?: boolean | undefined;
}

/** One terminal row. */
export type Line = Span[];

/** What a renderer needs besides the state. */
export interface RenderCtx {
    layout: ShellLayout;
    g: Glyphs;
    theme: Theme;
    /** Epoch milliseconds of this frame. */
    now: number;
    /** The package version. */
    version: string;
    /** The spinner frame index. */
    spinner: number;
    /** The about view's facts. */
    about: AboutInfo;
}

/** Facts the about view shows. */
export interface AboutInfo {
    /** The state file path. */
    statePath: string;
    /** The terminal description (`kitty 0.36 · 120×36 · truecolor · mouse ● · kitty keyboard ●`). */
    terminal: string;
}

/** A plain span. */
export const t = (text: string, tone?: Tone): Span => (tone === undefined ? { text } : { text, tone });
/** A bold span. */
export const b = (text: string, tone?: Tone): Span => ({ text, tone, bold: true });
/** A dim (muted) span. */
export const d = (text: string): Span => ({ text, dim: true });

/** The cell width of a line. */
export function lineWidth(line: Line): number {
    let w = 0;
    for (const s of line) w += displayWidth(s.text);
    return w;
}

/**
 * Fits a line to exactly `width` cells: spans past the width are cut (the
 * last kept one ending in an ellipsis), a short line is padded.
 *
 * @param line - The line
 * @param width - The row width
 * @returns The fitted line
 */
export function fitLine(line: Line, width: number): Line {
    const out: Line = [];
    let used = 0;
    for (const span of line) {
        if (used >= width) break;
        const w = displayWidth(span.text);
        if (used + w <= width) {
            out.push(span);
            used += w;
            continue;
        }
        out.push({ ...span, text: truncate(span.text, width - used) });
        used = width;
    }
    if (used < width) out.push({ text: ' '.repeat(width - used) });
    return out;
}

/**
 * A line from plain text, padded to the width.
 *
 * @param text - The text
 * @param width - The row width
 * @param tone - An optional tone
 * @returns The line
 */
export function textLine(text: string, width: number, tone?: Tone): Line {
    return [t(padEnd(text, width), tone)];
}

/** A blank line. */
export function blank(width: number): Line {
    return [t(' '.repeat(width))];
}

/** A full-width rule. */
export function rule(width: number, ch: string): Line {
    return [{ text: ch.repeat(width), tone: 'muted' }];
}

/** Pads a list of lines to exactly `rows` rows, cutting extras. */
export function fitRows(lines: Line[], rows: number, width: number): Line[] {
    const out = lines.slice(0, rows).map(l => fitLine(l, width));
    while (out.length < rows) out.push(blank(width));
    return out;
}

/** The text of a line (for tests and the debug log). */
export function lineText(line: Line): string {
    return line.map(s => s.text).join('');
}

/**
 * Left- and right-aligned spans on one row, the left yielding.
 *
 * @param left - The left spans
 * @param right - The right spans
 * @param width - The row width
 * @returns The composed line
 */
export function lrLine(left: Line, right: Line, width: number): Line {
    const rightWidth = lineWidth(right);
    const leftBudget = Math.max(0, width - rightWidth - 1);
    const l = fitLine(left, leftBudget);
    return [...l, t(' '), ...right];
}

/** The glyph set of the context (a shorthand). */
export function glyphs(ctx: RenderCtx): Glyphs {
    return ctx.g;
}
