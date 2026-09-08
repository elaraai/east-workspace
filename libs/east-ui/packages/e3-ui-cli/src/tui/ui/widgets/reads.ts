/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Reads tab of a `ui` task — its data manifest (`decodeManifest` from
 * `@elaraai/e3-ui/internal`): the dataset paths it reads (each `⏎` opens
 * as a dataset), the paths it reads by window, the package functions it
 * calls and the records it binds.
 *
 * @packageDocumentation
 */

import { decodeManifest, type DataManifest } from '@elaraai/e3-ui/internal';
import type { TaskDetails } from '@elaraai/e3-api-client';
import { dottedPath } from '../../api.js';
import type { Controller } from '../../controller.js';
import type { Glyphs } from '../../render/glyphs.js';
import type { TuiState } from '../../state/actions.js';
import { b, d, t, type Line } from '../lines.js';
import { withScrollbar } from '../shell/widgets.js';

/** One row of the Reads tab. */
export interface ReadRow {
    kind: 'path' | 'page' | 'function' | 'record';
    text: string;
    /** The dataset path a `path` / `page` row opens. */
    path: string | null;
}

/**
 * The manifest of a task's details, if it carries one.
 *
 * @param details - The task details
 * @returns The manifest, or null (no metadata, or not a manifest)
 */
export function manifestOf(details: TaskDetails | undefined): DataManifest | null {
    if (details === undefined || details.metadata.type !== 'some') return null;
    try {
        return decodeManifest(details.metadata.value);
    } catch {
        return null;
    }
}

/** `manifest: 3 reads · 1 function` for the title line. */
export function manifestSummary(manifest: DataManifest, g: Glyphs): string {
    const parts = [`${manifest.paths.length} read${manifest.paths.length === 1 ? '' : 's'}`];
    if (manifest.pages.length > 0) parts.push(`${manifest.pages.length} paged`);
    if (manifest.functions.length > 0) parts.push(`${manifest.functions.length} function${manifest.functions.length === 1 ? '' : 's'}`);
    if (manifest.records.length > 0) parts.push(`${manifest.records.length} record${manifest.records.length === 1 ? '' : 's'}`);
    return `manifest: ${parts.join(` ${g.sep} `)}`;
}

/** The rows of the Reads tab (sections separated by their headings). */
export function readRows(manifest: DataManifest): ReadRow[] {
    const rows: ReadRow[] = [];
    for (const p of manifest.paths) rows.push({ kind: 'path', text: dottedPath(p), path: dottedPath(p) });
    for (const p of manifest.pages) rows.push({ kind: 'page', text: dottedPath(p), path: dottedPath(p) });
    for (const f of manifest.functions) rows.push({ kind: 'function', text: f, path: null });
    for (const r of manifest.records) rows.push({ kind: 'record', text: r, path: null });
    return rows;
}

/** The section heading of a row kind. */
const HEADINGS: Record<ReadRow['kind'], string> = { path: 'READS', page: 'READS BY WINDOW', function: 'FUNCTIONS', record: 'RECORDS' };

/**
 * Renders the Reads tab: headed sections, the selection bar on the
 * selected row, a scrollbar when they overflow.
 *
 * @param manifest - The manifest (null when the task has none)
 * @param sel - The selected row
 * @param top - The first visible line
 * @param visible - Visible lines
 * @param width - The row width including the scrollbar column
 * @param g - The glyph set
 * @returns The lines
 */
export function renderReads(manifest: DataManifest | null, sel: number, top: number, visible: number, width: number, g: Glyphs): Line[] {
    if (manifest === null) {
        const out: Line[] = [[t(' '), d('this task carries no data manifest — a ui() task declares its reads through Data.bind / Func.bind / Record.bind')]];
        while (out.length < visible) out.push([t(' '.repeat(width))]);
        return out;
    }
    const rows = readRows(manifest);
    const lines: Line[] = [];
    let lastKind: ReadRow['kind'] | null = null;
    rows.forEach((row, i) => {
        if (row.kind !== lastKind) {
            if (lastKind !== null) lines.push([t(' ')]);
            lines.push([t(' '), b(HEADINGS[row.kind])]);
            lastKind = row.kind;
        }
        const selected = i === sel;
        const opens = row.path !== null;
        lines.push([t(' '), selected ? b(g.sel, 'brand') : t(' '), selected ? b(row.text) : t(row.text), d(opens ? `   ${g.enter} open` : '')]);
    });
    if (rows.length === 0) lines.push([t(' '), d('the manifest is empty')]);
    const clampedTop = Math.max(0, Math.min(top, Math.max(0, lines.length - visible)));
    const window = lines.slice(clampedTop, clampedTop + visible);
    while (window.length < visible) window.push([t(' '.repeat(width - 1))]);
    return withScrollbar(window, width, lines.length, visible, clampedTop, g);
}

/**
 * `⏎` on a Reads row opens the dataset.
 *
 * @param state - The store state
 * @param controller - The controller
 */
export function openRead(state: TuiState, controller: Controller): void {
    const v = state.view;
    if (v.kind !== 'task' || v.tab !== 'reads') return;
    const manifest = manifestOf(state.data.taskDetails[v.ws]?.[v.task]);
    const row = manifest === null ? undefined : readRows(manifest)[v.reads.sel];
    if (row === undefined) return;
    if (row.path === null) {
        controller.toast(`${row.kind === 'function' ? 'a package function' : 'a record'} has no view here`, 'warn');
        return;
    }
    void controller.execute(`/dataset ${row.path}`);
}
