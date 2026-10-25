/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Plan (#1409, #1419; `Optimise Spec.md` §9, R24) on e3: the
 * print works' optimiser is the example's own `e3.function`, called by name on
 * e3 once per run. The eye shows only with an optimiser (R6); a click sends
 * one call over the plan window — every job in it and the backlog by key, the
 * presses beside them (R1, R24) — and while it is out the eye runs, the footer
 * counts and the history is locked (R2); the result lands as one edit (R7,
 * R8): the backlog placed on the presses, each new bar marked and named for
 * the run, the banner saying what changed, the Backlog count and the footer's
 * `in backlog` flashing — and one Undo reverts it all, Redo replays the
 * landing without the banner, Save commits it with everything else (R9, R11).
 * Stop ignores a late answer (R3); nothing to change and a failed call say so
 * (R10).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as events from "@elaraai/e3-ui/examples/plan/plan-events";
import * as opt from "@elaraai/e3-ui/examples/plan/optimise";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import "./index.js";

const h = e3Harness({ "plan/plan-events": events, "plan/optimise": opt }, { main: "data-plan-body" });
const calls = fitCalls(h, { request: opt.PlanOptimiseRequest, result: opt.PlanOptimiseResult });

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const history = (c: HTMLElement, name: string) => toolbar(c).getByRole("button", { name });
const added = (c: HTMLElement) => c.querySelectorAll<HTMLElement>('[data-plan-body] [data-run][data-op="add"]');
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const words = (el: HTMLElement) => [el.querySelector("[data-banner-title]")!.textContent, el.querySelector("[data-banner-body]")!.textContent];
const line = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-slot=footer] [data-footer-line]")!;
const lit = (c: HTMLElement) => c.querySelector("[data-plan-frame]")!.hasAttribute("data-optimise-lit");
/** The window, as the eye names it: `Optimise {period}`. */
const period = (c: HTMLElement) => eye(c)!.getAttribute("aria-label")!.replace(/^Optimise /, "");
const backlogTab = (c: HTMLElement) => within(slot(c, "start")).getByRole("tab", { name: /^Backlog/ });
/** How many jobs the Backlog tab counts. */
const backlogCount = (c: HTMLElement) => Number(backlogTab(c).textContent!.replace(/^Backlog\s*/, ""));
const commits = async () => (await h.history(events.planEventJobs)).commits.map(commit => commit.mutation);
/** Waits for a run's answer to land — e3 runs the optimiser's function for it, which takes its time. */
const landed = (c: HTMLElement, n: number) => waitFor(() => expect(added(c)).toHaveLength(n), { timeout: 10_000 });
/** Waits for a banner of a kind — the answer's, once e3 has given it. */
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 10_000 });
/** Mounts the example and waits for the kinds' first read: the eye is enabled once the window is read. */
async function mounted() {
    const view = await h.mount(opt.planOptimise);
    await waitFor(() => expect(eye(view.container)!.disabled).toBe(false), { timeout: 10_000 });
    return view;
}

