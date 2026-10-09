/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The toolbar's one row under width pressure (Sheet Spec §6.3, #952): its
 * items on the shared toolbar, as the Sheet's frame lays them out (#1216),
 * fold on one ladder — the tabs fold into the `+n` menu one at a time,
 * then the count goes, the context label, the `+ TAB` label and the
 * whole-sheet count, the tab names cap, and last the context switch goes
 * and the strip closes up; after those a paged source's key search folds to
 * its icon and the strip into one chip, the open view's (#1221), and last the
 * history item to its buttons. jsdom lays nothing out, so each form's width
 * is stubbed from what it shows: a tab 80px (50 once the names cap), `+n` 30,
 * `+ TAB` 50 (20 once its label goes), the strip's one chip 60, the context
 * switch 150 with its label and 100 without, the count 100, the key search's
 * box 200 and its icon 44, the history item 150 and its buttons 100; the gap
 * between items is 10px.
 *
 * And both by the keyboard alone (#860): the tabs a WAI-ARIA tablist, the
 * context switch a radio group.
 */

import { describe, test, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { useState } from "react";
import { act, render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe } from "@chakra-ui/react";
import { IntegerType, StringType, StructType, none, toEastTypeValue, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { system, formatters, EditSession, historyToolbarItem, editingMessages, Toolbar, type ToolbarItem } from "@elaraai/east-ui-components";
import { SheetTabs, type SheetTabView } from "./Tabs.js";
import { useSheetToolbarItemsFor, type SheetToolbarProps, type SheetToolbarTabs } from "./Toolbar.js";
import type { LensContext } from "./sheet-types.js";
import type { SheetSearch } from "./use-seek.js";

/** The toolbar's items on the shared toolbar's one row — as the Sheet's frame lays them out. */
function SheetToolbar(props: SheetToolbarProps) {
    return <Toolbar items={useSheetToolbarItemsFor(props)} />;
}

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

/** A form's width, from what it shows (see the header). */
function widthOf(el: Element): number {
    if (el.hasAttribute("data-toolbar")) return row.px;
    switch (el.getAttribute("data-toolbar-item")) {
        case "tabs": {
            const strip = el.querySelector('[data-slot="tabs"]');
            const squeezed = strip?.getAttribute("data-strip");
            if (squeezed === "menu") return 60;
            const tabs = el.querySelectorAll('[data-slot="tab"]').length;
            const more = el.querySelector('[data-slot="tabMore"]') !== null ? 30 : 0;
            const add = squeezed !== null && squeezed !== undefined ? 20 : 50;
            const tab = squeezed === "capped" || squeezed === "closed" ? 50 : 80;
            return tabs * tab + more + add;
        }
        case "context": return el.querySelector('[data-slot="contextSwitch"] > span[aria-hidden="true"]') !== null ? 150 : 100;
        case "count": return 100;
        case "seek": return el.querySelector('[data-key-search="icon"]') !== null ? 44 : 200;
        case "history": return el.querySelector('[data-history-form="buttons"]') !== null ? 100 : 150;
        default: return 0;
    }
}

const originalRect = Element.prototype.getBoundingClientRect;
const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = widthOf(this);
        return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
    };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
        const style = computed(el, pseudo);
        if (!el.hasAttribute("data-toolbar")) return style;
        return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
    });
});
afterAll(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    vi.restoreAllMocks();
});

const VIEWS = [
    { id: "spray", name: "SPRAYING", count: 12, title: "" },
    { id: "router", name: "ROUTERS", count: 12, title: "" },
    { id: "late", name: "OVERDUE", count: 3, title: "" },
];
const noop = () => {};

