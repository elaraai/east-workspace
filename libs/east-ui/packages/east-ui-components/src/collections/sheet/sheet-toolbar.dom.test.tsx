/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The toolbar's one row under width pressure (Sheet Spec §6.3): the tab strip
 * folds its trailing tabs into the `+n` menu, and at its floor reports, so the
 * toolbar climbs its ladder — the count, the context label, the `+ TAB` label,
 * the tab names, the context switch. jsdom lays nothing out, so the strip's
 * measure is stubbed: `scrollWidth` past `clientWidth` is "overflowing".
 *
 * And both by the keyboard alone (#860): the tabs a WAI-ARIA tablist, the
 * context switch a radio group.
 */

import { describe, test, expect, afterEach, beforeAll, afterAll } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { SheetTabs, type SheetTabView } from "./Tabs.js";
import { SheetToolbar } from "./Toolbar.js";
import type { LensContext } from "./sheet-types.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the strip and the toolbar observe their widths through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

/** The stubbed measure: the strip's content width against its box. */
let stripContent = 0;
let stripBox = 0;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
const originalClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
        configurable: true,
        get(this: HTMLElement) { return this.getAttribute("data-slot") === "tabs" ? stripContent : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get(this: HTMLElement) { return this.getAttribute("data-slot") === "tabs" ? stripBox : 0; },
    });
});
afterAll(() => {
    if (originalScroll !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollWidth", originalScroll);
    if (originalClient !== undefined) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClient);
});

const VIEWS = [
    { id: "paint", name: "PAINTING", count: 12, title: "" },
    { id: "lathe", name: "LATHES", count: 12, title: "" },
    { id: "late", name: "OVERDUE", count: 3, title: "" },
];
const noop = () => {};

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
            tabs={
                <SheetTabs
                    styles={styles}
                    views={VIEWS}
                    wholeCount={60}
                    active={active}
                    dirty={false}
                    hasQuery={false}
                    renaming={null}
                    renameVal=""
                    onSwitch={noop}
                    onCreate={noop}
                    onClose={noop}
                    onRenameStart={noop}
                    onRenameChange={noop}
                    onRenameCommit={noop}
                    onRenameCancel={noop}
                    onReorder={noop}
                />
            }
        />
    );
}

function mount(count: string, active: string | null) {
    return render(<ChakraProvider value={system}><Harness count={count} active={active} /></ChakraProvider>);
}

