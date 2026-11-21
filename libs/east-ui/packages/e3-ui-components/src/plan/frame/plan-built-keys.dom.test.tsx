/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Plan whose event kind builds each event's key from its row (`key`,
 * east-workspace#1709), over the print works' jobs and the flows between them
 * (`flowsPlan`): a job whose key is built from its customer — the field of
 * its row its form edits. A customer typed in the inspector moves the job
 * under the key it then builds, still selected, and takes the flows that name
 * it with it — each written to name its new key, in the same step — and Save
 * writes the job and its flows so. Flows bound read only cannot follow: the
 * edit is refused, the job where it was.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { equalFor, none, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { act, el, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";
import { flowsPlan, type FlowsPlanOptions } from "./flows.test-utils.js";

const h = planHarness();

/** Press A1's landing row of bars. */
const A1 = entry("presses", "a1");
/** A job's bar on Press A1, by its key. */
const job = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(A1)} ${el("data-run", "job", key)}`);
/** The inspector pane. */
const pane = (c: HTMLElement) => slot(c, "end")!;
/** The title the inspector's head shows. */
const inspected = (c: HTMLElement) => pane(c).querySelector("[data-inspector-title]")?.textContent ?? null;
/** The customer's box in the selected event's form. */
const customerBox = (c: HTMLElement) => within(pane(c).querySelector<HTMLElement>("[data-inspector-fields='form'] [data-field='customer']")!).getByRole("textbox");
/** How many changes wait on Save, as the footer says it. */
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;
/** Presses one of the history's buttons, by its name, and lets what it starts settle. */
async function press(c: HTMLElement, name: string) {
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name })); });
    await settle();
}
/** Types a customer into the selected event's form, as one edit. */
async function typeCustomer(c: HTMLElement, customer: string) {
    const box = customerBox(c);
    await act(async () => { fireEvent.change(box, { target: { value: customer } }); fireEvent.blur(box); });
    await settle();
}

const sameFlow = equalFor(ex.PrintFlow);
/** The print jobs keyed by their customers. */
const keyedByCustomer: FlowsPlanOptions = { jobKey: (print) => print.customer };

describe("a Plan whose event kind builds each event's key from its row", () => {
    test("ruling 1 — a job whose customer is typed moves under the key its customer builds, still selected, the flows that name it written to name its new key in the same step; Save writes the job and both flows", async () => {
        const { container: c } = await h.mount(flowsPlan(keyedByCustomer));
        await settle();
        // Catalogue covers, stored under J-2001: the plates feed it, and it feeds the catalogue.
        fireEvent.click(job(c, "J-2001")!);
        await settle();
        expect(inspected(c)).toBe("Catalogue covers");
        await typeCustomer(c, "Quay Books");
        // Under the key its customer builds, its bar where it was, the inspector on it still.
        expect([job(c, "J-2001"), job(c, "Quay Books") !== null, inspected(c)]).toEqual([null, true, "Catalogue covers"]);
        expect([job(c, "Quay Books")!.getAttribute("aria-pressed"), customerBox(c).getAttribute("value")]).toEqual(["true", "Quay Books"]);
        // One step: Undo puts the job back under J-2001, and nothing is left to save.
        await press(c, editingMessages.undo());
        expect([job(c, "J-2001") !== null, job(c, "Quay Books"), pending(c)]).toEqual([true, null, "0 pending"]);
        await press(c, editingMessages.redo());
        expect(job(c, "Quay Books")).not.toBeNull();
        await press(c, editingMessages.apply());
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        const [jobs, flows] = [await h.read(ex.planLinkCaseJobs), await h.read(ex.planLinkFlows)];
        expect(sameFlow(flows.get("covers")!, { from: variant("job", "Quay Books"), to: variant("job", "J-2013"), sheets: some(12.0) })).toBe(true);
        expect([jobs.has("J-2001"), jobs.get("Quay Books")!.title, jobs.size, flows.size]).toEqual([false, "Catalogue covers", 23, 17]);
        expect(sameFlow(flows.get("plates")!, { from: variant("plate", "P-01"), to: variant("job", "Quay Books"), sheets: none })).toBe(true);
    });

    test("ruling 1 — a customer that builds a key another job stands under is refused, the job where it was; and where the flows are read only, a job a flow names stays under its key", async () => {
        const first = await h.mount(flowsPlan(keyedByCustomer));
        await settle();
        fireEvent.click(job(first.container, "J-2001")!);
        await settle();
        // Shop posters stand under J-2002.
        await typeCustomer(first.container, "J-2002");
        expect([job(first.container, "J-2001") !== null, inspected(first.container), pending(first.container)]).toEqual([true, "Catalogue covers", "0 pending"]);
        first.unmount();
        const { container: c } = await h.mount(flowsPlan({ ...keyedByCustomer, readOnly: true }), { storageKey: "plan-read-only-flows" });
        await settle();
        fireEvent.click(job(c, "J-2001")!);
        await settle();
        await typeCustomer(c, "Quay Books");
        expect([job(c, "J-2001") !== null, job(c, "Quay Books"), inspected(c), pending(c)]).toEqual([true, null, "Catalogue covers", "0 pending"]);
    });
});
