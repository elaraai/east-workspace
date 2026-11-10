/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * An event's number outside its field's bounds (#1585), over the print
 * works' jobs on e3 itself, in a test's own Plan whose job form holds the
 * sheets to at least 0: another planner's commit leaves the Spring catalogue
 * at −1,000 sheets. Stored, its bar wears the warn ring, Details says it
 * under the field and it holds no Save; its customer retyped, Save waits, the
 * banner over its form saying it by the field's label, in the hint's own
 * words, and the bar keeps its ring.
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

/** The jobs on their presses, the job form holding the sheets to at least 0 — no role reads them. */
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
                fields: { sheets: Schedule.field.number({ label: "Sheets", min: 0.0 }) },
            }),
        },
    });
}))) };

test("a stored job's sheets under their least: its bar wears the warn ring, Details says it under the field and it holds no Save — another job's change saves; its own customer retyped, Save waits, the banner says it and the ring stays (#1585)", async () => {
    const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, ValueTypeOf<typeof ex.PrintJob>>);
    jobs.set("J-1001", { ...jobs.get("J-1001")!, sheets: -1000.0 });
    await h.commit(ex.planPrintJobs, jobs);
    const { container } = await h.mount(bounded);
    await settle();
    const pane = () => slot(container, "end")!;
    const form = () => pane().querySelector<HTMLElement>("[data-inspector-fields='form']")!;
    const save = () => within(slot(container, "toolbar")!).getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() });
    const banner = () => pane().querySelector("[data-inspector-refusals]");
    const bar = (key: string) => container.querySelector<HTMLElement>(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", key)}`)!;
    const select = async (key: string) => {
        fireEvent.click(bar(key));
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
    // Stored, the bar under its least wears the warn ring; another job's does not.
    expect([bar("J-1001").hasAttribute("data-bounds"), bar("J-1002").hasAttribute("data-bounds")]).toEqual([true, false]);
    // Another job's change saves: the stored breach holds nothing.
    await select("J-1002");
    await retype("Driftwood Museum Trust");
    expect(save().disabled).toBe(false);
    // Stored: the line under the field, and no banner.
    await select("J-1001");
    expect(form().querySelector("[data-field='sheets'] [data-scope=field][data-part=error-text]")?.textContent).toBe("at least 0");
    expect(banner()).toBeNull();
    // Its own customer retyped: Save waits, and the banner says why.
    await retype("Alder & Finch Ltd");
    expect(save().disabled).toBe(true);
    expect(banner()?.textContent).toBe("Not saved yet" + "Sheets: at least 0");
    expect(bar("J-1001").hasAttribute("data-bounds")).toBe(true);
});
