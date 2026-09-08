/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The log view — a stream's lines with numbers, the stream header
 * (`stdout ▾   stderr (12)`), the scrollbar and the footer; follow-tail
 * that pauses on scroll-up and resumes on `F`; `o` / `e` switch streams;
 * `/find` substring matches with `n` / `N` and a held highlight; `s` saves
 * `<ws>.<task>.<stream>.log`; `c` copies through OSC 52.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Controller } from '../../controller.js';
import { emptyLogs, findInLines, logLines, type LogStream } from '../../data/logs.js';
import { isRunLive } from '../../data/dataflow.js';
import type { ParsedCommand } from '../../input/commands.js';
import type { KeyAction } from '../../input/keymap.js';
import { layoutOf } from '../../model/index.js';
import type { Glyphs } from '../../render/glyphs.js';
import { formatInt, formatSize, padEnd, padStart } from '../../render/text.js';
import type { LogsData, LogsUi, TuiState } from '../../state/actions.js';
import { b, d, t, lrLine, type Line } from '../lines.js';
import { withScrollbar } from '../shell/widgets.js';

/** Rows the header lines, the dashed rule, the stream line and the footer take. */
export const LOGS_CHROME_ROWS = 5;
/** Bytes copied through OSC 52 at most (terminals cap the sequence). */
export const COPY_LIMIT = 100 * 1024;

/** The logs a task view shows. */
export interface LogsContext {
    ws: string;
    task: string;
    ui: LogsUi;
    data: LogsData;
    other: LogsData;
    lines: string[];
    visible: number;
}

/**
 * The logs context of the current view (a task view on its Logs tab).
 *
 * @param state - The store state
 * @returns The context, or null
 */
export function logsContext(state: TuiState): LogsContext | null {
    const v = state.view;
    if (v.kind !== 'task' || v.tab !== 'logs') return null;
    const streams = state.data.logs[v.ws]?.[v.task] ?? {};
    const data = streams[v.logs.stream] ?? emptyLogs();
    const other = streams[v.logs.stream === 'stdout' ? 'stderr' : 'stdout'] ?? emptyLogs();
    return { ws: v.ws, task: v.task, ui: v.logs, data, other, lines: logLines(data.text), visible: Math.max(1, layoutOf(state).bodyRows - LOGS_CHROME_ROWS) };
}

/** The window's top: the tail while following, else the scrolled top (clamped). */
export function logsTop(ctx: LogsContext): number {
    const max = Math.max(0, ctx.lines.length - ctx.visible);
    return ctx.ui.follow ? max : Math.max(0, Math.min(ctx.ui.top, max));
}

/** The matching line indices of the held search. */
export function logsMatches(ctx: LogsContext): number[] {
    return ctx.ui.match === null ? [] : findInLines(ctx.lines, ctx.ui.match.text);
}

/**
 * The stream line: ` stdout ▾   stderr (12)` with the totals flush right.
 *
 * @param ctx - The logs context
 * @param state - The store state
 * @param width - The row width
 * @param g - The glyph set
 * @returns The line
 */
export function streamLine(ctx: LogsContext, state: TuiState, width: number, g: Glyphs): Line {
    const otherName: LogStream = ctx.ui.stream === 'stdout' ? 'stderr' : 'stdout';
    const otherCount = logLines(ctx.other.text).length;
    const left: Line = [t(' '), b(ctx.ui.stream), b(` ${g.expanded}`, 'brand'), t('   '), d(`${otherName} (${formatInt(otherCount)})`)];
    const live = isRunLive(state, ctx.ws) || state.data.status[ctx.ws]?.result.tasks.find(x => x.name === ctx.task)?.status.type === 'in-progress';
    const parts: string[] = [`${formatInt(ctx.lines.length)} line${ctx.lines.length === 1 ? '' : 's'}`, formatSize(ctx.data.totalSize)];
    const right: Line = [d(parts.join(` ${g.sep} `))];
    if (live) right.push(d(` ${g.sep} `), b(`${g.dot} live`, 'pos'));
    if (ctx.ui.follow) right.push(d(` ${g.sep} following`));
    if (ctx.data.capped) right.push(d(` ${g.sep} `), b('capped at 10 MB', 'warn'));
    if (ctx.data.error !== null && ctx.data.error !== 'no run yet') right.push(d(` ${g.sep} `), b(ctx.data.error, 'neg'));
    right.push(t(' '));
    return lrLine(left, right, width);
}

