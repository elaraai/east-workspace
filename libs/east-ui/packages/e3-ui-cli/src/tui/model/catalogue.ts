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

import type { EastTypeValue } from '@elaraai/east';
import type { Catalogue, CatalogueItem } from '../input/completion.js';
import type { Glyphs } from '../render/glyphs.js';
import { formatSize } from '../render/text.js';
import type { TuiState } from '../state/actions.js';
import { compactType } from './types.js';
import { datasetStatusCell, statusText, taskStatusCell } from './status.js';

/**
 * The entry of a dataset in the workspace's dataset list (type / size), by
 * dotted path. The recursive listing shows a task's subtree as one leaf at
 * `.tasks.<name>` carrying the output's type / hash / size, while the status
 * names the output `.tasks.<name>.output` — both spellings resolve.
 */
export function datasetEntries(state: TuiState, ws: string): Map<string, { type: string; size: number | null; hash: string | null }> {
    const raw = new Map<string, { type: EastTypeValue; size: number | null; hash: string | null }>();
    for (const entry of state.data.datasets[ws] ?? []) {
        if (entry.type !== 'dataset') continue;
        raw.set(`.${entry.value.path.replace(/^\./, '')}`, {
            type: entry.value.type,
            size: entry.value.size.type === 'some' ? Number(entry.value.size.value) : null,
            hash: entry.value.hash.type === 'some' ? entry.value.hash.value : null,
        });
    }
    for (const task of state.data.status[ws]?.result.tasks ?? []) {
        if (raw.has(task.output)) continue;
        const leaf = raw.get(task.output.replace(/\.output$/, ''));
        if (leaf !== undefined) raw.set(task.output, leaf);
    }
    const uiTasks = new Set((state.data.taskList[ws] ?? []).filter(t => t.kind.type === 'some' && t.kind.value === 'ui').map(t => `.tasks.${t.name}.output`));
    const out = new Map<string, { type: string; size: number | null; hash: string | null }>();
    for (const [path, entry] of raw) out.set(path, { type: compactType(entry.type, uiTasks.has(path)), size: entry.size, hash: entry.hash });
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
