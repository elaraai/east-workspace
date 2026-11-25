/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { initialPlanStore, planStoreReducer, type PlanAction, type PlanStore } from "./plan-state.js";
import { GROUP_H, ROW_H, skeletonHeight, type RowHeightFacts, type WindowSkeleton } from "./model.js";
import { persistedOf } from "./persisted.js";

test("bulk folds include nested parents, retain selection, and survive reconciliation and page eviction", () => {
    const keys = ["hall-a", "press-a1", "hall-b"];
    let store = initialPlanStore("group", ["hall-b"]);
    store = { ...store, ui: { ...store.ui, selected: "press-a1", elements: ["job-1"], chartsExpanded: new Set(["sheets"]) } };
    for (const collapsed of [false, true, false]) {
        store = planStoreReducer(store, { t: "event", e: { t: "groups.set", keys, collapsed } }).store;
        expect(store.ui.grain).toBe("resource");
        expect(keys.map(key => store.ui.collapsed.has(key))).toEqual(keys.map(() => collapsed));
        expect(keys.map(key => store.overrides.get(key))).toEqual(keys.map(() => collapsed));
        expect(store.ui.selected).toBe("press-a1");
        expect(store.ui.elements).toEqual(["job-1"]);
        expect([...store.ui.chartsExpanded]).toEqual(["sheets"]);
        store = planStoreReducer(store, { t: "reconcile", complete: false, alive: new Set(["hall-b"]),
            declaredCollapsed: new Set(["hall-b"]), declaredGrain: "group" }).store;
        expect(keys.map(key => store.overrides.get(key))).toEqual(keys.map(() => collapsed));
    }
    const restored = initialPlanStore("resource", keys, { collapse: store.overrides, charts: store.ui.chartsExpanded });
    expect([...restored.ui.collapsed]).toEqual([]);
});

/** A store driven by actions, read as it goes. */
function driven(start: PlanStore) {
    let store = start;
    return {
        get store() { return store; },
        act(a: PlanAction) { store = planStoreReducer(store, a).store; },
        folded(...keys: string[]) { return keys.map((key) => store.ui.collapsed.has(key)); },
    };
}

test("Collapse all stands until Expand all: every parent read later arrives folded, but one opened by hand (#1777)", () => {
    const s = driven(initialPlanStore("resource", []));
    s.act({ t: "event", e: { t: "groups.set", keys: ["hall-a"], collapsed: true } });
    expect(s.store.standing).toBe(true);
    // A window lands holding a hall and a press group under it, never seen: both arrive folded.
    s.act({ t: "seed", declaredCollapsed: new Set(), parents: ["hall-b", "press-b1"] });
    expect(s.folded("hall-b", "press-b1")).toEqual([true, true]);
    // Opened by hand, the hall stays open as its window leaves and lands again.
    s.act({ t: "event", e: { t: "group.toggle", key: "hall-b" } });
    s.act({ t: "seed", declaredCollapsed: new Set(), parents: ["hall-b", "press-b1"] });
    expect(s.folded("hall-b", "press-b1")).toEqual([false, true]);
    // A data commit's rows take what stands too.
    s.act({ t: "reconcile", complete: false, alive: new Set(["hall-c"]), declaredCollapsed: new Set(), declaredGrain: "resource", parents: ["hall-c"] });
    expect(s.folded("hall-c")).toEqual([true]);
    // A landing that moves nothing leaves the store as it was.
    const before = s.store;
    s.act({ t: "seed", declaredCollapsed: new Set(), parents: ["hall-c"] });
    expect(s.store).toBe(before);
});

