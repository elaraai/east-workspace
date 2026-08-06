/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Opt-in debug logging for the paged dataset preview (#497).
 *
 * Silent by default. Enable with `localStorage['e3-paging-debug'] = '1'`
 * (any value except 'off') to trace page fetches, resets, and short-page
 * clamps in the console — everything is prefixed `[e3-paging]`.
 */
export function pagingDebug(...args: unknown[]): void {
    try {
        if (typeof localStorage === 'undefined') return;
        const flag = localStorage.getItem('e3-paging-debug');
        if (flag === null || flag === 'off') return;
    } catch {
        return;
    }
    console.info('[e3-paging]', ...args);
}
