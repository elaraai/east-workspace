/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster beside another session's removal or change of a duty under its
 * drafts (#1599), on e3 itself: the checks every builder runs
 * (`shared/remote-rows.test-utils.ts`), over the warehouse's duties — what the
 * board draws of the duty read at every change of the page. The board reads a
 * duty it draws back from its week's own reads, so no read is held apart.
 *
 * - A duty moved to another shift here that another session removes stands as
 *   drafted, a conflict to choose: kept, the next Save puts it back; let go,
 *   it leaves.
 * - A duty removed here that another session changes stays off the board, a
 *   conflict to choose, its card naming the duty by whose it is: kept, the
 *   next Save removes it; let go, it is back as the other session left it.
 * - A duty removed here and by another session is nothing to choose and
 *   nothing to save, and is never drawn again.
 */
import { test } from "vitest";
import { within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import type { E3Request } from "../e3-web.test-utils.js";
import { removedHere, removedHereAtSave, removedOnBothSides, removedThere, removedThereAtSave } from "../shared/remote-rows.test-utils.js";
import { assignment, cell, drop, press, rosterHarness, settle } from "./harness.test-utils.js";

const h = rosterHarness();
/** The duties as e3 holds them now. */
const read = () => h.read(ex.rosterDuties);
type Duties = Awaited<ReturnType<typeof read>>;

/** Another session's write: the duties as it leaves them, from the duties as e3 holds them now. */
async function theirs(change: (duties: Duties) => void): Promise<void> {
    const duties = await read();
    change(duties);
    await h.patch(ex.rosterDuties, duties);
    await settle();
}

/** C. Clover's Thursday duty as the board draws it: its chip, and not struck as removed. */
const chip = (c: HTMLElement): HTMLElement | null => c.querySelector<HTMLElement>('[data-roster-assignment="s37"]:not([data-removed])');

/** What the shared checks take of the Roster, over C. Clover's Thursday duty. */
const duty = (c: HTMLElement) => ({
    e3: h.e3, container: c,
    // The session reads a duty the board draws back from the board's own reads of its week: held, they would starve it.
    reads: () => false,
    // The session's reads of the duties its drafts hold, by their keys: of one the week's own reads hold no more.
    byKey: (request: E3Request) => request.dataset === `records.${ex.rosterDuties.name}` && request.kind === "rows",
    drawn: () => chip(c) !== null,
    theirRemoval: () => theirs((duties) => { duties.delete("s37"); }),
    held: async () => (await read()).has("s37"),
    // Named as the Roster names a duty: whose it is.
    name: "C. Clover",
});

/** The duty removed here, by its chip's own control. */
const remove = (c: HTMLElement) => async () => { await press(within(assignment(c, "s37")).getByRole("button", { name: "Remove C. Clover" })); };
/** The duty moved here to Thursday's late picking shift: a draft. */
const move = (c: HTMLElement) => async () => { await drop(assignment(c, "s37"), cell(c, 4, "picking", "late")); };
/** The cell the board draws the duty in. */
const where = (c: HTMLElement) => chip(c)?.closest("[data-roster-slot]")?.getAttribute("data-roster-slot") ?? null;

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the duty leaves and nothing is left to save", "source"]] as const)(
    "a duty moved here that another session removes stands as drafted while the week's duties are read again, a conflict to choose: %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await removedThere({ ...duty(c), change: move(c), look: () => where(c) }, choice);
    });

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the duty leaves and nothing is left to save", "source"]] as const)(
    "a duty moved here that another session removes stands as drafted while the week's duties are read again without it and its session has yet to read it by key: %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await removedThere({ ...duty(c), change: move(c), look: () => where(c) }, choice, "rows");
    });

test.each([["kept, the next Save removes it", "draft"], ["let go, the duty is back as the other session left it", "source"]] as const)(
    "a duty removed here that another session changed stays off the board while the week's duties are read again, a conflict to choose, its card naming the duty by whose it is: %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await removedHere({ ...duty(c), remove: remove(c), theirChange: () => theirs((duties) => { duties.set("s37", { ...duties.get("s37")!, note: "asked to swap" }); }) }, choice);
    });

test("a duty removed here and by another session is nothing to choose and nothing to save, and the board never draws it again — nor while its week, standing from before the other session's write, is read again", async () => {
    const { container: c } = await h.mount(ex.rosterWarehouse);
    await removedOnBothSides({ ...duty(c), remove: remove(c) });
});

// ── Save pressed over a row another session removed or changed, the page not having heard (#1599) ──

test.each([["kept, the next Save puts the duty back as drafted", "draft"], ["let go, the duty leaves and nothing is left to save", "source"]] as const)(
    "a duty moved here that another session removes before the board has heard, and Save pressed: e3 refuses the Save, the duty stands as drafted, a conflict to choose — %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await removedThereAtSave({ ...duty(c), change: move(c), look: () => where(c), savedOver: (save: () => void) => h.race(ex.rosterDuties, save, (now) => { const next = new Map(now); next.delete("s37"); return next as typeof now; }) }, choice);
    });

test.each([["kept, the next Save removes the duty", "draft"], ["let go, the duty is back as the other session left it", "source"]] as const)(
    "a duty removed here that another session changes before the board has heard, and Save pressed: e3 refuses the Save, the duty stays off the board, a conflict to choose — %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await removedHereAtSave({ ...duty(c), remove: remove(c), savedOver: (save: () => void) => h.race(ex.rosterDuties, save, (now) => { const next = new Map(now); next.set("s37", { ...next.get("s37")!, note: "asked to swap" }); return next as typeof now; }) }, choice);
    });
