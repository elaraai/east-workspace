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
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { parseFor } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import type { E3Request } from "../../e3-web.test-utils.js";
import { addedOnBothSides } from "../../shared/remote-rows.test-utils.js";
import { act, el, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

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
