/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Schematic's history names its records by (#1388) — pure and
 * React-free: a kind's own record by its slot, and its details record by
 * {@link detailsKey}; what the editing (`editing.ts`), the banners and the
 * inspector's Issues (`issues.ts`, #1391) read a record's kind from.
 *
 * @packageDocumentation
 */

/**
 * What a change names a kind's details record by: never a kind's slot, which
 * holds no NUL.
 *
 * @param slot - The kind's slot
 * @returns The details record's key in the history
 */
export function detailsKey(slot: string): string {
    return `${slot}\u0000details`;
}

/**
 * The slot of the kind a record of the history is: the kind's own, or the kind
 * whose details it is ({@link detailsKey}).
 *
 * @param key - The record's key in the history
 * @returns The kind's slot
 */
export function recordSlot(key: string): string {
    const at = key.indexOf("\u0000");
    return at < 0 ? key : key.slice(0, at);
}
