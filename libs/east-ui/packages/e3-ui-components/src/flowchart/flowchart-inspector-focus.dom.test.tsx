/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's Details keep the keyboard as a control it is on goes
 * (#1398, `Flowchart Records Spec.md` R15): Delete on a state takes the state
 * away, Details turns to the flowchart, and the button the focus was on goes
 * with the view it was in — the focus lands on the flowchart's heading, never
 * on the page's body. Over the depot's four records on e3 itself, bound to be
 * edited and read whole (`flowchart.test-utils.tsx`).
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";

const h = flowchartHarness();

/** The inspector pane. */
const pane = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-frame-slot='end']")!;
/** Its open tab's panel. */
const panel = (c: HTMLElement): HTMLElement => pane(c).querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** What Details shows. */
const showing = (c: HTMLElement): string | null => panel(c).querySelector("[data-flowchart-inspector]")?.getAttribute("data-flowchart-inspector") ?? null;

test("Delete on a state in Details keeps the keyboard in the inspector: the focus lands on the heading of the view drawn in its place, never on the page's body", async () => {
    const { container } = await h.mountExample(ex.flowchartDepotEditing);
    // What the reader read reaches the canvas in a task of its own, once its last request lands.
    await waitFor(() => expect(container.querySelector('[data-flowchart-node="CH*"]')).not.toBeNull());
    await act(async () => { fireEvent.click(container.querySelector('[data-flowchart-node="CH*"]')!); });
    await settle();
    expect(showing(container)).toBe("state");
    const remove = panel(container).querySelector<HTMLElement>('[data-inspector-action="delete"]')!;
    remove.focus();
    expect(document.activeElement).toBe(remove);
    await act(async () => { fireEvent.click(remove); });
    await settle();
    // The state is gone, and Details shows the flowchart: nothing is selected.
    expect([container.querySelector('[data-flowchart-node="CH*"]'), showing(container)]).toEqual([null, "flowchart"]);
    expect(document.activeElement).not.toBe(document.body);
    expect(pane(container).contains(document.activeElement)).toBe(true);
    // The flowchart's heading holds the keyboard, naming what Details shows.
    const focused = document.activeElement!;
    expect([focused.hasAttribute("data-focus-home"), focused.closest("[data-flowchart-inspector]")?.getAttribute("data-flowchart-inspector")]).toEqual([true, "flowchart"]);
});
