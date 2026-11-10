/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster through a Save whose reads come back late — the check every
 * builder runs (`shared/save-held.test-utils.ts`): a duty a drop placed stays
 * in its cell from the press of Save until the day's duties are read again,
 * never leaving the board while its record's reads are on their way.
 */
import { expect, test } from "vitest";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { savedThroughReload } from "../shared/save-held.test-utils.js";
import { cell, drop, libraryCard, rosterHarness } from "./harness.test-utils.js";

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
