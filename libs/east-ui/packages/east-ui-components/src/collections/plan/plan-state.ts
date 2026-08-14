/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * THE Plan state machine (`Plan Spec.md` §6.1) — every piece of interaction
 * state in one pure reducer: no React, no DOM, no East values. The component
 * holds exactly one `useReducer(planReducer)` (plus the shared review
 * controller, which stays separate — it is the cross-component review
 * contract). Side effects are returned as data (`PlanEffect[]`) and run in one
 * place by the component; the reducer never performs them.
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
 *   drag-cancel → brush-cancel → focus-return (links / expand) →
 *   journey-close → drilled-collapse → deselect.
 * - **One row focus per canvas** (R1 links / R2 expand): invoking a second
 *   focus control returns the first; invoking the active row's own control
 *   returns it.
 * - **Drill is idempotent + in-place**: drilling the drilled row collapses
 *   it; drilling another moves the single `drilled` slot. A second click on
 *   the selected row *is* drill (`row.select` promotes).
 * - **Grain changes rows, never the axis**: `grain.set` clears `drilled` +
 *   `selected`, keeps `cursor` / `expanded` / the window.
 *
 * @packageDocumentation
 */

/** A row's stable key (never an index — the flat row array reorders). */
export type RowKey = string;

/** The §5 grains. */
export type PlanGrain = "group" | "resource" | "item";

/** All ephemeral UI state — one object, one reducer. */
export interface PlanUiState {
    /** The active grain (initial from the IR; the toolbar segment drives it after). */
    grain: PlanGrain;
    /** Collapsed group strips (keys present = COLLAPSED — rows carry the initial set). */
    collapsed: ReadonlySet<RowKey>;
    /** The in-place 96px drilled row, if any. */
    drilled: RowKey | null;
    /** The selected row, if any (`--brand-tint`, the one selection colour). */
    selected: RowKey | null;
    /** Chart rows toggled from spark to expanded. */
    chartsExpanded: ReadonlySet<RowKey>;
    /** The shared hover cursor (window fraction + containing bucket), if any. */
    cursor: { frac: number; bucket: number } | null;
    /** Whether a horizon-brush drag is in flight (esc-ladder rung). */
    brush: { active: true } | null;
    /** The row-scoped focus (R1 links / R2 expand) — at most one per canvas. */
    focus: { kind: "links" | "expand"; key: RowKey } | null;
    /** In-flight drag staging (P3 wires the DOM side). */
    drag: { over: string | null; valid: boolean } | null;
    /** The open K8 journey overlay's item key, if any. */
    journey: string | null;
}

/** Every interaction the surface can report. */
export type PlanEvent =
    | { t: "grain.set"; grain: PlanGrain }
    | { t: "group.toggle"; key: RowKey }
    | { t: "row.select"; key: RowKey }
    | { t: "row.drill"; key: RowKey }
    | { t: "chart.toggle"; key: RowKey }
    | { t: "cursor.move"; frac: number }
    | { t: "cursor.leave" }
    | { t: "brush.down" }
    | { t: "brush.preview"; min: Date; max: Date }
    | { t: "brush.commit"; min: Date; max: Date }
    | { t: "brush.clear" }
    | { t: "focus.links"; key: RowKey }
    | { t: "focus.expand"; key: RowKey }
    | { t: "focus.clear" }
    | { t: "resolution.set"; resolution: string }
    | { t: "drag.start" }
    | { t: "drag.over"; cell: string | null; valid: boolean }
    | { t: "drag.drop" }
    | { t: "drag.cancel" }
    | { t: "journey.open"; item: string }
    | { t: "journey.close" }
    | { t: "key"; key: "esc" | "enter" | "n" | "[" | "]" | "g" };

/** Side effects, returned as data — never performed in the reducer. */
export type PlanEffect =
    | { t: "slice.setRange"; min: Date; max: Date }
    | { t: "slice.clearRange" }
    | { t: "slice.setResolution"; resolution: string }
    | { t: "emit.select"; key: RowKey }
    | { t: "emit.drill"; key: RowKey }
    | { t: "emit.groupToggle"; key: RowKey; expanded: boolean }
    | { t: "emit.grainChange"; grain: PlanGrain }
    | { t: "scroll.toNow" }
    | { t: "pan"; buckets: -1 | 1 };

/** Static context the reducer consults (never stored in the state). */
export interface PlanCtx {
    /** The bucket index containing a window fraction (−1 outside). */
    bucketAtFrac(frac: number): number;
}

const GRAIN_CYCLE: PlanGrain[] = ["group", "resource", "item"];

