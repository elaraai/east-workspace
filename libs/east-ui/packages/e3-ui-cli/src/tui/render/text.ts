/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Text measurement and formatting for one-line terminal rows.
 *
 * Every row the TUI renders is exactly one terminal line, so the layout
 * math needs the CELL width of a string (not its code-unit length): the
 * glyph set is single-width, but user data can carry wide (CJK, emoji) or
 * zero-width (combining) characters. Byte sizes come from
 * `formatSize` (`@elaraai/e3-cli/internal`) — one formatter across `e3`
 * and `e3-ui`, not a third.
 *
 * @packageDocumentation
 */

export { formatSize } from '@elaraai/e3-cli/internal';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Whether a code point renders two cells wide (East Asian Wide / Fullwidth, emoji presentation). */
function isWide(cp: number): boolean {
    return (
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0x303e) ||
        (cp >= 0x3041 && cp <= 0x33ff) ||
        (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0x4e00 && cp <= 0x9fff) ||
        (cp >= 0xa000 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1f64f) ||
        (cp >= 0x1f900 && cp <= 0x1f9ff) ||
        (cp >= 0x20000 && cp <= 0x3fffd)
    );
}

/** Whether a code point occupies no cell (combining marks, ZWJ, variation selectors, controls). */
function isZeroWidth(cp: number): boolean {
    return (
        cp < 0x20 ||
        (cp >= 0x7f && cp < 0xa0) ||
        (cp >= 0x300 && cp <= 0x36f) ||
        (cp >= 0x200b && cp <= 0x200f) ||
        (cp >= 0xfe00 && cp <= 0xfe0f) ||
        cp === 0xfeff
    );
}

/**
 * The number of terminal cells `text` occupies.
 *
 * @param text - The text (no ANSI escapes)
 * @returns Its cell width
 */
export function displayWidth(text: string): number {
    let width = 0;
    for (const { segment } of segmenter.segment(text)) {
        const cp = segment.codePointAt(0);
        if (cp === undefined || isZeroWidth(cp)) continue;
        width += isWide(cp) ? 2 : 1;
    }
    return width;
}

/**
 * Truncates `text` to at most `width` cells, ending in `ellipsis` when cut.
 *
 * @param text - The text
 * @param width - The cell budget
 * @param ellipsis - The marker appended when truncated (default `…`)
 * @returns The text, or a prefix of it plus the ellipsis, within `width`
 */
export function truncate(text: string, width: number, ellipsis = '…'): string {
    if (width <= 0) return '';
    if (displayWidth(text) <= width) return text;
    const ellipsisWidth = displayWidth(ellipsis);
    const budget = width - ellipsisWidth;
    if (budget <= 0) return ellipsis.slice(0, width);
    let out = '';
    let used = 0;
    for (const { segment } of segmenter.segment(text)) {
        const w = displayWidth(segment);
        if (used + w > budget) break;
        out += segment;
        used += w;
    }
    return out + ellipsis;
}

/**
 * Pads `text` on the right to exactly `width` cells, truncating when longer.
 *
 * @param text - The text
 * @param width - The cell width
 * @returns The fitted text
 */
export function padEnd(text: string, width: number): string {
    const w = displayWidth(text);
    if (w > width) return truncate(text, width, '');
    return text + ' '.repeat(width - w);
}

/**
 * Pads `text` on the left to exactly `width` cells, truncating when longer.
 *
 * @param text - The text
 * @param width - The cell width
 * @returns The fitted text
 */
export function padStart(text: string, width: number): string {
    const w = displayWidth(text);
    if (w > width) return truncate(text, width, '');
    return ' '.repeat(width - w) + text;
}

/**
 * Centres `text` in `width` cells (the extra cell of an odd remainder goes
 * to the right).
 *
 * @param text - The text
 * @param width - The cell width
 * @returns The centred, fitted text
 */
export function center(text: string, width: number): string {
    const w = displayWidth(text);
    if (w >= width) return truncate(text, width, '');
    const left = Math.floor((width - w) / 2);
    return ' '.repeat(left) + text + ' '.repeat(width - w - left);
}

/**
 * Fits `text` to exactly `width` cells — padded on the right, or truncated
 * with an ellipsis.
 *
 * @param text - The text
 * @param width - The cell width
 * @returns The fitted text
 */
export function fit(text: string, width: number): string {
    return padEnd(truncate(text, width), width);
}

