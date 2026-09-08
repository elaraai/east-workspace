/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The workspace dashboard — the title line now (#721); the counts, the
 * execution panel and the tasks + inputs tables land in #723.
 *
 * @packageDocumentation
 */

import { timeAgo, agoShort } from '../../render/text.js';
import type { TuiState } from '../../state/actions.js';
import { registerListModel } from '../../model/index.js';
import { d, t, b, type Line, type RenderCtx } from '../lines.js';
import { lrLine } from '../lines.js';

/** The dashboard title line: ` main   ● DEPLOYED · demand@1.4.2 · deployed 3d ago · lock: none`. */
export function dashboardTitle(state: TuiState, ws: string, ctx: RenderCtx): Line {
    const g = ctx.g;
    const info = (state.data.workspaces ?? []).find(w => w.name === ws);
    const wsState = state.data.workspaceState[ws];
    const status = state.data.status[ws]?.result;
    const right: Line = [];
    if (info === undefined || !info.deployed) {
        right.push(b(`${g.empty} EMPTY`, 'muted'));
    } else {
        const pkg = info.packageName.type === 'some' ? `${info.packageName.value}${info.packageVersion.type === 'some' ? `@${info.packageVersion.value}` : ''}` : '';
        right.push(b(`${g.dot} DEPLOYED`, 'pos'), d(` ${g.sep} ${pkg}`));
        if (wsState !== undefined && wsState !== null) right.push(d(` ${g.sep} deployed ${timeAgo(wsState.deployedAt, ctx.now)}`));
    }
    const lock = status?.lock;
    if (lock !== undefined) {
        if (lock.type === 'some') {
            const holder = lock.value;
            right.push(t(` ${g.sep} `), b(`lock: pid ${holder.pid}`, 'warn'), d(` ${holder.command.type === 'some' ? holder.command.value : ''} ${timeAgo(holder.acquiredAt, ctx.now)}`));
        } else {
            right.push(d(` ${g.sep} lock: none`));
        }
    }
    right.push(t(' '));
    return lrLine([t(' '), b(ws)], right, ctx.layout.columns);
}

/** The dashboard body (title only until #723). */
export function renderDashboard(state: TuiState, ctx: RenderCtx): Line[] {
    if (state.view.kind !== 'dashboard') return [];
    const ws = state.view.ws;
    const out: Line[] = [dashboardTitle(state, ws, ctx)];
    const error = state.data.statusError[ws];
    if (error !== undefined && state.data.status[ws] === undefined) {
        out.push([t(' '), t(`${ctx.g.cross} ${error}`, 'neg')]);
    }
    return out;
}

/** The dashboard hints. */
export function dashboardHints(state: TuiState, ctx: RenderCtx): { left: string; right: string } {
    const polled = state.data.polledAt;
    const ws = state.view.kind === 'dashboard' ? state.view.ws : null;
    const running = ws !== null && (state.data.execution[ws]?.state?.status.type === 'running' || state.data.execution[ws]?.settling === true);
    return {
        left: running ? '↑↓ move   ⏎ open   x stop   / commands' : '↑↓ move   ⏎ open   r run   x stop   w workspaces   / commands',
        right: polled !== null ? `polled ${agoShort(polled, ctx.now)}` : '',
    };
}

registerListModel('dashboard', () => ({ count: 0, visible: 0 }));
