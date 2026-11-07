/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * A Tag given a `colorPalette` draws in it — the tag recipe's `colored` — in
 * each variant East offers, the default outline too: solid filled with the
 * palette and its contrast words, subtle on the palette's subtle fill in its
 * text, outline on one 1px rule of it in its text, no ring inside. Given none,
 * each keeps the chip's own colours; and a fill the author sets wins over the
 * palette's. Read from the rules the theme writes for each tag's own class:
 * jsdom computes no colour a recipe or a custom property sets. The value is
 * built by the east-ui factory and COMPILED, so the renderer reads what an
 * author's program produces.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { Tag, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { declaredStyle } from "../../testing/styles.js";

afterEach(cleanup);

/** What an author gives a Tag beside its label: its palette, its variant and the rest. */
type TagStyle = NonNullable<Parameters<typeof Tag.Root>[1]>;

/** A Tag as an author's program builds it, drawn: its root. */
function drawn(style: TagStyle): Element {
    const value = East.compile(East.function([], UIComponentType, (_$) => Tag.Root("Hazmat", style)), [])() as ValueTypeOf<typeof UIComponentType>;
    const { container } = render(<ChakraProvider value={system}><EastChakraComponent value={value} storageKey="tag" /></ChakraProvider>);
    const root = container.querySelector(".elara-tag__root");
    expect(root).not.toBeNull();
    return root!;
}

/** A theme colour, as a rule names it. */
const token = (name: string): string => `var(--chakra-colors-${name})`;

/** What a tag's root declares for its fill, its rule, its words and its shadow. */
const colours = (el: Element) => ["background", "border-color", "color", "box-shadow"].map((property) => declaredStyle(el, property));

describe("Tag — in the palette it is given", () => {
    test("solid is filled with the palette, its words the palette's contrast — the palette the one given", () => {
        const tag = drawn({ colorPalette: "danger", variant: "solid" });
        expect(colours(tag).slice(0, 3)).toEqual([token("color-palette-solid"), token("color-palette-solid"), token("color-palette-contrast")]);
        expect(declaredStyle(tag, "--chakra-colors-color-palette-solid")).toBe(token("danger-solid"));
    });

    test("subtle is on the palette's subtle fill, its words the palette's text", () => {
        expect(colours(drawn({ colorPalette: "purple", variant: "subtle" })).slice(0, 3))
            .toEqual([token("color-palette-subtle"), token("transparent"), token("color-palette-fg")]);
    });

    test("outline — named, or the default — is the surface on one 1px rule of the palette, its words the palette's text, no ring inside", () => {
        const outline = [token("bg-surface"), token("color-palette-border"), token("color-palette-fg"), "none"];
        expect(colours(drawn({ colorPalette: "info", variant: "outline" }))).toEqual(outline);
        expect(colours(drawn({ colorPalette: "info" }))).toEqual(outline);
    });

    test("given no palette, each variant keeps the chip's own colours, an outline's ring gone", () => {
        expect(colours(drawn({ variant: "solid" })).slice(0, 3)).toEqual([token("brand-solid"), token("brand-solid"), token("brand-contrast")]);
        expect(colours(drawn({ variant: "subtle" })).slice(0, 3)).toEqual([token("bg-subtle"), token("transparent"), token("fg")]);
        expect(colours(drawn({ variant: "outline" }))).toEqual([token("bg-surface"), token("border-strong"), token("brand-fg"), "none"]);
    });

    test("a fill the author sets wins over the palette's", () => {
        expect(declaredStyle(drawn({ colorPalette: "danger", variant: "solid", background: "#123456" }), "background")).toBe("#123456");
    });
});
