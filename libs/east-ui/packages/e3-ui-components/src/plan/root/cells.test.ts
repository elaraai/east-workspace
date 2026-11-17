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
 * shows, or the span standing while it shows only rows not read; and the
 * resources a window's rows are read by, a row beneath a resource by the one
 * it stands beneath (#1541, U1). What the reader wants and decides is the
 * shared reader's (`shared/schedule/cells.test.ts`).
 */

import { describe, test, expect, vi } from "vitest";
import { none, some, variant } from "@elaraai/east";
import type { PlanWireBlock } from "../model.js";
import { utcAt } from "../plan.test-utils.js";
import { entry } from "../row-id.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import { bucketsOver, cellSpanOf, createCellSpanStore, landingKeysOf, shownCellSpan } from "./cells.js";
import { readPathOf, readResourceOf, type PlanLandingValue } from "./landings.js";

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

describe("the resources a window's rows are read by (#1541, U1)", () => {
    /** The presses, and the kinds of task beneath each: a kind's `child` lands on the kinds' rows. */
    const presses: PlanLandingValue = { key: "press", name: "Presses", draws: [variant("buckets", null)], kinds: [], series: ["temperature"], top: true, under: none };
    const kinds: PlanLandingValue = { key: "kinds", name: "Tasks", draws: [variant("buckets", null)], kinds: ["task"], series: [], top: false, under: some("press") };
    const landings = [presses, kinds];
    /** A window's rows, each by its id alone: what the reader reads of them. */
    const block = (...ids: ReturnType<typeof entry>[]): PlanWireBlock[] => [{ rows: ids.map((id) => ({ id })) } as never];

    test("a landing row is read by its own resource, and a row beneath a resource by the one it stands beneath", () => {
        expect(readResourceOf(presses, ["P03"])).toEqual({ slot: "press", key: "P03" });
        expect(readResourceOf(kinds, ["P03", ".ink_fill"])).toEqual({ slot: "press", key: "P03" });
        // A path too short to hold the resource names none.
        expect(readResourceOf(kinds, [".ink_fill"])).toBeUndefined();
        // Rows by key, each under its parent: the press, a kind of task beneath it, a heat row of the kind's own and a row
        // a step beneath that.
        const rows = new Map([
            ["press", { id: entry("press", "P03"), parent: none }],
            ["kind", { id: entry("kinds", "P03", ".ink_fill"), parent: some("press") }],
            ["kind-heat", { id: entry("kind-heat", "P03", ".ink_fill"), parent: some("kind") }],
            ["kind-part", { id: entry("kind-parts", "P03", ".ink_fill", "nozzle"), parent: some("kind-heat") }],
            ["temperature", { id: entry("temperature", "P03"), parent: some("press") }],
        ]);
        const pathOf = (key: string) => readPathOf(rows.get(key)!, landings, (k) => rows.get(k));
        expect(pathOf("press")).toEqual(["P03"]);
        expect(pathOf("kind")).toEqual(["P03"]);
        // Any row beneath a row a step beneath the press is read by the press too: a series of the kind's own, and a row
        // a further step down (#1660's review).
        expect(pathOf("kind-heat")).toEqual(["P03"]);
        expect(pathOf("kind-part")).toEqual(["P03"]);
        // A row of no landing beneath the press — a series of its own — keeps its path, which ends in the press's key.
        expect(pathOf("temperature")).toEqual(["P03"]);
    });

    test("a resource's own row and the rows beneath it name it once, in the order the rows draw them", () => {
        expect(landingKeysOf(block(
            entry("folder", "F1"),
            entry("press", "P03"), entry("temperature", "P03"), entry("kinds", "P03", ".blanket_wash"), entry("kinds", "P03", ".ink_fill"),
            entry("press", "P04"), entry("kinds", "P04", ".blanket_wash"),
        ), landings)).toEqual([{ slot: "press", key: "P03" }, { slot: "press", key: "P04" }]);
    });

    test("a page that draws no row of a resource's own names it by the rows beneath it", () => {
        expect(landingKeysOf(block(
            entry("temperature", "P03"), entry("kinds", "P03", ".blanket_wash"), entry("kinds", "P03", ".ink_fill"), entry("kinds", "P03", ".plate_check"),
        ), landings)).toEqual([{ slot: "press", key: "P03" }]);
    });
});
