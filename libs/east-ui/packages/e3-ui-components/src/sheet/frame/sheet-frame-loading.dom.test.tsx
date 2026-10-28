/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet>`'s footer loading line over a record read a window at a time
 * (#1398, CL3), on e3 itself (`harness.test-utils.tsx`): a window that cannot
 * be read, for a reason a retry can fix, is said on the line with Retry, which
 * asks e3 again at once — never held back by the gap a read alone waits after
 * a failure — and the rows land.
 */

import { test, expect, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { SortedMap, StringType, compareFor, type ValueTypeOf } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import type { E3Request } from "../../e3-web.test-utils.js";
import { act, sheetHarness, settle, slot } from "./harness.test-utils.js";

const h = sheetHarness();
const JOBS = ex.sheetJobs;
/** The jobs' record, as its dataset's requests name it. */
const JOBS_DATASET = `records.${JOBS.name}`;
type Jobs = ValueTypeOf<typeof JOBS.type>;

/** The jobs record with one job's task changed: another session's write. */
function withTask(jobs: Jobs, key: string, task: string): Jobs {
    const next = new SortedMap([...jobs], compareFor(StringType));
    next.set(key, { ...jobs.get(key)!, task });
    return next;
}

test("a window that cannot be read, for a reason a retry can fix, is said on the footer's loading line with Retry, which asks e3 again at once — inside the gap a read alone waits after a failure — and the rows land (#1398)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        const { container } = await h.mount(ex.sheetPaged);
        const line = () => slot(container, "footer")!.querySelector<HTMLElement>("[data-footer-line]")!;
        // Every window of the jobs refused from now on, as a server that fell over refuses them.
        const windows = (request: E3Request) => request.kind === "page" && request.dataset === JOBS_DATASET;
        const stop = h.e3.fail(windows, { status: 500, type: "internal", message: "the store is down" });
        // Another session's save moves the record: its window is read again at the new revision, and refused.
        await h.patch(JOBS, withTask(await h.read(JOBS), "J-0002", "Edge banding, both edges"));
        await waitFor(() => expect(line().hasAttribute("data-failed")).toBe(true), { timeout: 15_000 });
        expect(line().getAttribute("title")).toContain("the store is down");
        // The store is back, and Retry is pressed at once: the window is asked again, and its rows land.
        stop();
        const asked = h.requests().filter(windows).length;
        await act(async () => { fireEvent.click(line().querySelector("[data-line-retry]")!); });
        await settle();
        await waitFor(() => expect(line().hasAttribute("data-idle")).toBe(true), { timeout: 15_000 });
        expect(h.requests().filter(windows).length).toBeGreaterThan(asked);
        expect(container.querySelectorAll('[data-slot="row"] [data-key="task"]')[1]!.textContent).toBe("Edge banding, both edges");
    } finally {
        logged.mockRestore();
    }
});
