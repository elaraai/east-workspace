/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Sheet (#1409, #1418, east-workspace#1622; `Optimise Spec.md`
 * §9, R25) on e3: the shop's optimiser is the example's own `e3.function`,
 * called by name on e3 once per run. The eye shows only with an optimiser
 * (R6); a click sends one call — the run's number and the rail's narrowing,
 * and no row (R1, R25): the function reads the orders itself, the sheet's
 * unsaved edits laid over them as a draft — and while it is out the eye runs,
 * the footer counts, the history is locked and no cell takes an edit (R2); the
 * answer's patch lands as one edit (R7, R8), cell by cell: a blank given a
 * value an add, a value changed a change, each named for the run on hover,
 * the banner saying what changed — and one Undo reverts it all, Redo replays
 * the landing without the banner, Save commits it with everything else (R9,
 * R11). Stop ignores a late answer (R3); nothing to change and a failed call
 * say so (R10). An order typed Scheduled and not saved is the function's
 * input: it plans around it. An answer that changes a row whose own edit is
 * not finished — a value it requires cleared — is refused, naming the row
 * (rule 11). A call that ends `conflict` — another page saved under the
 * sheet's unsaved edits — lands nothing, and takes the path a refused Save
 * takes (rule 12): with nothing to choose it goes again by itself over the
 * newer save and lands; with a conflict to choose the run ends saying so, and
 * the person chooses before running again. What it does with any answer — one that inserts, updates and
 * deletes, one that replaces the whole Dict, another page's save while the
 * call is out, a key another page takes, a row whose reference builds its key
 * (east-workspace#1709, ruling 14), and the run's mark on a row a person then
 * gives another reference (ruling 16) — is the builders' shared cases
 * (`optimise-cases.test-utils.ts`), over the orders; a sheet has no period for
 * an answer to leave.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, none } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Func, Record, Sheet } from "@elaraai/e3-ui";