/**
 * The visible lines with numbers and the scrollbar.
 *
 * @param ctx - The logs context
 * @param width - The row width including the scrollbar column
 * @param g - The glyph set
 * @returns The lines
 */
export function renderLogLines(ctx: LogsContext, width: number, g: Glyphs): Line[] {
    const top = logsTop(ctx);
    const matches = new Set(logsMatches(ctx));
    const active = ctx.ui.match === null ? -1 : (logsMatches(ctx)[ctx.ui.match.index] ?? -1);
    const out: Line[] = [];
    const digits = Math.max(4, String(ctx.lines.length).length);
    for (let i = top; i < top + ctx.visible; i++) {
        const text = ctx.lines[i];
        if (text === undefined) {
            out.push([t(' '.repeat(width - 1))]);
            continue;
        }
        const number = padStart(String(i + 1), digits + 2);
        const body = padEnd(text.replace(/\t/g, '    '), Math.max(1, width - 1 - digits - 4));
        if (i === active) out.push([b(number, 'brand'), t('  '), b(body, 'brand')]);
        else if (matches.has(i)) out.push([d(number), t('  '), b(body)]);
        else out.push([d(number), t('  '), t(body)]);
    }
    if (ctx.lines.length === 0) {
        out[0] = [t('  '), d(ctx.data.error === 'no run yet' ? `no ${ctx.ui.stream} yet — the task has not run` : ctx.data.error ?? (ctx.data.complete ? `${ctx.ui.stream} is empty` : 'loading…'))];
    }
    return withScrollbar(out, width, ctx.lines.length, ctx.visible, top, g);
}

/**
 * The footer: ` lines a–b of N · at end` with the follow hint flush right.
 *
 * @param ctx - The logs context
 * @param width - The row width
 * @param g - The glyph set
 * @returns The line
 */
export function logsFooter(ctx: LogsContext, width: number, g: Glyphs): Line {
    const total = ctx.lines.length;
    const top = logsTop(ctx);
    const first = total === 0 ? 0 : top + 1;
    const last = Math.min(total, top + ctx.visible);
    const parts = [`lines ${formatInt(first)}–${formatInt(last)} of ${formatInt(total)}`];
    if (last >= total) parts.push('at end');
    if (ctx.ui.match !== null) {
        const n = logsMatches(ctx).length;
        parts.push(n === 0 ? `no match for ${ctx.ui.match.text}` : `match ${ctx.ui.match.index + 1} of ${n} ${g.sep} held until esc`);
    }
    const right = ctx.ui.follow ? `${g.up} scroll up pauses follow ${g.sep} F resumes` : 'F follow';
    return lrLine([d(` ${parts.join(` ${g.sep} `)}`)], [d(right), t(' ')], width);
}

/** Writes a scrolled top, pausing follow. */
function scrollTo(controller: Controller, ctx: LogsContext, top: number): void {
    const max = Math.max(0, ctx.lines.length - ctx.visible);
    const clamped = Math.max(0, Math.min(top, max));
    if (ctx.ui.follow && clamped < max) controller.dispatch({ type: 'logs/follow', follow: false });
    controller.dispatch({ type: 'logs/scroll', top: clamped });
    if (clamped >= max && !ctx.ui.follow) controller.dispatch({ type: 'logs/follow', follow: true });
}

/** Scrolls a match into view (two lines of context above). */
function showMatch(controller: Controller, ctx: LogsContext, index: number): void {
    const matches = logsMatches(ctx);
    if (matches.length === 0) return;
    const i = ((index % matches.length) + matches.length) % matches.length;
    const line = matches[i]!;
    if (ctx.ui.match !== null) controller.dispatch({ type: 'logs/match', match: { text: ctx.ui.match.text, index: i } });
    controller.dispatch({ type: 'logs/follow', follow: false });
    controller.dispatch({ type: 'logs/scroll', top: Math.max(0, Math.min(line - 2, Math.max(0, ctx.lines.length - ctx.visible))) });
}

/**
 * Handles a key action on the logs.
 *
 * @param action - The action
 * @param state - The store state
 * @param controller - The controller
 * @returns `true` when handled
 */
