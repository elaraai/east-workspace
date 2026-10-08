/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What a Plan's elements draw of their text, measured in the page: the
 * invariant every spec that lays a Plan out or changes it reads.
 */

/**
 * Each bar, chip, tile, rollup band or `+n` chip whose text is partly drawn
 * (#1258, #1264, #1266, #1267). A label shows whole, ellipsized after at least
 * one whole letter — what shows of it at least as wide as its first letter and
 * the ellipsis in its own font — or not at all: never a partial glyph. A bar's
 * quantity is drawn whole beside a whole label, or not at all — never cut, and
 * never squeezing the label. An icon is drawn whole or not at all. What an
 * element draws is what lies inside its border, where it clips — and a tile's,
 * or a cell's `+n` chip's, what of that lies inside its cell, which clips it
 * too. Measured in a bar under a row or a narrow card, a chip, a tile, a rollup
 * band and a `+n` chip; a label is the element's `data-plan-label`, or its
 * first span where it has none, and text of the element's own, in no span, can
 * draw no ellipsis: it shows whole or not at all. Evaluated in the page: an
 * empty list holds.
 */
export const cutText = (root: Element): string[] => {
    const out: string[] = [];
    const ctx = document.createElement("canvas").getContext("2d")!;
    /** Whether an element is drawn at all: displayed, visible and of some width. */
    const drawnAt = (el: Element) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && el.getBoundingClientRect().width > 0.5;
    };
    const holder = "[data-plan-row], [data-plan-card]";
    const elements = root.querySelectorAll<HTMLElement>(["[data-run]", "[data-chip]", "[data-event]", "[data-plan-band]", "[data-tile-more]"]
        .map((kind) => `:is(${holder}) ${kind}:not([data-ctx])`).join(", "));
    for (const el of elements) {
        const box = el.getBoundingClientRect();
        const es = getComputedStyle(el);
        const bw = (side: string) => Number.parseFloat(es.getPropertyValue(`border-${side}-width`));
        const b = { left: box.left + bw("left"), right: box.right - bw("right"), top: box.top + bw("top"), bottom: box.bottom - bw("bottom") };
        // A tile's cell clips it too, and a `+n` chip's.
        const cell = el.hasAttribute("data-event") || el.hasAttribute("data-tile-more") ? el.closest("[data-plan-cell]") : null;
        if (cell !== null) {
            const c = cell.getBoundingClientRect();
            [b.left, b.right, b.top, b.bottom] = [Math.max(b.left, c.left), Math.min(b.right, c.right), Math.max(b.top, c.top), Math.min(b.bottom, c.bottom)];
        }
        const row = el.closest(holder)!;
        const kind = (["run", "chip", "event"] as const).find((k) => el.hasAttribute(`data-${k}`));
        const noun = el.hasAttribute("data-tile-more") ? "+n chip" : kind === undefined ? "band" : { run: "bar", chip: "chip", event: "tile" }[kind];
        const what = el.hasAttribute("data-tile-more") ? `+n chip in cell ${cell?.getAttribute("data-plan-cell") ?? "?"}`
            : kind === undefined ? "rollup band" : `${noun} ${el.getAttribute(`data-${kind}`)}`;
        const name = `${row.getAttribute("data-plan-row") ?? row.getAttribute("data-plan-card")} ${what}`;
        const spans = [...el.children].filter((c): c is HTMLElement => c.tagName === "SPAN" && !c.hasAttribute("data-plan-icon"));
        const label = el.querySelector<HTMLElement>(":scope > [data-plan-label]") ?? spans[0];
        const inside = (r: DOMRect) => r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
        /** How far a part's box lies across the clip, and how far down it. */
        const across = (r: DOMRect) => Math.min(r.right, b.right) - Math.max(r.left, b.left);
        const down = (r: DOMRect) => Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
        // An icon: whole inside the clip, or not drawn — out of sight past it draws nothing.
        for (const icon of el.querySelectorAll("svg")) {
            const r = icon.getBoundingClientRect();
            if (drawnAt(icon) && across(r) > 0.5 && down(r) > 0.5 && !inside(r)) out.push(`${name}: its icon is cut`);
        }
        // Its own text, in no span: whole inside the clip, or out of sight.
        for (const node of el.childNodes) {
            const own = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").trim() : "";
            if (own === "") continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            const r = range.getBoundingClientRect();
            if (across(r) > 0.5 && down(r) > 0.5 && !inside(r)) out.push(`${name}: its text "${own}" is cut`);
        }
        if (label === undefined) continue;
        const qty = el.hasAttribute("data-run") ? spans.find((s) => s !== label) : undefined;
        const ls = getComputedStyle(label);
        const lr = label.getBoundingClientRect();
        // What shows of the label: its box, inside the element's clip.
        const shows = across(lr);
        const text = (label.textContent ?? "").trim();
        if (drawnAt(label) && shows > 0.5 && down(lr) > 0.5 && text !== "") {
            // The element clips at its border, where no ellipsis is drawn: the label's box keeps inside it.
            const whole = label.scrollWidth <= label.clientWidth;
            const ellipsized = ls.textOverflow === "ellipsis" && ls.overflowX === "hidden" && ls.whiteSpace === "nowrap";
            // The label's font from its parts: its `font` shorthand reads empty
            // under tabular numerals, which the shorthand cannot say, and a
            // canvas given nothing keeps its own 10px sans-serif.
            ctx.font = `${ls.fontStyle} ${ls.fontWeight} ${ls.fontSize} ${ls.fontFamily}`;
            if (!ctx.font.includes(ls.fontSize)) { out.push(`${name}: its label's font (${ctx.font}) cannot be measured`); continue; }
            const spacing = Number.parseFloat(ls.letterSpacing) || 0;
            const oneLetter = ctx.measureText(`${[...text][0]}…`).width + 2 * spacing;
            if (!inside(lr)) out.push(`${name}: its label "${text}" runs past the ${noun}'s edge`);
            else if (!whole && !ellipsized) out.push(`${name}: its label "${text}" is cut`);
            else if (!whole && shows < oneLetter - 0.5) out.push(`${name}: its label "${text}" shows ${shows.toFixed(1)}px, under one letter and the ellipsis (${oneLetter.toFixed(1)}px)`);
            if (qty !== undefined) {
                const q = qty.getBoundingClientRect();
                const drawn = across(q) > 0.5 && down(q) > 0.5;
                if (drawn && !(inside(q) && qty.scrollWidth <= qty.clientWidth)) out.push(`${name}: its quantity "${qty.textContent}" is cut`);
                if (drawn && !whole) out.push(`${name}: its quantity squeezes its label "${text}" to ${label.clientWidth}px of ${label.scrollWidth}px`);
            }
        }
    }
    return out;
};
