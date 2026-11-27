/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The utilisation examples, on e3 itself: `planGroupUtilisation` mounts as a
 * surface mounts it, its paper stores read whole. Folded, each store's own row
 * prints how full its bays are together each week — the pallets in them over
 * the pallets they hold, its days' mean — which is not the mean of its bays'
 * fills: a big bay weighs more than a small one. Open, the store's row prints
 * nothing of its own, and each bay prints its own fill.
 *
 * `planPagedUtilisation` reads its stores a page at a time, never whole: each
 * store's row prints the same figures from the totals the store keeps beside
 * its bays, and each bay its own, all read a cell at a time through the rows'
 * nested series index.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import type { TreePath } from "@elaraai/e3-types";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-utilisation";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-utilisation": ex });

// The example's frame as a browser lays it: 700px tall, each mounted row as tall as it draws.
let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(700), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

/** The weeks the example's window shows: the four from Monday 5 October 2026, the stock's first. */
const WEEKS = 4;

/** A store's bays, each the pallets it holds and the pallets in it a day, in day order. */
const baysOf = (store: string) => [...ex.planPaperStores.default!.get(store)!.bays.values()]
    .map((bay) => ({ capacity: Number(bay.capacity), stock: [...bay.stock.values()].map(Number) }));
/** A week's mean of a figure a day: the days of week `week` from the stock's first, its first a Monday. */
const weekOf = (week: number, onDay: (day: number) => number) => Array.from({ length: 7 }, (_, i) => onDay(week * 7 + i)).reduce((sum, v) => sum + v, 0) / 7;
/** How full a store's bays are together in a week: each day the pallets in them over the pallets they hold, the days' mean. */
const fillIn = (store: string, week: number) => {
    const bays = baysOf(store);
    const holds = bays.reduce((sum, bay) => sum + bay.capacity, 0);
    return weekOf(week, (day) => bays.reduce((sum, bay) => sum + bay.stock[day]!, 0) / holds);
};
/** The mean of a store's bays' own fills in a week. */
const meanIn = (store: string, week: number) => {
    const bays = baysOf(store);
    return bays.reduce((sum, bay) => sum + weekOf(week, (day) => bay.stock[day]! / bay.capacity), 0) / bays.length;
};

/** A store's own row, by its name. */
const bandOf = (main: HTMLElement, name: string) => [...main.querySelectorAll<HTMLElement>("[data-plan-group]")]
    .find((band) => band.querySelector("[data-plan-gutter='label']")?.textContent === name);
/** The figures a row prints, a cell at a time in its columns' order. */
const printed = (row: Element | null | undefined) =>
    [...(row?.querySelectorAll<HTMLElement>("[data-plan-heat-label]") ?? [])].map((label) => label.textContent ?? "");
/** Whether a printed percent is a fraction, to the nearest whole percent. */
const shows = (text: string, fraction: number) => Math.abs(Number(text.replace("%", "")) / 100 - fraction) <= 0.005 + 1e-9;

const STORES = [["S-1", "Reel store"], ["S-2", "Sheet store"], ["S-3", "Board store"]] as const;

