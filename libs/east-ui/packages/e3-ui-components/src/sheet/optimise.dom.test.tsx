/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Sheet (#1409, #1418; `Optimise Spec.md` §9, R25) on e3: the
 * shop's optimiser is the example's own `e3.function`, called by name on e3
 * once per run. The eye shows only with an optimiser (R6); a click sends one
 * call over the tab's rows by key, as the session holds them (R1, R25), and
 * while it is out the eye runs, the footer counts, the history is locked and
 * no cell takes an edit (R2); the result lands as one edit (R7, R8), cell by
 * cell: a blank given a value an add, a value changed a change, each named
 * for the run on hover, the banner saying what changed — and one Undo
 * reverts it all, Redo replays the landing without the banner, Save commits
 * it with everything else (R9, R11). Stop ignores a late answer (R3);
 * nothing to change and a failed call say so (R10).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { Sheet } from "@elaraai/e3-ui";
import { editingMessages } from "@elaraai/east-ui-components";
import * as opt from "@elaraai/e3-ui/examples/sheet/optimise";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import "./frame/index.js";

const h = e3Harness({ "sheet/optimise": opt });
const calls = fitCalls(h, { request: Sheet.Types.OptimiseRequest(opt.OptimiseWorkOrder), result: Sheet.Types.OptimiseResult(opt.OptimiseWorkOrder) });

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

describe("the eye in the Sheet", () => {
    test("R6 — the eye shows for a Sheet with an optimiser, named for the tab's rows, immediately before the history item", async () => {
        const { container } = await h.mount(opt.sheetOptimise);
        expect([eye(container)!.getAttribute("aria-label"), eye(container)!.disabled, eye(container)!.hasAttribute("data-running")]).toEqual(["Optimise 8 rows", false, false]);
        const items = [...slot(container, "toolbar").querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item"));
        expect(items.indexOf("history") - items.indexOf("optimise")).toBe(1);
    });

    test("R1, R2, R25 — one call over the tab's rows by key, as the session holds them; the lock while it is out", async () => {
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
        expect([asked.run, asked.rows.size, [...asked.rows.keys()]]).toEqual([1n, 8, ["WO-1001", "WO-1002", "WO-1003", "WO-1004", "WO-1005", "WO-1006", "WO-1007", "WO-1008"]]);
        expect(READY.map(id => asked.rows.get(id)!.due.type)).toEqual(["none", "none", "none"]);
        hold.release();
        await landed(container, 6);
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
        await press(eye(container));
        await said(container, "none");
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, eye(container)!.hasAttribute("data-blink"), calls.requests().length]).toEqual([true, true, 2]);
        expect(marked(container)).toHaveLength(6);
        const restore = calls.fail();
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Nothing changed. Run it again from the eye."]);
        expect([banner(container, "fail")!.querySelector("[role=alert]") !== null, marked(container).length]).toEqual([true, 6]);
        restore();
    });
});
