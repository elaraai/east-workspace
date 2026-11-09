/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A duty's number outside its field's bounds (#1585), over the warehouse's
 * duties on e3 itself: an app's write leaves C. Clover's duty with an unpaid
 * break under its least, 0. Stored, it holds no Save; moved, the Issues tab
 * says it among what is not saved yet — the field in the hint's own words —
 * and Save waits.
 */
import { expect, test } from "vitest";
import { within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { assignment, cell, drop, history, press, rosterHarness, slot, warehouseRoster } from "./harness.test-utils.js";

const h = rosterHarness();

/** The refusals holding Save the Issues tab lists, by what each says. */
const refusals = (c: HTMLElement) => [...slot(c, "end").querySelectorAll('[data-roster-issue="refusal"]')].map((el) => el.textContent);

test("a stored duty's break under its least holds no Save; moved, Issues says it in the hint's words and Save waits (#1585)", async () => {
    const duties = await h.read(ex.rosterDuties);
    duties.set("s37", { ...duties.get("s37")!, unpaidBreak: -15 });
    await h.patch(ex.rosterDuties, duties);
    const { container: c } = await h.mount(warehouseRoster());
    await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
    expect(refusals(c)).toEqual([]);
    await drop(assignment(c, "s37"), cell(c, 4, "picking", "late"));
    expect(refusals(c)).toHaveLength(1);
    expect(refusals(c)[0]).toContain("Unpaid break: at least 0");
    expect(history(c, editingMessages.apply())).toHaveProperty("disabled", true);
});
