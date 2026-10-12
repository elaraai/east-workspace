/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Every Chakra part a renderer uses that draws an icon of its own draws Font
 * Awesome's solid icon instead (#1263), passed as the part's child, and no
 * icon of Chakra's own is left there: a stat's direction, a number input's
 * steppers, a select's chevron and a picked item's check, a combobox's clear,
 * chevron and check, a tag's close, a file's and a tag's delete, a close
 * button and a banner's close, an accordion's chevron, the error alert's
 * mark, a checkbox's check and minus, the pagination's ellipsis and a tree
 * branch's chevron. Each part keeps the name it had; a tag's close is named
 * for the tag it removes. A close button keeps a caller's css after its
 * mark's, and draws again when a forwarded prop changes. An avatar with no
 * name draws Font Awesome's person, as an avatar group's member and a gallery
 * card's byline do. An icon of Font Awesome's regular or brands set draws
 * nothing: the renderers register the solid set alone.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, useRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { East, IntegerType, NullType, defaultValue, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import {
    Accordion, Avatar, AvatarGroup, Checkbox, CloseButton, Combobox, FileUpload, Icon, IconButton, Input, NavList, Pagination, Select, Stack, Stat,
    Tag, TagsInput, TreeView, UIComponentType,
} from "@elaraai/east-ui/internal";
import { system } from "./theme/index.js";
import { EastChakraComponent } from "./component.js";
import { faIcons, foreignIcons, markOf } from "./testing/icons.js";
import { declaredStyle } from "./testing/styles.js";
import { EastChakraFloatInput, EastChakraIntegerInput } from "./forms/input/index.js";
import { BannerView } from "./feedback/banner/index.js";
import { EastErrorDisplay } from "./reactive/error-display.js";
import { EastChakraCloseButton } from "./buttons/close-button/index.js";
import { EastChakraIcon } from "./display/icon/index.js";
import { EastChakraIconButton } from "./buttons/icon-button/index.js";
import { EastChakraNavList } from "./navigation/nav-list/index.js";
import { EastChakraLibrary, type LibraryItemValue, type LibraryValue } from "./collections/library/index.js";

afterEach(cleanup);

/** A component's value, rendered as the catalog renders one. */
function show(value: ValueTypeOf<typeof UIComponentType>) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="chakra-icons-test" />
        </ChakraProvider>,
    );
}

/** Each of a part's elements: its mark — each Font Awesome icon, then any text — and whether it is hidden. */
const marks = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].map((el) => [markOf(el), el.hidden]);

