/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The People grid (#1398) on e3 itself: what it draws again, and no more, as
 * it is picked, scrolled and folded; ↑ and ↓ on a person's name step to the
 * next person, past a group's band and its agency requests; Search Records
 * finds the staff by their keys, a person far down the rows brought into
 * view; and where the rows rest comes back after a remount.
 */
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StringType, printFor, variant } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { setRosterPeopleCardsProbe } from "./library.js";
import { setPeopleDrawProbe } from "./views.js";
import { act, narrow, open, press, rosterHarness, settle, slot, type Choice } from "./harness.test-utils.js";
const h = rosterHarness();
const text = printFor(StringType);

afterEach(() => { setPeopleDrawProbe(undefined); setRosterPeopleCardsProbe(undefined); });

/** What the People grid draws from now on: each row and each person's day, by key, as often as it is drawn. */
function draws() {
    const rows = new Map<string, number>(), days = new Map<string, number>();
    setPeopleDrawProbe((part, key) => { const into = part === "row" ? rows : days; into.set(key, (into.get(key) ?? 0) + 1); });
    return { rows, days, clear: () => { rows.clear(); days.clear(); } };
}
/** The People rows mounted, by key. */
const mountedRows = (c: HTMLElement) => [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-person-row]")].map(row => row.getAttribute("data-roster-person-row")!);