import { editingMessages } from "@elaraai/east-ui-components";
import * as opt from "@elaraai/e3-ui/examples/sheet/optimise";
import { act, conflictCards, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { patchRecord } from "../e3-web.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { optimiseCases } from "../shared/func/optimise-cases.test-utils.js";
import "./frame/index.js";

const h = e3Harness({ "sheet/optimise": opt });
const calls = fitCalls(h, { request: Sheet.Types.OptimiseRequest(), result: Sheet.Types.OptimiseResult(opt.OptimiseWorkOrders) });

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const history = (c: HTMLElement, name: string) => toolbar(c).getByRole("button", { name });
/** The cells a run changed, by the operation drawn on them. */
const marked = (c: HTMLElement, op?: string) => c.querySelectorAll<HTMLElement>(op === undefined ? "[data-slot=cell][data-op]" : `[data-slot=cell][data-op="${op}"]`);
const cell = (c: HTMLElement, id: string, key: string) => c.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-slot=cell][data-key="${key}"]`)!;
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const words = (el: HTMLElement) => [el.querySelector("[data-banner-title]")!.textContent, el.querySelector("[data-banner-body]")!.textContent];
const line = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-slot=footer] [data-footer-line]")!;
/** The highlight is on the frame's own root (#1409): the sheet has no root of its own around it. */
const lit = (c: HTMLElement) => c.querySelector("[data-builder-frame]")!.hasAttribute("data-optimise-lit");
/** The tab's rows, as the eye names them: `Optimise {period}`. */
const period = (c: HTMLElement) => eye(c)!.getAttribute("aria-label")!.replace(/^Optimise /, "");
const commits = async () => (await h.history(opt.optimiseWorkOrders)).commits.map(commit => commit.mutation);
/** Waits for a run's answer to land — e3 runs the optimiser's function for it, which takes its time. */
const landed = (c: HTMLElement, n: number) => waitFor(() => expect(marked(c)).toHaveLength(n), { timeout: 10_000 });
/** Waits for a banner of a kind — the answer's, once e3 has given it. */
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 10_000 });
/** The three orders with no due date, which the optimiser schedules. */
const READY = ["WO-1005", "WO-1007", "WO-1008"];
/** Types a cell's new text in the row's editor, committed with ⏎. */
async function typeInto(target: Element, text: string) {
    await act(async () => { fireEvent.doubleClick(target); });
    await settle();
    const input = document.querySelector('[data-slot="editorInput"]')!;
    await act(async () => { fireEvent.input(input, { target: { value: text } }); });
    await settle();
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await settle();
}

describe("the eye in the Sheet", () => {
    test("R6 — the eye shows for a Sheet with an optimiser, named for the tab's rows, immediately before the history item", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        expect([eye(container)!.getAttribute("aria-label"), eye(container)!.disabled, eye(container)!.hasAttribute("data-running")]).toEqual(["Optimise 8 rows", false, false]);
        const items = [...slot(container, "toolbar").querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item"));
        expect(items.indexOf("history") - items.indexOf("optimise")).toBe(1);
    });

    test("R1, R2, R25 — one call asking the run's number and the rail's narrowing, and no row; the lock while it is out", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        const at = period(container);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        expect([eye(container)!.hasAttribute("data-running"), eye(container)!.getAttribute("aria-label")]).toEqual([true, "Stop optimising"]);
        expect([line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent]).toEqual(["busy", `Optimising ${at}`]);
        for (const name of [editingMessages.undo(), editingMessages.redo(), editingMessages.discard(), editingMessages.apply()]) {
            expect(history(container, name).getAttribute("aria-disabled")).toBe("true");
        }
        // No cell takes an edit, and no row has a grip.
        await act(async () => { fireEvent.doubleClick(cell(container, "WO-1005", "status")); });
        expect([container.querySelector("[data-sheet-card] input"), container.querySelector("[data-drag-grip]")]).toEqual([null, null]);
        expect(calls.requests()).toHaveLength(1);
        const asked = calls.requests()[0]!;
        // The request carries no row, and with no rail no narrowing: the function reads the orders itself.
        expect(Object.keys(asked).sort()).toEqual(["run", "slice"]);
        expect([asked.run, asked.slice.size]).toEqual([1n, 0]);
        hold.release();
        await landed(container, 6);
        // The answer is a patch of the orders' record: the three Ready orders, each updated.
        const answered = calls.answers()[0]!.rows;
        expect(answered.type === "patch" ? [...answered.value].map(([key, change]) => [key, change.type]) : answered.type)
            .toEqual(READY.map(id => [id, "update"]));
        expect([eye(container)!.hasAttribute("data-running"), line(container).hasAttribute("data-idle")]).toEqual([false, true]);
        expect(container.querySelector("[data-sheet-card] [data-slot=cell][data-editable]")).not.toBeNull();
    });

    test("R7–R9, R11, R25 — the result lands as one edit, cell by cell: the due dates added and the statuses changed, each named for the run; the banner and the legend; one Undo reverts it, Redo replays it without the banner, Save commits it as one patch", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        const deployed = await commits();
        await press(eye(container));
        await landed(container, 6);
        const at = period(container);
        // A blank given a value is an add, a value changed a change (R25), each cell's value marked to fade in.
        expect([marked(container, "add").length, marked(container, "chg").length, marked(container, "del").length]).toEqual([3, 3, 0]);
        for (const id of READY) {
            expect([cell(container, id, "due").getAttribute("data-op"), cell(container, id, "due").getAttribute("data-fill"), cell(container, id, "due").getAttribute("title")]).toEqual(["add", "cell", "Added by Elara · run #1"]);
            expect([cell(container, id, "status").getAttribute("data-op"), cell(container, id, "status").getAttribute("title")]).toEqual(["chg", "Was Ready · Elara run #1"]);
            expect(cell(container, id, "status").querySelector("[data-op-value]")).not.toBeNull();
        }
        expect(cell(container, "WO-1001", "due").hasAttribute("data-op")).toBe(false);
        expect(words(banner(container, "done")!)).toEqual([`Elara optimised ${at}`, "3 changes: 3 changed. Undo or apply them like any edit."]);
        expect([lit(container), container.querySelector("[data-slot=footer] [data-optimise-legend]")?.textContent]).toEqual([true, "Elara change"]);
        // One step: one Undo takes the whole run back, and ends its highlight and its banner.
        await press(history(container, editingMessages.undo()));
        expect([marked(container).length, lit(container)]).toEqual([0, false]);
        await waitFor(() => expect(container.querySelector("[data-optimise-banner]:not([data-leaving])")).toBeNull());
        // Redo re-inserts it and replays the landing, without the banner — the Undo's may still be collapsing.
        await press(history(container, editingMessages.redo()));
        await landed(container, 6);
        await waitFor(() => expect(lit(container)).toBe(true));
        expect(container.querySelector('[data-optimise-banner="done"]:not([data-leaving])')).toBeNull();
        // Save commits the run with everything else, as one patch; nothing is marked once nothing is pending.
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]), { timeout: 10_000 });
        await waitFor(() => expect(marked(container)).toHaveLength(0));
        const orders = await h.read(opt.optimiseWorkOrders);
        expect(READY.map(id => [orders.get(id)!.due.type, orders.get(id)!.status])).toEqual([["some", "Scheduled"], ["some", "Scheduled"], ["some", "Scheduled"]]);
        expect([lit(container), container.querySelector("[data-optimise-banner]")]).toEqual([false, null]);
    });

    test("R3 — Stop cancels the call: the footer says so, a late answer is ignored, and nothing is recorded", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        await press(eye(container));
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent])
            .toEqual([false, "note", "Stopped · nothing changed"]);
        hold.release();
        await settle();
        expect([calls.requests().length, marked(container).length, container.querySelector("[data-optimise-banner]")]).toEqual([1, 0, null]);
        expect((history(container, editingMessages.apply()) as HTMLButtonElement).disabled).toBe(true);
    });

    test("R10 — a result that changes nothing is said so, the eye blinking; a failed call is an alert until the next run", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        await press(eye(container));
        await landed(container, 6);
        // The drafts are the next run's input (O5): with every order due, the optimiser changes nothing.
        // The blink lasts 560ms, which a slow machine can spend before the banner is read: what it did is watched.
        let blinked = false;
        const watching = new MutationObserver(() => { blinked ||= eye(container)!.hasAttribute("data-blink"); });
        watching.observe(container, { subtree: true, attributes: true, attributeFilter: ["data-blink"] });
        await press(eye(container));
        await said(container, "none");
        watching.disconnect();
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, blinked, calls.requests().length]).toEqual([true, true, 2]);
        expect(marked(container)).toHaveLength(6);
        const restore = calls.fail();
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Nothing changed. Run it again from the eye."]);
        expect([banner(container, "fail")!.querySelector("[role=alert]") !== null, marked(container).length]).toEqual([true, 6]);
        restore();
    });

    test("rule 1 — the sheet's unsaved edits are the run's input, sent as a draft of the orders' record: an order typed Scheduled and not saved is planned around; nothing is written before Save, which commits the typed edit and the answer together", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        const deployed = await commits();
        await typeInto(cell(container, "WO-1005", "status"), "Scheduled");
        await press(eye(container));
        await landed(container, 4);
        // One draft, of the orders' record, a call of its patch door — and the function read WO-1005 as typed: no longer Ready.
        expect(calls.drafts()).toEqual([[{ record: opt.optimiseWorkOrders.name, mutation: "patch" }]]);
        const answered = calls.answers()[0]!.rows;
        expect(answered.type === "patch" ? [...answered.value.keys()] : answered.type).toEqual(["WO-1007", "WO-1008"]);
        expect(words(banner(container, "done")!)[1]).toBe("2 changes: 2 changed. Undo or apply them like any edit.");
        expect([cell(container, "WO-1005", "status").hasAttribute("data-op"), cell(container, "WO-1005", "due").hasAttribute("data-op")]).toEqual([false, false]);
        // The call saved nothing: the record stands as deployed until Save.
        expect(await commits()).toEqual(deployed);
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]), { timeout: 10_000 });
        const orders = await h.read(opt.optimiseWorkOrders);
        expect(READY.map(id => [orders.get(id)!.due.type, orders.get(id)!.status])).toEqual([["none", "Scheduled"], ["some", "Scheduled"], ["some", "Scheduled"]]);
    });

    test("rule 11 — an answer that changes a row whose own edit is not finished is refused whole, naming the row: its quantity is cleared, a value the row requires, so the function read the row as saved; nothing lands, and the edit stays", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        await typeInto(cell(container, "WO-1005", "quantity"), "");
        expect(cell(container, "WO-1005", "quantity").closest('[data-slot="row"]')!.hasAttribute("data-incomplete")).toBe(true);
        await press(eye(container));
        await said(container, "fail");
        // The unfinished edit was no part of the draft: the function read WO-1005 as saved, Ready with no due date, and changed it.
        const answered = calls.answers()[0]!.rows;
        expect(answered.type === "patch" ? [...answered.value.keys()] : answered.type).toEqual(READY);
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Elara's answer changes WO-1005, whose edit is not finished. Nothing changed."]);
        expect([marked(container).length, lit(container)]).toEqual([0, false]);
        expect([cell(container, "WO-1005", "quantity").hasAttribute("data-blank"), cell(container, "WO-1005", "quantity").getAttribute("title")]).toEqual([true, "A value is required"]);
        expect(READY.map(id => cell(container, id, "status").textContent)).toEqual(["Ready", "Ready", "Ready"]);
    });
});

describe("a record that changed under the sheet's edits (rule 12)", () => {
    /** The orders as another page leaves them: one order's field set, the rest as e3 holds them. */
    const another = async (id: string, change: Partial<Awaited<ReturnType<typeof h.read<typeof opt.optimiseWorkOrders.type>>> extends ReadonlyMap<string, infer R> ? R : never>) => {
        const orders = await h.read(opt.optimiseWorkOrders);
        const next = new Map(orders);
        next.set(id, { ...next.get(id)!, ...change });
        // Committed as another page's Save, and this page told nothing of it.
        await patchRecord(h.e3, h.workspace, opt.optimiseWorkOrders, next);
    };

    test("no conflict — another page saved another order: the sheet's draft lays over the newer save, the function reads both, and the answer lands once the sheet has read the save; Save keeps all three", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        const deployed = await commits();
        await typeInto(cell(container, "WO-1005", "status"), "Scheduled");
        await another("WO-1001", { job: "Cut panels · rush" });
        await press(eye(container));
        await said(container, "done");
        expect([calls.outcomes(), calls.drafts().map(drafts => drafts.length), container.querySelector('[data-session-banner="conflicts"]')]).toEqual([["success"], [1], null]);
        expect(words(banner(container, "done")!)[1]).toBe("2 changes: 2 changed. Undo or apply them like any edit.");
        expect(cell(container, "WO-1001", "job").textContent).toContain("Cut panels · rush");
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", "patch", ...deployed]), { timeout: 10_000 });
        const orders = await h.read(opt.optimiseWorkOrders);
        expect([orders.get("WO-1001")!.job, ...READY.map(id => [orders.get(id)!.due.type, orders.get(id)!.status])])
            .toEqual(["Cut panels · rush", ["none", "Scheduled"], ["some", "Scheduled"], ["some", "Scheduled"]]);
    });

    test("nothing to choose — another page saved the same change of the order the sheet edited: the call ends `conflict` and lands nothing; the sheet takes the save in, its edit carried over to nothing left to save, and the call goes again by itself and lands", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        const deployed = await commits();
        await typeInto(cell(container, "WO-1005", "status"), "Scheduled");
        await another("WO-1005", { status: "Scheduled" });
        await press(eye(container));
        await said(container, "done");
        // Two calls for the one run: the first over a draft of the record as the sheet held it, refused; the second with no
        // draft left to send — the other page's save is the sheet's edit.
        expect([calls.outcomes(), calls.drafts().map(drafts => drafts.length), container.querySelector('[data-session-banner="conflicts"]')]).toEqual([["conflict", "success"], [1, 0], null]);
        expect(words(banner(container, "done")!)[1]).toBe("2 changes: 2 changed. Undo or apply them like any edit.");
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", "patch", ...deployed]), { timeout: 10_000 });
        const orders = await h.read(opt.optimiseWorkOrders);
        expect(READY.map(id => [orders.get(id)!.due.type, orders.get(id)!.status])).toEqual([["none", "Scheduled"], ["some", "Scheduled"], ["some", "Scheduled"]]);
    });

    test("a conflict to choose — another page saved the order the sheet edited: the call ends `conflict`, and the run ends saying so in the refused Save's words; nothing lands, no second call is made, and the conflict waits in the history bar", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        await typeInto(cell(container, "WO-1005", "status"), "Scheduled");
        await another("WO-1005", { status: "Done" });
        await press(eye(container));
        await said(container, "fail");
        expect(calls.outcomes()).toEqual(["conflict"]);
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "1 of your changes conflicts with newer changes. Nothing changed."]);
        expect([marked(container).length, lit(container)]).toEqual([0, false]);
        await waitFor(() => expect(container.querySelector('[data-session-banner="conflicts"]')).not.toBeNull());
        const [conflict, ...more] = await conflictCards(container);
        expect([more, conflict!.yours]).toEqual([[], "Yours, Scheduled"]);
        // Chosen, the next run goes: the draft is laid over the other page's save, and the answer lands.
        await act(async () => { fireEvent.click(conflict!.radio("draft")); });
        await settle();
        await press(eye(container));
        await said(container, "done");
        expect(calls.outcomes()).toEqual(["conflict", "success"]);
        expect(words(banner(container, "done")!)[1]).toBe("2 changes: 2 changed. Undo or apply them like any edit.");
    });
});

/** The orders with the shop's optimiser, each keyed by the key its reference builds (`rowKey`, east-workspace#1709). */
const keyedOrders = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const orders = $.let(Record.bind(opt.optimiseWorkOrders));
    const optimise = $.let(Func.bind(opt.setDueDates));
    return Sheet({
        record: orders, name: "sheetOptimiseKeyed", optimise, rowKey: (order) => order.reference,
        columns: {
            reference: Sheet.column.text(opt.OptimiseWorkOrder, { header: "Reference" }),
            job: Sheet.column.text(opt.OptimiseWorkOrder, { header: "Job" }),
            status: Sheet.column.text(opt.OptimiseWorkOrder, { header: "Status" }),
            quantity: Sheet.column.integer(opt.OptimiseWorkOrder, { header: "Quantity" }),
        },
    });
}))) };

// The orders, and one the optimiser adds.
optimiseCases<typeof opt.OptimiseWorkOrder>({
    builder: "the Sheet", h,
    mounted: async () => (await h.mount(opt.sheetOptimise)).container,
    record: opt.optimiseWorkOrders,
    answer: (patch) => { calls.answer({ rows: patch as never }); },
    add: ["WO-1009", { reference: "WO-1009", job: "Cut panels", status: "Ready", due: none, quantity: 250n }],
    change: ["WO-1002", (order) => ({ ...order, quantity: 1500n })],
    remove: "WO-1004",
    other: ["WO-1006", (order) => ({ ...order, job: "Edge band · rush" })],
    // An order the answer gives a new reference stands under it; one given another order's is refused.
    keyed: {
        mounted: async () => (await h.mount(keyedOrders)).container,
        move: ["WO-1005", (order) => ({ ...order, reference: "WO-2005" }), "WO-2005"],
        taken: [(order) => ({ ...order, reference: "WO-1001" }), 'Another row is keyed "WO-1001" already'],
        op: (c, key) => c.querySelector<HTMLElement>(`[data-row-id="${key}"] [data-slot=cell][data-op]`)?.getAttribute("data-op") ?? undefined,
        another: "WO-1006",
        drawn: (c, key) => c.querySelector(`[data-row-id="${key}"]`) !== null,
        // The order's reference typed in its cell.
        rename: (c, key, to) => typeInto(cell(c, key, "reference"), to),
    },
});
