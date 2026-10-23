/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, rosterHarness, settle, slot, width } from "./harness.test-utils.js";
const h = rosterHarness();
/** The weeks' and the duties' records, as the request log names their datasets. */
const WEEKS = "records.roster_rota_weeks", DUTIES = "records.roster_duties";
/** A read of the weeks or of the duties — a page, a key search, a read of runs or of rows by key (#1351). */
const READS = new Set(["page", "find", "runs", "rows"]);
const weekRead = (request: E3Request) => READS.has(request.kind) && (request.dataset === WEEKS || request.dataset === DUTIES);
/** A week's step, `]` on or `[` back, as the viewer's key — the arrows step the Day view a day. */
const step = (c: HTMLElement, key: "[" | "]") => act(async () => { fireEvent.keyDown(slot(c, "main"), { key }); });
for (const mainWidth of [900, 390]) test(`Roster holds a full-frame skeleton until its week resolves at ${mainWidth}px`, async () => {
    // Every read of the weeks and of the duties held on its way to e3: the week the windowed Roster opens on is unresolved.
    const held = h.e3.hold(weekRead);
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

test("a week whose read fails says so in the footer's loading line, at once, with the reason and Retry; Retry, the fault gone, asks e3 again and the week lands (#1398, CL3)", async () => {
    // Every read of the weeks and the duties fails as e3 fails, for a reason a retry can fix.
    const stop = h.e3.fail(weekRead, { status: 500, type: "internal", message: "the store is down" });
    const { container } = await h.mount(ex.rosterWindowed);
    const line = () => slot(container, "footer").querySelector<HTMLElement>("[data-footer-line]")!;
    await waitFor(() => expect(line().hasAttribute("data-failed")).toBe(true), { timeout: 15_000 });
    expect(line().querySelector("[data-line-text]")!.textContent).toMatch(/^Couldn't read .+/);
    expect(line().getAttribute("title")).toContain("the store is down");
    // The footer is live: its Retry is a control the viewer reaches, under no cover.
    expect(line().closest("[inert]")).toBeNull();
    stop();
    const before = h.requests().filter(weekRead).length;
    await act(async () => { fireEvent.click(line().querySelector("[data-line-retry]")!); });
    await settle();
    await waitFor(() => expect(line().hasAttribute("data-idle")).toBe(true), { timeout: 15_000 });
    expect(h.requests().filter(weekRead).length).toBeGreaterThan(before);
    expect(container.querySelector("[data-roster-grid], [data-roster-agenda]")).not.toBeNull();
});

test("once its week has landed, the Roster reads the weeks either side ahead: a step to the next shows it whole with every read held, and asks for the week after it (#1398, CL7)", async () => {
    const { container } = await h.mount(ex.rosterWindowed);
    await settle();
    // From now on every read of the weeks and the duties is held on its way to e3.
    const held = h.e3.hold(weekRead);
    const before = h.requests().length;
    await step(container, "]");
    await settle();
    // The week stepped to was read before the step: nothing covers the frame, its main is not busy, and the footer's line says nothing.
    expect(container.querySelector("[data-builder-loading]")).toBeNull();
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
    expect(slot(container, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true);
    // What it asks now is the week after it, read ahead in turn — on its way.
    expect(h.requests().slice(before).filter(weekRead).length).toBeGreaterThan(0);
    expect(held.held).toBeGreaterThan(0);
    await act(async () => { held.release(); });
    await settle();
});

test("a step back while the week after is read ahead drops that read: each of its requests is aborted on its way to e3, and the frame never covers (#1398, CL6, CL7)", async () => {
    const { container } = await h.mount(ex.rosterWindowed);
    await settle();
    const held = h.e3.hold(weekRead);
    const before = h.requests().length;
    await step(container, "]");
    await settle();
    // The week after the next, read ahead: its requests on their way, none given up.
    const ahead = h.requests().slice(before).filter(weekRead);
    expect(ahead.length).toBeGreaterThan(0);
    expect(ahead.some(request => request.signal.aborted)).toBe(false);
    await step(container, "[");
    await settle();
    // Back at the week it opened on, its neighbours read already: nothing reads that week any more, and every request for it is aborted.
    expect(ahead.every(request => request.signal.aborted)).toBe(true);
    expect(container.querySelector("[data-builder-loading]")).toBeNull();
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
    await act(async () => { held.release(); });
    await settle();
});
