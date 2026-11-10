/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * An event's number outside its field's bounds (#1585), over the operations'
 * jobs on e3 itself, in a test's own Calendar whose job form holds the hours
 * to at least 1: the prototype plates' job is stored at half an hour. Stored,
 * its block wears the warn ring, the toolbar's issues button warns of it, by
 * its title, the field's label and the bound, and it holds no Save — another
 * job's change saves; the warning pressed, Details shows it, the line under
 * the field saying it; its customer retyped, Save waits, the banner over its
 * form saying it in the hint's own words, the warning now the issue holding
 * Save, and the block keeps its ring.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Calendar, Record } from "@elaraai/e3-ui";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { act, calendarHarness, event, settle, slot } from "./harness.test-utils.js";

const h = calendarHarness();

/** The jobs on the first of October, the job form holding the hours to at least 1 — no role reads them. */
const bounded = { fn: East.function([], UIComponentType, _$ => Reactive.Root(East.function([], UIComponentType, $ => {
    const jobs = $.let(Record.bind(ex.calendarJobs, ["patch"]));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") },
        events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end",
            fields: { hours: Calendar.field.number({ label: "Hours", min: 1.0 }) } }) },
    });
}))) };

test("a stored job's hours under their least: its block wears the warn ring, the toolbar warns of it and it holds no Save — another job's change saves; the warning pressed, Details says it under the field; its own customer retyped, Save waits, the banner says it, the warning is the issue holding Save and the ring stays (#1585)", async () => {
    const { container } = await h.mount(bounded);
    const pane = () => slot(container, "end");
    const save = () => within(slot(container, "toolbar")).getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() });
    const issues = () => slot(container, "toolbar").querySelector<HTMLButtonElement>('[data-slot="historyIssues"] button')!;
    const banner = () => pane().querySelector("[data-calendar-inspector-refusals]");
    const select = async (key: string) => {
        await act(async () => { fireEvent.click(event(container, "job", key)); });
        await settle();
    };
    /** Retypes the selected job's customer, committed with Enter. */
    const retype = async (text: string) => {
        const user = userEvent.setup();
        const customer = pane().querySelector<HTMLInputElement>('[data-field="customer"] input')!;
        await user.clear(customer);
        await user.type(customer, `${text}{Enter}`);
        await settle();
    };
    // Stored, the block under its least wears the warn ring; another job's does not. The toolbar warns of it, by its words.
    expect([event(container, "job", "job3").hasAttribute("data-bounds"), event(container, "job", "job2").hasAttribute("data-bounds")]).toEqual([true, false]);
    expect(issues().getAttribute("aria-label")).toBe("1 warning");
    await userEvent.setup().hover(issues());
    await waitFor(() => expect(document.querySelector("[data-scope=tooltip][data-part=content]")?.textContent)
        .toBe("1 warning · Save still works · Go to Long title: stainless steel mounting plates for the prototype assembly · Hours: at least 1"));
    // Another job's change saves: the stored breach holds nothing, and is still a warning.
    await select("job2");
    await retype("Birch Engineering Ltd");
    expect([save().disabled, issues().getAttribute("aria-label")]).toEqual([false, "1 warning"]);
    // The warning pressed goes to its job: the line under the field, and no banner.
    await act(async () => { fireEvent.click(issues()); });
    await settle();
    expect(pane().querySelector('[data-field="hours"] [data-scope=field][data-part=error-text]')?.textContent).toBe("at least 1");
    expect(banner()).toBeNull();
    // Its own customer retyped: Save waits, the banner says why, the warning is now the issue holding Save, and the ring stays.
    await retype("Cedar Fabrication Ltd");
    expect(save().disabled).toBe(true);
    expect(banner()?.textContent).toContain("Hours: at least 1");
    expect(issues().getAttribute("aria-label")).toBe("1 issue");
    expect(event(container, "job", "job3").hasAttribute("data-bounds")).toBe(true);
});