test("People draws a row and its days once (#1398, CL9): a pick draws again only the chips it marks, another Library tab nothing of the grid, a scroll only the rows it brings into view, and a fold no day of a person still shown; the People tab's cards are made once", async () => {
    const { container } = await h.mount(ex.rosterWarehouse);
    await press(within(slot(container, "toolbar")).getByRole("radio", { name: "People" }));
    let cards = 0;
    setRosterPeopleCardsProbe(() => { cards += 1; });
    const drawn = draws();
    // A duty picked: its chip says so, and nothing else is drawn or made again.
    const chip = slot(container, "main").querySelector<HTMLElement>("[data-roster-assignment]")!;
    await press(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect([drawn.rows.size, drawn.days.size, cards]).toEqual([0, 0, 0]);
    // Another tab of the Library: nothing of the grid.
    await press(within(slot(container, "start")).getByRole("tab", { name: /^Activities/ }));
    expect([drawn.rows.size, drawn.days.size, cards]).toEqual([0, 0, 0]);
    // Scrolled down a few rows at a time until the second group's band comes into view below the first group's rows:
    // each row a scroll brings into view drawn once, and none it kept mounted drawn again.
    const scroller = slot(container, "main").querySelector<HTMLElement>("[data-virtual-rows]")!;
    const second = () => [...slot(container, "main").querySelectorAll<HTMLElement>("[data-roster-group]")].find(band => band.getAttribute("aria-expanded") === "true" && band !== firstBand);
    const firstBand = slot(container, "main").querySelector<HTMLElement>("[data-roster-group]")!;
    for (let step = 1; step <= 40 && second() === undefined; step++) {
        const before = mountedRows(container);
        drawn.clear();
        await act(async () => { scroller.scrollTop = step * 3 * 62; fireEvent.scroll(scroller); });
        await settle();
        const brought = mountedRows(container).filter(key => !before.includes(key));
        expect(brought.length).toBeGreaterThan(0);
        expect([...drawn.rows.keys()].sort()).toEqual([...brought].sort());
        expect([...drawn.rows.values()].every(n => n === 1)).toBe(true);
    }
    // The second group folded: its rows go, and no day of a person of the first group, still shown, is drawn again.
    drawn.clear();
    const shown = mountedRows(container);
    const band = second();
    expect(band).toBeDefined();
    await press(band!);
    const still = mountedRows(container).filter(key => shown.includes(key));
    expect(still.length).toBeGreaterThan(0);
    expect([...drawn.days.keys()].filter(day => still.some(key => day.startsWith(`${key}.`)))).toEqual([]);
    expect(cards).toBe(0);
});

/** The People grid's scroll box. */
const scroller = (c: HTMLElement) => slot(c, "main").querySelector<HTMLElement>("[data-virtual-rows]")!;
/** Scrolls the People grid down a few rows at a time until a band other than the first comes into view, open. */
async function toSecondBand(c: HTMLElement): Promise<HTMLElement> {
    const first = slot(c, "main").querySelector<HTMLElement>("[data-roster-group]")!;
    const second = () => [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-group]")].find(band => band !== first && band.getAttribute("aria-expanded") === "true");
    for (let step = 1; step <= 40 && second() === undefined; step++) {
        await act(async () => { scroller(c).scrollTop = step * 3 * 62; fireEvent.scroll(scroller(c)); });
        await settle();
    }
    expect(second()).toBeDefined();
    return second()!;
}
/** The key of the person whose name holds the focus. */
const focusedPerson = () => document.activeElement?.getAttribute("data-roster-person-head") ?? null;

test("↑ and ↓ on a person's name step to the next person and the one before, past a group's band and its agency requests, selecting them and focusing their name (#1398)", async () => {
    const { container } = await open(ex.rosterWarehouse);
    await press(within(slot(container, "toolbar")).getByRole("radio", { name: "People" }));
    // Down the first group, a person at a time.
    const names = () => [...slot(container, "main").querySelectorAll<HTMLElement>("[data-roster-person-head]")];
    const [first, next] = names();
    first!.focus();
    await act(async () => { fireEvent.keyDown(first!, { key: "ArrowDown" }); });
    await settle();
    expect(focusedPerson()).toBe(next!.getAttribute("data-roster-person-head"));
    expect(within(slot(container, "end")).getByText(next!.textContent!, { selector: "[data-inspector-title]" })).toBeTruthy();
    // Across the boundary: the first person of the next group, ↑ — the first group's agency requests and the band passed
    // over — the last person of the group before; ↓ back again.
    const band = await toSecondBand(container);
    const bandAt = Number(band.closest("[data-index]")!.getAttribute("data-index"));
    /** The row at a place of the grid, mounted. */
    const row = (i: number) => slot(container, "main").querySelector<HTMLElement>(`[data-index="${i}"]`);
    for (let step = 1; step <= 5 && row(bandAt + 1) === null; step++) {
        await act(async () => { scroller(container).scrollTop += 62; fireEvent.scroll(scroller(container)); });
        await settle();
    }
    // The rows about the band: the first group's last person, its agency requests, the band, the next group's first person.
    expect(row(bandAt - 1)!.querySelector("[data-roster-person-row]")!.getAttribute("data-roster-person-row")).toMatch(/^requests:/);
    const last = row(bandAt - 2)!.querySelector<HTMLElement>("[data-roster-person-head]")!.getAttribute("data-roster-person-head");
    const opening = row(bandAt + 1)!.querySelector<HTMLElement>("[data-roster-person-head]")!;
    opening.focus();
    await act(async () => { fireEvent.keyDown(opening, { key: "ArrowUp" }); });
    await settle();
    expect(focusedPerson()).toBe(last);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); });
    await settle();
    expect(focusedPerson()).toBe(opening.getAttribute("data-roster-person-head"));
});

/**
 * jsdom scrolls nothing a frame asks it to — the harness's `scrollTo` does nothing, and a scroll box has no extent to
 * scroll through — so a row a pick brings into view, or a place a remount restores, would never be seen: here the
 * grid's scroll box has room, and it scrolls as a page does, and says so. Its rows and bands measure themselves as the
 * harness measures the boxes the virtualizer places them in, so the grid's floors are what it places the rows by.
 */
function scrollsAsAPageDoes() {
    const rect = vi.mocked(Element.prototype.getBoundingClientRect);
    const harness = rect.getMockImplementation()!;
    rect.mockImplementation(function (this: Element) {
        const height = this.hasAttribute("data-roster-person-row") ? 62 : this.hasAttribute("data-roster-group") ? 38 : undefined;
        return height === undefined ? harness.call(this) : { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: height, width: 900, height, toJSON() {} };
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-virtual-rows") ? 1_000_000 : 0;
    });
    vi.spyOn(Element.prototype, "scrollTo").mockImplementation(function (this: Element, options?: ScrollToOptions | number) {
        if (typeof options !== "object") return;
        if (options.top !== undefined) this.scrollTop = options.top;
        if (options.left !== undefined) this.scrollLeft = options.left;
        this.dispatchEvent(new Event("scroll"));
    } as Element["scrollTo"]);
}

