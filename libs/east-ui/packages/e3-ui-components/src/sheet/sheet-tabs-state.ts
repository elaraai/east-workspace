/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The view tabs' transitions (B§8 — `Sheet Spec.md` §5 rows 16–17): a tab
 * switch that persists the leaving tab's folds and writes the target's
 * narrowing into the slice; `+ TAB` snapshotting the current narrowing; ⏎
 * updating and esc reverting a dirty tab; close, rename and reorder; the
 * search box's keys; and a narrowing that changed underneath the sheet. Pure
 * functions over the machine state — the views and the slice's narrowing
 * arrive with the context, and every write leaves as an effect (`emit.views`,
 * `slice.write`).
 *
 * @packageDocumentation
 */

import { clearSearch, narrowingQuery } from "./view-state.js";
import { viewName } from "./lens.js";
import { NO_FOLDS, clamp, same, type SheetEffect, type SheetMachineCtx, type SheetUiState, type Transition } from "./sheet-types.js";
import type { SheetSavedView } from "./values.js";

const noop = (s: SheetUiState): Transition => ({ state: s, effects: [] });

/** The fold overrides as the wire carries them (#740). */
function wireFolds(folds: ReadonlyMap<string, boolean>): Map<string, boolean> {
    return new Map([...folds].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Whether two fold maps are the same. */
function sameFolds(a: ReadonlyMap<string, boolean>, b: ReadonlyMap<string, boolean>): boolean {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
}

/** A view's folds, as the sheet opens it with them. */
function foldsOf(view: SheetSavedView): ReadonlyMap<string, boolean> {
    return view.folds.size === 0 ? NO_FOLDS : new Map(view.folds);
}

/** The active view, if any. */
function activeView(s: SheetUiState, ctx: SheetMachineCtx): SheetSavedView | undefined {
    return s.tabs.active === null ? undefined : (ctx.views ?? []).find((v) => v.id === s.tabs.active);
}

/**
 * The views with the active tab's folds persisted; an unsaved narrowing is
 * discarded on leave (B§8). The same array comes back when nothing changed.
 *
 * @param s - The state
 * @param views - The views
 * @returns The views, the active one's folds as they stand
 */
export function persistFolds(s: SheetUiState, views: readonly SheetSavedView[]): readonly SheetSavedView[] {
    const a = s.tabs.active;
    if (a === null) return views;
    let changed = false;
    const out = views.map((v) => {
        if (v.id !== a || sameFolds(v.folds, s.folds)) return v;
        changed = true;
        return { ...v, folds: wireFolds(s.folds) };
    });
    return changed ? out : views;
}

/** The narrowing changed underneath: the range and the proposal pick drop, and the ring returns to the top. */
export function narrowed(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const sel = clamp({ r: 0, c: s.sel.c }, ctx);
    const effects: SheetEffect[] = [];
    if (!same(sel, s.sel)) effects.push({ t: "emit.select", r: sel.r, c: sel.c });
    return { state: { ...s, sel, selEnd: null, gsel: null, armed: null }, effects };
}

// ── The tabs ──────────────────────────────────────────────────────────────

/**
 * Pick a tab (`null` = the whole sheet): the leaving tab keeps its folds, the
 * target's narrowing goes into the slice, its folds come back, and the ring
 * returns to the top.
 *
 * @param s - The state
 * @param ctx - The context (its `views`, `emptyNarrowing`)
 * @param id - The view to open, or `null`
 * @param persist - Whether the leaving tab's folds are written back (the initial open passes `false`)
 * @returns The transition
 */
export function switchTab(s: SheetUiState, ctx: SheetMachineCtx, id: string | null, persist = true): Transition {
    const views = ctx.views ?? [];
    const kept = persist ? persistFolds(s, views) : views;
    const view = id === null ? undefined : kept.find((v) => v.id === id);
    if (id !== null && view === undefined) return noop(s);
    const effects: SheetEffect[] = [];
    if (kept !== views) effects.push({ t: "emit.views", views: kept });
    const narrowing = view !== undefined ? view.narrowing : ctx.emptyNarrowing;
    if (narrowing !== undefined) effects.push({ t: "slice.write", state: narrowing });
    const sel = clamp({ r: 0, c: s.sel.c }, ctx);
    if (!same(sel, s.sel)) effects.push({ t: "emit.select", r: sel.r, c: sel.c });
    effects.push({ t: "focus.sheet" });
    return {
        state: {
            ...s,
            tabs: { ...s.tabs, active: id, renaming: null, renameVal: "" },
            folds: view !== undefined ? foldsOf(view) : NO_FOLDS,
            sel, selEnd: null, gsel: null, armed: null,
        },
        effects,
    };
}

/** `+ TAB` — the current narrowing and folds become a view, named from the query. */
export function createTab(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const narrowing = ctx.narrowing;
    if (narrowing === undefined) return noop(s);
    const kept = persistFolds(s, ctx.views ?? []);
    const query = narrowingQuery(narrowing);
    let seq = s.tabs.seq;
    let id = `view-${seq}`;
    while (kept.some((v) => v.id === id)) { seq += 1; id = `view-${seq}`; }
    const name = viewName(query, seq, ctx.viewName);
    const view: SheetSavedView = { id, name, narrowing, folds: wireFolds(s.folds) };
    return {
        state: { ...s, tabs: { ...s.tabs, active: id, seq: seq + 1, renaming: null, renameVal: "" }, msg: { id: "tabSaved", name, query: query.trim() !== "" } },
        effects: [{ t: "emit.views", views: [...kept, view] }],
    };
}

/** × or a middle click — closing the active tab falls back to the whole sheet. */
export function closeTab(s: SheetUiState, ctx: SheetMachineCtx, id: string): Transition {
    const views = ctx.views ?? [];
    const t = views.find((v) => v.id === id);
    if (t === undefined) return noop(s);
    const rest = views.filter((v) => v.id !== id);
    if (s.tabs.active !== id) return { state: { ...s, msg: { id: "tabClosed", name: t.name, active: false } }, effects: [{ t: "emit.views", views: rest }] };
    const effects: SheetEffect[] = [{ t: "emit.views", views: rest }];
    if (ctx.emptyNarrowing !== undefined) effects.push({ t: "slice.write", state: ctx.emptyNarrowing });
    return {
        state: { ...s, tabs: { ...s.tabs, active: null, renaming: null, renameVal: "" }, folds: NO_FOLDS, selEnd: null, gsel: null, msg: { id: "tabClosed", name: t.name, active: true } },
        effects,
    };
}

/** ⏎ with a dirty tab: the tab now saves the current narrowing (and the folds as they stand). */
export function updateTab(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const t = activeView(s, ctx);
    const narrowing = ctx.narrowing;
    if (t === undefined || narrowing === undefined) return noop(s);
    const views = (ctx.views ?? []).map((v) => (v.id === t.id ? { ...v, narrowing, folds: wireFolds(s.folds) } : v));
    return { state: { ...s, msg: { id: "tabUpdated", name: t.name } }, effects: [{ t: "emit.views", views }] };
}

/** esc with a dirty tab: the slice returns to the tab's saved narrowing, the folds to its saved ones. */
export function revertTab(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const t = activeView(s, ctx);
    if (t === undefined) return noop(s);
    return { state: { ...s, folds: foldsOf(t), msg: { id: "tabReverted" } }, effects: [{ t: "slice.write", state: t.narrowing }] };
}

/** A double click on a tab opens its name for editing. */
export function renameStart(s: SheetUiState, ctx: SheetMachineCtx, id: string): SheetUiState {
    const t = (ctx.views ?? []).find((v) => v.id === id);
    if (t === undefined) return s;
    return { ...s, tabs: { ...s.tabs, renaming: id, renameVal: t.name } };
}

/** The rename buffer. */
export function renameChange(s: SheetUiState, val: string): SheetUiState {
    if (s.tabs.renaming === null) return s;
    return { ...s, tabs: { ...s.tabs, renameVal: val } };
}

/** ⏎ or a blur commits the rename — an empty name keeps the old one. */
export function renameCommit(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const id = s.tabs.renaming;
    if (id === null) return noop(s);
    const name = s.tabs.renameVal.trim();
    const state: SheetUiState = { ...s, tabs: { ...s.tabs, renaming: null, renameVal: "" } };
    const views = ctx.views ?? [];
    const t = views.find((v) => v.id === id);
    if (t === undefined || name === "" || name === t.name) return { state, effects: [] };
    return { state, effects: [{ t: "emit.views", views: views.map((v) => (v.id === id ? { ...v, name } : v)) }] };
}

/** esc drops the rename. */
export function renameCancel(s: SheetUiState): SheetUiState {
    if (s.tabs.renaming === null) return s;
    return { ...s, tabs: { ...s.tabs, renaming: null, renameVal: "" } };
}

/** A tab dropped before the tab at `to`. */
export function reorderTab(s: SheetUiState, ctx: SheetMachineCtx, id: string, to: number): Transition {
    const views = [...(ctx.views ?? [])];
    const fi = views.findIndex((v) => v.id === id);
    if (fi < 0) return noop(s);
    const moved = views.splice(fi, 1)[0]!;
    const at = Math.max(0, Math.min(fi < to ? to - 1 : to, views.length));
    views.splice(at, 0, moved);
    if (at === fi) return noop(s);
    return { state: s, effects: [{ t: "emit.views", views }] };
}

/** The tab rungs of the esc ladder: a dirty tab reverts, a clean tab returns to the sheet; `null` = no tab to act on. */
export function escTabs(s: SheetUiState, ctx: SheetMachineCtx): Transition | null {
    if (s.tabs.active === null) return null;
    return ctx.dirty === true ? revertTab(s, ctx) : switchTab(s, ctx, null);
}

/**
 * A key in the rail's search box (B§8): ⏎ updates a dirty tab; esc reverts a
 * dirty tab, returns a clean tab to the sheet, or clears the search on the
 * whole sheet. Both hand the focus back to the sheet. `null` = not claimed.
 */
export function searchKey(s: SheetUiState, ctx: SheetMachineCtx, key: string): Transition | null {
    if (key === "Enter") {
        const t = s.tabs.active !== null && ctx.dirty === true ? updateTab(s, ctx) : noop(s);
        return { state: t.state, effects: [...t.effects, { t: "focus.sheet" }] };
    }
    if (key === "Escape") {
        const rung = escTabs(s, ctx);
        if (rung !== null) return { state: rung.state, effects: [...rung.effects, { t: "focus.sheet" }] };
        const effects: SheetEffect[] = [];
        if (ctx.narrowing !== undefined && narrowingQuery(ctx.narrowing) !== "") {
            effects.push({ t: "slice.write", state: clearSearch(ctx.narrowing) });
        }
        effects.push({ t: "focus.sheet" });
        return { state: s, effects };
    }
    return null;
}
