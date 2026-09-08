/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The completion catalogue — every workspace, task, input and dataset of
 * the open repository with its status / type / size columns, built from
 * the current workspace status + the workspace list.
 *
 * @packageDocumentation
 */

import type { Catalogue, CatalogueItem } from '../input/completion.js';
import type { Glyphs } from '../render/glyphs.js';
import { formatSize } from '../render/text.js';
import type { TuiState } from '../state/actions.js';
import { compactType } from './types.js';
import { datasetStatusCell, statusText, taskStatusCell } from './status.js';

/** The entry of a dataset in the workspace's dataset list (type / size), by dotted path. */
export function datasetEntries(state: TuiState, ws: string): Map<string, { type: string; size: number | null; hash: string | null }> {
    const out = new Map<string, { type: string; size: number | null; hash: string | null }>();
    const uiTasks = new Set((state.data.taskList[ws] ?? []).filter(t => t.kind.type === 'some' && t.kind.value === 'ui').map(t => `.tasks.${t.name}.output`));
    for (const entry of state.data.datasets[ws] ?? []) {
        if (entry.type !== 'dataset') continue;
        const path = `.${entry.value.path.replace(/^\./, '')}`;
        out.set(path, {
            type: compactType(entry.value.type, uiTasks.has(path)),
            size: entry.value.size.type === 'some' ? Number(entry.value.size.value) : null,
            hash: entry.value.hash.type === 'some' ? entry.value.hash.value : null,
        });
    }
    return out;
}

/**
 * Builds the catalogue.
 *
 * @param state - The store state
 * @param g - The glyph set
 * @param tags - Variant tags offered by `/tag` on the selected row
 * @returns The catalogue
 */
export function buildCatalogue(state: TuiState, g: Glyphs, tags?: string[]): Catalogue {
    const items: CatalogueItem[] = [];
    for (const w of state.data.workspaces ?? []) {
        const pkg = w.packageName.type === 'some' ? `${w.packageName.value}${w.packageVersion.type === 'some' ? `@${w.packageVersion.value}` : ''}` : '';
        items.push({ kind: 'workspace', name: w.name, workspace: null, status: w.deployed ? `${g.dot} DEPLOYED` : `${g.empty} EMPTY`, type: pkg, detail: '' });
    }
    for (const [ws, { result }] of Object.entries(state.data.status)) {
        const entries = datasetEntries(state, ws);
        for (const task of result.tasks) {
            const entry = entries.get(task.output);
            items.push({
                kind: 'task',
                name: task.name,
                workspace: ws,
                status: statusText(taskStatusCell(task.status, g)),
                type: entry?.type ?? '',
                detail: entry?.size != null ? formatSize(entry.size) : '—',
            });
        }
        for (const dataset of result.datasets) {
            const entry = entries.get(dataset.path);
            const status = statusText(datasetStatusCell(dataset.status.type, g));
            if (!dataset.isTaskOutput && dataset.path.startsWith('.inputs.')) {
                items.push({
                    kind: 'input',
                    name: dataset.path.slice('.inputs.'.length),
                    workspace: ws,
                    status,
                    type: entry?.type ?? '',
                    detail: entry?.size != null ? formatSize(entry.size) : '—',
                });
            }
            items.push({
                kind: 'dataset',
                name: dataset.path,
                workspace: ws,
                status,
                type: '',
                detail: entry?.size != null ? formatSize(entry.size) : '—',
            });
        }
    }
    for (const name of state.data.repos?.names ?? []) {
        const status = state.data.repos?.status[name];
        items.push({ kind: 'repo', name, workspace: null, status: status !== undefined ? `${status.workspaceCount} workspaces` : '', type: '', detail: '' });
    }
    return { items, tags };
}