describe("a Chakra part's icon is Font Awesome's, never Chakra's own (#1263)", () => {
    test("a stat's direction is Font Awesome's caret — up, or down", () => {
        for (const [direction, icon] of [["up", "caret-up"], ["down", "caret-down"]] as const) {
            const { container } = show(East.compile(East.function([], UIComponentType, () => Stat.Root({ label: "Revenue", value: 12.5, indicator: direction })), [])());
            expect(markOf(container.querySelector(`[data-type="${direction}"]`))).toBe(`fas ${icon}`);
            expect(foreignIcons(container)).toEqual([]);
            cleanup();
        }
    });

    test("a number input's steppers are Font Awesome's chevrons, named as before", () => {
        const integer: ValueTypeOf<typeof Input.Types.Integer> = { ...defaultValue(Input.Types.Integer), value: 3n };
        const float: ValueTypeOf<typeof Input.Types.Float> = { ...defaultValue(Input.Types.Float), value: 1.5 };
        for (const input of [<EastChakraIntegerInput value={integer} />, <EastChakraFloatInput value={float} />]) {
            const { container } = render(<ChakraProvider value={system}>{input}</ChakraProvider>);
            const steppers = [...container.querySelectorAll('[data-scope="number-input"][data-part$="-trigger"]')]
                .map((trigger) => [trigger.getAttribute("aria-label"), markOf(trigger)]);
            expect(steppers).toEqual([["increment value", "fas chevron-up"], ["decrease value", "fas chevron-down"]]);
            expect(foreignIcons(container)).toEqual([]);
            cleanup();
        }
    });

    test("a select's chevron is Font Awesome's chevron-down, and each item's check Font Awesome's, shown on the picked one", () => {
        show(East.compile(East.function([], UIComponentType, () => Select.Root({
            value: "beta", items: [Select.Item("alpha", "Alpha"), Select.Item("beta", "Beta")],
        })), [])());
        expect(marks('[data-scope="select"][data-part="indicator"]')).toEqual([["fas chevron-down", false]]);
        expect(marks('[data-scope="select"][data-part="item-indicator"]')).toEqual([["fas check", true], ["fas check", false]]);
        expect(foreignIcons(document.body)).toEqual([]);
    });

    test("a combobox's clear is Font Awesome's xmark, its trigger the chevron-down and each item's check Font Awesome's, named as before", () => {
        show(East.compile(East.function([], UIComponentType, () => Combobox.Root({
            value: "beta", items: [Combobox.Item("alpha", "Alpha"), Combobox.Item("beta", "Beta")],
        })), [])());
        expect(screen.getByRole("button", { name: "Clear value", hidden: true }).querySelector("svg")!.getAttribute("data-icon")).toBe("xmark");
        expect(markOf(screen.getByRole("button", { name: "Toggle suggestions" }))).toBe("fas chevron-down");
        expect(marks('[data-scope="combobox"][data-part="item-indicator"]').map(([mark]) => mark)).toEqual(["fas check", "fas check"]);
        expect(foreignIcons(document.body)).toEqual([]);
    });

    test("a closable tag's close is Font Awesome's xmark, named for the tag it removes", () => {
        const { container } = show(East.compile(East.function([], UIComponentType, () => Tag.Root("region · SE", { closable: true })), [])());
        expect(markOf(screen.getByRole("button", { name: "Remove region · SE" }))).toBe("fas xmark");
        expect(foreignIcons(container)).toEqual([]);
    });

    test("a file's delete is Font Awesome's xmark, named as before", async () => {
        const { container } = show(East.compile(East.function([], UIComponentType, () => FileUpload.Root({ label: "Upload" })), [])());
        await userEvent.setup().upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["0"], "chart.png", { type: "image/png" }));
        expect(markOf(screen.getByRole("button", { name: "delete file chart.png" }))).toBe("fas xmark");
        expect(foreignIcons(container)).toEqual([]);
    });

    test("a tag's delete in a tags input is Font Awesome's xmark, named as before", () => {
        const { container } = show(East.compile(East.function([], UIComponentType, () => TagsInput.Root(["react", "typescript"], {})), [])());
        expect(["react", "typescript"].map((tag) => markOf(screen.getByRole("button", { name: `Delete tag ${tag}`, hidden: true })))).toEqual(["fas xmark", "fas xmark"]);
        expect(foreignIcons(container)).toEqual([]);
    });

    test("a close button and a banner's close are Font Awesome's xmark, named Close", () => {
        const { container } = show(East.compile(East.function([], UIComponentType, () => CloseButton.Root()), [])());
        expect(markOf(screen.getByRole("button", { name: "Close" }))).toBe("fas xmark");
        expect(foreignIcons(container)).toEqual([]);
        cleanup();
        const banner = render(<ChakraProvider value={system}><BannerView status="info" title="Saved" dismissible onDismiss={() => {}} /></ChakraProvider>);
        expect(markOf(screen.getByRole("button", { name: "Close" }))).toBe("fas xmark");
        expect(foreignIcons(banner.container)).toEqual([]);
    });

    test("a close button keeps a caller's css after its mark's: the caller's style holds, and wins where both set one", () => {
        const value = defaultValue(CloseButton.Types.CloseButton);
        /**
         * The close button drawn with the caller's css, or none: the font and
         * `--fa-width` its class sets — jsdom computes neither a calc() font
         * nor a custom property — and the colour it computes.
         */
        const drawn = (css?: SystemStyleObject | SystemStyleObject[]) => {
            render(<ChakraProvider value={system}><EastChakraCloseButton value={value} {...(css !== undefined ? { css } : {})} /></ChakraProvider>);
            const button = screen.getByRole("button", { name: "Close" });
            const out = [declaredStyle(button, "font-size"), declaredStyle(button, "--fa-width"), getComputedStyle(button).color];
            cleanup();
            return out;
        };
        const [, , ink] = drawn();
        // The mark: the square Chakra's icon took at md, over 1.2, and the icon as wide.
        expect(drawn()).toEqual(["calc(20px / 1.2)", "1em", ink]);
        expect(drawn({ color: "rgb(1, 2, 3)" })).toEqual(["calc(20px / 1.2)", "1em", "rgb(1, 2, 3)"]);
        expect(drawn({ fontSize: "9px" })).toEqual(["9px", "1em", ink]);
        expect(drawn([{ color: "rgb(1, 2, 3)" }, { fontSize: "9px" }])).toEqual(["9px", "1em", "rgb(1, 2, 3)"]);
    });

    test("a close button's mark gives way to a caller's css from a recipe — in the recipes layer as the mark's is — set after it", () => {
        const value = defaultValue(CloseButton.Types.CloseButton);
        /** A caller whose css is a recipe's: the mark's own at the 2xs size. */
        function Caller() {
            const css = useRecipe({ key: "iconButtonMark" })({ size: "2xs" });
            return <EastChakraCloseButton value={value} css={css} />;
        }
        render(<ChakraProvider value={system}><Caller /></ChakraProvider>);
        const button = screen.getByRole("button", { name: "Close" });
        expect([declaredStyle(button, "font-size"), declaredStyle(button, "--fa-width")]).toEqual(["calc(14px / 1.2)", "1em"]);
    });

    test("a close button draws again when a prop a container forwards changes, its value the same", () => {
        const value = defaultValue(CloseButton.Types.CloseButton);
        const { rerender } = render(<ChakraProvider value={system}><EastChakraCloseButton value={value} data-first="" /></ChakraProvider>);
        rerender(<ChakraProvider value={system}><EastChakraCloseButton value={value} data-last="" /></ChakraProvider>);
        const button = screen.getByRole("button", { name: "Close" });
        expect([button.hasAttribute("data-first"), button.hasAttribute("data-last")]).toEqual([false, true]);
    });

    test("an avatar with no name draws Font Awesome's person in its fallback; a name, its initials and no icon", () => {
        const { container } = show(East.compile(East.function([], UIComponentType, () => Stack.HStack([
            Avatar.Root(), Avatar.Root({ name: "Jane Smith" }),
        ])), [])());
        expect([...container.querySelectorAll('[data-scope="avatar"][data-part="fallback"]')].map(markOf)).toEqual(["fas user", "JS"]);
        expect(foreignIcons(container)).toEqual([]);
    });

    test("an avatar group's member with no name draws the person; its overflow, the count", () => {
        const { container } = show(East.compile(East.function([], UIComponentType, () => AvatarGroup.Root([
            { name: "Ada Lovelace" }, {}, { name: "Cy Young" },
        ], { max: 2n })), [])());
        expect([...container.querySelectorAll('[data-scope="avatar"][data-part="fallback"]')].map(markOf)).toEqual(["AL", "fas user", "+1"]);
        expect(foreignIcons(container)).toEqual([]);
    });

    test("a gallery card's byline avatar with an empty name draws the person; with a name, its initials", () => {
        const card = (key: string, avatar: string): LibraryItemValue => ({
            key, label: key, sublabel: none, icon: none, status: none, trailing: none, draggable: false, filtered: false, placed: false,
            media: none, avatar: some(avatar), byline: some(`by ${avatar}`), action: none, search: none, groups: new Map(), facets: new Map(),
            dims: new Map(),
        });
        const gallery: LibraryValue = {
            id: "pages", hint: none, items: [card("overview", ""), card("detail", "Robin Kaur")], groupOptions: [], groupSummaries: new Map(),
            dimOptions: [], defaultDimensions: [], filterOptions: [], searchable: false, noun: none, addLabel: none, onAdd: none,
            onCardClick: none, slice: none, style: none, variant: some(variant("gallery", null)), layout: none, toolbar: false,
        };
        const { container } = render(<ChakraProvider value={system}><EastChakraLibrary value={gallery} storageKey="chakra-icons-test" /></ChakraProvider>);
        const avatar = (key: string) => markOf(container.querySelector(`[data-library-card="${key}"] [data-scope="avatar"][data-part="fallback"]`));
        expect([avatar("overview"), avatar("detail")]).toEqual(["fas user", "RK"]);
        expect(foreignIcons(container)).toEqual([]);
    });

    test("an icon of Font Awesome's regular or brands set draws nothing — an Icon, an IconButton's or a NavList item's: the renderers register the solid set alone", () => {
        // Only an East expression carries another set past the factories' refusal.
        const drawn = (prefix: string, name: string) => {
            const { container } = render(
                <ChakraProvider value={system}>
                    <EastChakraIcon value={{ ...defaultValue(Icon.Types.Icon), prefix, name }} />
                    <EastChakraIconButton value={{ ...defaultValue(IconButton.Types.IconButton), prefix, name, label: "Save" }} />
                    <EastChakraNavList value={{ ...defaultValue(NavList.Types.NavList), sections: [{ label: none, items: [
                        { key: "home", label: "Home", icon: some({ prefix, name, label: none, style: none }), badge: none, active: none },
                    ] }] }} />
                </ChakraProvider>,
            );
            const out = [...container.querySelectorAll("svg")].map((svg) => `${svg.getAttribute("data-prefix")} ${svg.getAttribute("data-icon")}`);
            cleanup();
            return out;
        };
        // Font Awesome says it found no such icon; nothing else is wrong.
        const missing = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            expect(drawn("far", "bookmark")).toEqual([]);
            expect(drawn("fab", "github")).toEqual([]);
        } finally {
            missing.mockRestore();
        }
        // The solid icon of that name draws, in each.
        expect(drawn("fas", "bookmark")).toEqual(["fas bookmark", "fas bookmark", "fas bookmark"]);
    });

    test("an accordion item's chevron is Font Awesome's chevron-down", () => {
        const { container } = show(East.compile(East.function([], UIComponentType, () => Accordion.Root([
            Accordion.Item("one", "First", []), Accordion.Item("two", "Second", []),
        ])), [])());
        expect(marks('[data-scope="accordion"][data-part="item-indicator"]').map(([mark]) => mark)).toEqual(["fas chevron-down", "fas chevron-down"]);
        expect(foreignIcons(container)).toEqual([]);
    });

    test("the error alert's mark is the danger status's paired icon, Font Awesome's circle-xmark", () => {
        const { container } = render(<ChakraProvider value={system}><EastErrorDisplay title="Render failed" message="boom" /></ChakraProvider>);
        expect(faIcons(container, "circle-xmark")).toHaveLength(1);
        expect(foreignIcons(container)).toEqual([]);
    });

    test("a checkbox draws Font Awesome's check while checked, its minus while indeterminate, and nothing while unchecked; a click checks it", async () => {
        const control = (container: HTMLElement) => container.querySelector('[data-scope="checkbox"][data-part="control"]');
        const checked = show(East.compile(East.function([], UIComponentType, () => Checkbox.Root(true, { label: "On" })), [])());
        expect(markOf(control(checked.container))).toBe("fas check");
        cleanup();
        const mixed = show(East.compile(East.function([], UIComponentType, () => Checkbox.Root(false, { label: "Some", indeterminate: true })), [])());
        expect(markOf(control(mixed.container))).toBe("fas minus");
        cleanup();
        const off = show(East.compile(East.function([], UIComponentType, () => Checkbox.Root(false, { label: "Off" })), [])());
        expect(control(off.container)!.querySelector("svg")).toBeNull();
        await act(async () => { fireEvent.click(screen.getByText("Off")); });
        expect(markOf(control(off.container))).toBe("fas check");
        expect(foreignIcons(off.container)).toEqual([]);
    });

    test("the pagination's ellipsis is Font Awesome's", () => {
        const { container } = show(East.compile(East.function([], UIComponentType, () => Pagination.Root({
            page: 0n, pageSize: 10n, count: 500n, onPageChange: East.function([IntegerType], NullType, () => {}),
        })), [])());
        expect(marks('[data-scope="pagination"][data-part="ellipsis"]').map(([mark]) => mark)).toEqual(["fas ellipsis"]);
        expect(foreignIcons(container)).toEqual([]);
    });

    test("a tree branch leads with Font Awesome's chevron-right, an item with none; opening the branch marks its indicator open", async () => {
        const { container } = show(East.compile(East.function([], UIComponentType, () => TreeView.Root([
            TreeView.Branch("src", "src", [TreeView.Item("index", "index.ts")]),
            TreeView.Item("readme", "README.md"),
        ])), [])());
        const indicator = () => container.querySelector('[data-scope="tree-view"][data-part="branch-indicator"]')!;
        expect(marks('[data-scope="tree-view"][data-part="branch-indicator"]')).toEqual([["fas chevron-right", false]]);
        expect([...container.querySelectorAll('[data-scope="tree-view"][data-part="item"]')].map(markOf)).toEqual(["index.ts", "README.md"]);
        expect(indicator().getAttribute("data-state")).toBe("closed");
        await act(async () => { fireEvent.click(container.querySelector('[data-scope="tree-view"][data-part="branch-control"]')!); });
        expect(indicator().getAttribute("data-state")).toBe("open");
        expect(foreignIcons(container)).toEqual([]);
    });
});
