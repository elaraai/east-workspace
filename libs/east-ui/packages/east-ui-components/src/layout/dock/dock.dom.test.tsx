/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Behaviour guard for `<Dock>` (issue #325):
 *   - the toggle collapses/expands via the chevron control (aria round-trip),
 *   - `defaultCollapsed` starts on the rail,
 *   - the body is kept mounted (in the DOM) while collapsed by default, so a
 *     child's state survives the collapse,
 *   - Esc does NOT collapse (inline content, not a modal — unlike Expandable),
 *   - a State-driven `collapsed` + `onCollapsedChange` round-trips through the
 *     store (the controlled path used by app-style ui() tasks);
 *   - a host drives `DockPane`'s open tab with `tab` and hears each change
 *     through `onTabChange` (K1, #935), and a tab's count follows its label
 *     (#1186);
 *   - a pane that is not `collapsible` never collapses, and a host-driven
 *     `collapsed` is drawn in the commit it arrives in (#1125);
 *   - a tab row too narrow for its tabs folds them (#1210): the counts first,
 *     then the trailing tabs into a `+n` menu, the open tab always on the row.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { useLayoutEffect, useRef } from "react";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, BooleanType, NullType, type ValueTypeOf } from "@elaraai/east";
import { Dock, Text, State, Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { DockPane } from "./index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { UIStore } from "../../platform/state-store.js";

afterEach(cleanup);

function compileUI(program: ReturnType<typeof East.function>): ValueTypeOf<typeof UIComponentType> {
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

function buildUncontrolled(defaultCollapsed = false): ValueTypeOf<typeof UIComponentType> {
    return compileUI(East.function([], UIComponentType, (_$) =>
        Dock.Root([Text.Root("BODY")], { label: "Library", icon: "book", defaultCollapsed }),
    ));
}

const KEY = "dock.test.collapsed";

/** State-driven `collapsed` + write-back `onCollapsedChange` (controlled path). */
function buildControlled(): ValueTypeOf<typeof UIComponentType> {
    return compileUI(East.function([], UIComponentType, (_$) =>
        Reactive.Root(East.function([], UIComponentType, ($2) => {
            const collapsedBind = $2.let(State.bind([BooleanType], KEY, false));
            const collapsed = $2.let(collapsedBind.read(), BooleanType);
            const onCollapsedChange = $2.const(East.function([BooleanType], NullType, ($3, next) => {
                $3(collapsedBind.write(next));
            }));
            return Dock.Root([Text.Root("BODY")], { collapsed, onCollapsedChange, label: "Library" });
        })),
    ));
}

function mount(value: ValueTypeOf<typeof UIComponentType>) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="dock-test" />
        </ChakraProvider>,
    );
}

describe("Dock — toggle, rail, keep-mounted, Esc", () => {
    test("chevron toggles collapsed state (aria round-trip)", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildUncontrolled());

        const control = getByRole("button", { name: "Collapse Library" });
        expect(control.getAttribute("aria-expanded")).toBe("true");

        await act(async () => { fireEvent.click(control); });
        expect(getByRole("button", { name: "Expand Library" }).getAttribute("aria-expanded")).toBe("false");

        await act(async () => { fireEvent.click(getByRole("button", { name: "Expand Library" })); });
        expect(getByRole("button", { name: "Collapse Library" }).getAttribute("aria-expanded")).toBe("true");
    });

    test("defaultCollapsed starts on the rail", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildUncontrolled(true));
        expect(getByRole("button", { name: "Expand Library" }).getAttribute("aria-expanded")).toBe("false");
    });

    test("body is kept mounted (in the DOM) while collapsed", async () => {
        initializeStore(new UIStore());
        const { getByRole, getByText } = mount(buildUncontrolled());
        // Same text node survives the collapse (kept mounted, just hidden).
        const bodyNode = getByText("BODY");
        await act(async () => { fireEvent.click(getByRole("button", { name: "Collapse Library" })); });
        expect(getByText("BODY")).toBe(bodyNode);
    });

    test("Esc does NOT collapse (inline content, not a modal)", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildUncontrolled());
        expect(getByRole("button", { name: "Collapse Library" }).getAttribute("aria-expanded")).toBe("true");
        await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
        expect(getByRole("button", { name: "Collapse Library" }).getAttribute("aria-expanded")).toBe("true");
    });

    test("controlled path: toggle writes State and the store drives collapse", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildControlled());
        expect(getByRole("button", { name: "Collapse Library" }).getAttribute("aria-expanded")).toBe("true");

        await act(async () => { fireEvent.click(getByRole("button", { name: "Collapse Library" })); });
        expect(getByRole("button", { name: "Expand Library" }).getAttribute("aria-expanded")).toBe("false");
    });
});

