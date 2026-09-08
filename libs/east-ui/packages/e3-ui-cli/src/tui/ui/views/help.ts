/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The help view — a tab per page so the commands and keys listed are the
 * ones that work where `?` was pressed.
 *
 * @packageDocumentation
 */

import { padEnd } from '../../render/text.js';
import type { TuiState } from '../../state/actions.js';
import { HELP_TABS, helpColumns } from '../../model/help.js';
import type { Hit } from '../frame.js';
import { blank, b, d, t, type Line, type RenderCtx } from '../lines.js';
import { lrLine } from '../lines.js';
import { tabStripHits } from '../shell/widgets.js';

/** The clickable tabs of the help strip (body row 0). */
export function helpTabHits(ctx: RenderCtx): Hit[] {
    return tabStripHits('HELP', HELP_TABS.map(x => x.label), ctx.g).map(h => ({ row: 0, x0: h.x0, x1: h.x1, target: { kind: 'tab', index: h.index } }));
}

/** The help body. */
export function renderHelp(state: TuiState, ctx: RenderCtx): Line[] {
    if (state.view.kind !== 'help') return [];
    const width = ctx.layout.columns;
    const g = ctx.g;
    const active = HELP_TABS.findIndex(x => x.tab === (state.view.kind === 'help' ? state.view.tab : 'everywhere'));
    const strip: Line = [t(' '), b('HELP'), t('   ')];
    HELP_TABS.forEach((tab, i) => {
        if (i === active) strip.push(b(`${g.tabL}${i + 1} ${tab.label}${g.tabR}`, 'brand'));
        else strip.push(d(` ${i + 1} ${tab.label} `));
        strip.push(t(' '));
    });
    const out: Line[] = [lrLine(strip, [d('esc back'), t(' ')], width), blank(width)];
    const columns = helpColumns(HELP_TABS[active]?.tab ?? 'everywhere');
    const colWidth = Math.floor((width - 2) / 3);
    const keyWidth = Math.min(26, Math.floor(colWidth * 0.5));
    const rows = Math.max(...columns.map(c => c.rows.length)) + 1;
    for (let r = 0; r < rows; r++) {
        const line: Line = [t(' ')];
        columns.forEach((col) => {
            if (r === 0) {
                line.push(b(padEnd(col.title, colWidth)));
                return;
            }
            const row = col.rows[r - 1];
            if (row === undefined) {
                line.push(t(' '.repeat(colWidth)));
                return;
            }
            const [key, effect] = row;
            const isHeading = key === '' && effect === '' ? false : key.toUpperCase() === key && key.includes('KEYS');
            if (isHeading) line.push(b(padEnd(key, colWidth)));
            else line.push(t(padEnd(key, keyWidth), 'brand'), d(padEnd(effect, colWidth - keyWidth)));
        });
        out.push(line);
    }
    return out;
}

/** The help hints. */
export const helpHints = { left: '1-6 tabs   ← →   esc back', right: '' };