/** Search Records' box, in the toolbar's row. */
const searchBox = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
/** Types into the box, a key at a time, as a person does. */
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
const inspected = (c: HTMLElement) => slot(c, "end").querySelector("[data-inspector-title]")?.textContent;

test("Search Records seeks the staff by key (#1398): one on screen is selected; a far one, their row not mounted, is selected and brought into view; one the rail hides says so", async () => {
    scrollsAsAPageDoes();
    const { container, store } = await open(ex.rosterWarehouse);
    await press(within(slot(container, "toolbar")).getByRole("radio", { name: "People" }));
    await typeIntoSearch(container, "aald");
    await waitFor(() => expect(lines(container)).toEqual(["aalder · A. Alder · Inbound"]));
    fireEvent.keyDown(searchBox(container).querySelector("input")!, { key: "Enter" });
    await settle();
    expect(inspected(container)).toBe("A. Alder");
    // T. Kelp, of the last group, far below the rows mounted.
    expect(slot(container, "main").querySelector('[data-roster-person-row="tkelp"]')).toBeNull();
    await act(async () => { fireEvent.click(searchBox(container).querySelector("button[aria-label='Clear search']")!); });
    await typeIntoSearch(container, "tkelp");
    await waitFor(() => expect(lines(container)).toEqual(["tkelp · T. Kelp · Dispatch"]));
    fireEvent.keyDown(searchBox(container).querySelector("input")!, { key: "Enter" });
    await settle();
    expect(inspected(container)).toBe("T. Kelp");
    await waitFor(() => expect(slot(container, "main").querySelector('[data-roster-person-row="tkelp"]')).not.toBeNull());
    // The rail narrowed to picking: T. Kelp is found, and said to be hidden.
    await narrow(store, "rosterWarehouse", "people", new Map<string, Choice>([["team", variant("values", [text("picking")])]]));
    await act(async () => { fireEvent.click(searchBox(container).querySelector("button[aria-label='Clear search']")!); });
    await typeIntoSearch(container, "tkelp");
    await waitFor(() => expect(lines(container)).toEqual(["tkelp · T. Kelp · Dispatch · hidden by the filters"]));
});

/** The row at the top of the People grid's view — the mounted row its scroll offset falls in — and the px scrolled into it. */
function topRow(c: HTMLElement): { key: string | null; into: number } {
    const top = scroller(c).scrollTop;
    const placed = [...slot(c, "main").querySelectorAll<HTMLElement>("[data-index]")].map(el => ({ el, at: Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? NaN) }))
        .filter(row => row.at <= top).sort((a, b) => b.at - a.at);
    const row = placed[0];
    if (row === undefined) return { key: null, into: 0 };
    const key = row.el.querySelector("[data-roster-person-row]")?.getAttribute("data-roster-person-row") ?? row.el.querySelector("[data-roster-group]")?.getAttribute("data-roster-group") ?? null;
    return { key, into: top - row.at };
}

test("where the People rows rest comes back after a remount: the row at the top, and the px into it (#1398)", async () => {
    scrollsAsAPageDoes();
    const first = await open(ex.rosterWarehouse);
    await press(within(slot(first.container, "toolbar")).getByRole("radio", { name: "People" }));
    await act(async () => { scroller(first.container).scrollTop = 20 * 62 + 17; fireEvent.scroll(scroller(first.container)); });
    await settle();
    const rested = topRow(first.container);
    expect(rested.key).not.toBeNull();
    // The scroll settles — the frame says so once it has rested — and is saved.
    await waitFor(() => expect(Object.keys(localStorage).some(key => key.endsWith(".anchor") && localStorage.getItem(key)!.includes("person:"))).toBe(true));
    first.unmount();
    const again = await open(ex.rosterWarehouse);
    await waitFor(() => expect(topRow(again.container)).toEqual(rested));
});
