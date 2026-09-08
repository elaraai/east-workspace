/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shell chrome — the header (breadcrumb + live pills), the command box
 * with its completion list and confirmations, the commit bar, the hint row,
 * and the frame that composes them around a view body.
 *
 * @packageDocumentation
 */

import { columnPlan, breakpoint } from '../../render/layout.js';
import { displayWidth, padEnd, lr } from '../../render/text.js';
import type { TuiState, View } from '../../state/actions.js';
import { dirtyCount } from '../../state/reducer.js';
import { RUN_FLAGS, describe, parseCommand } from '../../input/commands.js';
import { connectionCell } from '../../model/status.js';
import { blank, fitLine, fitRows, lineWidth, lrLine, rule, t, b, d, type Line, type RenderCtx } from '../lines.js';
import type { Hit } from '../frame.js';
import { launchStep } from '../views/launch.js';

/** The breadcrumb of a view. */
export function breadcrumb(state: TuiState, ctx: RenderCtx): string {
    const parts: string[] = [];
    const session = state.session;
    if (session !== null) parts.push(session.label);
    const v: View = state.view;
    if (v.kind === 'dashboard' || v.kind === 'task' || v.kind === 'input') parts.push(v.ws);
    if (v.kind === 'task') parts.push(v.task);
    if (v.kind === 'input') parts.push(v.name);
    if (v.kind === 'help' || v.kind === 'about') {
        // Help and about keep the breadcrumb of the page underneath.
        const under = state.history[state.history.length - 1];
        if (under !== undefined) {
            if (under.kind === 'dashboard' || under.kind === 'task' || under.kind === 'input') parts.push(under.ws);
            if (under.kind === 'task') parts.push(under.task);
            if (under.kind === 'input') parts.push(under.name);
        }
    }
    return parts.join(` ${ctx.g.crumb} `);
}

/** The header's pills: dirty, running, connection. */
export function pills(state: TuiState, ctx: RenderCtx): Line {
    const g = ctx.g;
    const out: Line = [];
    const dirty = dirtyCount(state);
    if (dirty > 0) out.push(b(`${g.diamond} ${dirty} DIRTY`, 'warn'), t('  '));
    const ws = state.view.kind === 'dashboard' || state.view.kind === 'task' || state.view.kind === 'input' ? state.view.ws : null;
    const execution = ws !== null ? state.data.execution[ws] : undefined;
    if (execution?.state?.status.type === 'running' || execution?.settling === true || execution?.stopping === true) {
        const total = ws !== null ? state.data.status[ws]?.result.tasks.length ?? 0 : 0;
        const done = execution.events.filter(e => e.type !== 'start').length;
        const spin = g.spinner[ctx.spinner % g.spinner.length]!;
        if (execution.stopping) out.push(b(`${g.square} STOPPING ${spin}`, 'warn'), t('  '));
        else out.push(b(`${g.quarter} RUNNING ${done}/${total} ${spin}`, 'info'), t('  '));
    }
    const conn = connectionCell(state.connection, g);
    if (conn !== null) out.push(b(`${conn.glyph} ${conn.word}`, conn.tone), t('  '));
    if (out.length === 0) out.push(d(`v${ctx.version}`), t('  '));
    return out;
}

/** The header row: ` e3-ui  <breadcrumb>` with the pills flush right. */
export function renderHeader(state: TuiState, ctx: RenderCtx): Line {
    const crumb = breadcrumb(state, ctx);
    const left: Line = [t(' '), b('e3-ui', 'brand'), t(crumb === '' ? '' : `  ${crumb}`)];
    return lrLine(left, pills(state, ctx), ctx.layout.columns);
}

/**
 * The clickable crumbs and pills of the header row (row 0).
 *
 * @param state - The store state
 * @param ctx - The render context
 * @returns The hits
 */
export function headerHits(state: TuiState, ctx: RenderCtx): Hit[] {
    const g = ctx.g;
    const hits: Hit[] = [];
    const parts = breadcrumb(state, ctx).split(` ${g.crumb} `).filter(p => p !== '');
    let x = 1 + displayWidth('e3-ui') + 2;
    parts.forEach((part, i) => {
        const w = displayWidth(part);
        hits.push({ row: 0, x0: x, x1: x + w, target: { kind: 'crumb', index: i } });
        x += w + displayWidth(` ${g.crumb} `);
    });
    const spans = pills(state, ctx);
    let px = ctx.layout.columns - lineWidth(spans);
    for (const span of spans) {
        const w = displayWidth(span.text);
        if (span.bold === true && span.text.trim() !== '') {
            const pill = span.text.includes('DIRTY') ? 'dirty' : span.text.includes('RUNNING') || span.text.includes('STOPPING') ? 'running' : 'connection';
            hits.push({ row: 0, x0: px, x1: px + w, target: { kind: 'pill', pill } });
        }
        px += w;
    }
    return hits;
}

