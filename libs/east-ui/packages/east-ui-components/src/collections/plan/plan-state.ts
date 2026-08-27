/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * THE Plan state machine (`Plan Spec.md` §6.1) — every piece of interaction
 * state in one pure reducer: no React, no DOM, no East values. The component
 * holds exactly one `useReducer(planStoreReducer)` (plus the shared review
 * controller, which stays separate — it is the cross-component review
 * contract); {@link planReducer} answers one event, and the store around it
 * carries the effect batch plus the declared-collapse bookkeeping that lets a
 * host data commit RECONCILE the UI state instead of resetting it (#610).
 * Side effects are returned as data (`PlanEffect[]`) and run in one place by
 * the component's post-commit drain; no reducer ever performs them.
 *
 * The slice is the single source of truth for window / resolution / filters —
 * the machine holds only ephemeral UI state and emits `slice.*` effects for
 * the component to write through the bind handle. Brush pixel geometry lives
 * in the shared `slice/brush-strip.tsx` gesture machine; the reducer tracks
 * only whether a brush drag is in flight (the esc-ladder rung) and receives
 * the committed window as instants.
 *
 * Non-negotiable transition rules (unit-tested as a table in
 * `plan-state.test.ts`):
 *
 * - **Esc ladder**, strict precedence, exactly one rung per press:
 *   brush-cancel → focus-return (links / expand) → deselect. (Drag-cancel
 *   belongs to the shared drag layer, which owns the drag lifecycle — the
 *   machine's own drag staging was deleted as dead code, #569.)
 * - **Windows are instants** (#631): a committed brush window and the
 *   `slice.setRange` effect carry `PlanInstantValue`s on the axis's arm;
 *   the component writes them as the slice arm the axis speaks.
 * - **One row focus per canvas** (R1 links / R2 expand): invoking a second
 *   focus control returns the first; invoking the active row's own control
 *   returns it.
 * - **Grain changes rows, never the axis**: `grain.set` clears `selected`,
 *   keeps `expanded` / the window.
 *
 * The hover CURSOR (hairline + ruler chip) is NOT machine state: it is
 * display-only chrome written straight to the DOM by the canvas's cursor
 * controller (#609) — routing a pointermove through a reducer re-rendered
 * every mounted row once per event.
 *
 * @packageDocumentation
 */

import type { PlanInstantValue } from "./instant.js";

/** A row's stable key (never an index — the flat row array reorders). */
export type RowKey = string;

/** The §5 grains. */
export type PlanGrain = "group" | "resource";

/** All ephemeral UI state — one object, one reducer. */
export interface PlanUiState {
    /** The active grain (initial from the IR; the toolbar segment drives it after). */
    grain: PlanGrain;
    /** Collapsed group strips (keys present = COLLAPSED — rows carry the initial set). */
    collapsed: ReadonlySet<RowKey>;
    /** The selected row, if any (`--brand-tint`, the one selection colour). */
    selected: RowKey | null;
    /** Chart rows toggled from spark to expanded. */
    chartsExpanded: ReadonlySet<RowKey>;
    /** Whether a horizon-brush drag is in flight (esc-ladder rung). */
    brush: { active: true } | null;
    /** The row-scoped focus (R1 links / R2 expand) — at most one per canvas. */
    focus: { kind: "links" | "expand"; key: RowKey } | null;
}

/** Every interaction the surface can report. */
export type PlanEvent =
    | { t: "grain.set"; grain: PlanGrain }
    | { t: "group.toggle"; key: RowKey }
    | { t: "row.select"; key: RowKey }
    | { t: "chart.toggle"; key: RowKey }
    | { t: "brush.down" }
    | { t: "brush.commit"; min: PlanInstantValue; max: PlanInstantValue }
    | { t: "brush.clear" }
    | { t: "brush.up" }
    | { t: "focus.links"; key: RowKey }
    | { t: "focus.expand"; key: RowKey }
    | { t: "focus.clear" }
    | { t: "resolution.set"; resolution: string }
    /** A window pan of N whole periods — the narrow layout's two-finger
     *  horizontal drag (§10); the `[` / `]` keys are the one-period case. */
    | { t: "pan"; buckets: number }
    | { t: "key"; key: "esc" | "n" | "[" | "]" | "g" };

/** Side effects, returned as data — never performed in the reducer. */
export type PlanEffect =
    | { t: "slice.setRange"; min: PlanInstantValue; max: PlanInstantValue }
    | { t: "slice.clearRange" }
    | { t: "slice.setResolution"; resolution: string }
    | { t: "emit.select"; key: RowKey }
    | { t: "emit.groupToggle"; key: RowKey; expanded: boolean }
    | { t: "emit.grainChange"; grain: PlanGrain }
    | { t: "scroll.toNow" }
    | { t: "pan"; buckets: number };

const GRAIN_CYCLE: PlanGrain[] = ["group", "resource"];

/** The initial UI state for a decoded root. */
export function initialPlanState(
    grain: PlanGrain,
    collapsedKeys: Iterable<RowKey>,
): PlanUiState {
    return {
        grain,
        collapsed: new Set(collapsedKeys),
        selected: null,
        chartsExpanded: new Set(),
        brush: null,
        focus: null,
    };
}

function toggled(set: ReadonlySet<RowKey>, key: RowKey): ReadonlySet<RowKey> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
}

/**
 * The pure transition function: `(state, event, ctx) → { state, effects }`.
 *
 * @param s - The current UI state
 * @param e - The interaction event
 * @returns The next state plus the effects the component must run
 */
export function planReducer(
    s: PlanUiState,
    e: PlanEvent,
): { state: PlanUiState; effects: PlanEffect[] } {
    switch (e.t) {
        case "grain.set": {
            if (e.grain === s.grain) return { state: s, effects: [] };
            // Grain changes rows, never the axis: selection resets,
            // collapsed / window survive.
            return {
                state: { ...s, grain: e.grain, selected: null, focus: null },
                effects: [{ t: "emit.grainChange", grain: e.grain }],
            };
        }
        case "group.toggle": {
            const collapsed = toggled(s.collapsed, e.key);
            return {
                state: { ...s, collapsed },
                effects: [{ t: "emit.groupToggle", key: e.key, expanded: !collapsed.has(e.key) }],
            };
        }
        case "row.select": {
            // Selection is idempotent — re-clicking the selected row holds.
            if (s.selected === e.key) return { state: s, effects: [] };
            return {
                state: { ...s, selected: e.key },
                effects: [{ t: "emit.select", key: e.key }],
            };
        }
        case "chart.toggle":
            return { state: { ...s, chartsExpanded: toggled(s.chartsExpanded, e.key) }, effects: [] };
        case "brush.down":
            return { state: { ...s, brush: { active: true } }, effects: [] };
        // NO brush.preview event: a mid-drag preview changes no machine state,
        // and routing it through the store bumped `fx`/`fxSeq` — a full canvas
        // render per pointer step with the OLD window, before the drain's
        // write rendered it again with the new one (#609). The HorizonBrush
        // applies previews directly to the slice, coalesced per animation
        // frame; only the state-bearing gesture events (down / commit /
        // clear / up — the esc rung) belong to the machine.
        case "brush.commit":
            // The machine never stores a window — the slice is the single
            // source of truth; the committed range goes straight through.
            return { state: { ...s, brush: null }, effects: [{ t: "slice.setRange", min: e.min, max: e.max }] };
        case "brush.clear":
            return { state: { ...s, brush: null }, effects: [{ t: "slice.clearRange" }] };
        case "brush.up":
            // The gesture ended, however it ended — INCLUDING the
            // sub-threshold release that emits neither a commit nor a clear.
            // Disarm the esc rung; never a slice write (#615). The rung
            // exists only while a pointer is actually down on the strip.
            if (s.brush === null) return { state: s, effects: [] };
            return { state: { ...s, brush: null }, effects: [] };
        case "focus.links":
            // Toggle on the focused row; switching rows (or from expand)
            // returns the first and focuses the new one — one per canvas.
            if (s.focus !== null && s.focus.kind === "links" && s.focus.key === e.key) {
                return { state: { ...s, focus: null }, effects: [] };
            }
            return { state: { ...s, focus: { kind: "links", key: e.key } }, effects: [] };
        case "focus.expand":
            if (s.focus !== null && s.focus.kind === "expand" && s.focus.key === e.key) {
                return { state: { ...s, focus: null }, effects: [] };
            }
            return { state: { ...s, focus: { kind: "expand", key: e.key } }, effects: [] };
        case "focus.clear":
            if (s.focus === null) return { state: s, effects: [] };
            return { state: { ...s, focus: null }, effects: [] };
        case "resolution.set":
            return { state: s, effects: [{ t: "slice.setResolution", resolution: e.resolution }] };
        case "pan":
            // A pure slice write, like the keys — a zero pan is identity so a
            // gesture that never crossed a period edge commits nothing.
            if (e.buckets === 0) return { state: s, effects: [] };
            return { state: s, effects: [{ t: "pan", buckets: e.buckets }] };
        case "key":
            return keyEvent(s, e.key);
    }
}

/** The keyboard map (§11) — esc runs the strict one-rung ladder. */
function keyEvent(s: PlanUiState, key: "esc" | "n" | "[" | "]" | "g"): { state: PlanUiState; effects: PlanEffect[] } {
    switch (key) {
        case "esc": {
            // Exactly one rung per press, strict precedence. (A drag in
            // flight is the shared drag LAYER's escape, not the machine's.)
            if (s.brush !== null) return { state: { ...s, brush: null }, effects: [] };
            if (s.focus !== null) return { state: { ...s, focus: null }, effects: [] };
            if (s.selected !== null) return { state: { ...s, selected: null }, effects: [] };
            return { state: s, effects: [] };
        }
        case "n":
            return { state: s, effects: [{ t: "scroll.toNow" }] };
        case "[":
            return { state: s, effects: [{ t: "pan", buckets: -1 }] };
        case "]":
            return { state: s, effects: [{ t: "pan", buckets: 1 }] };
        case "g": {
            const next = GRAIN_CYCLE[(GRAIN_CYCLE.indexOf(s.grain) + 1) % GRAIN_CYCLE.length]!;
            return {
                state: { ...s, grain: next, selected: null, focus: null },
                effects: [{ t: "emit.grainChange", grain: next }],
            };
        }
    }
}

// ── The component-facing store (#610) ──────────────────────────────────────
//
// `planReducer` answers one event. The STORE reducer is what the component's
// single `useReducer` runs: it adds the effect batch — drained by the
// component exactly once per `fxSeq` bump, post-commit — and the bookkeeping
// that lets a host data commit RECONCILE the ephemeral UI state instead of
// resetting it. An Approve click, a committed drop, any Reactive write the
// series read is "the data changed"; open groups, expanded charts, selection
// and focus must all survive it, dropping only the entries whose rows are
// actually gone.

/** The one `useReducer` store: UI state + effect batch + collapse seeding. */
export interface PlanStore {
    /** The ephemeral UI state. */
    ui: PlanUiState;
    /**
     * Declared-collapse keys already applied once. A declared key seeds
     * `collapsed` the FIRST time its row appears and never again, so a group
     * the user has since opened stays open across value changes and paged
     * window landings alike. A key that vanishes is pruned; if it later
     * returns it is a NEW row and re-seeds.
     */
    seeded: ReadonlySet<RowKey>;
    /** The declared initial grain, as of the last reconcile — a CHANGED
     *  declaration is adopted (it re-derives the rows, like `grain.set`);
     *  an unchanged one leaves the user's grain alone. */
    declaredGrain: PlanGrain;
    /**
     * The latest effectful event's batch — REPLACED per such event, never
     * appended. The component drains it in a layout effect, which commits
     * before the next event handler can dispatch, so at most one undrained
     * batch ever exists.
     */
    fx: readonly PlanEffect[];
    /** Bumps when an event yields effects; the component's drain gates on it. */
    fxSeq: number;
}

/** Everything the store reducer handles. */
export type PlanAction =
    /** An interaction event — the machine transition plus its effects. */
    | { t: "event"; e: PlanEvent }
    /**
     * The host's data changed (a new decoded value): drop per-row state whose
     * rows vanished, seed never-seen declared collapse, keep everything else.
     */
    | {
        t: "reconcile";
        /** Every row key the new value holds. */
        alive: ReadonlySet<RowKey>;
        /** The new value's declared-collapsed group keys. */
        declaredCollapsed: ReadonlySet<RowKey>;
        /** The new value's declared initial grain. */
        declaredGrain: PlanGrain;
    }
    /**
     * Rows arrived WITHOUT a data change (a paged window landed): seed
     * never-seen declared collapse and drop nothing — eviction must not
     * erase state the user still owns.
     */
    | { t: "seed"; declaredCollapsed: ReadonlySet<RowKey> };

/** The initial store for a decoded root (declared collapse counts as seeded). */
export function initialPlanStore(grain: PlanGrain, collapsedKeys: Iterable<RowKey>): PlanStore {
    const seeded = new Set(collapsedKeys);
    return {
        ui: initialPlanState(grain, seeded),
        seeded,
        declaredGrain: grain,
        fx: [],
        fxSeq: 0,
    };
}

/** `set` minus the keys `alive` lacks — the same identity when nothing drops. */
function pruned(set: ReadonlySet<RowKey>, alive: ReadonlySet<RowKey>): ReadonlySet<RowKey> {
    let changed = false;
    const next = new Set<RowKey>();
    for (const key of set) {
        if (alive.has(key)) next.add(key);
        else changed = true;
    }
    return changed ? next : set;
}

/** `set` plus `keys` — the same identity when every key is already present. */
function grown(set: ReadonlySet<RowKey>, keys: readonly RowKey[]): ReadonlySet<RowKey> {
    const missing = keys.filter((key) => !set.has(key));
    if (missing.length === 0) return set;
    const next = new Set(set);
    for (const key of missing) next.add(key);
    return next;
}

/**
 * The store transition — pure, like everything here: StrictMode double-invokes
 * reducers, so the effect batch rides the RETURNED store and is run by the
 * component's seq-gated drain, never from inside a reducer.
 *
 * @param store - The current store
 * @param a - The action
 * @returns The next store — `store` itself when nothing changed, so React
 *   skips the re-render
 */
export function planStoreReducer(store: PlanStore, a: PlanAction): PlanStore {
    switch (a.t) {
        case "event": {
            const { state, effects } = planReducer(store.ui, a.e);
            if (state === store.ui && effects.length === 0) return store;
            return effects.length === 0
                ? { ...store, ui: state }
                : { ...store, ui: state, fx: effects, fxSeq: store.fxSeq + 1 };
        }
        case "reconcile": {
            const fresh = [...a.declaredCollapsed].filter((key) => !store.seeded.has(key));
            const collapsed = grown(pruned(store.ui.collapsed, a.alive), fresh);
            const chartsExpanded = pruned(store.ui.chartsExpanded, a.alive);
            const grainChanged = a.declaredGrain !== store.declaredGrain;
            // Selection / focus follow their row out; a changed declared grain
            // clears both (grain changes rows — the `grain.set` rule), with no
            // `emit.grainChange`: the HOST changed it, echoing it back loops.
            const selected = !grainChanged && store.ui.selected !== null && a.alive.has(store.ui.selected)
                ? store.ui.selected : null;
            const focus = !grainChanged && store.ui.focus !== null && a.alive.has(store.ui.focus.key)
                ? store.ui.focus : null;
            const grain = grainChanged ? a.declaredGrain : store.ui.grain;
            const seeded = grown(pruned(store.seeded, a.alive), fresh);
            const uiSame = collapsed === store.ui.collapsed && chartsExpanded === store.ui.chartsExpanded
                && selected === store.ui.selected && focus === store.ui.focus && grain === store.ui.grain;
            if (uiSame && seeded === store.seeded && !grainChanged) return store;
            return {
                ...store,
                seeded,
                declaredGrain: a.declaredGrain,
                ui: uiSame ? store.ui : { ...store.ui, collapsed, chartsExpanded, selected, focus, grain },
            };
        }
        case "seed": {
            const fresh = [...a.declaredCollapsed].filter((key) => !store.seeded.has(key));
            if (fresh.length === 0) return store;
            return {
                ...store,
                seeded: grown(store.seeded, fresh),
                ui: { ...store.ui, collapsed: grown(store.ui.collapsed, fresh) },
            };
        }
    }
}
