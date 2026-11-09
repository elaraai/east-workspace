/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Where the Sheet's ring opens (#1585), over e3-ui's examples on e3 itself
 * (`harness.test-utils.tsx`): on the blank row a new entry is typed on, where
 * the sheet opens on one; on any other sheet nowhere — no cell drawn
 * selected, none the grid's active cell, the inspector on nothing — until a
 * press places it, or the first move key.
 */

import { test, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import * as actions from "@elaraai/e3-ui/examples/sheet/sheet-actions";
import { sheetHarness, settle, slot } from "./harness.test-utils.js";

const h = sheetHarness({ modules: { "sheet/sheet": ex, "sheet/sheet-actions": actions } });

const card = (container: HTMLElement) => slot(container, "main")!.querySelector<HTMLElement>("[data-sheet-card]")!;

/** What the ring is on: each cell drawn selected, as its row's key — `blank` for a blank row — and its column's; the rings drawn; the grid's active cell. */
const ringOf = (container: HTMLElement) => {
    const main = slot(container, "main")!;
    const selected = [...main.querySelectorAll<HTMLElement>('[data-slot="cell"][data-selected]')].map((cell) => {
        const row = cell.closest<HTMLElement>("[data-row]")!;
        return `${row.hasAttribute("data-blank") ? "blank" : row.getAttribute("data-row-id")} ${cell.getAttribute("data-key")}`;
    });
    const active = card(container).getAttribute("aria-activedescendant");
    return { selected, rings: main.querySelectorAll('[data-slot="ring"]').length, active: active === null ? null : document.getElementById(active)?.getAttribute("data-key") };
};

/** What the inspector shows: one row, a band, several, or nothing selected. */
const inspected = (container: HTMLElement) => slot(container, "end")!.querySelector("[data-sheet-inspector]")?.getAttribute("data-sheet-inspector");

test("a sheet that adds no rows opens with its ring on no row — never on its last ticket, as if it were chosen — until the first move key places it on the first row's first cell that edits, or a press where it lands", async () => {
    const { container } = await h.mount(actions.sheetActionsTickets);
    expect(ringOf(container)).toEqual({ selected: [], rings: 0, active: null });
    card(container).focus();
    fireEvent.keyDown(card(container), { key: "ArrowDown" });
    await settle();
    expect(ringOf(container)).toEqual({ selected: ["T-301 title"], rings: 1, active: "title" });
    fireEvent.mouseDown(slot(container, "main")!.querySelector('[data-row-id="T-303"] [data-key="due"]')!, { button: 0 });
    await settle();
    expect(ringOf(container)).toEqual({ selected: ["T-303 due"], rings: 1, active: "due" });
});

test("a sheet with blank rows opens its ring on the first of them, where a new entry is typed", async () => {
    const { container } = await h.mount(ex.sheetBasic);
    expect(ringOf(container)).toEqual({ selected: ["blank task"], rings: 1, active: "task" });
});

test("a paged sheet opens with its ring on no row: its blank rows lie past rows it has not read", async () => {
    const { container } = await h.mount(ex.sheetPaged);
    expect(slot(container, "main")!.querySelector('[data-slot="row"][data-row-id]')).not.toBeNull();
    expect(ringOf(container)).toEqual({ selected: [], rings: 0, active: null });
});

test("a grouped sheet that adds no lines opens with its ring on no band, and its inspector on nothing, until a press places it", async () => {
    const { container } = await h.mount(actions.sheetActionsWorkOrders);
    expect(ringOf(container)).toEqual({ selected: [], rings: 0, active: null });
    expect(inspected(container)).toBe("none");
    fireEvent.mouseDown(slot(container, "main")!.querySelector('[data-band-row][data-row-id="WO-1042"] [data-key="$title"]')!, { button: 0 });
    await settle();
    expect(ringOf(container)).toEqual({ selected: ["WO-1042 $title"], rings: 1, active: "$title" });
    expect(inspected(container)).toBe("band");
});
