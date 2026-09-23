/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, expect } from 'vitest';
import { variant } from "@elaraai/east";
import {
    initialPlanState, planReducer, initialPlanStore, planStoreReducer,
    type PlanAction, type PlanEvent, type PlanUiState, type PlanStore,
} from './plan-state';

function run(s: PlanUiState, ...events: PlanEvent[]): { state: PlanUiState; effects: ReturnType<typeof planReducer>["effects"] } {
    let state = s;
    let effects: ReturnType<typeof planReducer>["effects"] = [];
    for (const e of events) {
        const out = planReducer(state, e);
        state = out.state;
        effects = out.effects;
    }
    return { state, effects };
}

const init = () => initialPlanState("resource", []);

describe('planReducer', () => {
    describe('esc ladder (strict, one rung per press)', () => {
        it('runs brush → focus → deselect, one rung at a time', () => {
            // Drag-cancel is the shared drag LAYER's escape; the machine's own
            // drag staging was dead code and is gone (#569).
            let s: PlanUiState = {
                ...init(),
                selected: "r1",
                brush: { active: true },
                focus: { kind: "links", key: "r1" },
            };
            s = run(s, { t: "key", key: "esc" }).state;
            expect(s.brush).toBeNull();
            expect(s.focus).not.toBeNull();

            s = run(s, { t: "key", key: "esc" }).state;
            expect(s.focus).toBeNull();
            expect(s.selected).toBe("r1");

            s = run(s, { t: "key", key: "esc" }).state;
            expect(s.selected).toBeNull();

            const idle = planReducer(s, { t: "key", key: "esc" });
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
        it('grain.set clears selection, keeps collapsed', () => {
            let s = initialPlanState("resource", ["g1"]);
            s = run(s, { t: "row.select", key: "r1" }).state;
            const { state, effects } = run(s, { t: "grain.set", grain: "group" });
            expect(state.grain).toBe("group");
            expect(state.selected).toBeNull();
            expect(state.collapsed.has("g1")).toBe(true);
            expect(effects).toEqual([{ t: "emit.grainChange", grain: "group" }]);
        });

        it('grain.set to the current grain is a no-op', () => {
            const s = init();
            const out = planReducer(s, { t: "grain.set", grain: "resource" });
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
            // Windows are INSTANTS on the axis's arm (#631) — the component
            // writes them as the slice arm the axis speaks.
            const min = variant("time", new Date("2026-07-06T00:00:00Z"));
            const max = variant("time", new Date("2026-08-03T00:00:00Z"));
            const down = run(init(), { t: "brush.down" });
            expect(down.state.brush).toEqual({ active: true });
            const { state, effects } = run(down.state, { t: "brush.commit", min: min as never, max: max as never });
            expect(state.brush).toBeNull();
            expect(effects).toEqual([{ t: "slice.setRange", min, max }]);
        });

        // NO brush.preview event: mid-drag previews write the slice DIRECTLY
        // from the HorizonBrush, frame-coalesced — a store round-trip cost a
        // full canvas render per pointer step before the drain's write (#609).

        it('clear emits slice.clearRange', () => {
            const { state, effects } = run(init(), { t: "brush.clear" });
            expect(state.brush).toBeNull();
            expect(effects).toEqual([{ t: "slice.clearRange" }]);
        });

        it('brush.up disarms the esc rung with NO slice write; idle it is identity (#615)', () => {
            // The sub-threshold release emits neither commit nor clear — the
            // rung must still settle, or the next Escape is silently eaten.
            const down = run(init(), { t: "brush.down" });
            const { state, effects } = run(down.state, { t: "brush.up" });
            expect(state.brush).toBeNull();
            expect(effects).toEqual([]);
            const idle = planReducer(state, { t: "brush.up" });
            expect(idle.state).toBe(state);
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

    // NO cursor state: the hover hairline + ruler chip are DOM chrome written
    // by the canvas's cursor controller (#609) — a pointermove renders nothing.

    describe('charts', () => {
        it('toggle flips spark ↔ expanded per row', () => {
            const a = run(init(), { t: "chart.toggle", key: "cov" });
            expect(a.state.chartsExpanded.has("cov")).toBe(true);
            const b = run(a.state, { t: "chart.toggle", key: "cov" });
            expect(b.state.chartsExpanded.has("cov")).toBe(false);
        });
    });

    describe('keyboard pans', () => {
        it('n scrolls to now, [ and ] pan one bucket', () => {
            expect(run(init(), { t: "key", key: "n" }).effects).toEqual([{ t: "scroll.toNow" }]);
            expect(run(init(), { t: "key", key: "[" }).effects).toEqual([{ t: "pan", buckets: -1 }]);
            expect(run(init(), { t: "key", key: "]" }).effects).toEqual([{ t: "pan", buckets: 1 }]);
        });

        it('a pan event is a pure slice write of N periods; zero is identity (#570)', () => {
            const s = init();
            const out = run(s, { t: "pan", buckets: 3 });
            expect(out.state).toBe(s);
            expect(out.effects).toEqual([{ t: "pan", buckets: 3 }]);
            const idle = planReducer(s, { t: "pan", buckets: 0 });
            expect(idle.state).toBe(s);
            expect(idle.effects).toEqual([]);
        });
    });
});

describe('planStoreReducer (#610)', () => {
    const store0 = () => initialPlanStore("resource", ["g1"]);
    const step = (s: PlanStore, e: PlanEvent) => planStoreReducer(s, { t: "event", e });
    const event = (s: PlanStore, e: PlanEvent) => step(s, e).store;
    const act = (s: PlanStore, a: PlanAction) => planStoreReducer(s, a).store;
    const keys = (...k: string[]) => new Set(k);

    describe('event actions', () => {
        it('a no-op event returns the store identity and no effects', () => {
            const s = store0();
            const out = step(s, { t: "key", key: "esc" });
            expect(out.store).toBe(s);
            expect(out.effects).toEqual([]);
        });

        it('an effectless transition changes ui and returns no effects', () => {
            const s = store0();
            const out = step(s, { t: "chart.toggle", key: "c1" });
            expect(out.store.ui.chartsExpanded.has("c1")).toBe(true);
            expect(out.effects).toEqual([]);
        });

        it('an effectful event returns its effects with the transition — the store identity when ui is unchanged (#815)', () => {
            const s = store0();
            const selected = step(s, { t: "row.select", key: "r1" });
            expect(selected.store.ui.selected).toBe("r1");
            expect(selected.effects).toEqual([{ t: "emit.select", key: "r1" }]);
            // resolution.set transitions to the SAME ui but still delivers its
            // slice write — as data the caller runs, never a batch held in the
            // store for a later drain to find (where a second effectful event
            // in one handler replaced the first).
            const res = step(selected.store, { t: "resolution.set", resolution: "day" });
            expect(res.store).toBe(selected.store);
            expect(res.effects).toEqual([{ t: "slice.setResolution", resolution: "day" }]);
        });
    });

    describe('reconcile (a host data commit)', () => {
        it('keeps every entry whose row survives — the whole store by identity', () => {
            let s = store0();
            s = event(s, { t: "row.select", key: "r1" });
            s = event(s, { t: "chart.toggle", key: "c1" });
            s = event(s, { t: "focus.expand", key: "r1" });
            const out = act(s, {
                t: "reconcile", complete: true, alive: keys("g1", "r1", "c1"),
                declaredCollapsed: keys("g1"), declaredGrain: "resource",
            });
            expect(out).toBe(s);
            expect(out.ui.selected).toBe("r1");
            expect(out.ui.focus).toEqual({ kind: "expand", key: "r1" });
            expect(out.ui.chartsExpanded.has("c1")).toBe(true);
            expect(out.ui.collapsed.has("g1")).toBe(true);
        });

        it('drops selection / focus / collapse / chart entries for vanished rows', () => {
            let s = store0();
            s = event(s, { t: "row.select", key: "r1" });
            s = event(s, { t: "chart.toggle", key: "c1" });
            s = event(s, { t: "focus.links", key: "r2" });
            const out = act(s, {
                t: "reconcile", complete: true, alive: keys("r3"),
                declaredCollapsed: keys(), declaredGrain: "resource",
            });
            expect(out.ui.selected).toBeNull();
            expect(out.ui.focus).toBeNull();
            expect(out.ui.chartsExpanded.size).toBe(0);
            expect(out.ui.collapsed.size).toBe(0);
            // The positional state has no row to lose.
            expect(out.ui.grain).toBe("resource");
        });

        it('a declared-collapsed group the user opened is NOT re-collapsed', () => {
            let s = store0();                                          // g1 declared + seeded
            s = event(s, { t: "group.toggle", key: "g1" });            // user opens it
            expect(s.ui.collapsed.has("g1")).toBe(false);
            const out = act(s, {
                t: "reconcile", complete: true, alive: keys("g1", "r1"),
                declaredCollapsed: keys("g1"), declaredGrain: "resource",
            });
            expect(out.ui.collapsed.has("g1")).toBe(false);
        });

        it('a NEVER-SEEN declared key seeds collapsed once', () => {
            const s = store0();
            const out = act(s, {
                t: "reconcile", complete: true, alive: keys("g1", "g2"),
                declaredCollapsed: keys("g1", "g2"), declaredGrain: "resource",
            });
            expect(out.ui.collapsed.has("g2")).toBe(true);
            // ... and only once: opening it survives the next reconcile.
            const opened = event(out, { t: "group.toggle", key: "g2" });
            const again = act(opened, {
                t: "reconcile", complete: true, alive: keys("g1", "g2"),
                declaredCollapsed: keys("g1", "g2"), declaredGrain: "resource",
            });
            expect(again.ui.collapsed.has("g2")).toBe(false);
        });

        it('a vanished-then-returning declared key is a NEW row and re-seeds', () => {
            let s = store0();
            s = event(s, { t: "group.toggle", key: "g1" });            // user opens g1
            const gone = act(s, {
                t: "reconcile", complete: true, alive: keys("r1"),
                declaredCollapsed: keys(), declaredGrain: "resource",
            });
            const back = act(gone, {
                t: "reconcile", complete: true, alive: keys("g1", "r1"),
                declaredCollapsed: keys("g1"), declaredGrain: "resource",
            });
            expect(back.ui.collapsed.has("g1")).toBe(true);
        });

        it('a changed declared grain adopts and clears selection + focus', () => {
            let s = store0();
            s = event(s, { t: "row.select", key: "r1" });
            s = event(s, { t: "focus.links", key: "r1" });
            const out = planStoreReducer(s, {
                t: "reconcile", complete: true, alive: keys("r1"),
                declaredCollapsed: keys(), declaredGrain: "group",
            });
            expect(out.store.ui.grain).toBe("group");
            expect(out.store.ui.selected).toBeNull();
            expect(out.store.ui.focus).toBeNull();
            // No emit.grainChange: the HOST changed it; echoing it back loops.
            expect(out.effects).toEqual([]);
        });
    });

    describe('seed (rows arrived without a data change)', () => {
        it('applies never-seen declared collapse and drops nothing', () => {
            let s = store0();
            s = event(s, { t: "row.select", key: "r1" });
            const out = act(s, { t: "seed", declaredCollapsed: keys("g1", "late") });
            expect(out.ui.collapsed.has("late")).toBe(true);
            expect(out.ui.collapsed.has("g1")).toBe(true);
            expect(out.ui.selected).toBe("r1");
        });

        it('is the store identity when every declared key is seeded — and an opened group stays open', () => {
            let s = store0();
            expect(act(s, { t: "seed", declaredCollapsed: keys("g1") })).toBe(s);
            s = event(s, { t: "group.toggle", key: "g1" });            // user opens it
            const out = act(s, { t: "seed", declaredCollapsed: keys("g1") });
            expect(out).toBe(s);
            expect(out.ui.collapsed.has("g1")).toBe(false);
        });
    });

    describe('the user\'s toggles outlive the component (#813)', () => {
        it('a toggle records the user\'s word on that row; nothing else does', () => {
            let s = store0();
            s = event(s, { t: "group.toggle", key: "g1" });            // opens the declared-collapsed g1
            s = event(s, { t: "group.toggle", key: "g2" });            // collapses the undeclared g2
            s = event(s, { t: "row.select", key: "r1" });
            s = event(s, { t: "chart.toggle", key: "c1" });
            expect([...s.overrides]).toEqual([["g1", false], ["g2", true]]);
        });

        it('a restored store keeps each toggle; only rows never touched take the declaration', () => {
            const s = initialPlanStore("resource", ["g1", "g3"], {
                collapse: [["g1", false], ["g2", true]],
                charts: ["c1"],
            });
            expect(s.ui.collapsed.has("g1")).toBe(false);           // declared, but the user opened it
            expect(s.ui.collapsed.has("g2")).toBe(true);            // the user collapsed it
            expect(s.ui.collapsed.has("g3")).toBe(true);            // declared, untouched
            expect(s.ui.chartsExpanded.has("c1")).toBe(true);
            expect(s.ui.selected).toBeNull();                       // selection is never restored
        });

        it('a row that lands later keeps its restored toggle — seeded or reconciled', () => {
            const s = initialPlanStore("resource", [], { collapse: [["late", false]], charts: [] });
            const seeded = act(s, { t: "seed", declaredCollapsed: keys("late", "other") });
            expect(seeded.ui.collapsed.has("late")).toBe(false);
            expect(seeded.ui.collapsed.has("other")).toBe(true);
            const reconciled = act(s, {
                t: "reconcile", complete: true, alive: keys("late"),
                declaredCollapsed: keys("late"), declaredGrain: "resource",
            });
            expect(reconciled.ui.collapsed.has("late")).toBe(false);
        });

        it('an INCOMPLETE key set (a paged source\'s resident rows) prunes nothing', () => {
            let s = initialPlanStore("resource", [], { collapse: [["g9", true]], charts: ["c9"] });
            s = event(s, { t: "row.select", key: "r9" });
            // Nothing resident yet — the window holding g9, c9 and r9 has not landed.
            const out = act(s, {
                t: "reconcile", complete: false, alive: keys(),
                declaredCollapsed: keys(), declaredGrain: "resource",
            });
            expect(out).toBe(s);
            // A complete one drops what is gone — overrides included.
            const pruned = act(s, {
                t: "reconcile", complete: true, alive: keys(),
                declaredCollapsed: keys(), declaredGrain: "resource",
            });
            expect(pruned.overrides.size).toBe(0);
            expect(pruned.ui.collapsed.size).toBe(0);
            expect(pruned.ui.chartsExpanded.size).toBe(0);
            expect(pruned.ui.selected).toBeNull();
        });
    });
});
