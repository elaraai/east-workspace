/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Allocation beside another session's removal or change of a bin under
 * its drafts (#1599), on e3 itself: the checks every builder runs
 * (`shared/remote-rows.test-utils.ts`), over the kiln yard's bins, what the
 * board draws of the bin read at every change of the page. The board reads a
 * bin it draws back from its day's own pages, so no read is held apart.
 *
 * - A bin moved to another lane here that another session removes stands as
 *   drafted, a conflict to choose: kept, the next Save puts it back; let go,
 *   it leaves.
 * - A bin removed here that another session changes stays off the board, a
 *   conflict to choose, its card naming the bin as the board names it: kept,
 *   the next Save removes it; let go, it is back as the other session left it.
 * - A bin removed here and by another session is nothing to choose and
 *   nothing to save, and is never drawn again.
 */
import { test } from "vitest";
import { within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import type { E3Request } from "../e3-web.test-utils.js";
import { removedHere, removedOnBothSides, removedThere } from "../shared/remote-rows.test-utils.js";
import { allocationHarness, settle } from "./harness.test-utils.js";
import { card, details, inspectorKit, key, press } from "./inspector.test-utils.js";

const h = allocationHarness();
const { open } = inspectorKit(h);
/** The bins as e3 holds them now. */
const read = () => h.read(ex.kilnBins);
type Bins = Awaited<ReturnType<typeof read>>;

/** Another session's write: the bins as it leaves them, from the bins as e3 holds them now. */
async function theirs(change: (bins: Bins) => void): Promise<void> {
    const bins = await read();
    change(bins);
    await h.patch(ex.kilnBins, bins);
    await settle();
}

/** What the shared checks take of the Allocation, over one bin of the day, named as the board names it. */
const bin = (c: HTMLElement, id: string, name: string) => ({
    e3: h.e3, container: c,
    // No read is held here. A bin the board holds in its day's pages is read back from those pages, never by its key
    // (#1596): the session waits on the board's own read of the day, so the two land together, and held, nothing
    // would tell the session of the other session's write. What the board draws is read at every change of the page.
    reads: (_request: E3Request) => false,
    drawn: () => c.querySelector(`[data-allocation-card="${id}"]`) !== null,
    theirRemoval: () => theirs((bins) => { bins.delete(id); }),
    held: async () => (await read()).has(id),
    name,
});

/** The bin removed here: selected, then Delete. */
const remove = (c: HTMLElement, id: string) => [() => press(card(c, id)), () => key(c, "Delete")];
/**
 * The bin moved to another lane here, in Details: a draft. One press — where a number typed a key at a time inside one
 * step of a check would be typed with no draw between its keys, as no page types it.
 */
const relane = (c: HTMLElement, id: string, lane: string) => [() => press(card(c, id)), () =>
    press(within(details(c).querySelector<HTMLElement>('[data-field="lane"]')!).getAllByRole("radio").find((radio) => radio.textContent === lane))];
/** Where the board draws the bin: the cell its card stands in. */
const look = (c: HTMLElement, id: string) => () => c.querySelector(`[data-allocation-card="${id}"]`)?.closest("[data-allocation-cell]")?.getAttribute("data-allocation-cell") ?? null;

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the bin leaves and nothing is left to save", "source"]] as const)(
    "a bin moved to another lane here that another session removes stands as drafted while the board's day is read again, a conflict to choose: %s", async (_ends, choice) => {
        const c = await open();
        await removedThere({ ...bin(c, "3113", "LD-2210 · B-3 10:55"), change: relane(c, "3113", "B-3"), look: look(c, "3113") }, choice);
    });

test.each([["kept, the next Save removes it", "draft"], ["let go, the bin is back as the other session left it", "source"]] as const)(
    "a bin removed here that another session changed stays off the board while its day is read again, a conflict to choose, its card naming the bin as the board names it: %s", async (_ends, choice) => {
        const c = await open();
        await removedHere({
            ...bin(c, "3101", "LD-2201 · B-3 01:55"), remove: remove(c, "3101"),
            theirChange: () => theirs((bins) => { const held = bins.get("3101")!; bins.set("3101", { ...held, m3: held.m3 + 1 }); }),
        }, choice);
    });

test("a bin removed here and by another session is nothing to choose and nothing to save, and the board never draws it again — nor while its day, standing from before the other session's write, is read again", async () => {
    const c = await open();
    await removedOnBothSides({ ...bin(c, "3101", "LD-2201 · B-3 01:55"), remove: remove(c, "3101") });
});
