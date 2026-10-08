/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The icon checks the renderer tests share (#1263): every icon a renderer
 * draws is a Font Awesome solid icon, never a text glyph.
 *
 * @packageDocumentation
 */

/**
 * The text glyphs the renderers drew as icons before #1263 — carets, removes,
 * pluses in a circle, empty boxes, arrows, a refused drop's badge. None may be
 * an element's whole text. The text marks that are text — a key combination's
 * `+`, a signed figure's `+` and `−`, the ` · ` and `›` separators — are not
 * listed: a test of a site that drew one as an icon passes its own list.
 */
export const ICON_GLYPHS: readonly string[] = ["▾", "▸", "▴", "▲", "▼", "×", "⊕", "⊘", "☐", "∅", "⏎", "⌫", "↑", "↓", "△", "±", "🚫", "⠿", "✓"];

/**
 * The Font Awesome solid icons of a name under a root — the `svg` Font
 * Awesome draws, which names its prefix and its icon.
 *
 * @param root - Where to look
 * @param name - The icon's name, `caret-down`
 * @returns The icons, in document order
 */
export function faIcons(root: ParentNode, name: string): SVGElement[] {
    return [...root.querySelectorAll<SVGElement>(`svg[data-prefix="fas"][data-icon="${name}"]`)];
}

/**
 * What an element draws as its mark: each Font Awesome solid icon in it, as
 * `fas <name>`, then any text it writes — so a text glyph shows as itself.
 *
 * @param el - The element, or `null` for none
 * @returns The mark — `""` for an element that draws nothing — or `null` for no element
 */
export function markOf(el: Element | null): string | null {
    if (el === null) return null;
    const text = el.textContent ?? "";
    return [
        ...[...el.querySelectorAll('svg[data-prefix="fas"]')].map((svg) => `fas ${svg.getAttribute("data-icon")}`),
        ...(text !== "" ? [text] : []),
    ].join(" ");
}

/**
 * Every element — the root and what it holds — whose whole text is one of
 * the glyphs, each named by its tag and its text.
 *
 * @param root - Where to look
 * @param glyphs - The glyphs no element's whole text may be ({@link ICON_GLYPHS} when omitted)
 * @returns What draws a lone glyph, empty when nothing does
 */
export function loneGlyphs(root: Element, glyphs: readonly string[] = ICON_GLYPHS): string[] {
    return [root, ...root.querySelectorAll("*")]
        .filter((el) => glyphs.includes((el.textContent ?? "").trim()))
        .map((el) => `<${el.tagName.toLowerCase()}> ${JSON.stringify((el.textContent ?? "").trim())}`);
}
