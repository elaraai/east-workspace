/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Calendar (#1409, #1417; `Optimise Spec.md` §9) on e3: the
 * shop's optimiser is the example's own `e3.function`, called by name on e3
 * once per run. The eye shows only with an optimiser (R6); a click sends one
 * call over the window — every job in it and the backlog by key, the machines
 * beside them (R1, R24) — and while it is out the eye runs, the footer counts,
 * the history is locked and nothing drags (R2); the result lands as one edit
 * (R7, R8): the backlog scheduled, each new event marked and named for the
 * run, the banner saying what changed, the Backlog count flashing — and one
 * Undo reverts it all, Redo replays the landing without the banner, Save
 * commits it with everything else (R9, R11). Stop and a period change ignore
 * a late answer (R3, R4); nothing to change and a failed call say so (R10).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import * as opt from "@elaraai/e3-ui/examples/calendar/optimise";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import "./index.js";

const h = e3Harness({ "calendar/calendar": ex, "calendar/optimise": opt }, { main: "data-calendar-main" });
const calls = fitCalls(h, { request: opt.CalendarOptimiseRequest, result: opt.CalendarOptimiseResult });

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const history = (c: HTMLElement, name: string) => toolbar(c).getByRole("button", { name });
const added = (c: HTMLElement) => c.querySelectorAll<HTMLElement>('[data-calendar-event][data-op="add"]');
/** Waits for a run's answer to land — e3 runs the optimiser's function for it, which takes its time. */
const landed = (c: HTMLElement, n: number) => waitFor(() => expect(added(c)).toHaveLength(n), { timeout: 10_000 });
/** Waits for a banner of a kind — the answer's, once e3 has given it. */
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 10_000 });
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const words = (el: HTMLElement) => [el.querySelector("[data-banner-title]")!.textContent, el.querySelector("[data-banner-body]")!.textContent];
const line = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-calendar-footer] [data-footer-line]")!;
const lit = (c: HTMLElement) => c.querySelector("[data-calendar-frame]")!.hasAttribute("data-optimise-lit");
/** The window, as the eye names it: `Optimise {period}`. */
const period = (c: HTMLElement) => eye(c)!.getAttribute("aria-label")!.replace(/^Optimise /, "");
const commits = async () => (await h.history(ex.calendarJobs)).commits.map(commit => commit.mutation);

