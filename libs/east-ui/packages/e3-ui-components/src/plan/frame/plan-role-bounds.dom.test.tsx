/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A role's number outside the bounds a hint gives it (#1585), over the print
 * works' jobs on e3 itself, in a test's own Plan whose jobs' sheets are their
 * quantity, a role — drawn on the canvas and among Details' facts, never in the
 * form — which a hint holds to at least 0: another planner's commit leaves the
 * Spring catalogue at −1,000 sheets. Stored, Details says it under the
 * quantity and it holds no Save — another job's change saves; its customer
 * retyped, Save waits, the banner over its form saying it by the hint's label.
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
        resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" },
                quantity: { field: "sheets", unit: "sheets" },
                fields: { sheets: Schedule.field.number({ label: "Sheets", min: 0.0 }) },
            }),
        },
    });
}))) };

test("a stored job's quantity under its least: Details says it under the quantity and it holds no Save — another job's change saves; its own customer retyped, Save waits and the banner says it (#1585)", async () => {
    const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, ValueTypeOf<typeof ex.PrintJob>>);
    jobs.set("J-1001", { ...jobs.get("J-1001")!, sheets: -1000.0 });
    await h.commit(ex.planPrintJobs, jobs);
    const { container } = await h.mount(bounded);
    await settle();
    const pane = () => slot(container, "end")!;
    const form = () => pane().querySelector<HTMLElement>("[data-inspector-fields='form']")!;
    const quantity = () => pane().querySelector<HTMLElement>("[data-inspector-facts] [data-fact='quantity']");
    const save = () => within(slot(container, "toolbar")!).getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() });
    const banner = () => pane().querySelector("[data-inspector-refusals]");
    const select = async (key: string) => {
        fireEvent.click(container.querySelector<HTMLElement>(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", key)}`)!);
        await settle();
    };
    /** Retypes the selected job's customer, committed with Enter. */
    const retype = async (text: string) => {
        const user = userEvent.setup();
        const customer = within(form().querySelector<HTMLElement>("[data-field='customer']")!).getByRole("textbox");
        await user.clear(customer);
        await user.type(customer, text);
        await user.keyboard("{Enter}");
        await settle();
    };
    // Another job's change saves: the stored breach holds nothing.
    await select("J-1002");
    expect(quantity()?.querySelector("[data-fact-breach]")).toBeNull();
    await retype("Driftwood Museum Trust");
    expect(save().disabled).toBe(false);
    // Stored: the quantity a fact, never a field of the form, and the line under it; no banner.
    await select("J-1001");
    expect(form().querySelector("[data-field='sheets']")).toBeNull();
    expect(quantity()?.querySelector("[data-fact-breach]")?.textContent).toBe("at least 0");
    expect(banner()).toBeNull();
    // Its own customer retyped: Save waits, and the banner says why.
    await retype("Alder & Finch Ltd");
    expect(save().disabled).toBe(true);
    expect(banner()?.textContent).toBe("Not saved yet" + "Sheets: at least 0");
});
