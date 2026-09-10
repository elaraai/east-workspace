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
 */

import { describe, test, expect, afterEach, beforeAll, afterAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { SheetTabs } from "./Tabs.js";
import { SheetToolbar } from "./Toolbar.js";

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
