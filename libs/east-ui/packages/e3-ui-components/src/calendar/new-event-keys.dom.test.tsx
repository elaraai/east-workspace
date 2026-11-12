/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A new event's key over a kind read a window at a time (#1583), on e3 itself:
 * the operations calendar's jobs, whose record the Calendar never reads whole.
 * Its session cannot know which keys the record holds out of what it has read,
 * so a job made from a template is keyed by the template's key and a suffix
 * drawn at random — never the next in a row, which is an earlier copy's as
 * often as not.
 *
 * - A second job made from one template, the first saved and the page loaded
 *   again since, is a job of its own: keyed otherwise, saved by one request,
 *   the record never refusing it and nothing to choose. Keyed the next in a
 *   row, it took the first one's key again — the session of the page loaded
 *   again knew of none — and its Save was refused, the two a conflict to
 *   choose between.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { reloadPage } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, calendarHarness, settle, slot } from "./harness.test-utils.js";
import { parseEventKey } from "./model.js";

const h = calendarHarness();
/** The jobs as e3 holds them now. */
const read = () => h.read(ex.calendarJobs);
/** The keys of the jobs the board draws from a draft: those made here, still to save. */
const drafted = (c: HTMLElement): string[] => [...c.querySelectorAll<HTMLElement>("[data-calendar-event][data-drafted]")].flatMap((el) => {
    const key = parseEventKey(el.getAttribute("data-calendar-event")!);
    return key.success && key.value.kind === "job" ? [key.value.key] : [];
});
/** A button of the history bar, by its name. */
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole<HTMLButtonElement>("button", { name });
/** The library's first template — the bracket batch — created: its dialog's own Create makes the job. */
async function create(c: HTMLElement): Promise<void> {
    await act(async () => { fireEvent.click(within(slot(c, "start")).getByRole("button", { name: "Create" })); });
    await settle();
    await act(async () => { fireEvent.click(within(within(document.body).getByRole("dialog")).getByRole("button", { name: "Create" })); });
    await settle();
}
/** Presses Save and waits until nothing is left to save. */
async function save(c: HTMLElement): Promise<void> {
    await act(async () => { fireEvent.click(history(c, editingMessages.apply())); });
    await waitFor(() => expect(history(c, editingMessages.discard()).disabled, "nothing is left to save").toBe(true), { timeout: 8_000 });
    await settle();
}
/** The jobs' Saves sent from the `since`-th request on. */
const saves = (since: number) => h.requests().slice(since).filter((request: E3Request) => request.kind === "mutate" && request.record === ex.calendarJobs.name).length;
/** The keys of the bracket batches e3 holds: the jobs made from the template. */
const batches = async () => [...await read()].filter(([, job]) => job.title === "Bracket batch").map(([key]) => key);

test("a second job made from one template, the first saved and the page loaded again since, is a job of its own: keyed otherwise, one request, nothing refused and nothing to choose", async () => {
    const first = await h.mount(ex.calendarOperations, { storageKey: "calendar-keys-again" });
    await create(first.container);
    const [one, ...others] = drafted(first.container);
    expect([others, one]).toEqual([[], expect.stringMatching(/^brackets-[0-9a-f]{8}$/)]);
    await save(first.container);
    expect(await batches()).toEqual([one]);
    // The page loaded again: its session knows no key the record holds.
    reloadPage();
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-keys-again" });
    // Every banner the page shows from here on: a refused Save's among them.
    const banners = new Set<string>();
    const watch = new MutationObserver(() => { for (const el of c.querySelectorAll("[data-session-banner]")) banners.add(el.getAttribute("data-session-banner")!); });
    watch.observe(c, { subtree: true, childList: true, attributes: true });
    const since = h.requests().length;
    try {
        await create(c);
        const [two, ...more] = drafted(c);
        expect([more, two === one, two]).toEqual([[], false, expect.stringMatching(/^brackets-[0-9a-f]{8}$/)]);
        await save(c);
        expect([(await batches()).sort(), saves(since), [...banners], c.querySelector("[data-conflicts]")]).toEqual([[one, two].sort(), 1, [], null]);
    } finally {
        watch.disconnect();
    }
});
