/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { variant } from "@elaraai/east";
import { clearPagedApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
import { countWholeReads, recordPaging } from "../platform/record-paging.test-utils.js";
import { act, mount, rosterHarness, settle, slot, width, WORKSPACE } from "./harness.test-utils.js";
const h = rosterHarness();
afterEach(() => clearPagedApi());
for (const mainWidth of [900, 390]) test(`Roster holds a full-frame skeleton until its week resolves at ${mainWidth}px`, async () => {
    const reads = countWholeReads(h.cache);
    initializeRecordApi(reads.serve(h.memory), h.cache, WORKSPACE);
    const service = recordPaging(h.cache, reads.raw, [{ path: [variant("field", "records"), variant("field", ex.rosterWeeks.name)], type: ex.rosterWeeks.type }]);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    initializePagedApi({ ...service.api, getPage: async (...args) => { await waiting; return service.api.getPage(...args); } }, WORKSPACE);
    const { container } = mount(ex.rosterWindowed);
    await settle(); await width(mainWidth);
    const frame = container.querySelector('[data-builder-frame]')!;
    const canvas = slot(container, "main").firstElementChild!.firstElementChild;
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[data-builder-loading]')).not.toBeNull();
    expect(slot(container, "body").hasAttribute("inert")).toBe(true);
    expect(slot(container, "body").getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).not.toContain("Week not started");
    await act(async () => { release(); }); await settle();
    expect(container.querySelector('[data-builder-frame]')).toBe(frame);
    expect(frame.getAttribute("aria-busy")).toBe("false");
    expect(slot(container, "main").firstElementChild!.firstElementChild).toBe(canvas);
    expect(container.querySelector('[data-builder-loading]')).toBeNull();
    // This example opens a confirmed absent week: only now is forecast shown.
    expect(container.textContent).toContain("Week not started");
    expect(container.querySelector(mainWidth < 480 ? '[data-roster-agenda]' : '[data-roster-grid]')).not.toBeNull();
    expect(reads.paths.filter(p => p === "records.roster_weeks")).toEqual([]);
});