export function logsKey(action: KeyAction, state: TuiState, controller: Controller): boolean {
    const ctx = logsContext(state);
    if (ctx === null) return false;
    const top = logsTop(ctx);
    const page = Math.max(1, ctx.visible - 1);
    switch (action.kind) {
        case 'move': {
            switch (action.op) {
                case 'up': scrollTo(controller, ctx, top - 1); return true;
                case 'down': scrollTo(controller, ctx, top + 1); return true;
                case 'pageUp': scrollTo(controller, ctx, top - page); return true;
                case 'pageDown': scrollTo(controller, ctx, top + page); return true;
                case 'home': scrollTo(controller, ctx, 0); return true;
                case 'end': controller.dispatch({ type: 'logs/follow', follow: true }); return true;
            }
            return true;
        }
        case 'follow':
            controller.dispatch({ type: 'logs/follow', follow: !ctx.ui.follow });
            return true;
        case 'stream':
            if (action.stream !== ctx.ui.stream) controller.dispatch({ type: 'logs/stream', stream: action.stream });
            return true;
        case 'save':
            void controller.execute('/save');
            return true;
        case 'copy': {
            if (ctx.data.text === '') {
                controller.toast('nothing to copy yet', 'warn');
                return true;
            }
            const text = ctx.data.text.length > COPY_LIMIT ? ctx.data.text.slice(-COPY_LIMIT) : ctx.data.text;
            const note = ctx.data.text.length > COPY_LIMIT ? ` (the last ${formatSize(COPY_LIMIT)} of ${formatSize(ctx.data.text.length)})` : '';
            if (controller.deps.copy(text)) controller.toast(`copied ${formatSize(text.length)} to the clipboard via OSC 52${note} — if it did not arrive, /save writes the file`, 'pos');
            else controller.toast('copy needs a terminal that accepts OSC 52 — /save writes the file', 'warn');
            return true;
        }
        case 'next':
        case 'prev': {
            if (ctx.ui.match === null) {
                controller.toast('no match held — /find <text> first', 'warn');
                return true;
            }
            showMatch(controller, ctx, ctx.ui.match.index + (action.kind === 'next' ? 1 : -1));
            return true;
        }
        case 'back':
            if (ctx.ui.match === null) return false;
            controller.dispatch({ type: 'logs/match', match: null });
            return true;
        default:
            return false;
    }
}

/** The `/save` target: `<ws>.<task>.<stream>.log` in the working directory unless a file is given. */
export function logsSaveTarget(ctx: LogsContext, file: string | undefined): string {
    return path.resolve(file ?? `${ctx.ws}.${ctx.task}.${ctx.ui.stream}.log`);
}

/**
 * Handles `/find` and `/save` on the logs.
 *
 * @param command - The parsed command
 * @param state - The store state
 * @param controller - The controller
 * @returns `true` when handled
 */
export async function logsCommand(command: ParsedCommand, state: TuiState, controller: Controller): Promise<boolean> {
    const ctx = logsContext(state);
    if (ctx === null) return false;
    switch (command.name) {
        case 'find': {
            const matches = findInLines(ctx.lines, command.query);
            controller.dispatch({ type: 'logs/match', match: { text: command.query, index: 0 } });
            if (matches.length === 0) {
                controller.toast(`no match for ${command.query} in ${ctx.ui.stream}`, 'warn');
                return true;
            }
            const after = logsContext(controller.state());
            if (after !== null) showMatch(controller, after, 0);
            controller.toast(`${formatInt(matches.length)} match${matches.length === 1 ? '' : 'es'} ${controller.deps.glyphs.sep} n N next/prev ${controller.deps.glyphs.sep} esc`, 'info');
            return true;
        }
        case 'save': {
            const target = logsSaveTarget(ctx, command.file);
            if (fs.existsSync(target) && !command.force) {
                controller.dispatch({ type: 'command/confirm', confirm: { question: `overwrite ${target}?`, command: `/save "${target}" --force` } });
                return true;
            }
            if (ctx.data.text === '') {
                controller.toast(`nothing to save — ${ctx.ui.stream} is empty`, 'warn');
                return true;
            }
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, ctx.data.text);
            controller.toast(`saved ${formatSize(ctx.data.text.length)} to ${target}`, 'pos');
            return true;
        }
        default:
            return false;
    }
}