describe("the toolbar's ladder", () => {
    test("a strip that fits folds nothing and the toolbar keeps everything", () => {
        stripContent = 400; stripBox = 500;
        const { container } = mount("12 matches", null);
        const toolbar = container.querySelector('[data-slot="toolbar"]')!;
        expect(toolbar.getAttribute("data-tight")).toBeNull();
        expect(container.querySelector('[data-slot="tabs"]')!.getAttribute("data-folded")).toBeNull();
        expect(container.querySelector('[data-slot="tabMore"]')).toBeNull();
        expect(container.querySelector('[data-slot="toolbarCount"]')!.textContent).toBe("12 matches");
        expect(container.querySelector('[data-slot="contextSwitch"]')!.textContent).toContain("context");
        expect(container.querySelectorAll('[data-slot="tab"]')).toHaveLength(4);
    });

    test("a strip that overflows folds to its floor, then the toolbar climbs to its last rung", () => {
        stripContent = 900; stripBox = 300;
        const { container } = mount("12 matches", "lathe");
        // The floor: the whole-sheet tab, the active tab, `+2`, `+ TAB`.
        const tabs = container.querySelector('[data-slot="tabs"]')!;
        expect(tabs.getAttribute("data-folded")).toBe("2");
        expect(container.querySelector('[data-slot="tabMore"]')!.textContent).toBe("+2");
        expect([...container.querySelectorAll('[data-slot="tab"]')].map((t) => t.getAttribute("data-tab"))).toEqual(["all", "lathe"]);
        // Still overflowing at the floor: the ladder climbs — synchronously — until nothing more can go.
        const toolbar = container.querySelector('[data-slot="toolbar"]')!;
        expect(toolbar.getAttribute("data-tight")).toBe("5");
        expect(container.querySelector('[data-slot="toolbarCount"]')).toBeNull();
        expect(container.querySelector('[data-slot="contextSwitch"]')!.textContent).not.toContain("context");
    });

    test("the count coming or going resets the ladder, which climbs again only while the strip overflows", () => {
        stripContent = 900; stripBox = 300;
        const { container, rerender } = mount("12 matches", "lathe");
        expect(container.querySelector('[data-slot="toolbar"]')!.getAttribute("data-tight")).toBe("5");
        // The strip fits now (a wider box) and the count goes: the ladder resets and stays down.
        stripContent = 250; stripBox = 300;
        rerender(<ChakraProvider value={system}><Harness count="" active="lathe" /></ChakraProvider>);
        expect(container.querySelector('[data-slot="toolbar"]')!.getAttribute("data-tight")).toBeNull();
        expect(container.querySelector('[data-slot="contextSwitch"]')!.textContent).toContain("context");
        // The count returns while the strip still fits: nothing climbs.
        rerender(<ChakraProvider value={system}><Harness count="3 matches" active="lathe" /></ChakraProvider>);
        expect(container.querySelector('[data-slot="toolbar"]')!.getAttribute("data-tight")).toBeNull();
        expect(container.querySelector('[data-slot="toolbarCount"]')!.textContent).toBe("3 matches");
    });
});

/** A host that keeps what the tabs and the context switch change, as the sheet's machine does, and counts `+ TAB`. */
function KeyboardHost({ created }: { created: () => void }) {
    const recipe = useSlotRecipe({ key: "sheet" });
    const styles = recipe({}) as unknown as Record<string, Record<string, unknown>>;
    const [views, setViews] = useState<SheetTabView[]>(VIEWS);
    const [active, setActive] = useState<string | null>("paint");
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
            tabs={
                <SheetTabs
                    styles={styles}
                    views={views}
                    wholeCount={60}
                    active={active}
                    dirty={false}
                    hasQuery={false}
                    renaming={renaming}
                    renameVal={renameVal}
                    panelId="the-grid"
                    onSwitch={setActive}
                    onCreate={created}
                    onClose={(id) => { setViews((vs) => vs.filter((v) => v.id !== id)); if (active === id) setActive(null); }}
                    onRenameStart={(id) => { setRenaming(id); setRenameVal(views.find((v) => v.id === id)?.name ?? ""); }}
                    onRenameChange={setRenameVal}
                    onRenameCommit={() => { setViews((vs) => vs.map((v) => (v.id === renaming ? { ...v, name: renameVal } : v))); setRenaming(null); }}
                    onRenameCancel={() => setRenaming(null)}
                    onReorder={noop}
                />
            }
        />
    );
}

describe("by the keyboard alone (#860)", () => {
    function mountHost() {
        stripContent = 400; stripBox = 500;
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
        expect(tab("paint").getAttribute("aria-controls")).toBe("the-grid");
        tab("paint").focus();
        press("ArrowRight");
        expect(document.activeElement).toBe(tab("lathe"));
        press("End");
        expect(document.activeElement).toBe(tab("late"));
        press("ArrowRight");
        expect(document.activeElement).toBe(tab("all"));
        press("ArrowLeft");
        expect(document.activeElement).toBe(tab("late"));
        press("Home");
        expect(document.activeElement).toBe(tab("all"));
        // Moving the focus switches nothing; Enter does, and Space.
        expect(tab("paint").getAttribute("aria-selected")).toBe("true");
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
        expect(document.activeElement).toBe(tab("lathe"));
        press("Delete");
        expect(tab("lathe")).toBeNull();
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
