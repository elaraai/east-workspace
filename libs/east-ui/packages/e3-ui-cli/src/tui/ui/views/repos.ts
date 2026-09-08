/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The repositories view — a bare origin (or a multi-repo server):
 * `repoList` with each repository's counts and last deployment fetched
 * lazily; `⏎` binds one.
 *
 * @packageDocumentation
 */

import { breakpoint, columnPlan } from '../../render/layout.js';
import { formatInt, timeAgo } from '../../render/text.js';
import type { TuiState } from '../../state/actions.js';
import { registerListModel } from '../../model/index.js';
import { registerViewHooks } from '../../controller.js';
import type { Line, RenderCtx } from '../lines.js';
import { blank } from '../lines.js';
import { renderTable, sectionLine, withScrollbar, type TableRow } from '../shell/widgets.js';
import { registerView } from './index.js';

/** The rows of the repositories table. */
export function repoRows(state: TuiState, ctx: RenderCtx): TableRow[] {
    const repos = state.data.repos;
    if (repos === null) return [];
    return repos.names.map(name => {
        const status = repos.status[name];
        const deploy = repos.deploy[name];
        const lastDeploy = deploy === undefined ? '…'
            : deploy === null ? '—'
            : `${timeAgo(deploy.deployedAt, ctx.now)} ${ctx.g.sep} ${deploy.packageName}@${deploy.packageVersion} ${ctx.g.right} ${deploy.workspace}`;
        return {
            cells: {
                name,
                workspaces: status !== undefined ? String(status.workspaceCount) : '…',
                packages: status !== undefined ? String(status.packageCount) : '…',
                objects: status !== undefined ? formatInt(status.objectCount) : '…',
                lastDeploy,
            },
        };
    });
}

/** The header rows of the view (title + blank + table header). */
const CHROME_ROWS = 3;

registerListModel('repos', (state, layout) => ({
    count: state.data.repos?.names.length ?? 0,
    visible: Math.max(1, layout.bodyRows - CHROME_ROWS),
}));

registerView('repos', (state, ctx) => {
    if (state.view.kind !== 'repos') return { body: [], hints: { left: '', right: '' } };
    const width = ctx.layout.columns;
    const session = state.session;
    const rows = repoRows(state, ctx);
    const total = rows.length;
    const right = `${session?.identity !== null && session?.identity !== undefined ? `signed in as ${session.identity} ${ctx.g.sep} ` : ''}${total} of ${total}`;
    const body: Line[] = [
        sectionLine(`REPOSITORIES ${ctx.g.sep} ${session?.origin ?? session?.apiUrl ?? ''}`, right, width),
        blank(width),
    ];
    const visible = Math.max(1, ctx.layout.bodyRows - CHROME_ROWS);
    const { sel, top } = state.view.list;
    const table = renderTable(columnPlan('repos', breakpoint(state.size)), rows, sel, top, visible, width - 1, ctx.g);
    const header = table[0]!;
    const dataRows = table.slice(1);
    while (dataRows.length < visible) dataRows.push(blank(width - 1));
    body.push(header, ...withScrollbar(dataRows, width, total, visible, top, ctx.g));
    if (state.data.repos === null) body[3] = [{ text: '  loading repositories…', dim: true }];
    else if (total === 0) body[3] = [{ text: '  no repositories on this server', dim: true }];
    return {
        body,
        hints: { left: `${ctx.g.up}${ctx.g.down} move   ${ctx.g.enter} open   /repo <name>   /login`, right: 'q quit' },
    };
});

registerViewHooks('repos', {
    open: (state, controller) => {
        if (state.view.kind !== 'repos') return;
        const name = state.data.repos?.names[state.view.list.sel];
        const origin = state.session?.origin;
        if (name === undefined || origin === undefined || origin === null) return;
        void controller.deps.openTarget(`${origin}/repos/${name}`);
    },
});
