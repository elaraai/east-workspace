/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { expect, test } from "vitest";
import { initialPlanStore, planStoreReducer } from "./plan-state.js";

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
