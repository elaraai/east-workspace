/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The view router — `renderView(state, ctx)` picks the view module for the
 * current view and returns its body lines and hint row.
 *
 * @packageDocumentation
 */

import type { TuiState } from '../../state/actions.js';
import type { Line, RenderCtx } from '../lines.js';
import type { RepoFacts } from './about.js';
import { renderAbout, aboutHints } from './about.js';
import { renderDashboard, dashboardHints } from './dashboard.js';
import { renderHelp, helpHints } from './help.js';
import { renderLaunch, launchHints } from './launch.js';
import { renderRefusal, refusalHints } from './refusal.js';

/** A rendered view. */
export interface RenderedView {
    body: Line[];
    hints: { left: string; right: string };
}

/** Per-view renderers registered by later view modules (repos, workspaces, task, input). */
const extra = new Map<string, (state: TuiState, ctx: RenderCtx) => RenderedView>();

/**
 * Registers a view renderer.
 *
 * @param kind - The view kind
 * @param render - The renderer
 */
export function registerView(kind: string, render: (state: TuiState, ctx: RenderCtx) => RenderedView): void {
    extra.set(kind, render);
}

/**
 * Renders the current view.
 *
 * @param state - The store state
 * @param ctx - The render context
 * @param facts - Repository facts for the about view
 * @returns The body and hints
 */
export function renderView(state: TuiState, ctx: RenderCtx, facts: RepoFacts | null): RenderedView {
    switch (state.view.kind) {
        case 'launch': return { body: renderLaunch(state, ctx), hints: launchHints };
        case 'refusal': return { body: renderRefusal(state, ctx), hints: refusalHints(state) };
        case 'help': return { body: renderHelp(state, ctx), hints: helpHints };
        case 'about': return { body: renderAbout(state, ctx, facts), hints: aboutHints };
        case 'dashboard': {
            const registered = extra.get('dashboard');
            if (registered !== undefined) return registered(state, ctx);
            return { body: renderDashboard(state, ctx), hints: dashboardHints(state, ctx) };
        }
        default: {
            const registered = extra.get(state.view.kind);
            if (registered !== undefined) return registered(state, ctx);
            return { body: [], hints: { left: '', right: '' } };
        }
    }
}
