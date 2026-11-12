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
 * - A job made here from a template takes a key the Calendar's session makes
 *   from the template's — the jobs are read a window at a time, so the
 *   template's key and a suffix drawn at random — which another session's job
 *   is then saved under: the job made here goes on under another key, both
 *   drawn, nothing to choose, and Save keeps both — and it stays selected
 *   under its new key, the inspector open on it still.
 * - A job changed, removed or made here and saved, which another session
 *   puts back exactly before the board reads its period again, is read back
 *   as e3 holds the jobs: the Save never left saving (`putBackAfterSave`).
 * - A job removed here and saved, its answer coming only after the board has
 *   heard of another session's later removal of another job: the board is
 *   never put back at the jobs as the Save left them — it asks e3 for no
 *   state the jobs have left (`heardBeforeAnswer`).
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StringType, equalFor } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import type { E3Request } from "../e3-web.test-utils.js";
import { addedOnBothSides, addedOnBothSidesAtSave, heardBeforeAnswer, putBackAfterSave, removedHere, removedHereAtSave, removedOnBothSides, removedThere, removedThereAtSave } from "../shared/remote-rows.test-utils.js";
import { act, calendarHarness, event, settle, slot } from "./harness.test-utils.js";
import { parseEventKey } from "./model.js";

const h = calendarHarness();
const sameText = equalFor(StringType);
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
    // The session's reads of the jobs its drafts hold, by their keys.
    byKey: (request: E3Request) => request.dataset === JOBS && request.kind === "rows",
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

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the job leaves and nothing is left to save", "source"]] as const)(
    "a job changed here that another session removes stands as drafted while the board's period is read again without it and its session has yet to read it by key: %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.calendarOperations, { storageKey: `calendar-remote-removed-there-rows-${choice}` });
        await removedThere({ ...job(c), change: change(c), look: () => customer(c) }, choice, "rows");
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

/** The keys of the jobs the board draws from a draft: those made here. */
const drafted = (c: HTMLElement): string[] => [...c.querySelectorAll<HTMLElement>("[data-calendar-event][data-drafted]")].flatMap((el) => {
    const read = parseEventKey(el.getAttribute("data-calendar-event")!);
    return read.success ? [read.value.key] : [];
});

test("a job made here from a template, under the key another session's job then takes, goes on under another key the Calendar's session makes: both drawn, nothing to choose, and Save keeps both", async () => {
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-remote-added-both" });
    await addedOnBothSides({
        e3: h.e3, container: c,
        reads: (request: E3Request) => request.dataset === JOBS && (request.kind === "find" || request.kind === "page"),
        // The library's first template, created: its dialog's own Create makes the job.
        add: [
            () => { fireEvent.click(within(slot(c, "start")).getByRole("button", { name: "Create" })); },
            () => { fireEvent.click(within(within(document.body).getByRole("dialog")).getByRole("button", { name: "Create" })); },
        ],
        added: () => drafted(c),
        drawn: (key) => event(c, "job", key) !== null,
        // Their own job under that key: another run on the first lathe that morning.
        theirAddition: (key) => theirs((jobs) => { jobs.set(key, { ...jobs.get("job2")!, title: "Their new job" }); }),
        heldKeys: async () => [...(await read()).keys()],
    });
});

test("a job made here that goes on under another key stays selected under it: the inspector open on it still, never emptied", async () => {
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-remote-added-selected" });
    await act(async () => { fireEvent.click(within(slot(c, "start")).getByRole("button", { name: "Create" })); }); await settle();
    await act(async () => { fireEvent.click(within(within(document.body).getByRole("dialog")).getByRole("button", { name: "Create" })); }); await settle();
    // Keyed from its template's: the jobs are read a window at a time, so `brackets-` and a suffix drawn at random.
    const [made, ...more] = drafted(c);
    expect([more, made]).toEqual([[], expect.stringMatching(/^brackets-[0-9a-f]{8}$/)]);
    await act(async () => { fireEvent.click(event(c, "job", made!)); }); await settle();
    const inspected = () => slot(c, "end").querySelector("[data-inspector-title]")?.textContent;
    expect([event(c, "job", made!).hasAttribute("data-selected"), inspected()]).toEqual([true, "Bracket batch"]);
    // Every title the inspector shows from here on, as the page changes.
    const shown = new Set<string | undefined>();
    const watch = new MutationObserver(() => { shown.add(inspected()); });
    watch.observe(c, { subtree: true, childList: true, characterData: true });
    let moved: string | undefined;
    try {
        await theirs((jobs) => { jobs.set(made!, { ...jobs.get("job2")!, title: "Their new job" }); });
        await waitFor(() => { moved = drafted(c).find((key) => key !== made); expect(moved).toBeDefined(); });
        await settle();
    } finally {
        watch.disconnect();
    }
    expect([event(c, "job", moved!).hasAttribute("data-selected"), inspected(), [...shown]]).toEqual([true, "Bracket batch", ["Bracket batch"]]);
});