/** The history item every collection shares (#988), over a session with nothing pending. */
function historyItem(): ToolbarItem {
    const Run = StructType({ id: StringType, end: IntegerType });
    const session = new EditSession<string>({
        sourceId: "runs", entryType: Run, draftType: Editing.Types.Draft(Run), idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    return historyToolbarItem({ session, words: { ...formatters("en-US"), m: editingMessages }, editing: false, onAction: noop, onIssue: noop });
}

/** A paged source's key search, finding nothing — what the toolbar mounts over its `seek`. */
const SEARCH: SheetSearch = {
    resetKey: "r1", keyType: toEastTypeValue(StringType),
    find: async () => ({ found: false, row: 0, count: 0 }), listRange: async () => [], jump: noop, clear: noop,
};

/** The toolbar's tabs over a strip of `views`, the given one active. */
function tabsOf(styles: Record<string, Record<string, unknown>>, views: SheetTabView[], active: string | null, extra?: Partial<Parameters<typeof SheetTabs>[0]>): SheetToolbarTabs {
    return {
        maxFold: views.length - (views.some((v) => v.id === active) ? 1 : 0),
        version: views.map((v) => v.id).join("|") + String(active),
        held: false,
        render: (fold) => (
            <SheetTabs
                styles={styles}
                views={views}
                wholeCount={60}
                active={active}
                dirty={false}
                hasQuery={false}
                renaming={null}
                renameVal=""
                fold={fold}
                onSwitch={noop}
                onCreate={noop}
                onClose={noop}
                onRenameStart={noop}
                onRenameChange={noop}
                onRenameCommit={noop}
                onRenameCancel={noop}
                onReorder={noop}
                {...extra}
            />
        ),
    };
}

/** A toolbar over the strip, with a count and a context switch to give up. */
function Harness({ count, active }: { count: string; active: string | null }) {
    const recipe = useSlotRecipe({ key: "sheet" });
    const styles = recipe({}) as unknown as Record<string, Record<string, unknown>>;
    return (
        <SheetToolbar
            styles={styles}
            slice={undefined}
            affordances={[]}
            count={count}
            partial={false}
            context={{ value: 0, onChange: noop }}
            tabs={tabsOf(styles, VIEWS, active)}
        />
    );
}

function mount(count: string, active: string | null, px: number) {
    row.px = px;
    return render(<ChakraProvider value={system}><Harness count={count} active={active} /></ChakraProvider>);
}

/** What the toolbar shows: the tabs on the strip, its fold, and the rest. */
function read(container: HTMLElement) {
    const strip = container.querySelector('[data-slot="tabs"]')!;
    return {
        tabs: [...container.querySelectorAll('[data-slot="tab"]')].map((t) => t.getAttribute("data-tab")),
        folded: strip.getAttribute("data-folded"),
        strip: strip.getAttribute("data-strip"),
        count: container.querySelector('[data-slot="toolbarCount"]')?.textContent ?? null,
        context: container.querySelector('[data-slot="contextSwitch"]') === null ? null
            : container.querySelector('[data-slot="contextSwitch"]')!.textContent!.includes("context") ? "labelled" : "bare",
    };
}

describe("the toolbar's ladder", () => {
    test("a row that fits folds nothing and keeps everything", () => {
        // Every tab (370) + the context switch (150) + the count (100) + 2 gaps = 640.
        const { container } = mount("12 matches", "router", 640);
        expect(read(container)).toEqual({ tabs: ["all", "spray", "router", "late"], folded: null, strip: null, count: "12 matches", context: "labelled" });
    });

    test("the tabs fold first, one at a time, the active tab kept", () => {
        expect(read(mount("12 matches", "router", 590).container)).toMatchObject({ tabs: ["all", "spray", "router"], folded: "1", count: "12 matches" });
        cleanup();
        expect(read(mount("12 matches", "router", 510).container)).toMatchObject({ tabs: ["all", "router"], folded: "2", count: "12 matches" });
    });

    test("past the strip's floor the count goes, then the context label, then the strip closes up rung by rung", () => {
        expect(read(mount("12 matches", "router", 400).container)).toEqual({ tabs: ["all", "router"], folded: "2", strip: null, count: null, context: "labelled" });
        cleanup();
        expect(read(mount("12 matches", "router", 350).container)).toMatchObject({ strip: null, count: null, context: "bare" });
        cleanup();
        expect(read(mount("12 matches", "router", 320).container)).toMatchObject({ strip: "compact", context: "bare" });
        cleanup();
        expect(read(mount("12 matches", "router", 260).container)).toMatchObject({ strip: "capped", context: "bare" });
    });

    test("last, the context switch goes and the strip closes up", () => {
        const { container } = mount("12 matches", "router", 150);
        expect(read(container)).toEqual({ tabs: ["all", "router"], folded: "2", strip: "closed", count: null, context: null });
        expect(container.querySelector('[data-slot="tabMore"]')!.textContent).toBe("+2");
    });

    test("the count going gives its room back — the configuration follows the row it is in", () => {
        const { container, rerender } = mount("12 matches", "router", 400);
        expect(read(container)).toMatchObject({ folded: "2", count: null, context: "labelled" });
        // Without the count, 400 holds the folded strip and the labelled switch; at 530, everything.
        rerender(<ChakraProvider value={system}><Harness count="" active="router" /></ChakraProvider>);
        expect(read(container)).toMatchObject({ folded: "2", count: null, context: "labelled" });
        row.px = 530;
        rerender(<ChakraProvider value={system}><Harness count="" active="router" /></ChakraProvider>);
        expect(read(container)).toMatchObject({ tabs: ["all", "spray", "router", "late"], folded: null, context: "labelled" });
    });

    test("a paged source's key search folds to its icon after the sheet's own steps, before the history item's (#1221)", () => {
        const history = historyItem();
        function WithSearch() {
            const styles = useSlotRecipe({ key: "sheet" })({}) as unknown as Record<string, Record<string, unknown>>;
            return <SheetToolbar styles={styles} slice={undefined} affordances={[]} count="12 matches" partial={false}
                context={{ value: 0, onChange: noop }} tabs={tabsOf(styles, VIEWS, "router")} search={SEARCH} history={history} />;
        }
        const at = (px: number) => {
            cleanup();
            row.px = px;
            const { container } = render(<ChakraProvider value={system}><WithSearch /></ChakraProvider>);
            const form = (key: string) => container.querySelector(`[data-toolbar-item="${key}"]`)?.getAttribute("data-toolbar-form") ?? null;
            return {
                ladder: container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-ladder"), strip: read(container).strip, seek: form("seek"), history: form("history"),
                // It hugs the row's end, with the rail and the history.
                end: container.querySelector('[data-toolbar-item="seek"]')?.hasAttribute("data-toolbar-end") ?? null,
            };
        };
        // Its step comes after the strip closes up and the context switch goes; the strip's one chip after it, and the history item's last.
        expect(at(2000)).toEqual({ ladder: "tabs>1 tabs>2 count>1 context>1 tabs>3 tabs>4 tabs>5 context>2 seek>1 tabs>6 history>1", strip: null, seek: "0", history: "0", end: true });
        // The closed strip (150), the box (200) and the history item (150): the box holds while it fits.
        expect(at(520)).toMatchObject({ strip: "closed", seek: "0", history: "0" });
        // A pixel short of that, the icon (44), the history item whole.
        expect(at(519)).toMatchObject({ strip: "closed", seek: "1", history: "0" });
        // Shorter still (150 + 44 + 150 + 20 = 364), the strip folds into its chip (60), the history item whole.
        expect(at(363)).toMatchObject({ strip: "menu", seek: "1", history: "0" });
        // And past that (60 + 44 + 150 + 20 = 274), the history item folds to its buttons, last.
        expect(at(273)).toMatchObject({ strip: "menu", seek: "1", history: "1" });
    });
});

/** A menu's items, while it is open. */
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];

/** Opens a menu by its trigger and returns its items once they show. */
async function openMenu(trigger: HTMLElement): Promise<HTMLElement[]> {
    await act(async () => { fireEvent.click(trigger); });
    return waitFor(() => {
        const items = menuItems();
        if (items.length === 0 || trigger.getAttribute("aria-expanded") !== "true") throw new Error("the menu has not opened");
        return items;
    });
}

/**
 * Picks an item by its text as a pointer does — pressed on it, then its click; the menu opened first when it is
 * closed — and waits for the menu to close and its content to go. A menu opened again within a frame of its close
 * loses its content to that close: Zag's presence unmounts it a frame later, open or not. So the next open waits
 * for this one's close to finish.
 */
async function pick(trigger: () => HTMLElement, text: string): Promise<void> {
    const items = trigger().getAttribute("aria-expanded") === "true" ? menuItems() : await openMenu(trigger());
    const item = items.find((i) => i.textContent === text);
    if (item === undefined) throw new Error(`no item "${text}" among ${items.map((i) => i.textContent).join(", ")}`);
    await act(async () => { fireEvent.pointerDown(item); });
    await act(async () => { fireEvent.click(item); });
    await waitFor(() => {
        if (trigger().getAttribute("aria-expanded") === "true") throw new Error("the menu is still open");
        if (document.querySelector('[role="menu"]') !== null) throw new Error("the menu's content is still there");
    });
}

/** The strip folded into its one chip (#1221), over a host that keeps what it changes and counts `+ TAB`. */
function MenuHost({ created }: { created: () => void }) {
    const styles = useSlotRecipe({ key: "sheet" })({}) as unknown as Record<string, Record<string, unknown>>;
    const [views, setViews] = useState<SheetTabView[]>(VIEWS);
    const [active, setActive] = useState<string | null>("router");
    return (
        <SheetTabs styles={styles} views={views} wholeCount={60} active={active} dirty={false} hasQuery={false}
            renaming={null} renameVal="" fold={{ folded: views.length, strip: "menu" }}
            onSwitch={setActive} onCreate={created}
            onClose={(id) => { setViews((vs) => vs.filter((v) => v.id !== id)); if (active === id) setActive(null); }}
            onRenameStart={noop} onRenameChange={noop} onRenameCommit={noop} onRenameCancel={noop} onReorder={noop} />
    );
}

describe("the strip as one chip (#1221)", () => {
    test("the chip names the open view; its menu holds the whole sheet and every view with their counts, then + TAB and the open view's close — each doing what its tab or button does", async () => {
        let creates = 0;
        const { container } = render(<ChakraProvider value={system}><MenuHost created={() => { creates += 1; }} /></ChakraProvider>);
        const chip = () => container.querySelector('[data-slot="tabMenu"]') as HTMLElement;
        // One chip in place of the tablist: the open view's tab.
        expect(container.querySelector('[role="tablist"]')).toBeNull();
        expect([chip().getAttribute("aria-label"), chip().getAttribute("data-tab")]).toEqual(["Views: ROUTERS", "router"]);
        expect((await openMenu(chip())).map((i) => i.textContent)).toEqual(["All60", "SPRAYING12", "ROUTERS12", "OVERDUE3", "New tab from this view", 'Close "ROUTERS"']);
        // A view picked is the open one.
        await pick(chip, "OVERDUE3");
        expect(chip().getAttribute("aria-label")).toBe("Views: OVERDUE");
        // Its close: the view goes, and the whole sheet is open — with nothing to close.
        await pick(chip, 'Close "OVERDUE"');
        expect([chip().getAttribute("aria-label"), chip().getAttribute("data-tab")]).toEqual(["Views: All", "all"]);
        expect((await openMenu(chip())).map((i) => i.textContent)).toEqual(["All60", "SPRAYING12", "ROUTERS12", "New tab from this view"]);
        // + TAB snapshots a view, as the strip's button does.
        await pick(chip, "New tab from this view");
        expect(creates).toBe(1);
    });
});

/** A host that keeps what the tabs and the context switch change, as the sheet's machine does, and counts `+ TAB`. */
function KeyboardHost({ created }: { created: () => void }) {
    const recipe = useSlotRecipe({ key: "sheet" });
    const styles = recipe({}) as unknown as Record<string, Record<string, unknown>>;
    const [views, setViews] = useState<SheetTabView[]>(VIEWS);
    const [active, setActive] = useState<string | null>("spray");
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameVal, setRenameVal] = useState("");
    const [context, setContext] = useState<LensContext>(0);
    return (
        <SheetToolbar
            styles={styles}
            slice={undefined}
            affordances={[]}
            count=""
            partial={false}
            context={{ value: context, onChange: setContext }}
            tabs={tabsOf(styles, views, active, {
                renaming,
                renameVal,
                panelId: "the-grid",
                onSwitch: setActive,
                onCreate: created,
                onClose: (id) => { setViews((vs) => vs.filter((v) => v.id !== id)); if (active === id) setActive(null); },
                onRenameStart: (id) => { setRenaming(id); setRenameVal(views.find((v) => v.id === id)?.name ?? ""); },
                onRenameChange: setRenameVal,
                onRenameCommit: () => { setViews((vs) => vs.map((v) => (v.id === renaming ? { ...v, name: renameVal } : v))); setRenaming(null); },
                onRenameCancel: () => setRenaming(null),
            })}
        />
    );
}

