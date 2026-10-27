/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's Details keep the keyboard as a control it is on goes
 * (#1398): Delete on a state takes the state away, Details turns to the open
 * flow, and the button the focus was on goes with the view it was in — the
 * focus lands in the inspector, never on the page's body. Over the depot's
 * record of flows on e3 itself (`flowchart.test-utils.tsx`).
 */

import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";

const h = flowchartHarness();

// jsdom lacks the ResizeObserver the panes and the canvas reach for, the matchMedia the popovers do, and a listbox's scroll.
beforeAll(() => {
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    (globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
    Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };
});

// Each test its own UI store: its sessions, its open flow and its panes stay its own.
beforeEach(() => {
    initializeStore(new UIStore());
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

/** The sort flow: three lanes, a class of chutes and the transitions between its states. */
const SORT_INPUT = {
    description: "From the belt to the chutes",
    lanes: [{ key: "induct", label: "Induct" }, { key: "sort", label: "Sort" }, { key: "hold", label: "Hold" }],
    states: [
        { key: "IND", label: "Inducting", lane: "induct" },
        { key: "CH*", label: "Sort chutes", lane: "sort", members: 14n },
        { key: "SRD", label: "Sorted", lane: "sort" },
    ],
    links: [{ from: "IND", to: "CH*" }, { from: "CH*", to: "SRD", kind: "observed" }],
} as const satisfies Parameters<typeof Flowchart.value>[0];

/** The inspector pane. */
const pane = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-frame-slot='end']")!;
/** Its open tab's panel. */
const panel = (c: HTMLElement): HTMLElement => pane(c).querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** What Details shows. */
const showing = (c: HTMLElement): string | null => panel(c).querySelector("[data-flowchart-inspector]")?.getAttribute("data-flowchart-inspector") ?? null;

test("Delete on a state in Details keeps the keyboard in the inspector: the focus lands in the pane, never on the page's body", async () => {
    await h.commitFlows(Flowchart.values({ "Sort": SORT_INPUT }));
    const { container } = await h.mountRecord({ flow: "Sort", library: [Flowchart.library.flows()] });
    await act(async () => { fireEvent.click(container.querySelector('[data-flowchart-node="CH*"]')!); });
    await settle();
    expect(showing(container)).toBe("state");
    const remove = panel(container).querySelector<HTMLElement>('[data-inspector-action="delete"]')!;
    remove.focus();
    expect(document.activeElement).toBe(remove);
    await act(async () => { fireEvent.click(remove); });
    await settle();
    // The state is gone, and Details shows the open flow.
    expect([container.querySelector('[data-flowchart-node="CH*"]'), showing(container)]).toEqual([null, "flow"]);
    expect(document.activeElement).not.toBe(document.body);
    expect(pane(container).contains(document.activeElement)).toBe(true);
});
