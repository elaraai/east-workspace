/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The overlays' open and close options (#1036): an overlay a callback opens
 * through the State its `open` reads — at its own trigger — and that writes
 * the State back through `onOpenChange` when it closes (OO1); `defaultOpen`
 * (OO2); `closeOnEscape: false` (OO3); an ActionBar's `open` in place of its
 * selection count's. Ark keeps closed overlay content mounted, hidden, so
 * openness is read from `hidden` and `data-state`; a Drawer is Ark's dialog
 * and an ActionBar Ark's popover, so their content carries those scopes.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, BooleanType, NullType, decodeBeast2For, type ValueTypeOf } from "@elaraai/east";
import {
    ActionBar, Button, Dialog, Drawer, HoverCard, Popover, Reactive, Stack, State, Text, ToggleTip, UIComponentType,
} from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { EastChakraComponent } from "../component.js";
import { getStore, initializeStore } from "../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../platform/registry.js";
import { UIStore } from "../platform/state-store.js";

// Zag's popper reaches for ResizeObserver once an overlay opens, and the hover
// card asks matchMedia whether the pointer hovers; jsdom has neither.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => { cleanup(); });

function mount(value: ValueTypeOf<typeof UIComponentType>) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="overlay-options" />
        </ChakraProvider>,
    );
}

/** Let Ark sync a controlled `open`, and East take the writes. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
    });
}

/** The open content of an overlay, by its Zag scope — or `null`. */
function openContent(scope: string): HTMLElement | null {
    const content = document.querySelector<HTMLElement>(`[data-scope="${scope}"][data-part="content"]`);
    return content !== null && !content.hidden && content.getAttribute("data-state") === "open" ? content : null;
}

/** The State a test's overlay reads, as the store holds it. */
function stateOf(key: string): boolean | undefined {
    const bytes = getStore().read(key);
    return bytes === undefined ? undefined : decodeBeast2For(BooleanType)(bytes);
}

/** Press Escape where the open overlay's content has the focus. */
async function escape(scope: string) {
    await act(async () => { fireEvent.keyDown(openContent(scope)!, { key: "Escape" }); });
    await settle();
}

describe("an overlay a callback opens through State (#1036)", () => {
    test("OO1: a popover — the button writes its State, it opens at its own trigger, and Esc writes the State back", async () => {
        const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const shown = $.let(State.bind([BooleanType], "oo.popover", false));
            const openIt = $.const(East.function([], NullType, ($2) => { $2(shown.write(true)); }));
            return Stack.HStack([
                Button.Root("Open the details", { onClick: openIt }),
                Popover.Root([Text.Root("DETAILS-BODY")], { trigger: Button.Root("Details"), open: shown.read(), onOpenChange: shown.write }),
            ]);
        }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        mount(program());
        await settle();
        expect(openContent("popover")).toBeNull();

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open the details" })); });
        await settle();
        expect(openContent("popover")!.textContent).toContain("DETAILS-BODY");
        expect(screen.getByRole("button", { name: "Details" }).closest("[data-part=trigger]")!.getAttribute("data-state")).toBe("open");

        await escape("popover");
        expect(openContent("popover")).toBeNull();
        expect(stateOf("oo.popover")).toBe(false);
    });

    test("OO1: a toggle tip — the button writes its State, and it opens at its own trigger", async () => {
        const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const shown = $.let(State.bind([BooleanType], "oo.toggletip", false));
            const openIt = $.const(East.function([], NullType, ($2) => { $2(shown.write(true)); }));
            return Stack.HStack([
                Button.Root("Explain the score", { onClick: openIt }),
                ToggleTip.Root("TIP-BODY", { trigger: Button.Root("Why"), open: shown.read(), onOpenChange: shown.write }),
            ]);
        }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        mount(program());
        await settle();
        expect(openContent("popover")).toBeNull();

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Explain the score" })); });
        await settle();
        expect(openContent("popover")!.textContent).toContain("TIP-BODY");
        expect(screen.getByRole("button", { name: "Why" }).closest("[data-part=trigger]")!.getAttribute("data-state")).toBe("open");
    });

    test("OO1: a dialog — the button writes its State, and Esc writes it back", async () => {
        const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const asking = $.let(State.bind([BooleanType], "oo.dialog", false));
            const ask = $.const(East.function([], NullType, ($2) => { $2(asking.write(true)); }));
            return Stack.HStack([
                Button.Root("Remove cohort…", { onClick: ask }),
                Dialog.Root([Text.Root("DIALOG-BODY")], { trigger: Text.Root("Late"), title: "Remove cohort Late?", open: asking.read(), onOpenChange: asking.write }),
            ]);
        }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        mount(program());
        await settle();
        expect(openContent("dialog")).toBeNull();

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove cohort…" })); });
        await settle();
        expect(openContent("dialog")!.textContent).toContain("DIALOG-BODY");

        await escape("dialog");
        expect(openContent("dialog")).toBeNull();
        expect(stateOf("oo.dialog")).toBe(false);
    });

    test("OO1: a drawer — the button writes its State, and Esc writes it back", async () => {
        const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const shown = $.let(State.bind([BooleanType], "oo.drawer", false));
            const openIt = $.const(East.function([], NullType, ($2) => { $2(shown.write(true)); }));
            return Stack.VStack([
                Button.Root("Open B4418", { onClick: openIt }),
                Drawer.Root([Text.Root("DRAWER-BODY")], { trigger: Text.Root("Reactor detail"), title: "B4418", open: shown.read(), onOpenChange: shown.write }),
            ]);
        }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        mount(program());
        await settle();
        expect(openContent("dialog")).toBeNull();

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open B4418" })); });
        await settle();
        expect(openContent("dialog")!.textContent).toContain("DRAWER-BODY");

        await escape("dialog");
        expect(openContent("dialog")).toBeNull();
        expect(stateOf("oo.drawer")).toBe(false);
    });

    test("OO1: a hover card its `open` holds open, with no hover", async () => {
        const program = East.compile(East.function([], UIComponentType, (_$) =>
            HoverCard.Root([Text.Root("CARD-BODY")], { trigger: Text.Root("@johndoe"), open: true }),
        ), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        mount(program());
        await settle();
        expect(openContent("hover-card")!.textContent).toContain("CARD-BODY");
    });
});

describe("the open and close options (#1036)", () => {
    test("OO2, OO3: defaultOpen opens a popover on mount, and closeOnEscape: false keeps it open on Esc", async () => {
        const program = East.compile(East.function([], UIComponentType, (_$) =>
            Popover.Root([Text.Root("PINNED-BODY")], { trigger: Button.Root("Pinned"), defaultOpen: true, closeOnEscape: false }),
        ), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        mount(program());
        await settle();
        expect(openContent("popover")!.textContent).toContain("PINNED-BODY");

        await escape("popover");
        expect(openContent("popover")).not.toBeNull();
    });

    test("an action bar's `open` replaces its selection count's: closed with three selected, and open with the count alone", async () => {
        const closed = East.compile(East.function([], UIComponentType, (_$) =>
            ActionBar.Root([ActionBar.Action("archive", "Archive")], { selectionCount: 3n, open: false }),
        ), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        const counted = East.compile(East.function([], UIComponentType, (_$) =>
            ActionBar.Root([ActionBar.Action("archive", "Archive")], { selectionCount: 3n }),
        ), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        const first = mount(closed());
        await settle();
        expect(openContent("popover")).toBeNull();
        first.unmount();

        mount(counted());
        await settle();
        expect(openContent("popover")!.textContent).toContain("Archive");
    });
});
