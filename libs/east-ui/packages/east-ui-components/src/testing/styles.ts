/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A style a renderer sets through its element's own class, read from the
 * rules the page holds — for a jsdom test, which computes no style a recipe
 * sets: a recipe's rules sit in a cascade layer, which jsdom does not apply,
 * and it computes neither a `calc()` font nor a custom property (#1263).
 *
 * @packageDocumentation
 */

/**
 * The value an element declares for a property, as the cascade would take
 * it: its inline style, which every rule yields to — where a renderer writes
 * a place it computes, since a class would be minted for each value — else
 * its own emotion class's, its `css` and the recipes merged into it, from the
 * page's style elements: a rule outside a cascade layer over one inside, a
 * later rule over an earlier. Rules under a condition (`@media`, `@supports`,
 * `@container`) are left out.
 *
 * @param el - The element
 * @param property - The CSS property, as a rule spells it: `font-size`, `--fa-width`
 * @returns The value, or `undefined` when neither its inline style nor a rule of its own class sets the property
 */
export function declaredStyle(el: Element, property: string): string | undefined {
    const inline = (el as HTMLElement).style?.getPropertyValue(property) ?? "";
    if (inline !== "") return inline;
    const own = [...el.classList].find((name) => name.startsWith("css-"));
    if (own === undefined) return undefined;
    const opening = `.${own}{`;
    const css = [...el.ownerDocument.querySelectorAll("style")].map((style) => style.textContent ?? "").join("");
    let unlayered: string | undefined;
    let layered: string | undefined;
    // Each rule's body ends at a `}`; what precedes its selector in the same
    // stretch is the at-rule it sits in, if any.
    for (const chunk of css.split("}")) {
        const at = chunk.indexOf(opening);
        if (at < 0) continue;
        const context = chunk.slice(0, at);
        if (/@(media|supports|container)\b/.test(context)) continue;
        for (const declaration of chunk.slice(at + opening.length).split(";")) {
            const colon = declaration.indexOf(":");
            if (colon <= 0 || declaration.slice(0, colon).trim() !== property) continue;
            const value = declaration.slice(colon + 1).trim();
            if (context.includes("@layer")) layered = value;
            else unlayered = value;
        }
    }
    return unlayered ?? layered;
}
