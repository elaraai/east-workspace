/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Allocation through a Save another session puts back exactly before the
 * board reads the day's bins again (#1599), on e3 itself — the check every
 * builder runs (`shared/remote-rows.test-utils.ts`' `putBackAfterSave`): a bin
 * removed here and saved, added back by another session as it was, stands on
 * the board as e3 holds it, the Save never left saving and the bin never
 * removed again.
 */
import { test } from "vitest";
import { fireEvent } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { putBackAfterSave } from "../shared/remote-rows.test-utils.js";
import { allocationHarness, slot } from "./harness.test-utils.js";

const h = allocationHarness();

/** The bins the board draws a card of, by their keys, in the board's order. */
const cards = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-allocation-card]")].map((el) => el.getAttribute("data-allocation-card"));

test("a bin removed here and saved, added back by another session exactly as it was before the board reads the day's bins again, stands on the board as e3 holds it: the Save never left saving, and the bin never removed again", async () => {
    const { container: c } = await h.mount(ex.allocationKilnYard);
    const before = await h.read(ex.kilnBins);
    await putBackAfterSave({
        container: c,
        // Bin 3101 selected and removed with Delete.
        change: [
            () => { fireEvent.click(c.querySelector<HTMLElement>('[data-allocation-card="3101"]')!); },
            () => { fireEvent.keyDown(slot(c, "main"), { key: "Delete" }); },
        ],
        look: () => cards(c),
        held: async () => [...(await h.read(ex.kilnBins))],
        savedThenPutBack: (save) => h.followed(ex.kilnBins, save, () => before),
    });
});
