/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan beside another session's new event under the key its own new event
 * holds (#1599), on e3 itself: the check every builder runs
 * (`shared/remote-rows.test-utils.ts`), over the print works' jobs — the
 * canvas's own reads of them held and let go one at a time.
 *
 * A job duplicated here takes a key the Plan's session makes from the job's
 * own — the jobs are read a window at a time, so `J-1001-` and a suffix drawn
 * at random — which another planner's job is then saved under. Theirs saved
 * first, the copy made here goes on under another key: both drawn, nothing to
 * choose, and Save keeps both — and it stays selected under its new key, the
 * inspector open on it still, never on the other planner's.
 *
 * And a job duplicated here and saved, its answer coming only after the canvas
 * has heard of another planner's later removal of another job: the canvas is
 * never put back at the jobs as the Save left them — it asks e3 for no state
 * the jobs have left (`heardBeforeAnswer`).
 *
 * And a job another planner removes or changes under a draft of it here, as
 * every builder's rows are held to it:
 *
 * - A job changed here that another planner removes stands as drafted, a
 *   conflict to choose — whichever lands first, the canvas's own reads of its
 *   window or its session's read of the job by its key: kept, the next Save
 *   puts it back; let go, it leaves.
 * - A job removed here that another planner changes stays off the canvas, a
 *   conflict to choose, its card naming the job by its title: kept, the next
 *   Save removes it; let go, it is back as the other planner left it.
 * - A job removed here and by another planner is nothing to choose and
 *   nothing to save, and is never drawn again.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseFor } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import type { E3Request } from "../../e3-web.test-utils.js";
