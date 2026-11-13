/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Flowchart through a Save another session puts back exactly before the
 * canvas reads the states again (#1599), on e3 itself — the check every
 * builder runs (`shared/remote-rows.test-utils.ts`' `putBackAfterSave`): a
 * state renamed here and saved, renamed back by another session, reads as it
 * did before the Save, the Save never left saving and nothing saved again.
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { slot } from "../e3-web-mount.test-utils.js";
import { putBackAfterSave } from "../shared/remote-rows.test-utils.js";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";

const h = flowchartHarness();

/** A state's card. */
const node = (c: HTMLElement, key: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);
/** Every state drawn: its key and what its card says. */
const states = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-flowchart-node]")].map((el) => [el.getAttribute("data-flowchart-node"), el.textContent]);

test("a state renamed here and saved, renamed back by another session before the canvas reads the states again, reads as it did before the Save: the Save never left saving, nothing asked, nothing left to save", async () => {
    const { container: c } = await h.mountExample(ex.flowchartDepot);
    await settle();
    await waitFor(() => expect(node(c, "SCN")).not.toBeNull());
    await waitFor(() => expect(slot(c, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true));
    await settle();
    const before = await h.read(ex.depotStates);
    await putBackAfterSave({
        container: c,
        // SCN double-clicked into its editor, a label typed, and ⏎.
        change: async () => {
            await act(async () => { fireEvent.doubleClick(node(c, "SCN")!); });
            await settle();
            const input = c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-label]")!;
            await act(async () => { fireEvent.change(input, { target: { value: "Scanned twice" } }); });
            await settle();
            await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
            await settle();
        },
        look: () => states(c),
        held: async () => [...(await h.read(ex.depotStates))],
        savedThenPutBack: (save) => h.followed(ex.depotStates, save, () => before),
    });
});