describe("a store's own row is its bays' total fill, on e3", () => {
    test("planGroupUtilisation: folded, each store prints each week the pallets in its bays over the pallets they hold — not the mean of its bays' fills; open, each bay prints its own", async () => {
        const { container: c } = await h.mount(ex.planGroupUtilisation);
        await settle();
        const main = slot(c, "main") ?? c;
        expect([...c.querySelectorAll("[data-plan-diagnostic],[data-plan-error],[role='alert']")].map((el) => el.textContent ?? "")).toEqual([]);
        // Folded to start: each store's row a cell a week of the window, each its bays' total fill.
        await waitFor(() => {
            for (const [, name] of STORES) expect(printed(bandOf(main, name)).length, name).toBeGreaterThanOrEqual(WEEKS);
        }, { timeout: 10_000 });
        for (const [key, name] of STORES) {
            printed(bandOf(main, name)).slice(0, WEEKS).forEach((text, week) => expect(shows(text, fillIn(key, week)), `${name}, week ${week}: ${text}`).toBe(true));
        }
        // The reel store's first week: 190 of its 360 pallets on average, 53% — its big bay running low weighs four times
        // either small one, nearly full, and their fills average 68%.
        const reels = printed(bandOf(main, "Reel store"));
        expect(reels[0]).toBe("53%");
        expect(shows(reels[0]!, meanIn("S-1", 0))).toBe(false);
        // The board store's: its big bay nearly full lifts it to 71%, where its bays' fills average 54%.
        const board = printed(bandOf(main, "Board store"));
        expect(board[0]).toBe("71%");
        expect(shows(board[0]!, meanIn("S-3", 0))).toBe(false);
        // Open, the reel store's row prints nothing of its own, and each bay its own fill.
        fireEvent.click(bandOf(main, "Reel store")!);
        await settle();
        const bay = () => main.querySelector(rowAt(entry("bays", "S-1", "R1")));
        await waitFor(() => expect(printed(bay()).length).toBeGreaterThanOrEqual(WEEKS), { timeout: 10_000 });
        expect(printed(bandOf(main, "Reel store"))).toEqual([]);
        const r1 = baysOf("S-1")[0]!;
        printed(bay()).slice(0, WEEKS).forEach((text, week) =>
            expect(shows(text, weekOf(week, (day) => r1.stock[day]! / r1.capacity)), `R1, week ${week}: ${text}`).toBe(true));
    });

    test("planPagedUtilisation: its stores read a page at a time, never whole — folded, each store prints each week its own pallets over the pallets it holds, what the stores read whole print; open, each bay prints its own, every figure read a cell at a time", async () => {
        const { container: c } = await h.mount(ex.planPagedUtilisation);
        await settle();
        const main = slot(c, "main") ?? c;
        expect([...c.querySelectorAll("[data-plan-diagnostic],[data-plan-error],[role='alert']")].map((el) => el.textContent ?? "")).toEqual([]);
        // Folded to start: each store's row a cell a week of the window, from the totals it keeps — the figures of its bays
        // read whole, and not the mean of their fills.
        await waitFor(() => {
            for (const [, name] of STORES) expect(printed(bandOf(main, name)).length, name).toBeGreaterThanOrEqual(WEEKS);
        }, { timeout: 10_000 });
        for (const [key, name] of STORES) {
            printed(bandOf(main, name)).slice(0, WEEKS).forEach((text, week) => expect(shows(text, fillIn(key, week)), `${name}, week ${week}: ${text}`).toBe(true));
        }
        expect(printed(bandOf(main, "Reel store"))[0]).toBe("53%");
        expect(printed(bandOf(main, "Board store"))[0]).toBe("71%");
        // Never read whole: a page of the stores, and every figure a cell at a time through their nested series index.
        const stores = (ex.planPaperStoresWithTotals.path as TreePath).map((step) => step.value).join(".");
        const inTime = ex.planPaperStoresWithTotals.indexes.plan_paper_stores_with_totals_in_time.name;
        expect(h.readKinds(stores)).not.toContain("read");
        expect(h.readKinds(stores, inTime)).toEqual(expect.arrayContaining(["find", "runs"]));
        // Open, the reel store's row prints nothing of its own, and each bay its own fill, read the same way.
        fireEvent.click(bandOf(main, "Reel store")!);
        await settle();
        const bay = () => main.querySelector(rowAt(entry("bays", "S-1", "R1")));
        await waitFor(() => expect(printed(bay()).length).toBeGreaterThanOrEqual(WEEKS), { timeout: 10_000 });
        expect(printed(bandOf(main, "Reel store"))).toEqual([]);
        const r1 = baysOf("S-1")[0]!;
        printed(bay()).slice(0, WEEKS).forEach((text, week) =>
            expect(shows(text, weekOf(week, (day) => r1.stock[day]! / r1.capacity)), `R1, week ${week}: ${text}`).toBe(true));
        expect(h.readKinds(stores)).not.toContain("read");
    });
});
