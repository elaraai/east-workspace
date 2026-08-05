/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Debug logging for the paged dataset preview (#497).
 *
 * On by default while the feature stabilizes; silence with
 * `localStorage['e3-paging-debug'] = 'off'` (or set any other value to
 * force it on). Everything is prefixed `[e3-paging]` for easy filtering.
 */
export function pagingDebug(...args: unknown[]): void {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('e3-paging-debug') === 'off') return;
    } catch {
        // No localStorage (tests/SSR) — log anyway.
    }
    console.info('[e3-paging]', ...args);
}
