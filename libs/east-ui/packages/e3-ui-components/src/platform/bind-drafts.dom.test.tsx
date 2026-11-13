/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The binds' examples of a call over drafts (#1620), each mounted on e3 as the
 * showcase mounts it and its buttons pressed: what the example's description
 * says is what a person then reads on the page, and nothing is saved — read
 * back from e3 itself: each record's state, its newest commit and the request
 * log.
 *
 * What a handle and a call do with drafts, case by case, is
 * `test/func-drafts.spec.ts`'s. This holds the examples an author copies to
 * the same behaviour, drawn.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { equalFor, printFor, type EastType, type ValueTypeOf } from "@elaraai/east";
import * as fx from "@elaraai/e3-ui/examples/bind/func/func";
import * as rx from "@elaraai/e3-ui/examples/bind/record/record";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import type { E3Record } from "../e3-web.test-utils.js";

const h = e3Harness({ "bind/func/func": fx, "bind/record/record": rx });

/** Presses a button, by the name a person reads on it, and lets what it started end. */
async function press(container: HTMLElement, name: string): Promise<void> {
    await act(async () => { fireEvent.click(within(container).getByRole("button", { name })); });
    await settle();
}

/** What a Stat shows under its label. */
function stat(container: HTMLElement, label: string): string | null {
    const term = within(container).getByText(label, { exact: true });
    return term.closest("dl")?.querySelector("dd")?.textContent ?? null;
}

/** The commit a record stands at, as e3's history of it names it. */
async function head(record: { readonly name: string }): Promise<string> {
    const [newest] = (await h.history(record)).commits;
    if (newest === undefined) throw new Error(`${record.name} has no commit`);
    return newest.hash;
}

/** A record as e3 holds it before a test's presses, to hold it to afterwards. */
async function asSaved<T extends EastType>(record: E3Record<T>) {
    const state: ValueTypeOf<T> = await h.read(record);
    const stood = await head(record);
    const same = equalFor(record.type);
    const print = printFor(record.type);
    return {
        /** The commit it stood at. */
        stood,
        /** Holds: its state is what it was, it stands at the commit it stood at, and no write of it was sent. */
        async unchanged(): Promise<void> {
            const now = await h.read(record);
            expect(same(now, state), print(now)).toBe(true);
            expect(await head(record), "no commit was made").toBe(stood);
            expect(h.requests("mutate", record.name), "no write was sent").toEqual([]);
        },
    };
}

test("funcBindDrafts: a call with a draft reads the record with the edit laid over it, an empty Array reads it as saved, and the record stays as saved", async () => {
    const jobs = await asSaved(fx.pressJobs);
    const { container } = await h.mount(fx.funcBindDrafts);
    expect(stat(container, "Jobs on P1"), "before any call").toBe(".none");

    // j1 and j2 are on P1 as saved; the draft moves j3 beside them.
    await press(container, "As saved");
    await waitFor(() => expect(stat(container, "Jobs on P1")).toBe(".some 2"));
    await press(container, "With j3 moved to P1");
    await waitFor(() => expect(stat(container, "Jobs on P1")).toBe(".some 3"));
    // The draft was laid for that call alone: a call as saved reads two again.
    await press(container, "As saved");
    await waitFor(() => expect(stat(container, "Jobs on P1")).toBe(".some 2"));

    await jobs.unchanged();
});

test("funcBindDrafted: drafts of two records in one call are read together, drafted() names each at the commit it stood at, and binding.drafts the records the function lists — neither record saved", async () => {
    const jobs = await asSaved(fx.pressJobs);
    const shop = await asSaved(fx.presses);
    const { container } = await h.mount(fx.funcBindDrafted);
    const figure = "P1 with j3 and a ten-hour day";
    expect(stat(container, figure), "before any call").toBe("not asked yet");
    expect(within(container).getByText("May draft: press_jobs, presses", { exact: true })).toBeTruthy();
    expect(within(container).getByText("Read over:", { exact: true }), "nothing drafted before a call").toBeTruthy();

    // j1 (4 h) and j2 (2 h) with j3 (6 h) moved beside them, on a press whose day the draft makes ten hours.
    await press(container, "Load P1 with my edits");
    await waitFor(() => expect(stat(container, figure)).toBe("12 h of 10 h, 3 jobs"));
    const beneath = `Read over: press_jobs at ${jobs.stood.substring(0, 8)}, presses at ${shop.stood.substring(0, 8)}`;
    expect(within(container).getByText(beneath, { exact: true })).toBeTruthy();

    await jobs.unchanged();
    await shop.unchanged();
});

test("funcBindDraftRefused: a draft the record refuses ends the call and the page says which — a conflict in the record's words where the record changed under the edit, the mutation's failure where its program refuses — and nothing is saved", async () => {
    const jobs = await asSaved(fx.pressJobs);
    const { container } = await h.mount(fx.funcBindDraftRefused);
    expect(within(container).getByText("no draft refused", { exact: true })).toBeTruthy();

    // The edit began from j1 on P2, and the record holds it on P1.
    await press(container, "A stale edit");
    const lead = "press_jobs.patch changed under the edit: ";
    const conflict = await waitFor(() => within(container).getByText((text) => text.startsWith(lead)));
    expect((conflict.textContent ?? "").length, "in the record's own words").toBeGreaterThan(lead.length);

    // The shop holds no j9: the move's own program refuses it.
    await press(container, "An unknown job");
    await waitFor(() => expect(
        within(container).getByText("draft press_jobs.move (1 of 1) failed with exit code 1; the function did not run", { exact: true }),
    ).toBeTruthy());

    await jobs.unchanged();
});

test("recordBindDraft: a mutation as a draft is asked about and not committed — the function reads the counter with the draft laid over it, and the counter stays as saved", async () => {
    const counter = await asSaved(rx.counter);
    const { container } = await h.mount(rx.recordBindDraft);
    expect(stat(container, "Counter, as saved")).toBe("0");
    expect(stat(container, "Within 10 after 25 more"), "before any call").toBe(".none");

    // 0 and 25 more is past the limit of 10, which the function reads without the 25 being committed.
    await press(container, "Ask about 25 more");
    await waitFor(() => expect(stat(container, "Within 10 after 25 more")).toBe(".some false"));
    expect(stat(container, "Counter, as saved")).toBe("0");

    await counter.unchanged();
});
