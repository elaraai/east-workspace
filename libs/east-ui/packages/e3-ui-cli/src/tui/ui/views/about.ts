/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The about view — the wordmark, the version, the server, the repository,
 * the terminal, the state file and the licence.
 *
 * @packageDocumentation
 */

import { formatInt } from '../../render/text.js';
import type { TuiState } from '../../state/actions.js';
import { blank, b, d, t, type Line, type RenderCtx } from '../lines.js';
import { wordmark } from './wordmark.js';

/** Facts about the open repository, filled by the session (for the about view). */
export interface RepoFacts {
    objects: number;
    packages: number;
    workspaces: number;
}

/** The about body. */
export function renderAbout(state: TuiState, ctx: RenderCtx, facts: RepoFacts | null): Line[] {
    const width = ctx.layout.columns;
    const session = state.session;
    const row = (label: string, value: string): Line => [t('   '), d(label.padEnd(11)), t(value)];
    const server = session === null ? '—'
        : session.kind === 'local'
            ? `embedded @elaraai/e3-api-server ${ctx.version} · ${session.apiUrl} · repo ${session.repo}`
            : `${session.apiUrl}${session.repo !== null ? ` · repo ${session.repo}` : ''}${session.identity !== null ? ` · signed in as ${session.identity}` : ''}`;
    const repository = session === null ? '—'
        : `${session.path ?? session.target}${facts !== null ? ` · ${formatInt(facts.objects)} objects · ${facts.packages} packages · ${facts.workspaces} workspaces` : ''}`;
    return [
        blank(width),
        ...wordmark(ctx.g.tabL === '[').map(line => [t('   '), b(line, 'brand')]),
        blank(width),
        [t('   '), b(`e3-ui ${ctx.version}`)],
        blank(width),
        row('server', server),
        row('repository', repository),
        row('terminal', ctx.about.terminal),
        row('state', ctx.about.statePath),
        row('licence', 'AGPL-3.0-or-later · commercial licence available'),
    ];
}

/** The about hints. */
export const aboutHints = { left: 'esc back', right: '' };
