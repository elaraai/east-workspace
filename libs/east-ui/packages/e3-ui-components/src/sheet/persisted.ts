/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What a sheet persists under its `storageKey` (#857) — what the viewer
 * arranged: the folds, and where a bounded frame's scroll rests. Never the
 * ring, nor the lens's context and reveals (they follow the narrowing, which
 * the slice owns). The Plan's rule (#813).
 *
 * @packageDocumentation
 */

/** Where a bounded sheet's scroll rests (#857) — an item, never pixels. */
export interface SheetAnchor {
    /** The first body item showing under the header — its key among the virtual rows (`row:…`, `group:…`, `sub:…`). */
    key: string;
    /** How many px of it are scrolled past. */
    offset: number;
    /** Its body index — the clamped fallback when the key is gone. */
    index: number;
    /** On a paged sheet, the source element the item belongs to (a row; a line's or a sub row's group) — over an unloaded band, the element the band draws there — where a remount that has not loaded it yet looks for it. */
    element: number | null;
}

/** What a sheet persists under its `storageKey` (#857). */
export interface SheetPersisted {
    /** The tab the folds were left on (`null` = the whole sheet): they come back only when the sheet opens there. */
    view: string | null;
    /** The fold overrides there — a group's or a line's id → folded (a line's `false`: its sub rows open). */
    folds: Array<[string, boolean]>;
    /** Where a bounded frame's scroll rests, once the viewer has scrolled it. */
    anchor: SheetAnchor | null;
}

/** Nothing persisted yet. */
export const NOT_PERSISTED: SheetPersisted = { view: null, folds: [], anchor: null };

/**
 * The persisted state, read defensively: storage outlives versions and anyone
 * can write it, so each part is taken only in the shape this version writes
 * and dropped otherwise — never trusted into the reducer.
 *
 * @param stored - Whatever the storage holds under the sheet's key
 * @returns The parts this version can use
 */
export function persistedOf(stored: unknown): SheetPersisted {
    if (typeof stored !== "object" || stored === null) return NOT_PERSISTED;
    const { view, folds, anchor } = stored as Partial<Record<keyof SheetPersisted, unknown>>;
    const okView = view === null || typeof view === "string";
    const okFolds = Array.isArray(folds) && folds.every((e) =>
        Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && typeof e[1] === "boolean");
    const a = anchor as Partial<SheetAnchor> | null | undefined;
    const okAnchor = typeof a === "object" && a !== null && typeof a.key === "string"
        && Number.isFinite(a.offset) && Number.isInteger(a.index) && (a.index ?? -1) >= 0
        && (a.element === null || Number.isInteger(a.element));
    return {
        // Folds without the tab they belong to are nobody's.
        view: okView && okFolds ? view as string | null : null,
        folds: okView && okFolds ? folds as Array<[string, boolean]> : [],
        anchor: okAnchor ? a as SheetAnchor : null,
    };
}

/**
 * Whether the persisted folds are these — the same tab, the same overrides in
 * the same order. No folds are no folds on any tab, so a sheet no one has
 * folded never records the tab it opens on.
 *
 * @param p - What storage holds
 * @param view - The tab the folds are on
 * @param folds - The fold overrides
 * @returns Whether writing them would change nothing
 */
export function sameFolds(p: SheetPersisted, view: string | null, folds: ReadonlyMap<string, boolean>): boolean {
    if (p.folds.length === 0 && folds.size === 0) return true;
    if (p.view !== view || p.folds.length !== folds.size) return false;
    let i = 0;
    for (const [id, folded] of folds) {
        const e = p.folds[i++]!;
        if (e[0] !== id || e[1] !== folded) return false;
    }
    return true;
}

/** Two anchors are the same — `x` may be absent. */
export function sameAnchor(x: SheetAnchor | null, y: SheetAnchor): boolean {
    return x !== null && x.key === y.key && x.offset === y.offset && x.index === y.index && x.element === y.element;
}
