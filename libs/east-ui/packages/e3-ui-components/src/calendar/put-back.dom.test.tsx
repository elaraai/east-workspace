/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Calendar over jobs read whole, through a Save whose every part another
 * session puts back exactly before the board reads the jobs again (#1599), on
 * e3 itself: the check every builder runs (`shared/remote-rows.test-utils.ts`'
 * `putBackAfterSave`), over the conflicts example's jobs — a record the board
 * reads whole, its sessions under one history.
 *
 * The record then holds the bytes it held before the Save, so nothing it holds
 * tells when it was read: the Save is read back at what the page holds of the
 * record once it has read it since e3 answered (`record-runtime.ts`'
 * `settledOf`). Left to what the jobs show, the Save waited for good.
 *
 * - A job's customer typed here and saved, typed back by another session.
 * - A job removed here and saved, added back by another session as it was.
 */

import { test } from "vitest";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StringType, equalFor } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { putBackAfterSave } from "../shared/remote-rows.test-utils.js";
import { act, calendarHarness, event, settle, slot } from "./harness.test-utils.js";
import { parseEventKey } from "./model.js";

const h = calendarHarness();
const sameText = equalFor(StringType);
/** The jobs as e3 holds them now. */
const read = () => h.read(ex.calendarConflictJobs);

/** The customer the inspector shows of the job selected; `null` where it shows none. */
const customer = (c: HTMLElement) => slot(c, "end")?.querySelector<HTMLInputElement>('[data-field="customer"] input')?.value ?? null;
/** The jobs the board draws, by their keys, in order. */
const jobsDrawn = (c: HTMLElement): string[] => [...c.querySelectorAll<HTMLElement>("[data-calendar-event]")].flatMap((el) => {
    const parsed = parseEventKey(el.getAttribute("data-calendar-event")!);
    return parsed.success && sameText(parsed.value.kind, "job") ? [parsed.value.key] : [];
}).sort();
/** The first job selected, as a click selects it. */
const select = (c: HTMLElement) => () => { fireEvent.click(event(c, "job", "job1")); };

/** What the shared check takes of the Calendar: what e3 holds of the jobs, and a Save followed by a write that puts them back. */
async function putBack(c: HTMLElement) {
    const before = await read();
    return {
        container: c,
        held: async () => [...(await read())],
        savedThenPutBack: (save: () => void) => h.followed(ex.calendarConflictJobs, save, () => before),
    };
}

test("calendarConflicts: a job's customer typed here and saved, typed back by another session before the board reads the jobs again, is read back with the customer as it was — the Save never left saving, nothing asked, nothing left to save", async () => {
    const { container: c } = await h.mount(ex.calendarConflicts, { storageKey: "calendar-put-back-changed" });
    // The job selected to begin with, so the inspector shows its customer before the change and once it is read back.
    await act(async () => { select(c)(); }); await settle();
    await putBackAfterSave({
        ...await putBack(c),
        change: async () => {
            const input = slot(c, "end").querySelector<HTMLInputElement>('[data-field="customer"] input')!;
            const user = userEvent.setup();
            await user.clear(input);
            await user.type(input, "Customer here{Enter}");
        },
        look: () => customer(c),
    });
});

test("calendarConflicts: a job removed here and saved, added back by another session exactly as it was before the board reads the jobs again, stands on the board as e3 holds it — the Save never left saving, and the job never removed again", async () => {
    const { container: c } = await h.mount(ex.calendarConflicts, { storageKey: "calendar-put-back-removed" });
    await putBackAfterSave({
        ...await putBack(c),
        change: [select(c), () => { fireEvent.keyDown(event(c, "job", "job1"), { key: "Delete" }); }],
        look: () => jobsDrawn(c),
    });
});
