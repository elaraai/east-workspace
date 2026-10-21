/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, rosterHarness, settle, slot, width } from "./harness.test-utils.js";
const h = rosterHarness();
/** The weeks' and the duties' records, as the request log names their datasets. */
const WEEKS = "records.roster_rota_weeks", DUTIES = "records.roster_duties";
for (const mainWidth of [900, 390]) test(`Roster holds a full-frame skeleton until its week resolves at ${mainWidth}px`, async () => {
    // Every page and key search of the weeks and of the duties held on its way to e3: the week the windowed Roster opens on is unresolved.
    const held = h.e3.hold(request => (request.kind === "page" || request.kind === "find") && (request.dataset === WEEKS || request.dataset === DUTIES));
    const { container } = await h.mount(ex.rosterWindowed);
    await width(mainWidth);
    const frame = container.querySelector('[data-builder-frame]')!;
    const canvas = slot(container, "main").firstElementChild!.firstElementChild;
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[data-builder-loading]')).not.toBeNull();
    expect(slot(container, "body").hasAttribute("inert")).toBe(true);
    expect(slot(container, "body").getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).not.toContain("Week not started");
    await act(async () => { held.release(); }); await settle();
    expect(container.querySelector('[data-builder-frame]')).toBe(frame);
    expect(frame.getAttribute("aria-busy")).toBe("false");
    expect(slot(container, "main").firstElementChild!.firstElementChild).toBe(canvas);
    expect(container.querySelector('[data-builder-loading]')).toBeNull();
    // This example opens on a week the duties hold none of: only now is it Not started.
    expect(container.textContent).toContain("Week not started");
    expect(container.querySelector(mainWidth < 480 ? '[data-roster-agenda]' : '[data-roster-grid]')).not.toBeNull();
    expect([h.requests("read", WEEKS), h.requests("read", DUTIES)]).toEqual([[], []]);
});
