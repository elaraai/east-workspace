/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A role's number outside the bounds a hint gives it (#1585), over the print
 * works' jobs on e3 itself, in a test's own Plan whose jobs' sheets are their
 * quantity, a role — drawn on the canvas, and in the form as any number is
 * (#1680's review) — which a hint holds to at least 0: another planner's
 * commit leaves the Spring catalogue at −1,000 sheets. Stored, its field says
 * the bound in its help line, as a warning, and it holds no Save — another
 * job's change saves; its customer retyped, Save waits, the banner over its
 * form saying it by the hint's label, and the line is an error; its sheets
 * typed back inside the bound, the line goes and Save is free. The toolbar's
 * warning pressed goes to the job, and the keyboard to its sheets' field — the
 * Inspector collapsed, it opens first.
 */

import { expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { el, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness();

/** The print works' four weeks. */
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");

/** The jobs on their presses, their sheets their quantity, which a hint holds to at least 0. */
const bounded = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    return Plan({
        axis, inspector: true,
        // The presses are the canvas's rows, a landing row each (#1541).
        data: presses.read(),
        series: [Plan.series.resources(ex.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" },
                quantity: { field: "sheets", unit: "sheets" },
                fields: { sheets: Schedule.field.number({ label: "Sheets", min: 0.0 }) },
            }),
        },
    });
}))) };

/** The Plan over the jobs, the Spring catalogue's sheets committed under their least, and what the test reads of it. */
async function mounted() {
    const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, ValueTypeOf<typeof ex.PrintJob>>);
    jobs.set("J-1001", { ...jobs.get("J-1001")!, sheets: -1000.0 });
    await h.commit(ex.planPrintJobs, jobs);
    const { container } = await h.mount(bounded);
    await settle();
    const pane = () => slot(container, "end")!;
    const form = () => pane().querySelector<HTMLElement>("[data-inspector-fields='form']")!;
    /** The selected job's sheets: its quantity, a field of its form. */
    const sheets = () => form().querySelector<HTMLElement>("[data-field='sheets']");
    const select = async (key: string) => {
        fireEvent.click(container.querySelector<HTMLElement>(`${rowAt(entry("presses", "a1"))} ${el("data-run", "job", key)}`)!);
        await settle();
    };
    /** Retypes one of the selected job's fields, by its role, committed with Enter. */
    const retypeField = async (field: string, role: "textbox" | "spinbutton", text: string) => {
        const user = userEvent.setup();
        const box = within(form().querySelector<HTMLElement>(`[data-field='${field}']`)!).getByRole(role);
        await user.clear(box);
        await user.type(box, text);
        await user.keyboard("{Enter}");
        await settle();
    };
    return {
        container, pane, form, sheets, select,
        retype: (text: string) => retypeField("customer", "textbox", text),
        retypeSheets: (text: string) => retypeField("sheets", "spinbutton", text),
        save: () => within(slot(container, "toolbar")!).getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() }),
        issues: () => slot(container, "toolbar")!.querySelector<HTMLButtonElement>('[data-slot="historyIssues"] button')!,
        banner: () => pane().querySelector("[data-inspector-refusals]"),
    };
}

/** What a field's help line says of its bound — its words and its tone — and whether its box is invalid; `null` for none. */
const lineOf = (field: HTMLElement | null) => {
    const toned = field?.querySelector("[data-scope=field][data-part=helper-text] [data-breach]") ?? null;
    return toned === null ? null : [toned.textContent, toned.getAttribute("data-breach"), within(field!).getByRole("spinbutton").getAttribute("aria-invalid")];
};

test("a stored job's quantity under its least: its field in the form says the bound, as a warning, and it holds no Save — another job's change saves; its own customer retyped, Save waits, the banner says it and the line is an error; its sheets typed back inside the bound, the line goes and Save is free (#1585, #1680's review)", async () => {
    const { pane, form, sheets, select, retype, retypeSheets, save, banner } = await mounted();
    // Another job's change saves: the stored breach holds nothing.
    await select("J-1002");
    expect(lineOf(sheets())).toBeNull();
    await retype("Driftwood Museum Trust");
    expect(save().disabled).toBe(false);
    // Stored: the quantity a field of the form — no fact of its own beside it — its help line a warning; no banner.
    await select("J-1001");
    expect(pane().querySelector("[data-inspector-facts] [data-fact='quantity']")).toBeNull();
    expect(lineOf(sheets())).toEqual(["at least 0", "warn", null]);
    expect(banner()).toBeNull();
    // Its own customer retyped: Save waits, the banner says why, and the line is an error, the field invalid.
    await retype("Alder & Finch Ltd");
    expect(save().disabled).toBe(true);
    expect(banner()?.textContent).toBe("Not saved yet" + "Sheets: at least 0");
    expect(lineOf(sheets())).toEqual(["at least 0", "error", "true"]);
    // Its sheets typed back inside the bound: the line goes, the banner with it, and Save is free.
    await retypeSheets("1000");
    expect(lineOf(sheets())).toBeNull();
    expect(banner()).toBeNull();
    expect(save().disabled).toBe(false);
    // A change of the job's: its field tinted against what the record holds.
    expect(sheets()?.hasAttribute("data-dirty")).toBe(true);
});

test("the warning pressed goes to its job, and the keyboard to its sheets' field in the form — never the page's body (#1585, #1680's review)", async () => {
    const { pane, sheets, issues } = await mounted();
    expect(issues().getAttribute("aria-label")).toBe(editingMessages.warnings({ n: 1, count: "1" }));
    fireEvent.click(issues());
    await settle();
    expect(pane().querySelector("[data-inspector-title]")?.textContent).toBe("Spring catalogue");
    expect(document.activeElement).toBe(within(sheets()!).getByRole("spinbutton"));
});

test("the Inspector collapsed, the warning pressed opens it, as its rail does, and its sheets' field takes the keyboard (#1585, #1680's review)", async () => {
    const { container, sheets, issues } = await mounted();
    const end = () => slot(container, "end")!;
    fireEvent.click(within(end()).getByRole("button", { name: "Collapse Inspector" }));
    await settle();
    expect(end().hasAttribute("data-collapsed")).toBe(true);
    fireEvent.click(issues());
    await settle();
    expect([end().hasAttribute("data-collapsed"), document.activeElement === within(sheets()!).getByRole("spinbutton")]).toEqual([false, true]);
});