describe("the eye in the Calendar", () => {
    test("R6 — the eye shows for a Calendar with an optimiser, named for the window; a Calendar without one has none", async () => {
        const plain = await h.mount(ex.calendarOperations);
        expect(eye(plain.container)).toBeNull();
        plain.unmount();
        const { container } = await h.mount(opt.calendarOptimise);
        expect([eye(container)!.getAttribute("aria-label")!.startsWith("Optimise "), eye(container)!.disabled, eye(container)!.hasAttribute("data-running")]).toEqual([true, false, false]);
        // Immediately before the history item.
        const items = [...slot(container, "toolbar").querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item"));
        expect(items.indexOf("history") - items.indexOf("optimise")).toBe(1);
    });

    test("R1, R2, R24 — one call over the window and its backlog, the machines beside them; the lock while it is out", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
        const at = period(container);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        expect([eye(container)!.hasAttribute("data-running"), eye(container)!.getAttribute("aria-label")]).toEqual([true, "Stop optimising"]);
        expect([line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent]).toEqual(["busy", `Optimising ${at}`]);
        for (const name of [editingMessages.undo(), editingMessages.redo(), editingMessages.discard(), editingMessages.apply()]) {
            expect(history(container, name).getAttribute("aria-disabled")).toBe("true");
        }
        expect(container.querySelector("[data-draggable]")).toBeNull();
        expect(calls.requests()).toHaveLength(1);
        const asked = calls.requests()[0]!;
        expect([asked.run, asked.events.job.size, asked.resources.machines.size]).toEqual([1n, 10, 4]);
        expect([...asked.events.job.keys()].filter(key => key.startsWith("backlog")).sort()).toEqual(["backlog1", "backlog2", "backlog3", "backlog4"]);
        expect([asked.from.getTime(), asked.to.getTime()]).toEqual([new Date("2026-09-28T00:00:00Z").getTime(), new Date("2026-10-05T00:00:00Z").getTime()]);
        hold.release();
        await landed(container, 4);
        expect([eye(container)!.hasAttribute("data-running"), line(container).hasAttribute("data-idle")]).toEqual([false, true]);
        expect(container.querySelector("[data-draggable]")).not.toBeNull();
    });

    test("R7–R9, R11 — the result lands as one edit: the backlog scheduled and marked, the banner and the legend for the highlight; one Undo reverts it, Redo replays it without the banner, Save commits it as one patch", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
        const deployed = await commits();
        await press(eye(container));
        await landed(container, 4);
        const at = period(container);
        expect([...added(container)].every(el => el.getAttribute("title")!.startsWith("Added by Elara · run #1"))).toBe(true);
        expect(words(banner(container, "done")!)).toEqual([`Elara optimised ${at}`, "4 changes: 4 added. Undo or apply them like any edit."]);
        expect([lit(container), container.querySelector("[data-calendar-footer] [data-optimise-legend]")?.textContent]).toEqual([true, "Elara change"]);
        // The Backlog is empty, its count flashing; the day heads the run filled flash too.
        expect(within(slot(container, "start")).getByRole("tab", { name: /^Backlog/ }).textContent).toBe("Backlog 0");
        expect(slot(container, "start").querySelector("[data-tab-count][data-opn]")).not.toBeNull();
        expect(container.querySelectorAll("[data-calendar-day-count][data-opn]").length).toBeGreaterThan(0);
        // One step: one Undo takes the whole run back, and ends its highlight and its banner.
        await press(history(container, editingMessages.undo()));
        expect([added(container).length, lit(container)]).toEqual([0, false]);
        expect(within(slot(container, "start")).getByRole("tab", { name: /^Backlog/ }).textContent).toBe("Backlog 4");
        await waitFor(() => expect(container.querySelector("[data-optimise-banner]:not([data-leaving])")).toBeNull());
        // Redo re-inserts it and replays the landing, without the banner — the Undo's may still be collapsing.
        await press(history(container, editingMessages.redo()));
        await landed(container, 4);
        await waitFor(() => expect(lit(container)).toBe(true));
        expect(container.querySelector('[data-optimise-banner="done"]:not([data-leaving])')).toBeNull();
        // Save commits the run with everything else, as one patch; nothing is marked once nothing is pending.
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]));
        await waitFor(() => expect(container.querySelectorAll("[data-op]")).toHaveLength(0));
        const jobs = await h.read(ex.calendarJobs);
        expect(["backlog1", "backlog2", "backlog3", "backlog4"].every(key => jobs.get(key)!.start.type === "some")).toBe(true);
        expect([lit(container), container.querySelector("[data-optimise-banner]")]).toEqual([false, null]);
    });

    test("R3 — Stop cancels the call: the footer says so, a late answer is ignored, and nothing is recorded", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
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

    test("R4 — a change of period stops the run as Stop does", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        await press(toolbar(container).getByRole("button", { name: /^Next (day|week|month)$/ }));
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line")]).toEqual([false, "note"]);
        hold.release();
        await settle();
        expect([calls.requests().length, container.querySelectorAll("[data-op]").length]).toEqual([1, 0]);
    });

    test("R10 — a result that changes nothing is said so, the eye blinking; a failed call is an alert until the next run", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
        await press(eye(container));
        await landed(container, 4);
        // The drafts are the next run's input (O5): with every job scheduled, the optimiser changes nothing.
        await press(eye(container));
        await said(container, "none");
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, eye(container)!.hasAttribute("data-blink"), calls.requests().length]).toEqual([true, true, 2]);
        expect(added(container)).toHaveLength(4);
        const restore = calls.fail();
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Nothing changed. Run it again from the eye."]);
        expect([banner(container, "fail")!.querySelector("[role=alert]") !== null, added(container).length]).toEqual([true, 4]);
        restore();
    });
});