describe("Dock — the pane's tab row and its rail", () => {
    test("the row holds the tabs and the collapse control; a tab opens its body, and every body stays mounted", async () => {
        initializeStore(new UIStore());
        const { getAllByRole, getByRole, getByText } = mount(compileUI(East.function([], UIComponentType, (_$) => Dock.Root([], {
            label: "Components", icon: "shapes", badge: "47", surface: "shell",
            tabs: [
                { key: "components", label: "Components", body: [Text.Root("CARDS")] },
                { key: "pages", label: "Pages", body: [Text.Root("PAGES")] },
            ],
        }))));
        const tabs = getAllByRole("tab");
        expect(tabs.map(tab => tab.textContent)).toEqual(["Components", "Pages"]);
        expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
        expect(getByRole("button", { name: "Collapse Components" }).getAttribute("aria-expanded")).toBe("true");

        const pages = getByText("PAGES");
        expect(pages.closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(true);
        await act(async () => { fireEvent.click(tabs[1]!); });
        expect(getAllByRole("tab")[1]!.getAttribute("aria-selected")).toBe("true");
        // The same node, shown; the other tab's body hidden but mounted.
        expect(getByText("PAGES")).toBe(pages);
        expect(pages.closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(false);
        expect(getByText("CARDS").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(true);
    });

    test("the arrow keys, Home and End move between the tabs", async () => {
        initializeStore(new UIStore());
        const { getAllByRole } = mount(compileUI(East.function([], UIComponentType, (_$) => Dock.Root([], {
            label: "Components", icon: "shapes", badge: "47", surface: "shell",
            tabs: [
                { key: "components", label: "Components", body: [Text.Root("CARDS")] },
                { key: "pages", label: "Pages", body: [Text.Root("PAGES")] },
            ],
        }))));
        const selected = () => getAllByRole("tab").findIndex(tab => tab.getAttribute("aria-selected") === "true");
        await act(async () => { fireEvent.keyDown(getAllByRole("tab")[0]!, { key: "ArrowRight" }); });
        expect(selected()).toBe(1);
        await act(async () => { fireEvent.keyDown(getAllByRole("tab")[1]!, { key: "ArrowRight" }); });
        expect(selected()).toBe(0);
        await act(async () => { fireEvent.keyDown(getAllByRole("tab")[0]!, { key: "End" }); });
        expect(selected()).toBe(1);
        await act(async () => { fireEvent.keyDown(getAllByRole("tab")[1]!, { key: "Home" }); });
        expect(selected()).toBe(0);
    });

    test("collapsed, the rail holds the expand control, the icon tile, the count and the label; the rail expands", async () => {
        initializeStore(new UIStore());
        const { getByRole, getByText, queryAllByRole, container } = mount(compileUI(East.function([], UIComponentType, (_$) => Dock.Root([], {
            label: "Components", icon: "shapes", badge: "47", surface: "shell",
            tabs: [
                { key: "components", label: "Components", body: [Text.Root("CARDS")] },
                { key: "pages", label: "Pages", body: [Text.Root("PAGES")] },
            ],
        }))));
        await act(async () => { fireEvent.click(getByRole("button", { name: "Collapse Components" })); });
        expect(getByRole("button", { name: "Expand Components" }).getAttribute("aria-expanded")).toBe("false");
        expect(queryAllByRole("tab")).toHaveLength(0);
        expect(container.querySelector("svg[data-icon=shapes]")).not.toBeNull();
        expect(getByText("47")).toBeTruthy();
        await act(async () => { fireEvent.click(getByText("47")); });
        expect(getByRole("button", { name: "Collapse Components" })).toBeTruthy();
    });

    test("an active rail draws its tile and count in the brand, with the detail after the label; an inactive one reads its detail muted", async () => {
        initializeStore(new UIStore());
        const active = mount(compileUI(East.function([], UIComponentType, (_$) => Dock.Root([Text.Root("REVENUE")], {
            label: "Inspector", icon: "sliders", side: "end", defaultCollapsed: true,
            active: true, badge: "8/12", detail: "Revenue trend",
        }))));
        const rail = active.getByText("8/12").parentElement!;
        expect(rail.hasAttribute("data-active")).toBe(true);
        expect([...rail.children].map((el) => el.textContent)).toEqual(["", "8/12", "Inspector", "Revenue trend"]);
        expect(active.container.querySelector("svg[data-icon=sliders]")).not.toBeNull();
        cleanup();
        const idle = mount(compileUI(East.function([], UIComponentType, (_$) => Dock.Root([Text.Root("NOTHING")], {
            label: "Inspector", icon: "sliders", side: "end", defaultCollapsed: true, detail: "Nothing selected",
        }))));
        const detail = idle.container.querySelector("[data-dock-detail]")!;
        expect(detail.textContent).toBe("Nothing selected");
        expect(detail.parentElement!.hasAttribute("data-active")).toBe(false);
        // Expanded, the detail is the rail's alone.
        await act(async () => { fireEvent.click(idle.getByRole("button", { name: "Expand Inspector" })); });
        expect(idle.container.querySelector("[data-dock-detail]")).toBeNull();
    });

    test("without tabs, the label is the pane's only tab, over the children", () => {
        initializeStore(new UIStore());
        const { getByText, queryAllByRole } = mount(buildUncontrolled());
        expect(queryAllByRole("tab")).toHaveLength(0);
        expect(getByText("Library").hasAttribute("data-selected")).toBe(true);
        expect(getByText("BODY")).toBeTruthy();
    });

    test("a shell pane marks its root, and a card pane keeps its own panel", () => {
        initializeStore(new UIStore());
        const shell = mount(compileUI(East.function([], UIComponentType, (_$) => Dock.Root([], {
            label: "Components", icon: "shapes", badge: "47", surface: "shell",
            tabs: [
                { key: "components", label: "Components", body: [Text.Root("CARDS")] },
                { key: "pages", label: "Pages", body: [Text.Root("PAGES")] },
            ],
        }))));
        expect(shell.container.querySelector("[data-surface=shell]")).not.toBeNull();
        cleanup();
        const card = mount(buildUncontrolled());
        expect(card.container.querySelector("[data-surface=card]")).not.toBeNull();
    });
});

describe("DockPane — the open tab, driven by its host (K1, #935)", () => {
    const tabs = [
        { key: "query", label: "Query", body: "STEPS" },
        { key: "datasets", label: "Datasets", body: "SOURCES" },
        { key: "library", label: "Library", body: "SAVED" },
    ];
    const pane = (props: { tab?: string; onTabChange?: (key: string) => unknown }) => (
        <ChakraProvider value={system}>
            <DockPane storageKey="dock-tab-test" label="Query" surface="shell" tabs={tabs} {...props} />
        </ChakraProvider>
    );
    const open = (getAllByRole: (role: string) => HTMLElement[]) =>
        getAllByRole("tab").filter(tab => tab.getAttribute("aria-selected") === "true").map(tab => tab.textContent);

    test("a tab given opens that tab, and the pane follows it when the host changes it", () => {
        initializeStore(new UIStore());
        const { getAllByRole, getByText, rerender } = render(pane({ tab: "datasets" }));
        expect(open(getAllByRole)).toEqual(["Datasets"]);
        expect(getByText("SOURCES").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(false);
        rerender(pane({ tab: "library" }));
        expect(open(getAllByRole)).toEqual(["Library"]);
        expect(getByText("SAVED").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(false);
        expect(getByText("SOURCES").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(true);
    });

    test("a tab opened from the pane is told to the host through onTabChange, after the click, through a microtask", async () => {
        initializeStore(new UIStore());
        const told: string[] = [];
        const { getAllByRole } = render(pane({ tab: "query", onTabChange: (key) => { told.push(key); } }));
        fireEvent.click(getAllByRole("tab")[2]!);
        expect(told).toEqual([]);
        await act(async () => { await Promise.resolve(); });
        expect(told).toEqual(["library"]);
        expect(open(getAllByRole)).toEqual(["Library"]);
        await act(async () => { fireEvent.keyDown(getAllByRole("tab")[2]!, { key: "Home" }); });
        expect(told).toEqual(["library", "query"]);
    });

    test("a tab's count follows its label, in its own slot, and is part of the tab's name; a tab with none has none", () => {
        initializeStore(new UIStore());
        const { getAllByRole, getByRole } = render(
            <ChakraProvider value={system}>
                <DockPane storageKey="dock-count-test" label="Library" surface="shell" tabs={[
                    { key: "rows", label: "Rows", count: "3", body: "TEMPLATES" },
                    { key: "columns", label: "Columns", body: "COLUMNS" },
                ]} />
            </ChakraProvider>,
        );
        const [rows, columns] = getAllByRole("tab");
        expect(getByRole("tab", { name: "Rows 3" })).toBe(rows);
        const count = rows!.querySelector("[data-tab-count]")!;
        expect(count.textContent).toBe("3");
        expect(count.previousSibling?.textContent).toBe(" ");
        expect(columns!.textContent).toBe("Columns");
        expect(columns!.querySelector("[data-tab-count]")).toBeNull();
    });

    test("a pane given neither keeps its own open tab, as before, and one given only onTabChange still tells it", async () => {
        initializeStore(new UIStore());
        const { getAllByRole, unmount } = render(pane({}));
        expect(open(getAllByRole)).toEqual(["Query"]);
        await act(async () => { fireEvent.click(getAllByRole("tab")[1]!); });
        expect(open(getAllByRole)).toEqual(["Datasets"]);
        unmount();
        const told: string[] = [];
        const again = render(pane({ onTabChange: (key) => { told.push(key); } }));
        await act(async () => { fireEvent.click(again.getAllByRole("tab")[2]!); });
        expect(open(again.getAllByRole)).toEqual(["Library"]);
        expect(told).toEqual(["library"]);
    });
});

describe("DockPane — collapsible, and a host's collapse (#1125)", () => {
    test("a pane that is not collapsible has no collapse control and never a rail, whatever its collapsed state says; its body is mounted", () => {
        initializeStore(new UIStore());
        const { queryByRole, getByText, container } = render(
            <ChakraProvider value={system}>
                <DockPane storageKey="dock-never" label="Query" surface="shell" collapsible={false} collapsed lazy body="STEPS" />
            </ChakraProvider>,
        );
        expect(queryByRole("button", { name: /Query$/ })).toBeNull();
        expect(container.querySelector("[data-collapsed]")).toBeNull();
        expect(getByText("Query").hasAttribute("data-selected")).toBe(true);
        expect(getByText("STEPS").closest("[hidden]")).toBeNull();
    });

    test("a host-driven collapsed is drawn in the commit it arrives in: a host reading the pane as it lays out sees it", () => {
        initializeStore(new UIStore());
        const seen: string[] = [];
        function Host({ collapsed }: { collapsed: boolean }) {
            const ref = useRef<HTMLDivElement>(null);
            useLayoutEffect(() => {
                seen.push(ref.current!.querySelector("[data-surface]")!.hasAttribute("data-collapsed") ? "rail" : "pane");
            });
            return <div ref={ref}><DockPane storageKey="dock-driven" label="Query" collapsed={collapsed} body="STEPS" /></div>;
        }
        const view = render(<ChakraProvider value={system}><Host collapsed={false} /></ChakraProvider>);
        view.rerender(<ChakraProvider value={system}><Host collapsed /></ChakraProvider>);
        view.rerender(<ChakraProvider value={system}><Host collapsed={false} /></ChakraProvider>);
        expect(seen).toEqual(["pane", "rail", "pane"]);
    });
});

describe("DockPane — a tab row too narrow for its tabs folds them (#1210)", () => {
    const TABS = [
        { key: "rows", label: "Rows", count: "11", body: "TEMPLATES" },
        { key: "registers", label: "Registers", count: "29", body: "MEMBERS" },
        { key: "columns", label: "Columns", count: "6", body: "COLUMNS" },
    ];
    /** The row's room, as the stand-in layout gives it. */
    let room = 260;
    /** Each test's own storage key: a pane keeps its open tab under it. */
    let storageKey = "";
    let mounts = 0;
    /** Each ResizeObserver's callback, called as the row's room changes. */
    const observers: Array<() => void> = [];
    const saved = {
        rect: Element.prototype.getBoundingClientRect,
        clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!,
        computed: window.getComputedStyle,
        observer: (globalThis as { ResizeObserver?: unknown }).ResizeObserver,
    };
    /** A tab's width in the stand-in layout: 8px a letter of its name, and its count 7px after it at 6px a figure. */
    const tabWidth = (tab: Element) => {
        const count = tab.querySelector("[data-tab-count]")?.textContent ?? "";
        return 8 * (tab.firstElementChild?.textContent?.length ?? 0) + (count === "" ? 0 : 7 + 6 * count.length);
    };
    // jsdom lays nothing out: the tabs measure as the stand-in says, 20px apart, the menu's stand-in 30px.
    // Rows 11 is 51px, Registers 29 91px, Columns 6 69px: whole they take 251px, and 200px without their counts.
    beforeEach(() => {
        room = 260;
        storageKey = `dock-fold-${++mounts}`;
        observers.length = 0;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            const width = this.matches('[role="tab"]') ? tabWidth(this)
                : this.matches("[data-tab-count]") ? 6 * (this.textContent?.length ?? 0)
                    : this.matches("[data-dock-more-measure]") ? 30 : 0;
            return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect;
        };
        Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get(this: Element) { return this.matches("[data-dock-tabs]") ? room : 0; } });
        window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
            const style = saved.computed.call(window, el, pseudo);
            const gap = el.matches('[role="tablist"], [data-dock-tabs]') ? "20px" : el.matches('[role="tab"]') ? "7px" : undefined;
            if (gap === undefined) return style;
            return new Proxy(style, {
                get: (target, prop) => {
                    if (prop === "columnGap") return gap;
                    const value = Reflect.get(target, prop) as unknown;
                    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
                },
            });
        }) as typeof window.getComputedStyle;
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
            constructor(callback: () => void) { observers.push(callback); }
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    });
    afterEach(() => {
        Element.prototype.getBoundingClientRect = saved.rect;
        Object.defineProperty(Element.prototype, "clientWidth", saved.clientWidth);
        window.getComputedStyle = saved.computed;
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved.observer;
    });

    const mountLibrary = (props: { tab?: string } = {}) => render(
        <ChakraProvider value={system}>
            <DockPane storageKey={storageKey} label="Library" surface="shell" tabs={TABS} {...props} />
        </ChakraProvider>,
    );
    /** The row's form, the tabs on it (each its name), and the `+n` menu's words. */
    const rowOf = (view: ReturnType<typeof mountLibrary>) => {
        const more = view.container.querySelector("[data-dock-more]");
        return {
            fold: view.container.querySelector('[role="tablist"]')!.getAttribute("data-fold"),
            tabs: view.getAllByRole("tab").map((tab) => tab.textContent),
            more: more === null ? null : [more.textContent, more.getAttribute("aria-label")],
            measuring: view.container.querySelector("[data-dock-more-measure]") !== null,
        };
    };
    const openTabs = (view: ReturnType<typeof mountLibrary>) =>
        view.getAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.textContent);
    /** Opens the `+n` menu, by its trigger's name. */
    const openMenu = async (view: ReturnType<typeof mountLibrary>, more: string) => {
        await act(async () => { fireEvent.click(view.getByRole("button", { name: more })); });
    };
    /** Picks a tab from the open menu as a pointer does: pressed on the item, which highlights it, then its click. */
    const pick = async (view: ReturnType<typeof mountLibrary>, name: string) => {
        const item = view.getByRole("menuitem", { name });
        await act(async () => { fireEvent.pointerDown(item); });
        await act(async () => { fireEvent.click(item); });
    };

    test("a row its tabs fit draws every tab with its count, as before, and no menu", () => {
        initializeStore(new UIStore());
        const view = mountLibrary();
        expect(rowOf(view)).toEqual({ fold: null, tabs: ["Rows 11", "Registers 29", "Columns 6"], more: null, measuring: false });
    });

    test("too narrow for the counts, the row leaves them out: every tab, each still named with its count", () => {
        initializeStore(new UIStore());
        room = 210;
        const view = mountLibrary();
        expect(rowOf(view)).toEqual({ fold: "compact", tabs: ["Rows 11", "Registers 29", "Columns 6"], more: null, measuring: false });
        expect(view.getByRole("tab", { name: "Registers 29" })).toBeTruthy();
    });

    test("narrower still, the trailing tabs fold into a +n menu; picking one opens it, and the row folds again around it", async () => {
        initializeStore(new UIStore());
        room = 160;
        const view = mountLibrary();
        expect(rowOf(view)).toEqual({ fold: "folded", tabs: ["Rows 11"], more: ["+2", "2 more tabs"], measuring: false });
        await openMenu(view, "2 more tabs");
        expect(view.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Registers 29", "Columns 6"]);
        await pick(view, "Columns 6");
        // Columns is open, and on the row beside Rows; Registers is the menu's.
        expect(openTabs(view)).toEqual(["Columns 6"]);
        expect(rowOf(view)).toEqual({ fold: "folded", tabs: ["Rows 11", "Columns 6"], more: ["+1", "1 more tab"], measuring: false });
        expect(view.getByText("COLUMNS").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(false);
        // Back on Rows, the row folds around it again: Columns returns to the menu.
        await act(async () => { fireEvent.click(view.getByRole("tab", { name: "Rows 11" })); });
        expect(rowOf(view)).toEqual({ fold: "folded", tabs: ["Rows 11"], more: ["+2", "2 more tabs"], measuring: false });
    });

    test("the open tab never folds: a host's open tab at the row's end takes its place first", () => {
        initializeStore(new UIStore());
        room = 160;
        const view = mountLibrary({ tab: "columns" });
        expect(rowOf(view).tabs).toEqual(["Rows 11", "Columns 6"]);
        expect(openTabs(view)).toEqual(["Columns 6"]);
    });

    test("a lone open tab too wide beside the menu shrinks, its whole name its title", () => {
        initializeStore(new UIStore());
        room = 80;
        const view = mountLibrary({ tab: "registers" });
        expect(rowOf(view).tabs).toEqual(["Registers 29"]);
        const tab = view.getByRole("tab", { name: "Registers 29" });
        expect([tab.hasAttribute("data-squeezed"), tab.getAttribute("title")]).toEqual([true, "Registers"]);
    });

    test("the arrow keys, Home and End move among the tabs on the row, never to a folded one", async () => {
        initializeStore(new UIStore());
        // Room for Rows and Registers beside the menu, whichever is open; Columns folds.
        room = 180;
        const view = mountLibrary();
        expect(rowOf(view)).toEqual({ fold: "folded", tabs: ["Rows 11", "Registers 29"], more: ["+1", "1 more tab"], measuring: false });
        const key = async (name: string, k: string) => { await act(async () => { fireEvent.keyDown(view.getByRole("tab", { name }), { key: k }); }); };
        await key("Rows 11", "ArrowRight");
        expect(openTabs(view)).toEqual(["Registers 29"]);
        // Past the row's last tab, round to its first: Columns, folded, is skipped.
        await key("Registers 29", "ArrowRight");
        expect(openTabs(view)).toEqual(["Rows 11"]);
        await key("Rows 11", "ArrowLeft");
        expect(openTabs(view)).toEqual(["Registers 29"]);
        await key("Registers 29", "Home");
        expect(openTabs(view)).toEqual(["Rows 11"]);
        await key("Rows 11", "End");
        expect(openTabs(view)).toEqual(["Registers 29"]);
        expect(document.activeElement).toBe(view.getByRole("tab", { name: "Registers 29" }));
    });

    test("the row follows its room: wider, it unfolds; narrower again, it folds — measured again as the room changes", async () => {
        initializeStore(new UIStore());
        room = 160;
        const view = mountLibrary();
        expect(rowOf(view).fold).toBe("folded");
        room = 260;
        await act(async () => { for (const callback of observers) callback(); });
        expect(rowOf(view)).toEqual({ fold: null, tabs: ["Rows 11", "Registers 29", "Columns 6"], more: null, measuring: false });
        room = 210;
        await act(async () => { for (const callback of observers) callback(); });
        expect(rowOf(view).fold).toBe("compact");
    });

    test("other tabs are measured again: a longer count that no longer fits leaves the counts out", () => {
        initializeStore(new UIStore());
        room = 255;
        const view = mountLibrary();
        expect(rowOf(view).fold).toBeNull();
        view.rerender(
            <ChakraProvider value={system}>
                <DockPane storageKey={storageKey} label="Library" surface="shell" tabs={TABS.map((tab) => (tab.key === "rows" ? { ...tab, count: "1,204" } : tab))} />
            </ChakraProvider>,
        );
        expect(rowOf(view)).toEqual({ fold: "compact", tabs: ["Rows 1,204", "Registers 29", "Columns 6"], more: null, measuring: false });
    });
});
