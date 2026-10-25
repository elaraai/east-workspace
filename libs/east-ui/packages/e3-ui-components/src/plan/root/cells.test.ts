/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * The Plan's adapter to the shared cells' reader (#1039), worked out with no
 * read: the buckets a range is cut into at the canvas's resolution, and where
 * the canvas reports its paged rows in view — at rest, the rows its view
 * shows, or the span standing while it shows only rows not read. What the
 * reader wants and decides is the shared reader's
 * (`shared/schedule/cells.test.ts`).
 */

import { describe, test, expect, vi } from "vitest";
import { utcAt } from "../plan.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import { bucketsOver, cellSpanOf, createCellSpanStore, shownCellSpan } from "./cells.js";

const day = (text: string) => new Date(`${text}T00:00:00Z`);

describe("the buckets a range is cut into (#1039)", () => {
    test("whole periods of the scale's resolution, in order", () => {
        const scale = planScale({ kind: "time", window: { min: utcAt("2026-10-05T00:00:00"), max: utcAt("2026-10-19T00:00:00") }, resolution: "month" }) as PlanScale;
        expect(bucketsOver(scale, day("2026-09-01"), day("2026-12-01"))).toEqual([
            { start: day("2026-09-01").getTime(), end: day("2026-10-01").getTime() },
            { start: day("2026-10-01").getTime(), end: day("2026-11-01").getTime() },
            { start: day("2026-11-01").getTime(), end: day("2026-12-01").getTime() },
        ]);
    });
});

describe("where the canvas reports its rows in view (#1039)", () => {
    test("the first and the last row a paged window placed, each by its window and its resource's key, under the narrowing their windows are", () => {
        const origin = new Map([["r1", { w: 0 }], ["r2", { w: 0 }], ["r3", { w: 1 }]]);
        const items = [
            { key: "stock", path: ["board"] },
            { key: "r1", path: ["P-1001"] },
            { key: "r2", path: ["P-1002"] },
            { key: "r3", path: ["P-1201"] },
        ];
        expect(cellSpanOf(items, origin, undefined)).toEqual({ first: { w: 0, key: "P-1001" }, last: { w: 1, key: "P-1201" }, narrowing: undefined });
        // A kind its source narrows (#1344): the rows are the narrowing's, and say so.
        expect(cellSpanOf(items, origin, "hall: Hall 2")).toEqual({ first: { w: 0, key: "P-1001" }, last: { w: 1, key: "P-1201" }, narrowing: "hall: Hall 2" });
        // A row no paged window placed — the Plan's own — is never a paged kind's.
        expect(cellSpanOf([{ key: "stock", path: ["board"] }], origin, undefined)).toBeUndefined();
    });

    test("at rest: the paged rows the view shows; a view showing rows not read yet and none read keeps the span standing — never the opening's first block, a view away — and one showing neither reports none", () => {
        const origin = new Map([["r6", { w: 5 }], ["r7", { w: 5 }]]);
        const standing = { first: { w: 0, key: "JOB-10090" }, last: { w: 0, key: "JOB-10180" }, narrowing: "status: Ready" };
        const shown = [{ key: "r6", path: ["JOB-49999"] }, { key: "r7", path: ["JOB-49909"] }];
        // Rows in view, a run below them: their span.
        expect(shownCellSpan(shown, true, standing, origin, "status: Ready"))
            .toEqual({ first: { w: 5, key: "JOB-49999" }, last: { w: 5, key: "JOB-49909" }, narrowing: "status: Ready" });
        // A run not read alone — the view sent far into it — the span standing, or none while none stands.
        expect(shownCellSpan([], true, standing, origin, "status: Ready")).toBe(standing);
        expect(shownCellSpan([{ key: "stock", path: ["board"] }], true, undefined, origin, undefined)).toBeUndefined();
        // Nothing paged and no run — a narrowing of no row: none, the opening's.
        expect(shownCellSpan([], false, standing, origin, "status: Ready")).toBeUndefined();
    });

    test("the store holds the span reported last, and tells its listeners only of one that moves — its rows or its narrowing", () => {
        const store = createCellSpanStore();
        const heard = vi.fn();
        const stop = store.subscribe(heard);
        expect(store.get()).toBeUndefined();
        store.set({ first: { w: 0, key: "P-1001" }, last: { w: 0, key: "P-1018" }, narrowing: undefined });
        store.set({ first: { w: 0, key: "P-1001" }, last: { w: 0, key: "P-1018" }, narrowing: undefined });
        expect(heard).toHaveBeenCalledTimes(1);
        store.set({ first: { w: 0, key: "P-1002" }, last: { w: 0, key: "P-1019" }, narrowing: undefined });
        expect(heard).toHaveBeenCalledTimes(2);
        expect(store.get()).toEqual({ first: { w: 0, key: "P-1002" }, last: { w: 0, key: "P-1019" }, narrowing: undefined });
        // The same rows under another narrowing are other rows (#1344).
        store.set({ first: { w: 0, key: "P-1002" }, last: { w: 0, key: "P-1019" }, narrowing: "hall: Hall 2" });
        expect(heard).toHaveBeenCalledTimes(3);
        stop();
        store.set(undefined);
        expect(heard).toHaveBeenCalledTimes(3);
        expect(store.get()).toBeUndefined();
    });
});
