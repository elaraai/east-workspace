/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Whether a developer's debug flag is on: set by hand in the browser's console
 * (`localStorage['e3-paging-debug'] = '1'`), on unless it is unset or `off`.
 * Read by the name a developer types, never through the kept state
 * (`platform/kept.ts`), whose keys are scoped; and off wherever storage cannot
 * be reached.
 *
 * @param name - The flag's storage key
 * @returns Whether it is on
 */
export function debugFlag(name: string): boolean {
    try {
        if (typeof localStorage === "undefined") return false;
        const flag = localStorage.getItem(name);
        return flag !== null && flag !== "off";
    } catch {
        return false;
    }
}
