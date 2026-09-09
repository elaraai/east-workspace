/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lens's and the view tabs' transitions (B§8 — `Sheet Spec.md` §5 rows
 * 16–17): the context switch and the band controls over the lens state; a
 * tab switch that persists the leaving tab's context and reveals and writes
 * the target's narrowing into the slice; `+ TAB` snapshotting the current
 * narrowing; ⏎ updating and esc reverting a dirty tab; close, rename and
 * reorder; the search box's keys. Pure functions over the machine state —
 * the views and the slice's narrowing arrive with the context, and every
 * write leaves as an effect (`emit.views`, `slice.write`).
 *
 * @packageDocumentation
 */

import { none as noneValue } from "@elaraai/east";
import { revealStep, viewName } from "./lens.js";
import {
    EMPTY_LENS, clamp, same,
    type LensContext, type LensState, type SheetEffect, type SheetEvent, type SheetMachineCtx, type SheetUiState, type Transition,
} from "./sheet-types.js";
import type { SheetViewValue } from "./values.js";

const noop = (s: SheetUiState): Transition => ({ state: s, effects: [] });

/** The reveals as the wire carries them — sorted positions. */
function wireReveals(reveals: ReadonlySet<number>): bigint[] {
    return [...reveals].sort((a, b) => a - b).map((p) => BigInt(p));
}

/** Whether two wire reveal lists are the same. */
function sameReveals(a: readonly bigint[], b: readonly bigint[]): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** A view's lens — its context clamped to the switch's stops, its reveals as positions, no presses yet. */
function lensOf(view: SheetViewValue): LensState {
    const n = Number(view.context);
    const context: LensContext = n >= 3 ? 3 : n >= 1 ? 1 : 0;
    return { context, reveals: new Set(view.reveals.map((p) => Number(p))), steps: new Map() };
}

/** The active view, if any. */
function activeView(s: SheetUiState, ctx: SheetMachineCtx): SheetViewValue | undefined {
    return s.tabs.active === null ? undefined : (ctx.views ?? []).find((v) => v.id === s.tabs.active);
}

/**
 * The views with the active tab's lens persisted — its context and reveals;
 * an unsaved narrowing is discarded on leave (B§8). The same array comes back
 * when nothing changed.
 */
export function persistLens(s: SheetUiState, views: readonly SheetViewValue[]): readonly SheetViewValue[] {
    const a = s.tabs.active;
    if (a === null) return views;
    let changed = false;
    const context = BigInt(s.lens.context);
    const reveals = wireReveals(s.lens.reveals);
    const out = views.map((v) => {
        if (v.id !== a || (v.context === context && sameReveals(v.reveals, reveals))) return v;
        changed = true;
        return { ...v, context, reveals };
    });
    return changed ? out : views;
}

// ── The lens ──────────────────────────────────────────────────────────────

/** The context switch — reveals and presses reset. */
export function setContext(s: SheetUiState, context: LensContext): SheetUiState {
    if (s.lens.context === context && s.lens.reveals.size === 0) return s;
    return { ...s, lens: { context, reveals: new Set(), steps: new Map() } };
}

/** A band control pressed — the run opens a little further (1 · 3 · 10 · all). */
export function bandReveal(s: SheetUiState, e: Extract<SheetEvent, { t: "band.reveal" }>): SheetUiState {
    const { positions, steps } = revealStep(s.lens.steps, e.key, e.from, e.to, e.where);
    if (positions.length === 0) return s;
    const reveals = new Set(s.lens.reveals);
    for (const p of positions) reveals.add(p);
    return { ...s, lens: { ...s.lens, reveals, steps } };
}

/** The narrowing changed underneath: reveals and presses reset, the range and the proposal pick drop, the ring returns to the top. */
export function narrowed(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const sel = clamp({ r: 0, c: s.sel.c }, ctx);
    const effects: SheetEffect[] = [];
    if (!same(sel, s.sel)) effects.push({ t: "emit.select", r: sel.r, c: sel.c });
    const lens = s.lens.reveals.size === 0 && s.lens.steps.size === 0 ? s.lens : { ...s.lens, reveals: new Set<number>(), steps: new Map<string, number>() };
    return { state: { ...s, lens, sel, selEnd: null, gsel: null, armed: null }, effects };
}