import { addedOnBothSides, heardBeforeAnswer, putBackAfterSave, removedHere, removedOnBothSides, removedThere } from "../../shared/remote-rows.test-utils.js";
import { act, el, entry, madeFrom, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness();
/** The jobs' record, as its dataset's requests name it. */
const JOBS = `records.${ex.planPrintJobs.name}`;
/** Press A1's bars. */
const A1 = entry("presses.span", "Hall A", "a1");
/** A job's bar on Press A1. */
const bar = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(A1)} ${el("data-run", "job", key)}`);
/** The inspector pane, and one of its gesture buttons. */
const pane = (c: HTMLElement) => slot(c, "end")!;
const action = (c: HTMLElement, name: string) => pane(c).querySelector<HTMLButtonElement>(`[data-inspector-action=${JSON.stringify(name)}]`)!;
/** The jobs as e3 holds them now. */
const readJobs = () => h.read(ex.planPrintJobs);
/** Another planner's own copy of the spring catalogue, saved under a key. */
async function theirCopy(key: string): Promise<void> {
    const jobs = new Map(await readJobs());
    jobs.set(key, { ...jobs.get("J-1001")!, title: "Their catalogue" });
    await h.patch(ex.planPrintJobs, jobs);
    await settle();
}
const parseRef = parseFor(ScheduleEventRefType);
/** The keys of the jobs Press A1 draws from a draft that adds them — its copies of the spring catalogue, each keyed from it. */
const copies = (c: HTMLElement): string[] => [...c.querySelectorAll(`${rowAt(A1)} [data-run][data-draft]`)].flatMap((node) => {
    const ref = parseRef(node.getAttribute("data-run") ?? "");
    return ref.success && ref.value.kind === "job" && ref.value.key.startsWith("J-1001-") ? [ref.value.key] : [];
});
/** The spring catalogue selected, then Duplicate in the inspector. */
const duplicate = (c: HTMLElement) => [
    () => { fireEvent.click(bar(c, "J-1001")!); },
    () => { const button = action(c, "duplicate"); fireEvent.mouseDown(button, { button: 0 }); fireEvent.click(button); },
];

test("a job duplicated here, under the key another planner's job then takes, goes on under another key the Plan's session makes: both drawn, nothing to choose, and Save keeps both", async () => {
    const { container: c } = await h.mount(ex.planPrintWorks, { storageKey: "plan-remote-added-both" });
    await settle();
    await addedOnBothSides({
        e3: h.e3, container: c,
        // The canvas's own reads of the jobs: its window's searches, runs and pages, never the reads a session makes by key.
        reads: (request: E3Request) => request.dataset === JOBS && (request.kind === "find" || request.kind === "runs" || request.kind === "within" || request.kind === "page"),
        add: duplicate(c),
        added: () => copies(c),
        drawn: (key) => bar(c, key) !== null,
        theirAddition: theirCopy,
        heldKeys: async () => [...(await readJobs()).keys()],
    });
});

test("a job duplicated here that goes on under another key stays selected under it: the inspector open on the copy made here still, never on the other planner's", async () => {
    const { container: c } = await h.mount(ex.planPrintWorks, { storageKey: "plan-remote-added-selected" });
    await settle();
    for (const step of duplicate(c)) { await act(async () => { step(); }); await settle(); }
    const inspected = () => pane(c).querySelector("[data-inspector-title]")?.textContent;
    const [made, ...more] = copies(c);
    expect([more, bar(c, made!)?.getAttribute("aria-pressed"), inspected()]).toEqual([[], "true", "Spring catalogue"]);
    // Every title the inspector shows from here on, as the page changes.
    const shown = new Set<string | undefined>();
    const watch = new MutationObserver(() => { shown.add(inspected()); });
    watch.observe(c, { subtree: true, childList: true, characterData: true });
    let moved: string | undefined;
    try {
        await theirCopy(made!);
        await waitFor(() => { moved = copies(c).find((key) => key !== made); expect(moved).toBeDefined(); });
        await settle();
    } finally {
        watch.disconnect();
    }
    expect([bar(c, moved!)?.getAttribute("aria-pressed"), inspected(), [...shown]]).toEqual(["true", "Spring catalogue", ["Spring catalogue"]]);
});

test("a job duplicated here and saved, removed again by another planner before the canvas reads its window again, is gone as e3 holds the jobs: the Save never left saving, and the copy never made again", async () => {
    const { container: c } = await h.mount(ex.planPrintWorks, { storageKey: "plan-remote-put-back-added" });
    await settle();
    const before = await readJobs();
    await putBackAfterSave({
        container: c,
        change: duplicate(c),
        // The spring catalogue's copies Press A1 draws, a draft's or the record's: how many there are.
        look: () => madeFrom(c.querySelector(rowAt(A1))!, "data-run", "job", "J-1001").length,
        held: async () => [...(await readJobs()).keys()],
        savedThenPutBack: (save) => h.followed(ex.planPrintJobs, save, () => before),
    });
});

test("a Save whose answer comes after the canvas has heard of another planner's later removal of another job never takes the canvas back to the jobs as the Save left them: their removal stays drawn, beside the copy made here, and e3 refuses none of the canvas's reads", async () => {
    const { container: c } = await h.mount(ex.planPrintWorks, { storageKey: "plan-remote-late-answer" });
    await settle();
    // Every answer e3 gives the canvas's reads of the jobs, from here.
    const reads = h.e3.answers((request: E3Request) => request.kind !== "mutate" && request.dataset === JOBS);
    await heardBeforeAnswer({
        container: c,
        change: duplicate(c),
        // The spring catalogue's copies Press A1 draws, and whether it draws the museum guide.
        mine: () => madeFrom(c.querySelector(rowAt(A1))!, "data-run", "job", "J-1001").length,
        theirs: () => bar(c, "J-1002") !== null,
        refused: () => reads.filter((answer) => answer.status >= 400).length,
        // Another planner removes the museum guide once the Save here has committed.
        savedThenHeard: (save) => h.late(ex.planPrintJobs, save, (jobs) => { const next = new Map(jobs); next.delete("J-1002"); return next as typeof jobs; }),
    });
    expect((await readJobs()).has("J-1002")).toBe(false);
});

// ── A job another planner removes or changes under a draft of it here ─────

/** Another planner's write: the jobs as it leaves them, from the jobs as e3 holds them now. */
async function theirs(change: (jobs: Map<string, Awaited<ReturnType<typeof readJobs>> extends ReadonlyMap<string, infer Job> ? Job : never>) => void): Promise<void> {
    const jobs = new Map(await readJobs());
    change(jobs);
    await h.patch(ex.planPrintJobs, jobs);
    await settle();
}

/** The customer the inspector shows of the job selected; `null` where it shows none. */
const customer = (c: HTMLElement) => slot(c, "end")?.querySelector<HTMLInputElement>("[data-inspector-fields='form'] [data-field='customer'] input")?.value ?? null;

/** What the shared checks take of the Plan, over the spring catalogue on Press A1. */
const job = (c: HTMLElement) => ({
    e3: h.e3, container: c,
    // The canvas's own reads of the jobs: its window's searches, runs and pages, never the reads a session makes by key.
    reads: (request: E3Request) => request.dataset === JOBS && (request.kind === "find" || request.kind === "runs" || request.kind === "within" || request.kind === "page"),
    // The session's reads of the jobs its drafts hold, by their keys.
    byKey: (request: E3Request) => request.dataset === JOBS && request.kind === "rows",
    drawn: () => bar(c, "J-1001") !== null,
    theirRemoval: () => theirs((jobs) => { jobs.delete("J-1001"); }),
    held: async () => (await readJobs()).has("J-1001"),
    name: "Spring catalogue",
});

/** The job selected, as a click selects it. */
const select = (c: HTMLElement) => () => { fireEvent.click(bar(c, "J-1001")!); };
/** The job removed here: selected, then Delete. */
const remove = (c: HTMLElement) => [select(c), () => { fireEvent.keyDown(bar(c, "J-1001")!, { key: "Delete" }); }];
/** The job's customer typed here in the inspector: a draft. */
const change = (c: HTMLElement) => [select(c), async () => {
    const input = pane(c).querySelector<HTMLInputElement>("[data-inspector-fields='form'] [data-field='customer'] input")!;
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "Customer here{Enter}");
}];

/** The print works mounted, the spring catalogue drawn on Press A1. */
async function mounted(storageKey: string): Promise<HTMLElement> {
    const { container: c } = await h.mount(ex.planPrintWorks, { storageKey });
    await settle();
    await waitFor(() => expect(bar(c, "J-1001")).not.toBeNull());
    return c;
}

test.each([
    ["its session's read of it landing first, kept: the next Save puts it back as drafted", "draft", "session"],
    ["its session's read of it landing first, let go: the job leaves and nothing is left to save", "source", "session"],
    ["the canvas's window read again without it first, kept: the next Save puts it back as drafted", "draft", "rows"],
    ["the canvas's window read again without it first, let go: the job leaves and nothing is left to save", "source", "rows"],
] as const)("a job changed here that another planner removes stands as drafted, a conflict to choose — %s", async (_ends, choice, first) => {
    const c = await mounted(`plan-remote-removed-there-${first}-${choice}`);
    await removedThere({ ...job(c), change: change(c), look: () => customer(c) }, choice, first);
});

test.each([["kept, the next Save removes it", "draft"], ["let go, the job is back as the other planner left it", "source"]] as const)(
    "a job removed here that another planner changed stays off the canvas while its window is read again, a conflict to choose, its card naming the job by its title: %s", async (_ends, choice) => {
        const c = await mounted(`plan-remote-removed-here-${choice}`);
        await removedHere({
            ...job(c), remove: remove(c),
            theirChange: () => theirs((jobs) => { jobs.set("J-1001", { ...jobs.get("J-1001")!, customer: "Customer there" }); }),
        }, choice);
    });

test("a job removed here and by another planner is nothing to choose and nothing to save, and the canvas never draws it again — nor while its window, standing from before the other planner's write, is read again", async () => {
    const c = await mounted("plan-remote-removed-both");
    await removedOnBothSides({ ...job(c), remove: remove(c) });
});
