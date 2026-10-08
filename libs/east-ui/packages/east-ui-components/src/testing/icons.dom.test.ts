/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The icon checks the renderer tests share (#1263) find what they say they
 * find: a lone glyph, not one in words; the Font Awesome icons of a name; and
 * an element's mark, its icons before any text it writes.
 */

import { describe, test, expect } from "vitest";
import { ICON_GLYPHS, faIcons, loneGlyphs, markOf } from "./icons.js";

/** A detached element over the given markup. */
function fragment(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
}

/** Font Awesome's markup for an icon of a prefix and a name. */
const svg = (name: string, prefix = "fas") => `<svg data-prefix="${prefix}" data-icon="${name}" aria-hidden="true"><path d="M0 0"></path></svg>`;

describe("the icon checks (#1263)", () => {
    test("loneGlyphs names each element whose whole text is a glyph — the root too — never a glyph among words", () => {
        const root = fragment(`<button> ▾ </button><span>Drop here ▾</span><i>×</i><b>+</b>`);
        expect(loneGlyphs(root)).toEqual(['<button> "▾"', '<i> "×"']);
        expect(loneGlyphs(fragment("⊕"))).toEqual(['<div> "⊕"']);
        // A list of its own: a written plus.
        expect(loneGlyphs(root, ["+"])).toEqual(['<b> "+"']);
        expect(loneGlyphs(fragment(`<span>${svg("plus")}</span>`))).toEqual([]);
        // Every glyph the renderers once drew as an icon is listed.
        expect(ICON_GLYPHS).toEqual(["▾", "▸", "▴", "▲", "▼", "×", "⊕", "⊘", "☐", "∅", "⏎", "⌫", "↑", "↓", "△", "±", "🚫", "⠿", "✓"]);
    });

    test("faIcons finds the solid icons of a name, in document order, and no other prefix's", () => {
        const root = fragment(`<span>${svg("plus")}</span>${svg("plus", "far")}${svg("xmark")}<p>${svg("plus")}</p>`);
        expect(faIcons(root, "plus").map((icon) => icon.parentElement!.tagName)).toEqual(["SPAN", "P"]);
        expect(faIcons(root, "caret-down")).toEqual([]);
    });

    test("markOf reads an element's icons, then any text it writes; nothing drawn is empty, and no element is null", () => {
        expect(markOf(fragment(`${svg("caret-down")}WEEK`))).toBe("fas caret-down WEEK");
        expect(markOf(fragment(`${svg("box-open")}${svg("plus", "far")}`))).toBe("fas box-open");
        expect(markOf(fragment("☐"))).toBe("☐");
        expect(markOf(fragment(""))).toBe("");
        expect(markOf(null)).toBeNull();
    });
});
