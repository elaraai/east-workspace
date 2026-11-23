/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Plan whose event kind holds each event's key in a field of its row
 * (`keyField`, east-workspace#1705, #1709), over the print works' jobs
 * (`flowsPlan`), each job's customer its key field: a job duplicated holds its
 * own key there from the first — never the customer of the job it copies —
 * and Save writes it so; a job the record held already keeps what its field
 * holds.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { StringType, equalFor } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { act, el, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";
import { flowsPlan } from "./flows.test-utils.js";

const h = planHarness();
const sameKey = equalFor(StringType);

/** A job's bar on Press A1, by its key. */
const job = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(entry("presses", "a1"))} ${el("data-run", "job", key)}`);
/** How many changes wait on Save, as the footer says it. */
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;

test("ruling 1 — holding its key in a field (`keyField`), a job duplicated holds its own key in its customer from the first, never the customer of the job it copies; Save writes it so, and the job it copies keeps its own", async () => {
    const { container: c } = await h.mount(flowsPlan({ jobKeyField: "customer" }));
    await settle();
    const before = await h.read(ex.planLinkCaseJobs);
    fireEvent.click(job(c, "J-2001")!);
    await settle();
    await act(async () => { fireEvent.click(slot(c, "end")!.querySelector('[data-inspector-action="duplicate"]')!); });
    await settle();
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
    await waitFor(() => expect(pending(c)).toBe("0 pending"));
    const jobs = await h.read(ex.planLinkCaseJobs);
    const made = [...jobs.keys()].filter((key) => !before.has(key));
    expect([made.length, jobs.size]).toEqual([1, before.size + 1]);
    const copy = jobs.get(made[0]!)!;
    expect([sameKey(copy.customer, made[0]!), copy.title, jobs.get("J-2001")!.customer]).toEqual([true, "Catalogue covers", before.get("J-2001")!.customer]);
});
