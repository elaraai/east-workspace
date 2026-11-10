/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A number emptied in Details (#1585) is what emptying its cell is, over the
 * machines' upkeep on e3 itself: the hours a machine has run, a column whose
 * cell takes a clear, are left missing — the cell blank, the field not set, the
 * row's issue that a value is required, and Save waiting for one.
 */

import { expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { act, sheetHarness, settle, slot } from "./harness.test-utils.js";

const h = sheetHarness();

/** A machine's cell, by the machine's code and the column's key. */
const cell = (c: HTMLElement, id: string, key: string) =>
    slot(c, "main")!.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** Details' field, by its key. */
const field = (c: HTMLElement, key: string) =>
    slot(c, "end")!.querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-sheet-inspector="row"] [data-field="${key}"]`)!;
/** Details' issues: each one's field and what it says. */
const issues = (c: HTMLElement) => [...slot(c, "end")!.querySelectorAll<HTMLElement>('[role="tabpanel"]:not([hidden]) [data-inspector-issues] [data-kind]')]
    .map((text) => [text.previousElementSibling?.textContent, text.textContent]);
/** Whether Save waits: its button takes no press. */
const saveWaits = (c: HTMLElement) => within(slot(c, "toolbar")!).getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled;

test("the hours emptied in Details are what emptying their cell is: the cell blank, the field not set, a value required, and Save waiting (#1585)", async () => {
    const { container } = await h.mount(ex.sheetUpkeep, { storageKey: "details-emptied" });
    // The beam saw, the ring placed on its name: Details shows it.
    await act(async () => { fireEvent.mouseDown(cell(container, "S101", "name"), { button: 0 }); });
    await settle();
    const hours = () => field(container, "hours");
    expect(within(hours()).getByRole<HTMLInputElement>("spinbutton").value).toBe("1240");
    const user = userEvent.setup();
    await user.clear(within(hours()).getByRole("spinbutton"));
    await user.type(within(hours()).getByRole("spinbutton"), "{Enter}");
    await settle();
    // The cell as emptying it leaves it: blank, saying what it needs.
    expect(cell(container, "S101", "hours").textContent).toBe("A value is required");
    const box = within(hours()).getByRole<HTMLInputElement>("textbox");
    expect([box.value, box.placeholder, box.disabled, hours().querySelector("[data-field-set]")?.textContent]).toEqual(["", "Not set", true, "Set"]);
    expect(issues(container)).toEqual([["Hours", "A value is required"]]);
    expect(saveWaits(container)).toBe(true);
});
