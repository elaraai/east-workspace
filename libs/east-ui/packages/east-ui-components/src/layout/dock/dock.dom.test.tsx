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
 *     store (the controlled path used by app-style ui() tasks).
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, BooleanType, NullType, type ValueTypeOf } from "@elaraai/east";
import { Dock, Text, State, Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
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
