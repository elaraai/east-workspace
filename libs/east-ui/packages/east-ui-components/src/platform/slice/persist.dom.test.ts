/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 */

/**
 * Opt-in slice persistence (#168) — hydrate on enable, debounced write-back
 * on mutation, URL round-trip, and stale-blob resilience. Runs against the
 * REAL primitives + UIStore (jsdom provides localStorage / sessionStorage /
 * history / atob).
 */

import { describe, test, expect, beforeEach } from "vitest";
import { none, some, variant } from "@elaraai/east";
import {
    SliceImpl,
    buildSliceHandle,
    enableSlicePersistence,
    flushSlicePersistence,
    resetSlicePersistence,
} from "./index.js";
import { initializeStore } from "../state-runtime.js";
import { UIStore } from "../state-store.js";

const byName = new Map(SliceImpl.map(p => [p.name, p.fn]));
const call = (name: string, ...args: unknown[]): unknown =>
    (byName.get(name) as (...a: unknown[]) => unknown)(...args);

const cfg = { fields: new Map(), rangeFieldId: none, searchFieldIds: [], breakdownFieldIds: [] };
const initial = {
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
};
const eqPred = (v: string) => variant("string", { fieldId: "id", op: variant("eq", v) });

beforeEach(() => {
    resetSlicePersistence();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
});

describe("slice persistence (#168)", () => {
    test("a mutation debounce-writes the state back; a fresh store hydrates it on enable", () => {
        initializeStore(new UIStore());
        buildSliceHandle("p.local", cfg, initial, [{ id: "a" }, { id: "b" }], none);
        enableSlicePersistence("p.local", "local");

        call("slice_add_filter", "p.local", eqPred("a"));
        flushSlicePersistence();
        expect(window.localStorage.getItem("east-ui.slice.p.local")).toBeTruthy();

        // A brand-new session: fresh registrations + store; bind seeds the
        // default, then enabling persistence restores the saved narrowing.
        resetSlicePersistence();
        initializeStore(new UIStore());
        buildSliceHandle("p.local", cfg, initial, [{ id: "a" }, { id: "b" }], none);
        expect((call("slice_read", "p.local") as { filters: unknown[] }).filters.length).toBe(0);
        enableSlicePersistence("p.local", "local");
        const restored = call("slice_read", "p.local") as { filters: Array<{ type: string; value: { fieldId: string } }> };
        expect(restored.filters.length).toBe(1);
        expect(restored.filters[0]!.value.fieldId).toBe("id");
    });

    test("url mode round-trips a representative state through the query parameter", () => {
        initializeStore(new UIStore());
        buildSliceHandle("p.url", cfg, initial, [{ id: "a" }, { id: "b" }], none);
        enableSlicePersistence("p.url", "url");

        call("slice_set_search", "p.url", some("hello"));
        call("slice_add_filter", "p.url", eqPred("a"));
        flushSlicePersistence();

        const param = new URLSearchParams(window.location.search).get("east-ui.slice.p.url");
        expect(param).toBeTruthy();

        // "Open the shared link": fresh store + registration hydrates from the URL.
        resetSlicePersistence();
        initializeStore(new UIStore());
        buildSliceHandle("p.url", cfg, initial, [{ id: "a" }, { id: "b" }], none);
        enableSlicePersistence("p.url", "url");
        const restored = call("slice_read", "p.url") as { search: { type: string; value?: string }; filters: unknown[] };
        expect(restored.search.type).toBe("some");
        expect(restored.search.value).toBe("hello");
        expect(restored.filters.length).toBe(1);
        expect(call("slice_result_count", "p.url")).toBe(0n); // search "hello" + filter id=a compose
    });

    test("session mode uses sessionStorage", () => {
        initializeStore(new UIStore());
        buildSliceHandle("p.sess", cfg, initial, [{ id: "a" }], none);
        enableSlicePersistence("p.sess", "session");
        call("slice_add_filter", "p.sess", eqPred("a"));
        flushSlicePersistence();
        expect(window.sessionStorage.getItem("east-ui.slice.p.sess")).toBeTruthy();
        expect(window.localStorage.getItem("east-ui.slice.p.sess")).toBeNull();
    });

    test("a corrupt / foreign blob is ignored — the seeded state stands", () => {
        window.localStorage.setItem("east-ui.slice.p.bad", "not-a-beast2-blob");
        initializeStore(new UIStore());
        buildSliceHandle("p.bad", cfg, initial, [{ id: "a" }], none);
        expect(() => enableSlicePersistence("p.bad", "local")).not.toThrow();
        expect((call("slice_read", "p.bad") as { filters: unknown[] }).filters.length).toBe(0);
    });

    test("unregistered keys never touch storage", () => {
        initializeStore(new UIStore());
        buildSliceHandle("p.off", cfg, initial, [{ id: "a" }], none);
        call("slice_add_filter", "p.off", eqPred("a"));
        flushSlicePersistence();
        expect(window.localStorage.length).toBe(0);
        expect(window.sessionStorage.length).toBe(0);
        expect(window.location.search).toBe("");
    });
});
