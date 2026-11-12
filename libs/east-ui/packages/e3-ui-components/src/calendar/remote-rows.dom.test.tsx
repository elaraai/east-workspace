/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Calendar beside another session's removal or change of an event under
 * its drafts (#1599), on e3 itself: the checks every builder runs
 * (`shared/remote-rows.test-utils.ts`), over the operations calendar's jobs —
 * the board's own reads of them, its period's searches and pages, held and let
 * go one at a time, and what it draws of the job read at every change of the
 * page.
 *
 * - A job changed here that another session removes stands as drafted, a
 *   conflict to choose: kept, the next Save puts it back; let go, it leaves.
 * - A job removed here that another session changes stays off the board, a
 *   conflict to choose, its card naming the job by its title: kept, the next
 *   Save removes it; let go, it is back as the other session left it.
 * - A job removed here and by another session is nothing to choose and
 *   nothing to save, and is never drawn again.
 */

import { test } from "vitest";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import type { E3Request } from "../e3-web.test-utils.js";
import { removedHere, removedOnBothSides, removedThere } from "../shared/remote-rows.test-utils.js";
import { calendarHarness, event, settle, slot } from "./harness.test-utils.js";

const h = calendarHarness();
/** The jobs' record, as its dataset's requests name it. */
const JOBS = `records.${ex.calendarJobs.name}`;

/** Another session's write: the jobs as it leaves them, from the jobs as e3 holds them now. */
async function theirs(change: (jobs: Map<string, ReturnType<Awaited<ReturnType<typeof read>>["get"]> & object>) => void): Promise<void> {
    const jobs = new Map(await read());
    change(jobs as never);
    await h.patch(ex.calendarJobs, jobs);
    await settle();
}
/** The jobs as e3 holds them now. */
const read = () => h.read(ex.calendarJobs);

/** The customer the inspector shows of the job selected; `null` where it shows none. */
const customer = (c: HTMLElement) => slot(c, "end")?.querySelector<HTMLInputElement>('[data-field="customer"] input')?.value ?? null;

/** What the shared checks take of the Calendar, over the job on the first lathe. */
const job = (c: HTMLElement) => ({
    e3: h.e3, container: c,
    // The board's own reads of the jobs: its period's searches and its pages, never the reads a session makes by key.
    reads: (request: E3Request) => request.dataset === JOBS && (request.kind === "find" || request.kind === "page"),
    drawn: () => event(c, "job", "job1") !== null,
    theirRemoval: () => theirs((jobs) => { jobs.delete("job1"); }),
    held: async () => (await read()).has("job1"),
    name: "Mounting brackets · batch 42",
});

/** The job selected, as a click selects it. */
const select = (c: HTMLElement) => () => { fireEvent.click(event(c, "job", "job1")); };
/** The job removed here: selected, then Delete. */
const remove = (c: HTMLElement) => [select(c), () => { fireEvent.keyDown(event(c, "job", "job1"), { key: "Delete" }); }];
/** The job's customer typed here in the inspector: a draft. */
const change = (c: HTMLElement) => [select(c), async () => {
    const input = slot(c, "end").querySelector<HTMLInputElement>('[data-field="customer"] input')!;
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "Customer here{Enter}");
}];

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the job leaves and nothing is left to save", "source"]] as const)(
    "a job changed here that another session removes stands as drafted while the board's period is read again, a conflict to choose: %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.calendarOperations, { storageKey: `calendar-remote-removed-there-${choice}` });
        await removedThere({ ...job(c), change: change(c), look: () => customer(c) }, choice);
    });

test.each([["kept, the next Save removes it", "draft"], ["let go, the job is back as the other session left it", "source"]] as const)(
    "a job removed here that another session changed stays off the board while its period is read again, a conflict to choose, its card naming the job by its title: %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.calendarOperations, { storageKey: `calendar-remote-removed-here-${choice}` });
        await removedHere({ ...job(c), remove: remove(c), theirChange: () => theirs((jobs) => { jobs.set("job1", { ...jobs.get("job1")!, customer: "Changed elsewhere" }); }) }, choice);
    });

test("a job removed here and by another session is nothing to choose and nothing to save, and the board never draws it again — nor while its period, standing from before the other session's write, is read again", async () => {
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-remote-removed-both" });
    await removedOnBothSides({ ...job(c), remove: remove(c) });
});
