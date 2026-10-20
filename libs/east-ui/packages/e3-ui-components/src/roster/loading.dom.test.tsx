/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, rosterHarness, settle, slot, width } from "./harness.test-utils.js";
const h = rosterHarness();
/** The weeks' record, as the request log names its dataset. */
const WEEKS = "records.roster_weeks";
for (const mainWidth of [900, 390]) test(`Roster holds a full-frame skeleton until its week resolves at ${mainWidth}px`, async () => {
    // Every page and key search of the weeks held on its way to e3: the week the windowed Roster opens on is unresolved.
    const weeks = h.e3.hold(request => (request.kind === "page" || request.kind === "find") && request.dataset === WEEKS);
    const { container } = await h.mount(ex.rosterWindowed);
    await width(mainWidth);
    const frame = container.querySelector('[data-builder-frame]')!;
    const canvas = slot(container, "main").firstElementChild!.firstElementChild;
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[data-builder-loading]')).not.toBeNull();
    expect(slot(container, "body").hasAttribute("inert")).toBe(true);
    expect(slot(container, "body").getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).not.toContain("Week not started");
    await act(async () => { weeks.release(); }); await settle();
    expect(container.querySelector('[data-builder-frame]')).toBe(frame);
    expect(frame.getAttribute("aria-busy")).toBe("false");
    expect(slot(container, "main").firstElementChild!.firstElementChild).toBe(canvas);
    expect(container.querySelector('[data-builder-loading]')).toBeNull();
    // This example opens a confirmed absent week: only now is forecast shown.
    expect(container.textContent).toContain("Week not started");
    expect(container.querySelector(mainWidth < 480 ? '[data-roster-agenda]' : '[data-roster-grid]')).not.toBeNull();
    expect(h.requests("read", WEEKS)).toEqual([]);
});