// ── The tabs ──────────────────────────────────────────────────────────────

/**
 * Pick a tab (`null` = the whole sheet): the leaving tab keeps its context and
 * reveals, the target's narrowing goes into the slice, its lens comes back,
 * and the ring returns to the top.
 *
 * @param s - The state
 * @param ctx - The context (its `views`, `emptyNarrowing`)
 * @param id - The view to open, or `null`
 * @param persist - Whether the leaving tab's lens is written back (the initial open passes `false`)
 * @returns The transition
 */
export function switchTab(s: SheetUiState, ctx: SheetMachineCtx, id: string | null, persist = true): Transition {
    const views = ctx.views ?? [];
    const kept = persist ? persistLens(s, views) : views;
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
            lens: view !== undefined ? lensOf(view) : EMPTY_LENS,
            sel, selEnd: null, gsel: null, armed: null,
        },
        effects,
    };
}

/** `+ TAB` — the current narrowing, context and reveals become a view, named from the query. */
export function createTab(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const narrowing = ctx.narrowing;
    if (narrowing === undefined) return noop(s);
    const kept = persistLens(s, ctx.views ?? []);
    const query = narrowing.search.type === "some" ? (narrowing.search.value as string) : "";
    let seq = s.tabs.seq;
    let id = `view-${seq}`;
    while (kept.some((v) => v.id === id)) { seq += 1; id = `view-${seq}`; }
    const name = viewName(query, seq);
    const view: SheetViewValue = { id, name, narrowing, context: BigInt(s.lens.context), reveals: wireReveals(s.lens.reveals) };
    const msg = query.trim() !== ""
        ? `Saved tab "${name}" — a live view: rows that match join it as the sheet changes`
        : `Saved tab "${name}" — no filter; type a search and ⏎ to scope it`;
    return {
        state: { ...s, tabs: { ...s.tabs, active: id, seq: seq + 1, renaming: null, renameVal: "" }, msg },
        effects: [{ t: "emit.views", views: [...kept, view] }],
    };
}

/** × or a middle click — closing the active tab falls back to the whole sheet. */
export function closeTab(s: SheetUiState, ctx: SheetMachineCtx, id: string): Transition {
    const views = ctx.views ?? [];
    const t = views.find((v) => v.id === id);
    if (t === undefined) return noop(s);
    const rest = views.filter((v) => v.id !== id);
    if (s.tabs.active !== id) return { state: { ...s, msg: `Closed "${t.name}"` }, effects: [{ t: "emit.views", views: rest }] };
    const effects: SheetEffect[] = [{ t: "emit.views", views: rest }];
    if (ctx.emptyNarrowing !== undefined) effects.push({ t: "slice.write", state: ctx.emptyNarrowing });
    return {
        state: { ...s, tabs: { ...s.tabs, active: null, renaming: null, renameVal: "" }, lens: EMPTY_LENS, selEnd: null, gsel: null, msg: `Closed "${t.name}" — back to the whole sheet` },
        effects,
    };
}

/** ⏎ with a dirty tab: the tab now saves the current narrowing (and the lens as it stands). */
export function updateTab(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const t = activeView(s, ctx);
    const narrowing = ctx.narrowing;
    if (t === undefined || narrowing === undefined) return noop(s);
    const views = (ctx.views ?? []).map((v) => (v.id === t.id ? { ...v, narrowing, context: BigInt(s.lens.context), reveals: wireReveals(s.lens.reveals) } : v));
    return { state: { ...s, msg: `Tab "${t.name}" now saves this search` }, effects: [{ t: "emit.views", views }] };
}

/** esc with a dirty tab: the slice returns to the tab's saved narrowing, the lens to its saved context and reveals. */
export function revertTab(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const t = activeView(s, ctx);
    if (t === undefined) return noop(s);
    return { state: { ...s, lens: lensOf(t), msg: "Reverted to the tab's saved search" }, effects: [{ t: "slice.write", state: t.narrowing }] };
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
        if (ctx.narrowing !== undefined && ctx.narrowing.search.type === "some") {
            effects.push({ t: "slice.write", state: { ...ctx.narrowing, search: noneValue } });
        }
        effects.push({ t: "focus.sheet" });
        return { state: s, effects };
    }
    return null;
}
