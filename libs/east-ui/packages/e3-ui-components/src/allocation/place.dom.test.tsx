/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board finds its bins and keeps its place (#1398) on e3 itself: Search
 * Records seeks the bins' record by key through e3 — a bin of the day shown
 * selected where it is, one of another day stepped to and selected there —
 * and where the Table's rows rest comes back after a remount: the line at the
 * top, and the px into it.
 */
import { expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, settle, slot, type Example } from "./harness.test-utils.js";

const h = allocationHarness();
/** An example mounted over a store of its own. */
async function open(example: Example) {
    StateRuntime.initializeStore(new UIStore());
    return h.mount(example);
}
const card = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${key}"]`);
/** Search Records' box, in the toolbar's row. */
const searchBox = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
async function typeIntoSearch(c: HTMLElement, typed: string) {
    const input = searchBox(c).querySelector<HTMLInputElement>("input")!;
    for (const key of typed) {
        const now = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(now));
    }
}
/** The box's list — the listbox its input controls — its lines as they read. */
const lines = (c: HTMLElement) => {
    const list = document.getElementById(searchBox(c).querySelector("input")!.getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map(option => option.textContent);
};
/** The bins' record, as its dataset's requests name it. */
const BINS = "records.kiln_bins";

test("Search Records seeks the bins' record by key through e3: a bin of the day shown is selected where it is; one of another day is stepped to and selected there (#1398)", async () => {
    const { container } = await open(ex.allocationKilnYard);
    await waitFor(() => expect(card(container, "3101")).not.toBeNull());
    await settle();
    const finds = h.requests("find", BINS).length;
    await typeIntoSearch(container, "3101");
    await waitFor(() => expect(lines(container)).toEqual(["3101 · LD-2201 · B-3 01:55 · Tue, May 11, 2027"]), { timeout: 5_000 });
    expect(h.requests("find", BINS).length).toBeGreaterThan(finds);
    fireEvent.keyDown(searchBox(container).querySelector("input")!, { key: "Enter" });
    await settle();
    await waitFor(() => expect(card(container, "3101")?.getAttribute("aria-pressed")).toBe("true"));
    // Another day's: Wednesday's split load, its day stepped to and the bin selected there.
    await act(async () => { fireEvent.click(searchBox(container).querySelector("button[aria-label='Clear search']")!); });
    await typeIntoSearch(container, "3201");
    await waitFor(() => expect(lines(container)).toEqual(["3201 · LD-2232 · B-1 06:15 · Wed, May 12, 2027"]), { timeout: 5_000 });
    fireEvent.keyDown(searchBox(container).querySelector("input")!, { key: "Enter" });
    await settle();
    await waitFor(() => expect(card(container, "3201")?.getAttribute("aria-pressed")).toBe("true"), { timeout: 10_000 });
    expect(card(container, "3101")).toBeNull();
    // Nothing read the record whole.
    expect(h.requests("read", BINS)).toEqual([]);
});

/** The Table's scroll box. */
const scroller = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-allocation-table] [data-virtual-rows]")!;
/** Where the Table's view rests, as the board saves it: its top line's key and the px into it. */
const saved = (): { key: string; offset: number } | undefined => {
    const key = Object.keys(localStorage).find(k => k.endsWith(".anchor"));
    const held = key === undefined ? undefined : (JSON.parse(localStorage.getItem(key)!) as { table?: { key: string; offset: number } }).table;
    return held;
};

test("where the Table's rows rest comes back after a remount: the line at the top, and the px into it (#1398)", async () => {
    // jsdom scrolls nothing a frame asks it to, and its scroll box has no extent to scroll through: here the Table's has
    // room, and it scrolls as a page does, and says so — only when it moved, as a page says it.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-virtual-rows") ? 1_000_000 : 0;
    });
    vi.spyOn(Element.prototype, "scrollTo").mockImplementation(function (this: Element, options?: ScrollToOptions | number) {
        if (typeof options !== "object" || options.top === undefined || options.top === this.scrollTop) return;
        this.scrollTop = options.top;
        this.dispatchEvent(new Event("scroll"));
    } as Element["scrollTo"]);
    const first = await open(ex.allocationTable);
    await waitFor(() => expect(scroller(first.container)).not.toBeNull());
    await settle();
    await act(async () => { scroller(first.container).scrollTop = 14 * 36 + 9; fireEvent.scroll(scroller(first.container)); });
    await settle();
    const rested = scroller(first.container).scrollTop;
    // The scroll settles — the frame says so once it has rested — and is saved: a line by its key, a row's or a band's.
    await waitFor(() => expect(saved()?.key).toMatch(/^(bin:|slot:|band:)/));
    const at = saved()!;
    first.unmount();
    const again = await open(ex.allocationTable);
    // Every line of the Table stands at its fixed pitch: the line saved, and the px into it, are where the scroll was.
    await waitFor(() => expect(scroller(again.container)?.scrollTop).toBe(rested));
    expect(saved()).toEqual(at);
    expect(within(slot(again.container, "toolbar")).getByRole("radio", { name: "Table" }).getAttribute("aria-checked")).toBe("true");
});
