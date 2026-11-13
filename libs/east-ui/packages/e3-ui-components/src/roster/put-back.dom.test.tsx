/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster through a Save another session puts back exactly before the
 * board reads the day's duties again (#1599), on e3 itself — the check every
 * builder runs (`shared/remote-rows.test-utils.ts`' `putBackAfterSave`): a
 * duty placed here and saved, removed again by another session, is gone as e3
 * holds the duties; one removed here and saved, added back as it was, stands
 * in its cell — the Save never left saving, and nothing saved again.
 */
import { test } from "vitest";
import { within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { putBackAfterSave } from "../shared/remote-rows.test-utils.js";
import { cell, drop, libraryCard, press, rosterHarness } from "./harness.test-utils.js";

const h = rosterHarness();

/** Whose duties each cell holds, by their keys: the live ones — a duty a draft removes is drawn struck in its place until its Save. */
const duties = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-roster-slot]")]
    .map((el) => [el.getAttribute("data-roster-slot"),
        [...el.querySelectorAll("[data-roster-assignment]:not([data-removed])")].map((a) => a.getAttribute("data-roster-assignment"))] as const)
    .filter(([, held]) => held.length > 0);

/** What the shared check takes of the Roster: the duties its cells hold, what e3 holds, and a Save followed by a write that puts the duties back. */
async function putBack(c: HTMLElement) {
    const before = await h.read(ex.rosterDuties);
    return {
        container: c,
        look: () => duties(c),
        held: async () => [...(await h.read(ex.rosterDuties))],
        savedThenPutBack: (save: () => void) => h.followed(ex.rosterDuties, save, () => before),
    };
}

test("a duty placed here and saved, removed again by another session before the board reads the day's duties again, is gone as e3 holds the duties: the Save never left saving, and the duty never placed again", async () => {
    const { container: c } = await h.mount(ex.rosterDaily);
    await putBackAfterSave({
        ...await putBack(c),
        // N. Ochre dropped on Thursday's late inbound shift.
        change: async () => { await drop(await libraryCard(c, "N. Ochre"), cell(c, 4, "inbound", "late")); },
    });
});

test("a duty removed here and saved, added back by another session exactly as it was before the board reads the day's duties again, stands in its cell as e3 holds it: the Save never left saving, and the duty never removed again", async () => {
    const { container: c } = await h.mount(ex.rosterDaily);
    await putBackAfterSave({
        ...await putBack(c),
        change: async () => {
            const stored = c.querySelector<HTMLElement>("[data-roster-assignment]:not([data-drafted])")!;
            await press(within(stored).getByRole("button", { name: /^Remove / }));
        },
    });
});