/**
 * The clickable completion rows (absolute rows above the command box).
 *
 * @param state - The store state
 * @param ctx - The render context
 * @returns The hits
 */
export function completionHits(state: TuiState, ctx: RenderCtx): Hit[] {
    const completion = state.command.completion;
    if (completion === null || ctx.layout.completionRows === 0) return [];
    const first = ctx.layout.commandTop - ctx.layout.completionRows;
    return completion.items.slice(0, ctx.layout.completionRows).map((_, i) => ({ row: first + i, x0: 0, x1: ctx.layout.columns, target: { kind: 'completion', index: i } }));
}

/** The toast line, if a toast is showing. */
function toastLine(state: TuiState, ctx: RenderCtx): Line | null {
    const toast = state.toast;
    if (toast === null || toast.until < ctx.now) return null;
    const glyph = toast.glyph ?? (toast.tone === 'neg' ? ctx.g.cross : toast.tone === 'warn' ? ctx.g.half : toast.tone === 'info' ? ctx.g.quarter : ctx.g.dot);
    return [t(' '), b(`${glyph} `, toast.tone), t(toast.text)];
}

/** The consequence line of what is typed (`run 6 tasks in main …`), and its keys. */
export function commandStatus(state: TuiState): { text: string; keys: string; error: boolean } {
    const text = state.command.text;
    const completion = state.command.completion;
    if (!text.startsWith('/')) {
        if (completion !== null) return { text: `${completion.items.length} match${completion.items.length === 1 ? '' : 'es'} · ↑↓ pick · ⏎ open`, keys: 'esc', error: false };
        return { text: text === '' ? '' : 'no match', keys: 'esc', error: false };
    }
    const parsed = parseCommand(text);
    if (!parsed.ok) {
        if (completion !== null) return { text: `${completion.items.length} match${completion.items.length === 1 ? '' : 'es'} · ↑↓ pick · ⏎ open · tab complete`, keys: '', error: false };
        return { text: parsed.error, keys: 'esc', error: true };
    }
    const ws = state.view.kind === 'dashboard' || state.view.kind === 'task' || state.view.kind === 'input' ? state.view.ws : null;
    const status = ws !== null ? state.data.status[ws]?.result : undefined;
    const execution = ws !== null ? state.data.execution[ws] : undefined;
    const described = describe(parsed.command, {
        workspace: ws,
        taskCount: status?.tasks.length ?? 0,
        running: execution?.state?.status.type === 'running' || execution?.settling === true,
        concurrency: 4,
        dirty: dirtyCount(state),
    });
    if (completion !== null && (parsed.command.name === 'task' || parsed.command.name === 'input' || parsed.command.name === 'workspace' || parsed.command.name === 'dataset' || parsed.command.name === 'repo' || parsed.command.name === 'logs' || parsed.command.name === 'runs' || parsed.command.name === 'tag')) {
        return { text: `${completion.items.length} match${completion.items.length === 1 ? '' : 'es'} · ↑↓ pick · ⏎ open · tab complete`, keys: '', error: false };
    }
    return { text: described.text, keys: described.keys, error: false };
}

/** The command box: a rule, the ` › …` line, a rule. */
export function renderCommandBox(state: TuiState, ctx: RenderCtx): Line[] {
    const width = ctx.layout.columns;
    const g = ctx.g;
    const prompt: Line = [t(' '), b(g.prompt, 'brand'), t(' ')];
    let middle: Line;
    const command = state.command;
    const toast = toastLine(state, ctx);
    if (state.view.kind === 'launch') {
        middle = [...prompt, b(launchStep(state, ctx), 'brand')];
    } else if (command.mode === 'confirm' && command.confirm !== null) {
        middle = lrLine([...prompt, b(command.confirm.question, 'warn')], [d('⏎ yes · esc no'), t(' ')], width);
    } else if (command.mode === 'edit') {
        const text = command.text;
        const before = text.slice(0, command.cursor);
        const after = text.slice(command.cursor);
        const typed: Line = [...prompt, t(before), b(g.cursor, 'brand'), t(after)];
        const status = commandStatus(state);
        const typedWidth = displayWidth(before) + displayWidth(after) + 4;
        const at = Math.max(typedWidth + 3, Math.min(40, width - 30));
        const pad = Math.max(1, at - typedWidth);
        const statusSpan = status.error ? t(status.text, 'neg') : d(status.text);
        middle = lrLine([...typed, t(' '.repeat(pad)), statusSpan], [d(status.keys), t('         ')], width);
    } else if (toast !== null) {
        // The toast sits after the prompt (` ›  ● Dataflow started · main · 6 tasks queued`).
        middle = [...prompt, t(' '), ...toast.slice(1)];
    } else {
        const hint = '/ commands · type a name to jump · ? help';
        const at = Math.min(50, Math.max(6, width - displayWidth(hint) - 6));
        middle = [...prompt, b(g.cursor, 'brand'), t(' '.repeat(Math.max(1, at - 4))), d(hint)];
    }
    return [rule(width, g.rule), fitLine(middle, width), rule(width, g.rule)];
}

