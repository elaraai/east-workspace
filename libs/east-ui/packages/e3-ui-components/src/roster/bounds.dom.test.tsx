/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A duty's number outside its field's bounds (#1585), over the warehouse's
 * duties on e3 itself: an app's write leaves C. Clover's duty with an unpaid
 * break under its least, 0. Stored, its chip wears the warn ring and Issues
 * lists it as a warning, holding no Save; moved, the Issues tab says it among
 * what is not saved yet — the field in the hint's own words — and Save waits,
 * the ring kept.
 */
import { expect, test } from "vitest";
import { within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { assignment, cell, drop, history, press, rosterHarness, slot, warehouseRoster } from "./harness.test-utils.js";

const h = rosterHarness();

/** The refusals holding Save the Issues tab lists, by what each says. */
const refusals = (c: HTMLElement) => [...slot(c, "end").querySelectorAll('[data-roster-issue="refusal"]')].map((el) => el.textContent);
/** The breaches the Issues tab lists of a field's bounds: each one's title and its tone. */
const outOfBounds = (c: HTMLElement) => [...slot(c, "end").querySelectorAll('[data-roster-issue="breach"]')]
    .filter((el) => el.textContent?.includes("Unpaid break") === true).map((el) => [el.firstElementChild?.textContent, el.getAttribute("data-tone")]);

test("a stored duty's break under its least wears the warn ring and is a warning in Issues, holding no Save; moved, Issues says it among what is not saved yet and Save waits (#1585)", async () => {
    const duties = await h.read(ex.rosterDuties);
    duties.set("s37", { ...duties.get("s37")!, unpaidBreak: -15 });
    await h.patch(ex.rosterDuties, duties);
    const { container: c } = await h.mount(warehouseRoster());
    expect([assignment(c, "s37").hasAttribute("data-bounds"), assignment(c, "s10").hasAttribute("data-bounds")]).toEqual([true, false]);
    // Another duty removed: the stored one holds no Save, and Issues lists it as a warning.
    await press(within(assignment(c, "s10")).getByRole("button", { name: /^Remove / }));
    await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
    expect([refusals(c), outOfBounds(c)]).toEqual([[], [["C. Clover · Unpaid break: at least 0", "warning"]]]);
    expect(history(c, editingMessages.apply())).toHaveProperty("disabled", false);
    // Moved: its breach is what is not saved yet, and Save waits; its chip keeps the ring.
    await drop(assignment(c, "s37"), cell(c, 4, "picking", "late"));
    expect(refusals(c)).toHaveLength(1);
    expect(refusals(c)[0]).toContain("Unpaid break: at least 0");
    expect(outOfBounds(c)).toEqual([]);
    expect(history(c, editingMessages.apply())).toHaveProperty("disabled", true);
    expect(assignment(c, "s37").hasAttribute("data-bounds")).toBe(true);
});

test("the Inspector collapsed, the toolbar's issue pressed opens it, as its rail does, and the duty's break takes the keyboard (#1585)", async () => {
    const duties = await h.read(ex.rosterDuties);
    duties.set("s37", { ...duties.get("s37")!, unpaidBreak: -15 });
    await h.patch(ex.rosterDuties, duties);
    const { container: c } = await h.mount(warehouseRoster());
    await drop(assignment(c, "s37"), cell(c, 4, "picking", "late"));
    expect(history(c, editingMessages.apply())).toHaveProperty("disabled", true);
    await press(within(slot(c, "end")).getByRole("button", { name: "Collapse Inspector" }));
    expect(slot(c, "end").hasAttribute("data-collapsed")).toBe(true);
    await press(c.querySelector('[data-frame-slot="toolbar"] [data-slot="historyIssues"] button'));
    const field = slot(c, "end").querySelector('[data-field="unpaidBreak"]');
    expect([slot(c, "end").hasAttribute("data-collapsed"), field?.contains(document.activeElement) === true]).toEqual([false, true]);
});
