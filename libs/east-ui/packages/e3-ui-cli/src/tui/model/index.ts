/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * View models — the pure selectors every view renders from and the
 * controller navigates with. A view model is `{ rows, visible }` at
 * minimum: the rows the primary list has and how many fit, so `list/move`
 * is driven from one place.
 *
 * @packageDocumentation
 */

import { shellLayout, type ShellLayout } from '../render/layout.js';
import type { TuiState } from '../state/actions.js';

/** The rows of the current view's primary list and how many are visible. */
export interface ListModel {
    count: number;
    visible: number;
}

/**
 * The shell layout for the state (the commit bar shows while editing, the
 * completion list while it has items).
 *
 * @param state - The store state
 * @returns The layout
 */
export function layoutOf(state: TuiState): ShellLayout {
    return shellLayout(state.size, {
        commit: state.edit !== null && state.edit.ops.length > 0,
        completion: state.command.completion?.items.length ?? 0,
    });
}

/** Extension point: per-view list models registered by the view modules. */
const listModels = new Map<string, (state: TuiState, layout: ShellLayout) => ListModel>();

/**
 * Registers a view's list model (called by each view model module on load).
 *
 * @param kind - The view kind
 * @param model - The selector
 */
export function registerListModel(kind: string, model: (state: TuiState, layout: ShellLayout) => ListModel): void {
    listModels.set(kind, model);
}

/**
 * The current view's primary list model.
 *
 * @param state - The store state
 * @returns The rows and visible count (0 / 0 for views without a list)
 */
export function listModel(state: TuiState): ListModel {
    const model = listModels.get(state.view.kind);
    if (model === undefined) return { count: 0, visible: 0 };
    return model(state, layoutOf(state));
}
