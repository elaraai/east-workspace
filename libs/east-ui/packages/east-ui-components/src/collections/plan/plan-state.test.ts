/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, expect } from 'vitest';
import { initialPlanState, planReducer, type PlanCtx, type PlanEvent, type PlanUiState } from './plan-state';

const ctx: PlanCtx = { bucketAtFrac: (f) => (f < 0 || f >= 1 ? -1 : Math.floor(f * 12)) };

function run(s: PlanUiState, ...events: PlanEvent[]): { state: PlanUiState; effects: ReturnType<typeof planReducer>["effects"] } {
    let state = s;
    let effects: ReturnType<typeof planReducer>["effects"] = [];
    for (const e of events) {
        const out = planReducer(state, e, ctx);
        state = out.state;
        effects = out.effects;
    }
    return { state, effects };
}

const init = () => initialPlanState("resource", []);

describe('planReducer', () => {
    describe('esc ladder (strict, one rung per press)', () => {
        it('runs drag → brush → focus → deselect, one rung at a time', () => {
            let s: PlanUiState = {
                ...init(),
                selected: "r1",
                brush: { active: true },
                focus: { kind: "links", key: "r1" },
                drag: { over: null, valid: false },
            };
            s = run(s, { t: "key", key: "esc" }).state;
            expect(s.drag).toBeNull();
            expect(s.brush).not.toBeNull();

            s = run(s, { t: "key", key: "esc" }).state;
            expect(s.brush).toBeNull();
            expect(s.focus).not.toBeNull();

            s = run(s, { t: "key", key: "esc" }).state;
            expect(s.focus).toBeNull();
            expect(s.selected).toBe("r1");

            s = run(s, { t: "key", key: "esc" }).state;
            expect(s.selected).toBeNull();

            const idle = planReducer(s, { t: "key", key: "esc" }, ctx);
            expect(idle.state).toBe(s);
            expect(idle.effects).toEqual([]);
        });
    });

    describe('selection', () => {
        it('first click selects and emits', () => {
            const { state, effects } = run(init(), { t: "row.select", key: "r1" });
            expect(state.selected).toBe("r1");
            expect(effects).toEqual([{ t: "emit.select", key: "r1" }]);
        });

        it('re-clicking the selected row is idempotent (no navigation)', () => {
            const before = run(init(), { t: "row.select", key: "r1" }).state;
            const { state, effects } = run(before, { t: "row.select", key: "r1" });
            expect(state).toBe(before);
            expect(effects).toEqual([]);
        });

        it('selecting another row moves the single selection', () => {
            const s1 = run(init(), { t: "row.select", key: "r1" }).state;
            const { state, effects } = run(s1, { t: "row.select", key: "r2" });
            expect(state.selected).toBe("r2");
            expect(effects).toEqual([{ t: "emit.select", key: "r2" }]);
        });
    });

    describe('grain', () => {
        it('grain.set clears selection, keeps cursor and collapsed', () => {
            let s = initialPlanState("resource", ["g1"]);
            s = run(s, { t: "cursor.move", frac: 0.5 }).state;
            s = run(s, { t: "row.select", key: "r1" }).state;
            const { state, effects } = run(s, { t: "grain.set", grain: "group" });
            expect(state.grain).toBe("group");
            expect(state.selected).toBeNull();
            expect(state.cursor).not.toBeNull();
            expect(state.collapsed.has("g1")).toBe(true);
            expect(effects).toEqual([{ t: "emit.grainChange", grain: "group" }]);
        });

        it('grain.set to the current grain is a no-op', () => {
            const s = init();
            const out = planReducer(s, { t: "grain.set", grain: "resource" }, ctx);
            expect(out.state).toBe(s);
            expect(out.effects).toEqual([]);
        });

        it('g cycles group → resource → group', () => {
            const g1 = run(init(), { t: "key", key: "g" });
            expect(g1.state.grain).toBe("group");
            const g2 = run(g1.state, { t: "key", key: "g" });
            expect(g2.state.grain).toBe("resource");
            expect(g2.effects).toEqual([{ t: "emit.grainChange", grain: "resource" }]);
        });
    });

    describe('groups', () => {
        it('toggle flips collapse and reports the new expansion', () => {
            const a = run(initialPlanState("resource", ["g1"]), { t: "group.toggle", key: "g1" });
            expect(a.state.collapsed.has("g1")).toBe(false);
            expect(a.effects).toEqual([{ t: "emit.groupToggle", key: "g1", expanded: true }]);
            const b = run(a.state, { t: "group.toggle", key: "g1" });
            expect(b.state.collapsed.has("g1")).toBe(true);
            expect(b.effects).toEqual([{ t: "emit.groupToggle", key: "g1", expanded: false }]);
        });
    });

    describe('brush / slice handoff', () => {
        it('commit emits slice.setRange and never stores a window', () => {
            const min = new Date("2026-07-06T00:00:00Z");
            const max = new Date("2026-08-03T00:00:00Z");
            const down = run(init(), { t: "brush.down" });
            expect(down.state.brush).toEqual({ active: true });
            const { state, effects } = run(down.state, { t: "brush.commit", min, max });
            expect(state.brush).toBeNull();
            expect(effects).toEqual([{ t: "slice.setRange", min, max }]);
        });

        it('preview emits slice.setRange while the drag stays in flight', () => {
            const min = new Date("2026-07-13T00:00:00Z");
            const max = new Date("2026-08-10T00:00:00Z");
            const down = run(init(), { t: "brush.down" });
            const { state, effects } = run(down.state, { t: "brush.preview", min, max });
            // The live-applied step writes through the same channel as a
            // commit, but the brush rung stays armed (esc still cancels it).
            expect(state.brush).toEqual({ active: true });
            expect(effects).toEqual([{ t: "slice.setRange", min, max }]);
        });

        it('clear emits slice.clearRange', () => {
            const { state, effects } = run(init(), { t: "brush.clear" });
            expect(state.brush).toBeNull();
            expect(effects).toEqual([{ t: "slice.clearRange" }]);
        });

        it('resolution.set is a pure slice write', () => {
            const { state, effects } = run(init(), { t: "resolution.set", resolution: "day" });
            expect(state).toEqual(init());
            expect(effects).toEqual([{ t: "slice.setResolution", resolution: "day" }]);
        });
    });

    describe('row focus (R1 links / R2 expand) — one per canvas', () => {
        it('links focus toggles on the same row and switches rows in one step', () => {
            const on = run(init(), { t: "focus.links", key: "m214" });
            expect(on.state.focus).toEqual({ kind: "links", key: "m214" });
            const moved = run(on.state, { t: "focus.links", key: "m208" });
            expect(moved.state.focus).toEqual({ kind: "links", key: "m208" });
            const off = run(moved.state, { t: "focus.links", key: "m208" });
            expect(off.state.focus).toBeNull();
        });

        it('invoking the other control returns the first (one active per canvas)', () => {
            const links = run(init(), { t: "focus.links", key: "m214" });
            const expand = run(links.state, { t: "focus.expand", key: "l4m13" });
            expect(expand.state.focus).toEqual({ kind: "expand", key: "l4m13" });
        });

        it('focus.expand focuses the row; focus.clear returns', () => {
            const focused = run(init(), { t: "focus.expand", key: "r1" });
            expect(focused.state.focus).toEqual({ kind: "expand", key: "r1" });
            expect(run(focused.state, { t: "focus.clear" }).state.focus).toBeNull();
        });

        it('grain.set returns any active focus (grain changes rows)', () => {
            const focused = run(init(), { t: "focus.links", key: "m214" }).state;
            const { state } = run(focused, { t: "grain.set", grain: "group" });
            expect(state.focus).toBeNull();
        });
    });

    describe('cursor', () => {
        it('move stores the fraction + containing bucket; leave clears', () => {
            const moved = run(init(), { t: "cursor.move", frac: 0.51 });
            expect(moved.state.cursor).toEqual({ frac: 0.51, bucket: 6 });
            const left = run(moved.state, { t: "cursor.leave" });
            expect(left.state.cursor).toBeNull();
        });
    });

    describe('charts', () => {
        it('toggle flips spark ↔ expanded per row', () => {
            const a = run(init(), { t: "chart.toggle", key: "cov" });
            expect(a.state.chartsExpanded.has("cov")).toBe(true);
            const b = run(a.state, { t: "chart.toggle", key: "cov" });
            expect(b.state.chartsExpanded.has("cov")).toBe(false);
        });
    });

    describe('drag staging', () => {
        it('over updates staging; drop and cancel clear it', () => {
            let s = run(init(), { t: "drag.start" }).state;
            s = run(s, { t: "drag.over", cell: "r1|w2", valid: true }).state;
            expect(s.drag).toEqual({ over: "r1|w2", valid: true });
            expect(run(s, { t: "drag.drop" }).state.drag).toBeNull();
            const cancelled = run(run(init(), { t: "drag.start" }).state, { t: "drag.cancel" });
            expect(cancelled.state.drag).toBeNull();
        });

        it('drag.over without a live drag is ignored', () => {
            const s = init();
            const out = planReducer(s, { t: "drag.over", cell: "x", valid: true }, ctx);
            expect(out.state).toBe(s);
        });
    });

    describe('keyboard pans', () => {
        it('n scrolls to now, [ and ] pan one bucket', () => {
            expect(run(init(), { t: "key", key: "n" }).effects).toEqual([{ t: "scroll.toNow" }]);
            expect(run(init(), { t: "key", key: "[" }).effects).toEqual([{ t: "pan", buckets: -1 }]);
            expect(run(init(), { t: "key", key: "]" }).effects).toEqual([{ t: "pan", buckets: 1 }]);
        });
    });
});