/** What the shared check takes of the Calendar: the jobs the board draws, what e3 holds, and a Save followed by a write that puts the jobs back. */
async function putBack(c: HTMLElement) {
    const before = await read();
    return {
        container: c,
        held: async () => [...(await read())],
        savedThenPutBack: (save: () => void) => h.followed(ex.calendarJobs, save, () => before),
    };
}
/** The jobs the board draws, by their keys, in order. */
const jobsDrawn = (c: HTMLElement): string[] => [...c.querySelectorAll<HTMLElement>("[data-calendar-event]")].flatMap((el) => {
    const parsed = parseEventKey(el.getAttribute("data-calendar-event")!);
    return parsed.success && sameText(parsed.value.kind, "job") ? [parsed.value.key] : [];
}).sort();

test("a job's customer typed here and saved, typed back by another session before the board reads its period again, is read back with the customer as it was: the Save never left saving, nothing asked, nothing left to save", async () => {
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-remote-put-back-changed" });
    // The job selected to begin with, so the inspector shows its customer before the change and once it is read back.
    await act(async () => { select(c)(); }); await settle();
    await putBackAfterSave({ ...await putBack(c), change: change(c), look: () => customer(c) });
});

test("a job removed here and saved, added back by another session exactly as it was before the board reads its period again, stands on the board as e3 holds it: the Save never left saving, and the job never removed again", async () => {
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-remote-put-back-removed" });
    await putBackAfterSave({ ...await putBack(c), change: remove(c), look: () => jobsDrawn(c) });
});

test("a job made here from a template and saved, removed again by another session before the board reads its period again, is gone as e3 holds the jobs: the Save never left saving, and the job never made again", async () => {
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-remote-put-back-added" });
    await putBackAfterSave({
        ...await putBack(c),
        change: [
            () => { fireEvent.click(within(slot(c, "start")).getByRole("button", { name: "Create" })); },
            () => { fireEvent.click(within(within(document.body).getByRole("dialog")).getByRole("button", { name: "Create" })); },
        ],
        look: () => jobsDrawn(c),
    });
});

test("a Save whose answer comes after the board has heard of another session's later removal of another job never takes the board back to the jobs as the Save left them: their removal stays drawn, beside the job removed here, and e3 refuses none of the board's reads", async () => {
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-remote-late-answer" });
    // Every answer e3 gives the board's reads of the jobs, from here.
    const reads = h.e3.answers((request: E3Request) => request.kind !== "mutate" && request.dataset === JOBS);
    await heardBeforeAnswer({
        container: c,
        change: remove(c),
        mine: () => jobsDrawn(c).includes("job1"),
        theirs: () => jobsDrawn(c).includes("job2"),
        refused: () => reads.filter((answer) => answer.status >= 400).length,
        // Another session removes the second job once the Save here has committed.
        savedThenHeard: (save) => h.late(ex.calendarJobs, save, (jobs) => { const next = new Map(jobs); next.delete("job2"); return next as typeof jobs; }),
    });
    const held = await read();
    expect([held.has("job1"), held.has("job2")]).toEqual([false, false]);
});

// ── Save pressed over a row another session removed or changed, the page not having heard (#1599) ──

test.each([["kept, the next Save puts the job back as drafted", "draft"], ["let go, the job leaves and nothing is left to save", "source"]] as const)(
    "a job changed here that another session removes before the board has heard, and Save pressed: e3 refuses the Save, the job stands as drafted, a conflict to choose — %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.calendarOperations, { storageKey: `calendar-remote-saved-over-removal-${choice}` });
        await removedThereAtSave({ ...job(c), change: change(c), look: () => customer(c), savedOver: (save: () => void) => h.race(ex.calendarJobs, save, (now) => { const next = new Map(now); next.delete("job1"); return next as typeof now; }) }, choice);
    });

test.each([["kept, the next Save removes the job", "draft"], ["let go, the job is back as the other session left it", "source"]] as const)(
    "a job removed here that another session changes before the board has heard, and Save pressed: e3 refuses the Save, the job stays off the board, a conflict to choose — %s", async (_ends, choice) => {
        const { container: c } = await h.mount(ex.calendarOperations, { storageKey: `calendar-remote-saved-over-change-${choice}` });
        await removedHereAtSave({ ...job(c), remove: remove(c), savedOver: (save: () => void) => h.race(ex.calendarJobs, save, (now) => { const next = new Map(now); next.set("job1", { ...next.get("job1")!, customer: "Changed elsewhere" }); return next as typeof now; }) }, choice);
    });

test("a job made here from a template, its key taken by another session's job before the board has heard, and Save pressed: e3 refuses the Save, the job goes on under another key and is saved under it — both kept, nothing to choose", async () => {
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-remote-saved-over-addition" });
    await addedOnBothSidesAtSave({
        container: c,
        // The library's first template, created: its dialog's own Create makes the job.
        add: [
            () => { fireEvent.click(within(slot(c, "start")).getByRole("button", { name: "Create" })); },
            () => { fireEvent.click(within(within(document.body).getByRole("dialog")).getByRole("button", { name: "Create" })); },
        ],
        added: () => drafted(c),
        drawn: (key) => event(c, "job", key) !== null,
        heldKeys: async () => [...(await read()).keys()],
        // Their own job under that key: another run on the first lathe that morning.
        savedOver: (key, save) => h.race(ex.calendarJobs, save, (now) => { const next = new Map(now); next.set(key, { ...next.get("job2")!, title: "Their new job" }); return next as typeof now; }),
    });
});