describe("by the keyboard alone (#860)", () => {
    function mountHost() {
        row.px = 2000;
        let creates = 0;
        const ui = render(<ChakraProvider value={system}><KeyboardHost created={() => { creates += 1; }} /></ChakraProvider>);
        const tab = (id: string) => ui.container.querySelector(`[data-slot="tab"][data-tab="${id}"]`) as HTMLElement;
        const press = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(document.activeElement!, { key: k, ...init });
        return { ...ui, tab, press, creates: () => creates };
    }

    test("the tabs are a tablist with one tab stop: ←/→ and Home/End move, Enter and Space switch, F2 renames and Delete closes, the focus staying on a tab", () => {
        const { container, tab, press } = mountHost();
        const list = container.querySelector('[role="tablist"]')!;
        expect(list.getAttribute("aria-label")).toBe("Views");
        // The tablist owns only its tabs; `+ tab` is a button beside it.
        expect([...list.children].map((c) => c.getAttribute("role"))).toEqual(["tab", "tab", "tab", "tab"]);
        expect(container.querySelector('[data-slot="tabAdd"]')!.tagName).toBe("BUTTON");
        expect(list.contains(container.querySelector('[data-slot="tabAdd"]'))).toBe(false);
        // One tab stop, on the active tab; every tab names the grid it switches.
        expect([...list.children].map((c) => (c as HTMLElement).tabIndex)).toEqual([-1, 0, -1, -1]);
        expect(tab("spray").getAttribute("aria-controls")).toBe("the-grid");
        tab("spray").focus();
        press("ArrowRight");
        expect(document.activeElement).toBe(tab("router"));
        press("End");
        expect(document.activeElement).toBe(tab("late"));
        press("ArrowRight");
        expect(document.activeElement).toBe(tab("all"));
        press("ArrowLeft");
        expect(document.activeElement).toBe(tab("late"));
        press("Home");
        expect(document.activeElement).toBe(tab("all"));
        // Moving the focus switches nothing; Enter does, and Space.
        expect(tab("spray").getAttribute("aria-selected")).toBe("true");
        press("End");
        press("Enter");
        expect(tab("late").getAttribute("aria-selected")).toBe("true");
        expect(tab("late").tabIndex).toBe(0);
        press("Home");
        press(" ");
        expect(tab("all").getAttribute("aria-selected")).toBe("true");
        // The whole-sheet tab neither closes nor renames.
        press("Delete");
        press("F2");
        expect(tab("all")).toBeTruthy();
        expect(container.querySelector('[data-slot="tabRename"]')).toBeNull();
        // F2 renames; ⏎ commits, and the focus is back on the tab.
        press("End");
        press("F2");
        const rename = container.querySelector('[data-slot="tabRename"]') as HTMLInputElement;
        expect(document.activeElement).toBe(rename);
        fireEvent.change(rename, { target: { value: "LATE" } });
        fireEvent.keyDown(rename, { key: "Enter" });
        expect(tab("late").textContent).toContain("LATE");
        expect(document.activeElement).toBe(tab("late"));
        // Delete closes the focused tab; the focus goes to its neighbour.
        press("ArrowLeft");
        expect(document.activeElement).toBe(tab("router"));
        press("Delete");
        expect(tab("router")).toBeNull();
        expect(document.activeElement).toBe(tab("late"));
    });

    test("`+ tab` is a button: Enter or Space presses it once, and so does a pointer", () => {
        const { container, creates } = mountHost();
        const add = container.querySelector('[data-slot="tabAdd"]') as HTMLElement;
        // A key's press is a click with no pointer behind it.
        fireEvent.click(add, { detail: 0 });
        expect(creates()).toBe(1);
        // A pointer's press acts on the button going down; the click after it adds nothing.
        fireEvent.mouseDown(add, { button: 0 });
        fireEvent.click(add, { detail: 1 });
        expect(creates()).toBe(2);
    });

    test("the history item every collection shares sits at the row's end (#988)", () => {
        row.px = 2000;
        const history = historyItem();
        function WithHistory() {
            const styles = useSlotRecipe({ key: "sheet" })({}) as unknown as Record<string, Record<string, unknown>>;
            return <SheetToolbar styles={styles} slice={undefined} affordances={[]} count="" partial={false} history={history} />;
        }
        const { container } = render(<ChakraProvider value={system}><WithHistory /></ChakraProvider>);
        const item = container.querySelector('[data-toolbar-item="history"]')!;
        expect(item.hasAttribute("data-toolbar-end")).toBe(true);
        expect(item.querySelector('[data-slot="history"]')).not.toBeNull();
    });

    test("the context switch is a radio group with one tab stop: ←/→ and Home/End move and pick, and a key's press picks", () => {
        const { container, press } = mountHost();
        const group = container.querySelector('[role="radiogroup"]')!;
        const radio = (n: number) => group.querySelector(`[data-context="${n}"]`) as HTMLElement;
        const checked = () => [0, 1, 3].filter((n) => radio(n).getAttribute("aria-checked") === "true");
        expect(checked()).toEqual([0]);
        expect([0, 1, 3].map((n) => radio(n).tabIndex)).toEqual([0, -1, -1]);
        radio(0).focus();
        press("ArrowRight");
        expect(checked()).toEqual([1]);
        expect(document.activeElement).toBe(radio(1));
        expect([0, 1, 3].map((n) => radio(n).tabIndex)).toEqual([-1, 0, -1]);
        press("End");
        expect(checked()).toEqual([3]);
        press("ArrowRight");
        expect(checked()).toEqual([0]);
        press("ArrowLeft");
        expect(checked()).toEqual([3]);
        press("Home");
        expect(checked()).toEqual([0]);
        fireEvent.click(radio(3), { detail: 0 });
        expect(checked()).toEqual([3]);
    });
});
