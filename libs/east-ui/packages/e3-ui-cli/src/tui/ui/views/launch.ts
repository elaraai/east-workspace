/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The launch screen — the wordmark while the embedded server starts (or the
 * token resolves); the command box carries the progress step.
 *
 * @packageDocumentation
 */

import { center } from '../../render/text.js';
import type { TuiState } from '../../state/actions.js';
import { blank, b, d, t, type Line, type RenderCtx } from '../lines.js';
import { wordmark } from './wordmark.js';

/** The launch body. */
export function renderLaunch(state: TuiState, ctx: RenderCtx): Line[] {
    const width = ctx.layout.columns;
    const rows = ctx.layout.bodyRows;
    const mark = wordmark(ctx.g.tabL === '[');
    const target = state.view.kind === 'launch' ? state.view.target : '';
    const block: Line[] = [
        ...mark.map(row => [b(center(row, width), 'brand')]),
        blank(width),
        [d(center(`e3-ui  ·  ${ctx.version}`, width))],
        blank(width),
        blank(width),
        [t(center(`opening ${target}`, width))],
    ];
    const above = Math.max(0, Math.floor((rows - block.length) / 2));
    const out: Line[] = [];
    for (let i = 0; i < above; i++) out.push(blank(width));
    out.push(...block);
    return out;
}

/** The launch command-box step, drawn in the command line. */
export function launchStep(state: TuiState, ctx: RenderCtx): string {
    const step = state.view.kind === 'launch' ? state.view.step : '';
    const spin = ctx.g.spinner[ctx.spinner % ctx.g.spinner.length]!;
    return `${spin} ${step}`;
}

/** The launch hints. */
export const launchHints = { left: 'Ctrl-C abort', right: '' };