/**
 * A row with `left` at the start and `right` flush against the end, in
 * `width` cells; the left part yields to the right one.
 *
 * @param left - The left text
 * @param right - The right text
 * @param width - The cell width
 * @param gap - Minimum cells between the two (default 1)
 * @returns The composed row
 */
export function lr(left: string, right: string, width: number, gap = 1): string {
    const rightWidth = displayWidth(right);
    if (rightWidth >= width) return truncate(right, width, '');
    const leftBudget = width - rightWidth - gap;
    const l = leftBudget > 0 ? truncate(left, leftBudget) : '';
    return l + ' '.repeat(width - displayWidth(l) - rightWidth) + right;
}

/**
 * Formats an integer with thousands grouping (`1,240,000`).
 *
 * @param n - The integer
 * @returns The grouped text
 */
export function formatInt(n: number | bigint): string {
    const negative = typeof n === 'bigint' ? n < 0n : n < 0;
    const digits = (typeof n === 'bigint' ? (negative ? -n : n) : Math.trunc(Math.abs(n))).toString();
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return negative ? `-${grouped}` : grouped;
}

/**
 * Formats a duration in milliseconds the way the dashboard reads it:
 * `0.8s`, `38.4s`, `2m 5s`, `1h 02m`, `3d 4h`.
 *
 * @param ms - The duration in milliseconds
 * @returns The formatted duration
 */
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${String(minutes - hours * 60).padStart(2, '0')}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours - days * 24}h`;
}

/**
 * How long ago `then` was, at whole-unit precision: `just now`, `12s ago`,
 * `2m ago`, `3h ago`, `3d ago`, `12d ago`.
 *
 * @param then - The instant (a `Date`, ISO text, or epoch milliseconds)
 * @param now - The current epoch milliseconds
 * @returns The relative text (`—` for an unparsable instant)
 */
export function timeAgo(then: Date | string | number, now: number): string {
    const t = typeof then === 'number' ? then : new Date(then).getTime();
    if (!Number.isFinite(t)) return '—';
    const seconds = Math.max(0, Math.round((now - t) / 1000));
    if (seconds < 1) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/**
 * How long ago `then` was, with one decimal under ten seconds (`0.4s ago`,
 * `7.1s ago`, `12s ago`, `2m ago`) — the "polled … ago" hint.
 *
 * @param then - The instant in epoch milliseconds
 * @param now - The current epoch milliseconds
 * @returns The relative text
 */
export function agoShort(then: number, now: number): string {
    const seconds = Math.max(0, (now - then) / 1000);
    if (seconds < 10) return `${seconds.toFixed(1)}s ago`;
    return timeAgo(then, now);
}

/**
 * The first `n` characters of a hash (`9f3c1a7e2b41`).
 *
 * @param hash - The hash
 * @param n - Characters kept (default 12, e3-cli's display width)
 * @returns The prefix
 */
export function hashShort(hash: string, n = 12): string {
    return hash.slice(0, n);
}

/**
 * A hash abbreviated at both ends (`4be1…a9`).
 *
 * @param hash - The hash
 * @returns The abbreviation (short hashes are returned as is)
 */
export function hashMid(hash: string): string {
    if (hash.length <= 8) return hash;
    return `${hash.slice(0, 4)}…${hash.slice(-2)}`;
}

/**
 * A hash abbreviated to its first four characters plus an ellipsis (`0a44…`).
 *
 * @param hash - The hash
 * @returns The abbreviation
 */
export function hashTiny(hash: string): string {
    if (hash.length <= 4) return hash;
    return `${hash.slice(0, 4)}…`;
}

/**
 * Formats a UTC instant as `YYYY-MM-DD HH:MM:SS`.
 *
 * @param when - The instant (a `Date`, ISO text, or epoch milliseconds)
 * @returns The formatted text (`—` when unparsable)
 */
export function formatStamp(when: Date | string | number): string {
    const d = when instanceof Date ? when : new Date(when);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * A percentage with two decimals (`0.97%`), for the value-tree footer.
 *
 * @param part - The numerator
 * @param whole - The denominator
 * @returns The percentage text (`0%` when `whole` is 0)
 */
export function percent(part: number, whole: number): string {
    if (whole <= 0) return '0%';
    return `${((part / whole) * 100).toFixed(2)}%`;
}
