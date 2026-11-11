/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart through a Save whose reads come back late — the check every
 * builder runs (`shared/save-held.test-utils.ts`): a state a gesture renamed
 * keeps its new name from the press of Save until the states are read again,
 * never drawn under its old one while its record's reads are on their way —
 * and a Save never stops the editing: another state renamed while they are is
 * taken at once, from the card as it stands, and is the next Save's. The same
 * with the page evaluated again at every step: no card leaves the canvas for
 * it, and none goes back to an older name.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { evaluatesAgain, slot } from "../e3-web-mount.test-utils.js";
import { editedThroughReload, redrawnThroughReload, savedThroughReload } from "../shared/save-held.test-utils.js";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";

const h = flowchartHarness();
evaluatesAgain();

/** The depot's states' record, as its datasets' requests name it. */
const STATES = `records.${ex.depotStates.name}`;

/** A state's card. */
const node = (c: HTMLElement, key: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);

/** Every state drawn: its key and what its card says. */
const states = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-flowchart-node]")].map((el) => [el.getAttribute("data-flowchart-node"), el.textContent]);

test("a state Save renamed keeps its new name while the states are read again, and once they are", async () => {
    const { container: c } = await h.mountExample(ex.flowchartDepot);
    await settle();
    await waitFor(() => expect(node(c, "SCN")).not.toBeNull());
    await waitFor(() => expect(slot(c, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true));
    await settle();
    // SCN double-clicked into its editor, a label typed, and ⏎: a draft.
    await act(async () => { fireEvent.doubleClick(node(c, "SCN")!); });
    await settle();
    const input = c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-label]")!;
    await act(async () => { fireEvent.change(input, { target: { value: "Scanned twice" } }); });
    await settle();
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await settle();
    expect(node(c, "SCN")!.textContent).toContain("Scanned twice");
    await savedThroughReload({
        e3: h.e3,
        container: c,
        // Every read of the states: the canvas's own, which its Save's confirmation reads through too.
        reads: (request) => request.dataset === STATES,
        look: () => states(c),
    });
    // Saved: the record holds the name.
    expect((await h.read(ex.depotStates)).get("SCN")!.name).toBe("Scanned twice");
});

/** Renames a state through its card's editor: a double click, the label typed, and ⏎. */
async function rename(c: HTMLElement, key: string, label: string): Promise<void> {
    await act(async () => { fireEvent.doubleClick(node(c, key)!); });
    await settle();
    const input = c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-label]")!;
    await act(async () => { fireEvent.change(input, { target: { value: label } }); });
    await settle();
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await settle();
}

test.each([
    ["another state renamed while the states are read again after a Save is taken at once — from the card as it stands — keeps its name as the reads land, and the next Save writes it", editedThroughReload],
    ["the page evaluated again while the states are read again after a Save takes no card off the canvas, and gives none an older name: another state renamed meanwhile is taken at once, keeps its name as the page is evaluated again and the reads land, and the next Save writes it", redrawnThroughReload],
])("%s", async (_name, through) => {
    const { container: c } = await h.mountExample(ex.flowchartDepot);
    await settle();
    await waitFor(() => expect(node(c, "SCN")).not.toBeNull());
    await waitFor(() => expect(slot(c, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true));
    await settle();
    await rename(c, "SCN", "Scanned twice");
    expect(node(c, "SCN")!.textContent).toContain("Scanned twice");
    // Another state the record holds, which the Save did not: its original is the canvas's own row of it.
    const other = states(c).map(([key]) => key!).find((key) => key !== "SCN")!;
    await through({
        e3: h.e3,
        container: c,
        reads: (request) => request.dataset === STATES,
        look: () => states(c),
        again: () => rename(c, other, "Named while saving"),
    });
    // Both saved: the record holds each name.
    const held = await h.read(ex.depotStates);
    expect([held.get("SCN")!.name, held.get(other)!.name]).toEqual(["Scanned twice", "Named while saving"]);
});
