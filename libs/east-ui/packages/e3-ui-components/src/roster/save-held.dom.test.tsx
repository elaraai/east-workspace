/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster through a Save whose reads come back late — the check every
 * builder runs (`shared/save-held.test-utils.ts`): a duty a drop placed stays
 * in its cell from the press of Save until the day's duties are read again,
 * never leaving the board while its record's reads are on their way. And a
 * Save never stops the editing: a stored duty removed while the duties are
 * read again — the board's rows standing in from before the Save — is taken
 * and drawn at once, and the next Save writes it.
 */
import { expect, test } from "vitest";
import { within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { editedThroughReload, savedThroughReload } from "../shared/save-held.test-utils.js";
import { cell, drop, libraryCard, press, rosterHarness } from "./harness.test-utils.js";

const h = rosterHarness();

/** The duties' record, as its dataset's requests name it. */
const DUTIES = `records.${ex.rosterDuties.name}`;

test("a duty Save placed stays in its cell while the day's duties are read again, and once they are", async () => {
    const { container: c } = await h.mount(ex.rosterDaily);
    // N. Ochre dropped on Thursday's late inbound shift: a draft.
    await drop(await libraryCard(c, "N. Ochre"), cell(c, 4, "inbound", "late"));
    expect(cell(c, 4, "inbound", "late").querySelector("[data-roster-assignment][data-drafted]")).not.toBeNull();
    await savedThroughReload({
        e3: h.e3,
        container: c,
        // Every read of the duties: the board's own, which its Save's confirmation reads through too.
        reads: (request) => request.dataset === DUTIES,
        // Whose duties the cell holds, by their keys.
        look: () => [...c.querySelectorAll<HTMLElement>("[data-roster-slot]")]
            .filter((el) => el.querySelector("[data-roster-assignment]") !== null)
            .map((el) => [el.getAttribute("data-roster-slot"), [...el.querySelectorAll("[data-roster-assignment]")].map((a) => a.getAttribute("data-roster-assignment"))]),
    });
    // Saved: the record holds the duty.
    const placed = [...(await h.read(ex.rosterDuties)).values()].filter((duty) => duty.who.type === "staff" && duty.who.value === "nochre" && duty.shift === "late");
    expect(placed.length).toBeGreaterThan(0);
});

test("a stored duty removed while the day's duties are read again after a Save is taken at once — from the board's rows as they stand — stays removed as the reads land, and the next Save writes it", async () => {
    const { container: c } = await h.mount(ex.rosterDaily);
    await drop(await libraryCard(c, "N. Ochre"), cell(c, 4, "inbound", "late"));
    let removed: string | undefined;
    await editedThroughReload({
        e3: h.e3,
        container: c,
        reads: (request) => request.dataset === DUTIES,
        // Whose duties each cell holds, by their keys: the live ones — a duty a draft removes is drawn struck in its
        // place until its Save, a draft's look, and is no duty of the cell from the gesture on.
        look: () => [...c.querySelectorAll<HTMLElement>("[data-roster-slot]")]
            .map((el) => [el.getAttribute("data-roster-slot"),
                [...el.querySelectorAll("[data-roster-assignment]:not([data-removed])")].map((a) => a.getAttribute("data-roster-assignment"))] as const)
            .filter(([, duties]) => duties.length > 0),
        // A duty the record holds, which the Save did not: its original is the board's own row of it.
        again: async () => {
            const stored = c.querySelector<HTMLElement>("[data-roster-assignment]:not([data-drafted])")!;
            removed = stored.getAttribute("data-roster-assignment")!;
            await press(within(stored).getByRole("button", { name: /^Remove / }));
        },
    });
    // Both saved: the record holds the duty placed, and none of the one removed.
    const duties = await h.read(ex.rosterDuties);
    expect(removed).toBeDefined();
    expect(duties.has(removed!)).toBe(false);
    expect([...duties.values()].some((duty) => duty.who.type === "staff" && duty.who.value === "nochre" && duty.shift === "late")).toBe(true);
});