describe("the eye in the Plan", () => {
    test("R6 — the eye shows for a Plan with an optimiser, named for the window, immediately before the history item", async () => {
        const { container } = await mounted();
        expect([eye(container)!.getAttribute("aria-label")!.startsWith("Optimise "), eye(container)!.hasAttribute("data-running")]).toEqual([true, false]);
        const items = [...slot(container, "toolbar").querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item"));
        expect(items.indexOf("history") - items.indexOf("optimise")).toBe(1);
    });

    test("R1, R2, R24 — one call over the window and the backlog, the presses beside them; the lock while it is out", async () => {
        const { container } = await mounted();
        const at = period(container);
        const backlog = backlogCount(container);
        expect(backlog).toBeGreaterThan(0);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        expect([eye(container)!.hasAttribute("data-running"), eye(container)!.getAttribute("aria-label")]).toEqual([true, "Stop optimising"]);
        expect([line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent]).toEqual(["busy", `Optimising ${at}`]);
        for (const name of [editingMessages.undo(), editingMessages.redo(), editingMessages.discard(), editingMessages.apply()]) {
            expect(history(container, name).getAttribute("aria-disabled")).toBe("true");
        }
        expect(calls.requests()).toHaveLength(1);
        const asked = calls.requests()[0]!;
        expect([asked.run, asked.resources.presses.size > 0, asked.from.getTime(), asked.to.getTime()])
            .toEqual([1n, true, new Date("2026-10-05T00:00:00Z").getTime(), new Date("2026-11-02T00:00:00Z").getTime()]);
        expect([...asked.events.job.values()].filter(job => job.start.type === "none")).toHaveLength(backlog);
        hold.release();
        await landed(container, backlog);
        expect([eye(container)!.hasAttribute("data-running"), line(container).hasAttribute("data-idle")]).toEqual([false, true]);
    });

    test("R7–R9, R11 — the result lands as one edit: the backlog placed and marked, the banner and the legend; the counts flash; one Undo reverts it, Redo replays it without the banner, Save commits it as one patch", async () => {
        const { container } = await mounted();
        const backlog = backlogCount(container);
        const deployed = await commits();
        await press(eye(container));
        await landed(container, backlog);
        const at = period(container);
        const asked = calls.requests()[0]!;
        const waiting = [...asked.events.job].filter(([, job]) => job.start.type === "none").map(([key]) => key);
        expect([...added(container)].every(el => el.getAttribute("title")!.startsWith("Added by Elara · run #1") && el.getAttribute("data-fill") === "own")).toBe(true);
        expect(words(banner(container, "done")!)).toEqual([`Elara optimised ${at}`, `${backlog} changes: ${backlog} added. Undo or apply them like any edit.`]);
        expect([lit(container), container.querySelector("[data-slot=footer] [data-optimise-legend]")?.textContent]).toEqual([true, "Elara change"]);
        // The backlog is empty, its count flashing in the tab and in the footer.
        expect(backlogCount(container)).toBe(0);
        expect([slot(container, "start").querySelector("[data-tab-count][data-opn]"), container.querySelector('[data-plan-count="backlog"][data-opn]')].map(el => el !== null)).toEqual([true, true]);
        // One step: one Undo takes the whole run back, and ends its highlight and its banner.
        await press(history(container, editingMessages.undo()));
        expect([added(container).length, lit(container), backlogCount(container)]).toEqual([0, false, backlog]);
        await waitFor(() => expect(container.querySelector("[data-optimise-banner]:not([data-leaving])")).toBeNull());
        // Redo re-inserts it and replays the landing, without the banner — the Undo's may still be collapsing.
        await press(history(container, editingMessages.redo()));
        await landed(container, backlog);
        await waitFor(() => expect(lit(container)).toBe(true));
        expect(container.querySelector('[data-optimise-banner="done"]:not([data-leaving])')).toBeNull();
        // Save commits the run with everything else, as one patch; nothing is marked once nothing is pending.
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]), { timeout: 10_000 });
        await waitFor(() => expect(container.querySelectorAll("[data-plan-body] [data-op]")).toHaveLength(0));
        const jobs = await h.read(events.planEventJobs);
        expect(waiting.every(key => jobs.get(key)!.start.type === "some" && jobs.get(key)!.press.type === "some")).toBe(true);
        expect([lit(container), container.querySelector("[data-optimise-banner]")]).toEqual([false, null]);
    });

    test("R3 — Stop cancels the call: the footer says so, a late answer is ignored, and nothing is recorded", async () => {
        const { container } = await mounted();
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        await press(eye(container));
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent])
            .toEqual([false, "note", "Stopped · nothing changed"]);
        hold.release();
        await settle();
        expect([calls.requests().length, added(container).length, container.querySelector("[data-optimise-banner]")]).toEqual([1, 0, null]);
        expect((history(container, editingMessages.apply()) as HTMLButtonElement).disabled).toBe(true);
    });

    test("R10 — a result that changes nothing is said so, the eye blinking; a failed call is an alert until the next run", async () => {
        const { container } = await mounted();
        const backlog = backlogCount(container);
        await press(eye(container));
        await landed(container, backlog);
        // The drafts are the next run's input (O5): with every job placed, the optimiser changes nothing.
        await press(eye(container));
        await said(container, "none");
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, eye(container)!.hasAttribute("data-blink"), calls.requests().length]).toEqual([true, true, 2]);
        expect(added(container)).toHaveLength(backlog);
        const restore = calls.fail();
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Nothing changed. Run it again from the eye."]);
        expect([banner(container, "fail")!.querySelector("[role=alert]") !== null, added(container).length]).toEqual([true, backlog]);
        restore();
    });
});
