/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet over jobs read whole, beside a job changed here that another
 * session removes (#1599), on e3 itself: the job is drawn at EVERY commit of
 * the sheet, a pass no one sees among them.
 *
 * A record read whole reaches the sheet as a new collection, and its editing
 * session is told of it after the render that reads it: the shared hook
 * carries the drafts over in a layout effect. In that render the collection
 * holds no such job, and the session still says its record does. Drawn only
 * where the rows hold it, the job left the grid for one commit. No one saw
 * that commit — the next, before paint, drew the job with its conflict — but
 * the frame's scroll anchoring did: it took its anchor on the next job, and
 * scrolled the changed job under the header as it came back (found by hand,
 * 13 Nov 2026; the showcase's `sheet-conflicts.spec.ts` holds the
 * scroll in a browser).
 */

import { Profiler, type ReactNode } from "react";
import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { settle, sheetHarness, slot } from "./frame/harness.test-utils.js";

const h = sheetHarness();

/** The sheet's rows, the blank ones left out. */
const rowEls = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]:not([data-blank])')];
/** A row by its key; `undefined` where the grid draws none. */
const rowOf = (c: HTMLElement, id: string) => rowEls(c).find((row) => row.getAttribute("data-row-id") === id);
/** What a row's cells say. */
const cells = (row: HTMLElement | undefined) => row === undefined ? undefined : [...row.querySelectorAll<HTMLElement>("[data-key]")].map((cell) => cell.textContent);

test("sheetConflicts: a job changed here that another session removes is drawn at every commit of the sheet — the one before its session is told among them, which no one sees", async () => {
    // What the grid draws of the job at each commit of the sheet, from the other session's write on.
    const drawn: boolean[] = [];
    const page: { container?: HTMLElement; watching: boolean } = { watching: false };
    const wrap = (sheet: ReactNode) => (
        <Profiler id="sheet" onRender={() => { if (page.watching && page.container !== undefined) drawn.push(rowOf(page.container, "J-0001") !== undefined); }}>
            {sheet}
        </Profiler>
    );
    const { container: c } = await h.mount(ex.sheetConflicts, { storageKey: "sheet-standing-whole", wrap });
    page.container = c;
    // The first job's quantity typed in its editor, committed with ⏎.
    fireEvent.doubleClick(rowOf(c, "J-0001")!.querySelector<HTMLElement>('[data-key="qty"]')!);
    await settle();
    const input = document.querySelector('[data-slot="editorInput"]')!;
    fireEvent.input(input, { target: { value: "70" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(cells(rowOf(c, "J-0001"))).toContain("70");

    // Another session removes the job.
    page.watching = true;
    const jobs = new Map(await h.read(ex.sheetConflictJobs));
    jobs.delete("J-0001");
    await h.patch(ex.sheetConflictJobs, jobs);
    await settle();
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    page.watching = false;

    // A conflict to choose, the job standing as drafted — and never off the grid on the way there.
    expect(cells(rowOf(c, "J-0001"))).toContain("70");
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.filter((there) => !there)).toEqual([]);
});