test("Expand all stands too: a parent read later arrives open, what it declares and what Collapse all folded alike (#1777)", () => {
    const s = driven(initialPlanStore("resource", []));
    s.act({ t: "event", e: { t: "groups.set", keys: ["hall-a"], collapsed: true } });
    // Folded by what stood, then evicted: the controller's Expand all does not name it.
    s.act({ t: "seed", declaredCollapsed: new Set(), parents: ["press-b1"] });
    s.act({ t: "event", e: { t: "groups.set", keys: ["hall-a"], collapsed: false } });
    expect(s.store.standing).toBe(false);
    expect(s.folded("hall-a")).toEqual([false]);
    // Its window lands again, open; and a hall that declares itself folded lands open.
    s.act({ t: "seed", declaredCollapsed: new Set(["hall-e"]), parents: ["press-b1", "hall-e"] });
    expect(s.folded("press-b1", "hall-e")).toEqual([false, false]);
    // Folded by hand, a hall stays folded as it lands again.
    s.act({ t: "event", e: { t: "group.toggle", key: "hall-e" } });
    s.act({ t: "seed", declaredCollapsed: new Set(["hall-e"]), parents: ["hall-e"] });
    expect(s.folded("hall-e")).toEqual([true]);
});

test("a host's folds replace what stands; a write that leaves them leaves every row as it is (#1777)", () => {
    const s = driven(initialPlanStore("resource", []));
    s.act({ t: "event", e: { t: "groups.set", keys: ["hall-a"], collapsed: true } });
    s.act({ t: "seed", declaredCollapsed: new Set(), parents: ["hall-b"] });
    // The host selects a row and leaves the folds: the hall folded by what stands stays folded, and it still stands.
    s.act({ t: "external", selected: "press-a1", collapse: s.store.overrides, charts: new Set() });
    expect(s.folded("hall-a", "hall-b")).toEqual([true, true]);
    expect(s.store.standing).toBe(true);
    // The host clears every fold: what stood goes, and the rows fall back to what they declare.
    s.act({ t: "external", selected: null, collapse: new Map(), charts: new Set() });
    expect(s.store.standing).toBeUndefined();
    expect(s.folded("hall-a", "hall-b")).toEqual([false, false]);
    s.act({ t: "seed", declaredCollapsed: new Set(), parents: ["hall-c"] });
    expect(s.folded("hall-c")).toEqual([false]);
});

test("what stands outlives a remount: storage keeps it, and a restored Expand all opens what a row declares (#1777)", () => {
    expect(persistedOf({ collapse: [], charts: [], anchor: null, standing: true }).standing).toBe(true);
    expect(persistedOf({ collapse: [], charts: [], anchor: null, standing: "yes" })).not.toHaveProperty("standing");
    const opened = initialPlanStore("resource", ["hall-a"], { collapse: [], charts: [], standing: false });
    expect(opened.standing).toBe(false);
    expect(opened.ui.collapsed.has("hall-a")).toBe(false);
    const s = driven(initialPlanStore("resource", [], { collapse: [], charts: [], standing: true }));
    s.act({ t: "seed", declaredCollapsed: new Set(), parents: ["hall-b"] });
    expect(s.folded("hall-b")).toEqual([true]);
});

test("a window's height asks whether each of its rows has rows under it, for what stands to fold it (#1777)", () => {
    const facts = (kind: RowHeightFacts["kind"]): RowHeightFacts => ({ explicit: undefined, diagnostic: false, twoLine: false, kind });
    const sk: WindowSkeleton = {
        keys: ["hall", "press"], parents: [-1, 0], top: [true, false], pinned: [false, false], declared: [false, false],
        parent: [true, false], facts: [facts({ t: "group", strip: false }), facts({ t: "row" })],
    };
    const chartsExpanded = new Set<string>();
    // Folded as a parent, its press is hidden; open, the press draws under it.
    expect(skeletonHeight(sk, { grain: "resource", collapsed: (_key, _declared, parent) => parent, chartsExpanded }, false)).toBe(GROUP_H);
    expect(skeletonHeight(sk, { grain: "resource", collapsed: () => false, chartsExpanded }, false)).toBe(GROUP_H + ROW_H);
});
