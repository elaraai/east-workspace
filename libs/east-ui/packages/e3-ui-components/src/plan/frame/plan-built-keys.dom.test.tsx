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
 * writes the job and its flows so. So moved, it is the job it was, edited: its
 * form tints only the field the edit changed. An edit its key refuses says why under its
 * field: the key it would build is another job's, or — the flows bound read
 * only — its flows cannot follow it. Duplicate is off for a job standing
 * under the key its row builds, whose copy would build that key too. A link
 * kind that builds its links' keys says a refused key the same way, under the
 * field of the link's own form. And over presses the rail's `rows` source
 * pages, jobs keyed by a variant — a composite's key — read a cell at a time
 * through their own source of the rail (`planTypedKeysPaged`,
 * east-workspace#1696): a job is drawn, selected, carried a day on, and saved
 * under its typed key.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, OptionType, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import * as windows from "@elaraai/e3-ui/examples/plan/plan-windows";
import { retypeNumber } from "../../e3-web-mount.test-utils.js";
import { boundFrame } from "../../sheet/frame.test-utils.js";
import { carryRun } from "../plan-move.test-utils.js";
import { act, el, elementKey, entry, planHarness, ribbonWidth, rowAt, settle, slot } from "./harness.test-utils.js";
import { flowsPlan, type FlowsPlanOptions } from "./flows.test-utils.js";

const h = planHarness({ "plan/plan-events": ex, "plan/plan-windows": windows });

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
/** What the customer's field reads: its label, and under it why it refused an edit. */
const customerField = (c: HTMLElement) => pane(c).querySelector("[data-inspector-fields='form'] [data-field='customer']")!.textContent;
/** Whether Duplicate is off for the selected event. */
const duplicateOff = (c: HTMLElement) => pane(c).querySelector<HTMLButtonElement>('[data-inspector-action="duplicate"]')!.disabled;
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
        // Stored under another key than its customer builds, its copy would stand under one of its own: Duplicate is on.
        expect(duplicateOff(c)).toBe(false);
        await typeCustomer(c, "Quay Books");
        // Under the key its customer builds, its bar where it was, the inspector on it still.
        expect([job(c, "J-2001"), job(c, "Quay Books") !== null, inspected(c)]).toEqual([null, true, "Catalogue covers"]);
        expect([job(c, "Quay Books")!.getAttribute("aria-pressed"), customerBox(c).getAttribute("value")]).toEqual(["true", "Quay Books"]);
        // Its copy would build the key it now stands under: Duplicate is off.
        expect(duplicateOff(c)).toBe(true);
        // One step: Undo puts the job back under J-2001, and nothing is left to save — the job selected still, under the key
        // it is back under, the inspector on it.
        await press(c, editingMessages.undo());
        expect([job(c, "J-2001") !== null, job(c, "Quay Books"), pending(c)]).toEqual([true, null, "0 pending"]);
        expect([job(c, "J-2001")!.getAttribute("aria-pressed"), inspected(c)]).toEqual(["true", "Catalogue covers"]);
        // And Redo takes its selection back with it.
        await press(c, editingMessages.redo());
        expect([job(c, "Quay Books")?.getAttribute("aria-pressed"), inspected(c)]).toEqual(["true", "Catalogue covers"]);
        await press(c, editingMessages.apply());
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        const [jobs, flows] = [await h.read(ex.planLinkCaseJobs), await h.read(ex.planLinkFlows)];
        expect(sameFlow(flows.get("covers")!, { from: variant("job", "Quay Books"), to: variant("job", "J-2013"), sheets: some(12.0) })).toBe(true);
        expect([jobs.has("J-2001"), jobs.get("Quay Books")!.title, jobs.size, flows.size]).toEqual([false, "Catalogue covers", 23, 17]);
        expect(sameFlow(flows.get("plates")!, { from: variant("plate", "P-01"), to: variant("job", "Quay Books"), sheets: none })).toBe(true);
    });

    test("ruling 1 — a job moved under another key is the job it was, edited: its form tints the field the edit changed, never every field as a new job's", async () => {
        const { container: c } = await h.mount(flowsPlan(keyedByCustomer));
        await settle();
        fireEvent.click(job(c, "J-2001")!);
        await settle();
        await typeCustomer(c, "Quay Books");
        const changed = (name: string) => pane(c).querySelector(`[data-inspector-fields='form'] [data-field='${name}']`)!.hasAttribute("data-dirty");
        expect([job(c, "Quay Books") !== null, changed("customer"), changed("stock"), changed("due")]).toEqual([true, true, false, false]);
    });

    test("ruling 1 — a customer that builds a key another job stands under is refused, the job where it was, its field saying whose key it is; and where the flows are read only, a job a flow names stays under its key, its field saying its flows can't follow", async () => {
        const first = await h.mount(flowsPlan(keyedByCustomer));
        await settle();
        fireEvent.click(job(first.container, "J-2001")!);
        await settle();
        // Shop posters stand under J-2002.
        await typeCustomer(first.container, "J-2002");
        expect([job(first.container, "J-2001") !== null, inspected(first.container), pending(first.container)]).toEqual([true, "Catalogue covers", "0 pending"]);
        expect(customerField(first.container)).toContain('Another print job is keyed "J-2002" already');
        first.unmount();
        const { container: c } = await h.mount(flowsPlan({ ...keyedByCustomer, readOnly: true }), { storageKey: "plan-read-only-flows" });
        await settle();
        fireEvent.click(job(c, "J-2001")!);
        await settle();
        await typeCustomer(c, "Quay Books");
        expect([job(c, "J-2001") !== null, job(c, "Quay Books"), inspected(c), pending(c)]).toEqual([true, null, "Catalogue covers", "0 pending"]);
        expect(customerField(c)).toContain("Its flows can't follow this print job to another key");
    });

    test("ruling 1 — a link kind that builds each link's key from its row: sheets typed in a flow's own form move it under the key they build, and sheets that build a key another flow stands under are refused, the field saying whose key it is", async () => {
        const restore = ribbonWidth({ tall: true });
        try {
            // Each flow keyed by the sheets it moves, as East prints them: stored under their names, each stands apart from that key
            // until its sheets change.
            const keyedBySheets: FlowsPlanOptions = { key: (flow) => flow.sheets.match({ some: (_$, sheets) => East.str`${sheets}k`, none: () => "none" }) };
            const { container: c } = await h.mount(flowsPlan(keyedBySheets), { storageKey: "plan-keyed-flows" });
            await settle();
            fireEvent.click(c.querySelector(`${rowAt(A1)} [data-plan-control="links"]`)!);
            await settle();
            /** A flow's line on the canvas, by its key. */
            const flow = (key: string) => [...c.querySelectorAll("[data-link]")].find((path) => path.getAttribute("data-link-key") === elementKey("flow", key));
            /** The sheets' field of the selected flow's form: its box, and what it reads — its label, and under it why it refused an edit. */
            const sheets = () => pane(c).querySelector<HTMLElement>("[data-inspector-fields='form'] [data-field='sheets']")!;
            // The covers' flow, typed to move 30: under the key its sheets build.
            fireEvent.click(flow("covers")!);
            await settle();
            await retypeNumber(within(sheets()).getByRole("spinbutton"), "30");
            expect([flow("covers"), flow("30.0k") !== undefined]).toEqual([undefined, true]);
            // The posters' flow, which moves 24, typed to move 30 too: its sheets would build the key the covers' flow stands under.
            fireEvent.click(flow("posters")!);
            await settle();
            await retypeNumber(within(sheets()).getByRole("spinbutton"), "30");
            expect(sheets().textContent).toContain('Another flow is keyed "30.0k" already');
            expect(flow("posters")).not.toBeUndefined();
        } finally {
            restore();
        }
    });
});