/** The initial UI state for a decoded root. */
export function initialPlanState(
    grain: PlanGrain,
    collapsedKeys: Iterable<RowKey>,
): PlanUiState {
    return {
        grain,
        collapsed: new Set(collapsedKeys),
        drilled: null,
        selected: null,
        chartsExpanded: new Set(),
        cursor: null,
        brush: null,
        focus: null,
        drag: null,
        journey: null,
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
 * @param ctx - Scale-derived context (fraction → bucket)
 * @returns The next state plus the effects the component must run
 */
export function planReducer(
    s: PlanUiState,
    e: PlanEvent,
    ctx: PlanCtx,
): { state: PlanUiState; effects: PlanEffect[] } {
    switch (e.t) {
        case "grain.set": {
            if (e.grain === s.grain) return { state: s, effects: [] };
            // Grain changes rows, never the axis: drill + selection reset,
            // cursor / collapsed / window survive.
            return {
                state: { ...s, grain: e.grain, drilled: null, selected: null, focus: null },
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
            // Second click on the selected row IS drill (click selects, click
            // again drills); clicking the drilled row holds steady in place.
            if (s.selected === e.key) {
                if (s.drilled === e.key) return { state: s, effects: [] };
                return {
                    state: { ...s, drilled: e.key },
                    effects: [{ t: "emit.drill", key: e.key }],
                };
            }
            return {
                state: { ...s, selected: e.key },
                effects: [{ t: "emit.select", key: e.key }],
            };
        }
        case "row.drill": {
            // Idempotent + in-place: drilling the drilled row collapses it;
            // drilling another moves the single slot (the axis never moves).
            if (s.drilled === e.key) return { state: { ...s, drilled: null }, effects: [] };
            return {
                state: { ...s, drilled: e.key, selected: e.key },
                effects: [{ t: "emit.drill", key: e.key }],
            };
        }
        case "chart.toggle":
            return { state: { ...s, chartsExpanded: toggled(s.chartsExpanded, e.key) }, effects: [] };
        case "cursor.move": {
            const bucket = ctx.bucketAtFrac(e.frac);
            return { state: { ...s, cursor: { frac: e.frac, bucket } }, effects: [] };
        }
        case "cursor.leave":
            return { state: { ...s, cursor: null }, effects: [] };
        case "brush.down":
            return { state: { ...s, brush: { active: true } }, effects: [] };
        case "brush.preview":
            // Mid-drag live apply — the drag is still in flight (the brush
            // rung stays armed for esc), but the snapped draft window pans
            // the canvas as it changes. Same write channel as commit.
            return { state: s, effects: [{ t: "slice.setRange", min: e.min, max: e.max }] };
        case "brush.commit":
            // The machine never stores a window — the slice is the single
            // source of truth; the committed range goes straight through.
            return { state: { ...s, brush: null }, effects: [{ t: "slice.setRange", min: e.min, max: e.max }] };
        case "brush.clear":
            return { state: { ...s, brush: null }, effects: [{ t: "slice.clearRange" }] };
        case "focus.links":
            // Toggle on the focused row; switching rows (or from expand)
            // returns the first and focuses the new one — one per canvas.
            if (s.focus !== null && s.focus.kind === "links" && s.focus.key === e.key) {
                return { state: { ...s, focus: null }, effects: [] };
            }
            return { state: { ...s, focus: { kind: "links", key: e.key }, drilled: null }, effects: [] };
        case "focus.expand":
            if (s.focus !== null && s.focus.kind === "expand" && s.focus.key === e.key) {
                return { state: { ...s, focus: null }, effects: [] };
            }
            return { state: { ...s, focus: { kind: "expand", key: e.key }, drilled: null }, effects: [] };
        case "focus.clear":
            if (s.focus === null) return { state: s, effects: [] };
            return { state: { ...s, focus: null }, effects: [] };
        case "resolution.set":
            return { state: s, effects: [{ t: "slice.setResolution", resolution: e.resolution }] };
        case "drag.start":
            return { state: { ...s, drag: { over: null, valid: false } }, effects: [] };
        case "drag.over":
            if (s.drag === null) return { state: s, effects: [] };
            return { state: { ...s, drag: { over: e.cell, valid: e.valid } }, effects: [] };
        case "drag.drop":
            // An invalid drop is a no-op transition (the ⊘ stage held).
            return { state: { ...s, drag: null }, effects: [] };
        case "drag.cancel":
            return { state: { ...s, drag: null }, effects: [] };
        case "journey.open":
            return { state: { ...s, journey: e.item }, effects: [] };
        case "journey.close":
            return { state: { ...s, journey: null }, effects: [] };
        case "key":
            return keyEvent(s, e.key);
    }
}

/** The keyboard map (§11) — esc runs the strict one-rung ladder. */
function keyEvent(s: PlanUiState, key: "esc" | "enter" | "n" | "[" | "]" | "g"): { state: PlanUiState; effects: PlanEffect[] } {
    switch (key) {
        case "esc": {
            // Exactly one rung per press, strict precedence.
            if (s.drag !== null) return { state: { ...s, drag: null }, effects: [] };
            if (s.brush !== null) return { state: { ...s, brush: null }, effects: [] };
            if (s.focus !== null) return { state: { ...s, focus: null }, effects: [] };
            if (s.journey !== null) return { state: { ...s, journey: null }, effects: [] };
            if (s.drilled !== null) return { state: { ...s, drilled: null }, effects: [] };
            if (s.selected !== null) return { state: { ...s, selected: null }, effects: [] };
            return { state: s, effects: [] };
        }
        case "enter": {
            if (s.selected === null) return { state: s, effects: [] };
            if (s.drilled === s.selected) return { state: { ...s, drilled: null }, effects: [] };
            return {
                state: { ...s, drilled: s.selected },
                effects: [{ t: "emit.drill", key: s.selected }],
            };
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
                state: { ...s, grain: next, drilled: null, selected: null, focus: null },
                effects: [{ t: "emit.grainChange", grain: next }],
            };
        }
    }
}
