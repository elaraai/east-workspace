/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A phone's Filters view (`Mobile Filters Spec.md` SL3–SL9), over e3-ui's
 * phone Sheet on e3 itself (`harness.test-utils.tsx`): in a phone's frame the
 * rail's Filters button opens the view over the whole builder — never the
 * popover — its rows each field's name and choice, one field open at a time
 * with its editor under it; a pick narrows at once, the row saying it and the
 * head counting it; Clear all, Done, ← and Esc close or clear as drawn, and
 * the focus comes back to the button.
 */

import { test, expect } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-actions";
import { act, sheetHarness, settle, slot } from "./harness.test-utils.js";
import { touchFrame } from "../frame.test-utils.js";

const h = sheetHarness({ modules: { "sheet/sheet-actions": ex } });

/** The Filters button in a phone's first row. */
const filtersButton = (container: HTMLElement) => slot(container, "toolbar")!.querySelector<HTMLButtonElement>("[data-rail-phone]")!;
/** The Filters view, in the frame's overlay slot. */
const view = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-frame-slot=overlay] [data-slice-filters-view]");

/** Presses a control as a pointer does, and lets what it starts settle. */
async function press(el: Element) {
    await act(async () => { fireEvent.mouseDown(el, { button: 0 }); fireEvent.click(el); });
    await settle();
}

test("on a phone Filters opens its view over the builder, never a popover: a row a field, its choice or Any; a pick narrows at once and the head counts it (SL3–SL7, SL9.1)", async () => {
    const restore = touchFrame(390, { builder: true });
    try {
        const { container } = await h.mount(ex.sheetActionsPhone);
        expect(view(container)).toBeNull();
        await press(filtersButton(container));
        const opened = view(container)!;
        expect(opened).not.toBeNull();
        // No popover: the view is the editor.
        expect(document.querySelector("[data-scope=popover][data-part=content][data-state=open]")).toBeNull();
        expect(filtersButton(container).getAttribute("aria-expanded")).toBe("true");
        expect(opened.querySelector("[data-filters-active]")?.textContent).toBe("none active");
        // The focus moves into it: its ← back.
        expect(document.activeElement).toBe(opened.querySelector("[data-filters-back]"));
        const status = opened.querySelector<HTMLElement>("[data-slice-section][data-record-slice-field=status]")!;
        expect(status.textContent).toContain("Status");
        expect(status.textContent).toContain("Any");
        // One field open at a time, its editor under its row.
        await press(status);
        const editor = view(container)!.querySelector<HTMLElement>("[data-slice-filters-editor]")!;
        expect(editor).not.toBeNull();
        await press(within(editor).getByText("on_hold").closest("button")!);
        const row = view(container)!.querySelector<HTMLElement>("[data-slice-section][data-record-slice-field=status]")!;
        expect(row.textContent).toContain("on_hold");
        expect(row.textContent).toContain("Applied");
        expect(view(container)!.querySelector("[data-filters-active]")?.textContent).toBe("1 active");
        // Clear all clears it, and the view stays open.
        await press(view(container)!.querySelector("[data-filters-clear]")!);
        expect(view(container)!.querySelector("[data-filters-active]")?.textContent).toBe("none active");
        // Done closes it, the focus back on Filters.
        await press(view(container)!.querySelector("[data-filters-done]")!);
        expect(view(container)).toBeNull();
        expect(document.activeElement).toBe(filtersButton(container));
    } finally { restore(); }
});

test("← and Esc each close the view (SL9.6)", async () => {
    const restore = touchFrame(390, { builder: true });
    try {
        const { container } = await h.mount(ex.sheetActionsPhone);
        for (const close of ["[data-filters-back]"]) {
            await press(filtersButton(container));
            await press(view(container)!.querySelector(close)!);
            expect(view(container), close).toBeNull();
        }
        await press(filtersButton(container));
        await act(async () => { fireEvent.keyDown(view(container)!.querySelector("[data-filters-back]")!, { key: "Escape" }); });
        await settle();
        expect(view(container)).toBeNull();
    } finally { restore(); }
});

/** The phone's Search Records view, in the frame's overlay slot. */
const searchView = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-frame-slot=overlay] [data-key-search-phone]");

test("on a phone Search Records opens its view over the builder, never a popover: a key typed lists its records as 44px rows, and a tap closes the view and goes to the row (SL10, SL10.1)", async () => {
    const restore = touchFrame(390, { builder: true });
    try {
        const { container } = await h.mount(ex.sheetActionsPhone);
        const button = slot(container, "toolbar")!.querySelector<HTMLButtonElement>('[data-key-search="icon"]')!;
        await press(button);
        const opened = searchView(container)!;
        expect(opened).not.toBeNull();
        expect(document.querySelector("[data-scope=popover][data-part=content][data-state=open]")).toBeNull();
        const input = opened.querySelector<HTMLInputElement>("input")!;
        expect(document.activeElement).toBe(input);
        await act(async () => { fireEvent.change(input, { target: { value: "WO-1043" } }); });
        await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 400); }); });
        await settle();
        const rows = searchView(container)!.querySelectorAll<HTMLElement>("[data-key-search-row]");
        expect(rows.length).toBe(1);
        expect(rows[0]!.textContent).toContain("WO-1043");
        expect(searchView(container)!.textContent).toContain("Jumps to the row. The filters stay as they are.");
        await press(rows[0]!);
        expect(searchView(container)).toBeNull();
        await settle();
        expect(slot(container, "main")!.querySelector('[data-row-id="WO-1043"] [data-selected], [data-row-id="WO-1043"][data-selected], [data-group-id="WO-1043"] [data-selected]')).not.toBeNull();
    } finally { restore(); }
});

test("Cancel and Esc each close the Search Records view, the focus back on its button (SL10)", async () => {
    const restore = touchFrame(390, { builder: true });
    try {
        const { container } = await h.mount(ex.sheetActionsPhone);
        const button = () => slot(container, "toolbar")!.querySelector<HTMLButtonElement>('[data-key-search="icon"]')!;
        await press(button());
        await press(searchView(container)!.querySelector("[data-key-search-cancel]")!);
        expect(searchView(container)).toBeNull();
        expect(document.activeElement).toBe(button());
        await press(button());
        await act(async () => { fireEvent.keyDown(searchView(container)!.querySelector("input")!, { key: "Escape" }); });
        await settle();
        expect(searchView(container)).toBeNull();
    } finally { restore(); }
});