/** The completion rows above the command box. */
export function renderCompletion(state: TuiState, ctx: RenderCtx): Line[] {
    const completion = state.command.completion;
    if (completion === null || ctx.layout.completionRows === 0) return [];
    const width = ctx.layout.columns;
    const g = ctx.g;
    const isJump = !state.command.text.startsWith('/');
    const plan = columnPlan(isJump ? 'jump' : 'completion', breakpoint(state.size));
    const items = completion.items.slice(0, ctx.layout.completionRows);
    return items.map((item, i) => {
        const selected = i === completion.index;
        const line: Line = [t(' '), b(selected ? g.sel : ' ', 'brand'), t(' ')];
        let used = 3;
        plan.forEach((col, ci) => {
            const cell = item.cells[ci] ?? '';
            if (col.width === 0) {
                line.push(selected ? b(cell) : t(cell));
                return;
            }
            line.push(selected ? b(padEnd(cell, col.width)) : t(padEnd(cell, col.width)));
            used += col.width;
        });
        void used;
        return fitLine(line, width);
    });
}

/** The commit bar (a dashed rule + the pending summary), when editing. */
export function renderCommitBar(state: TuiState, ctx: RenderCtx): Line[] {
    if (ctx.layout.commitRows === 0 || state.edit === null) return [];
    const width = ctx.layout.columns;
    const g = ctx.g;
    const n = state.edit.ops.length;
    const changed = state.edit.changed.map(id => id.replace(/^\./, '').split(/[.[{]/).pop() ?? id).join(' · ');
    const left: Line = [t(' '), b(`${g.diamond} ${n} change${n === 1 ? '' : 's'} pending`, 'warn'), t('   '), d(changed)];
    const right: Line = state.edit.applying ? [d('applying…')] : [b(`${g.enter} APPLY`, 'pos'), t('     '), b('esc DISCARD', 'neg')];
    return [rule(width, g.dashed), lrLine(left, right, width)];
}

/** The hint row (the last row): the view's hints, or the toast when the box is busy. */
export function renderHintBar(state: TuiState, ctx: RenderCtx, hints: { left: string; right: string }): Line {
    const width = ctx.layout.columns;
    const toast = toastLine(state, ctx);
    if (toast !== null && state.command.mode !== 'idle') return fitLine(toast, width);
    // While `/run` is being typed the row lists its flags.
    if (state.command.mode === 'edit' && /^\/run(\s|$)/.test(state.command.text)) {
        return [d(lr(` ${RUN_FLAGS.map(f => (f.hint === '' ? f.flag : `${f.flag}  ${f.hint}`)).join('    ')}`, '', width))];
    }
    return [d(lr(` ${hints.left}`, hints.right === '' ? '' : `${hints.right} `, width))];
}

/**
 * The whole frame: header, rule, body, commit bar, completion, command box,
 * hint — exactly `rows` lines of exactly `columns` cells.
 *
 * @param state - The store state
 * @param ctx - The render context
 * @param body - The view's body lines
 * @param hints - The view's hint row
 * @returns The frame's lines
 */
export function renderFrame(state: TuiState, ctx: RenderCtx, body: Line[], hints: { left: string; right: string }): Line[] {
    const { layout } = ctx;
    const width = layout.columns;
    const lines: Line[] = [];
    lines.push(fitLine(renderHeader(state, ctx), width));
    lines.push(rule(width, ctx.g.rule));
    lines.push(...fitRows(body, layout.bodyRows, width));
    lines.push(...renderCommitBar(state, ctx));
    lines.push(...renderCompletion(state, ctx));
    lines.push(...renderCommandBox(state, ctx));
    lines.push(fitLine(renderHintBar(state, ctx, hints), width));
    while (lines.length < layout.rows) lines.push(blank(width));
    return lines.slice(0, layout.rows);
}
