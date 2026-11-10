/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Allocation through a Save whose reads come back late — the check every
 * builder runs (`shared/save-held.test-utils.ts`): a bin a gesture removed
 * stays off the board from the press of Save until the day's bins are read
 * again, never drawn again while its record's reads are on their way.
 */
import { expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { savedThroughReload } from "../shared/save-held.test-utils.js";
import { act, allocationHarness, settle, slot } from "./harness.test-utils.js";

const h = allocationHarness();

/** The bins' record, as its dataset's requests name it. */
const BINS = `records.${ex.kilnBins.name}`;

/** The bins the board draws a card of, by their keys, in the board's order. */
const cards = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-allocation-card]")].map((el) => el.getAttribute("data-allocation-card"));

test("a bin Save removed stays off the board while the day's bins are read again, and once they are", async () => {
    const { container: c } = await h.mount(ex.allocationKilnYard);
    expect(cards(c)).toContain("3101");
    // Bin 3101 selected and removed with Delete: a draft.
    await act(async () => { fireEvent.click(c.querySelector<HTMLElement>('[data-allocation-card="3101"]')!); });
    await settle();
    await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "Delete" }); });
    await settle();
    expect(cards(c)).not.toContain("3101");
    await savedThroughReload({
        e3: h.e3,
        container: c,
        // Every read of the bins: the board's own, which its Save's confirmation reads through too.
        reads: (request) => request.dataset === BINS,
        look: () => cards(c),
    });
    // Saved: the record holds no such bin.
    expect((await h.read(ex.kilnBins)).has("3101")).toBe(false);
});
