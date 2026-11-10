/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart through a Save whose reads come back late — the check every
 * builder runs (`shared/save-held.test-utils.ts`): a state a gesture renamed
 * keeps its new name from the press of Save until the states are read again,
 * never drawn under its old one while its record's reads are on their way.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { slot } from "../e3-web-mount.test-utils.js";
import { savedThroughReload } from "../shared/save-held.test-utils.js";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";

const h = flowchartHarness();

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
