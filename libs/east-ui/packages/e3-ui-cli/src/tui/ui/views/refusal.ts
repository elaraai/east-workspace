/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The refusal screens — not an e3 repository, not logged in, server
 * unreachable — each with the fix spelled out (and prefilled in the box).
 *
 * @packageDocumentation
 */

import type { Refusal, TuiState } from '../../state/actions.js';
import type { Line, RenderCtx } from '../lines.js';
import { centredBlock } from '../shell/widgets.js';

/** The refusal body. */
export function renderRefusal(state: TuiState, ctx: RenderCtx): Line[] {
    if (state.view.kind !== 'refusal') return [];
    const width = ctx.layout.columns;
    const g = ctx.g;
    const r: Refusal = state.view.refusal;
    switch (r.kind) {
        case 'not-repo':
            return centredBlock(g.cross, 'neg', 'NOT AN E3 REPOSITORY', [
                `${r.target} has no objects/ packages/ executions/ workspaces/`,
                '',
                `e3 repo create ${r.target}          create one here`,
                '/repo <path>                        open a different repository',
                'E3_REPO=<path>                      or set the default',
            ], width);
        case 'not-logged-in':
            return centredBlock(g.cross, 'neg', 'NOT LOGGED IN', [
                `${r.origin} has no saved credential`,
                '',
                `e3-ui auth login ${r.origin}        (same store as e3 auth)`,
                r.repo !== null ? `then   e3-ui ${r.origin}/repos/${r.repo}` : `then   e3-ui ${r.origin}`,
            ], width);
        case 'unreachable':
            return centredBlock(g.cross, 'neg', 'SERVER UNREACHABLE', [
                `GET ${r.url} — ${r.error} after ${r.attempts} attempts`,
                '',
                'r  retry now         waits 15s and retries by itself',
            ], width);
        default:
            return centredBlock(g.cross, 'neg', 'COULD NOT OPEN', [r.message], width);
    }
}

/** The refusal hints. */
export function refusalHints(state: TuiState): { left: string; right: string } {
    const kind = state.view.kind === 'refusal' ? state.view.refusal.kind : 'error';
    return {
        left: kind === 'unreachable' ? 'r retry   q quit   /repo <path|url>' : 'q quit   /repo <path|url>   /login <url>',
        right: '',
    };
}