describe("a Plan over rows read a page at a time, its jobs keyed by a variant (east-workspace#1696)", () => {
    const sameStart = equalFor(OptionType(DateTimeType));

    test("#1696 — the rail's `rows` source pages the presses, and the jobs, keyed by a variant, are read a cell at a time through their own source: a job is drawn, selected and shown in the inspector, carried a day on, a draft, and Save writes it under its typed key", async () => {
        // The example's frame is bounded, its rows drawn as tall as a browser lays them.
        const restore = boundFrame(2000);
        try {
            const { container: c } = await h.mount(windows.planTypedKeysPaged, { drag: true });
            await settle();
            // The trade price list, an order's: on Press 1002, Wednesday 7 October from six.
            const PRICE_LIST = variant("order", "J-8002");
            const bar = () => c.querySelector<HTMLElement>(el("data-run", "job", printFor(ex.PrintJobKey)(PRICE_LIST)));
            await waitFor(() => expect(bar()).not.toBeNull(), { timeout: 10_000 });
            fireEvent.click(bar()!);
            await settle();
            expect(inspected(c)).toBe("Trade price list");
            await carryRun(bar()!, { key: "ArrowRight" });
            expect([bar()!.hasAttribute("data-draft"), pending(c)]).toEqual([true, "1 pending"]);
            await press(c, editingMessages.apply());
            await waitFor(() => expect(pending(c)).toBe("0 pending"));
            const held = await h.read(windows.planKeyedWindowJobs);
            expect([held.size, sameStart(held.get(PRICE_LIST)!.start, some(new Date("2026-10-08T06:00:00Z")))]).toEqual([4, true]);
        } finally {
            restore();
        }
    });
});
