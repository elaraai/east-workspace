/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pagination slot recipe — the design system's page buttons
 * (`parts-pagination`).
 *
 * The root is the room the pagination is given (#1268): its container's full
 * inline size whichever form it draws, never held open by what it draws, so
 * the renderer's compact form — the `page / total` readout below 360px —
 * reads the room. Its bar holds prev, the page strip or the readout, and
 * next, laid out as the root was; the bar sits in the room where the
 * container would place the pagination — a flex container's own
 * justification (the configurator's stage centres it), the start otherwise.
 *
 * Every pagination draws the design system's: its page buttons at its size's
 * height, 24 at `sm` (the default), 32 at `md`, 40 at `lg`, each at least a
 * square of it, padded 4, 8 or 12 across, mono 10.5, 11 or 12.5 at 500 and
 * tabular; its previous and next triggers the same buttons, each a square of
 * that height with its chevron, 14px at `sm` and 16 above, in its middle; 4
 * apart, `--r-md`; and a gap that marks the pages it leaves out, 16 wide in
 * `--ink-4` — a mark, not a button. `outline`, the default, draws
 * each button on `--paper` with a 1px `--rule-strong` edge in `--ink-2`,
 * hovering `--paper-2`; `subtle` draws no edge or paper, in `--ink-3`,
 * hovering `--paper-3` in `--ink`. The current page is `--brand-tint` in
 * `--brand-dd` at 600, its edge `--brand-d` in `outline`; a disabled trigger
 * is `--ink-5`, its edge `--rule`; focus is the focus ring.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";
import { oneLineBox } from "../one-line-box.js";

/** A button the pointer is over that it can press: a disabled one never hovers. */
const HOVER = "&:hover:not(:disabled, [data-disabled])";

/** A page button's look: the page buttons' and the triggers'. */
const button = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    /* Touch hit target (#346). */
    ...coarseHitArea({ position: true }),
    borderRadius: "{radii.md}",
    borderWidth: "1px",
    borderColor: "border.strong",
    background: "bg.surface",
    color: "fg.strong",
    fontFamily: "mono",
    fontWeight: "500",
    fontVariantNumeric: "tabular-nums",
    lineHeight: "1",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "background, color, border-color",
    transitionDuration: "{durations.fast}",
    [HOVER]: { background: "bg.canvas" },
    _focusVisible: { outline: "none", boxShadow: "focus" },
    _disabled: { borderColor: "border.subtle", color: "fg.faint", cursor: "not-allowed" },
};

/** The current page, in `outline`: the brand's tint and ink at 600, its edge the brand's. */
const current = { background: "brandTint", borderColor: "brand.solid", color: "brandPressed", fontWeight: "600" };

/** `subtle`'s button: no edge or paper, in `--ink-3`, hovering `--paper-3` in `--ink`. */
const subtleButton = {
    borderColor: "transparent",
    background: "transparent",
    color: "fg.muted",
    [HOVER]: { background: "bg.subtle", color: "fg" },
    _disabled: { borderColor: "transparent", color: "fg.faint" },
};

/** `subtle`'s current page: the brand's tint and ink at 600, no edge. */
const subtleCurrent = { ...current, borderColor: "transparent" };

/**
 * A size's parts: a page button its height and at least a square of it, padded
 * across, in its text — its one line as tall as the room inside its edge, so
 * its number starts a whole pixel under the edge (#1638); a trigger a square
 * of it, its chevron in the middle — whatever width the chevron is drawn; a
 * gap its height.
 */
function sized(side: number, paddingX: string, text: string, icon: string) {
    const trigger = { width: `${side}px`, height: `${side}px`, padding: "0", fontSize: icon };
    return {
        item: { minWidth: `${side}px`, ...oneLineBox(side), paddingX, fontSize: text },
        ellipsis: { height: `${side}px`, fontSize: text },
        prevTrigger: trigger,
        nextTrigger: trigger,
    };
}

export const paginationSlotRecipe = defineSlotRecipe({
    className: "elara-pagination",
    slots: ["root", "bar", "item", "ellipsis", "prevTrigger", "nextTrigger"],
    base: {
        root: { display: "flex", justifyContent: "inherit", width: "full", minWidth: 0 },
        bar: { display: "flex", alignItems: "center", gap: "{spacing.1}" },
        item: {
            ...button,
            _selected: current,
            "&[data-selected]": current,
        },
        /* The gap that marks the pages left out: a mark, not a button. */
        ellipsis: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "16px",
            color: "fg.subtle",
            fontFamily: "mono",
        },
        prevTrigger: button,
        nextTrigger: button,
    },
    variants: {
        /* The size a pagination declares: the design system's three. */
        size: {
            sm: sized(24, "4px", "{fontSizes.label.md}", "14px"),
            md: sized(32, "8px", "{fontSizes.label.lg}", "16px"),
            lg: sized(40, "12px", "{fontSizes.body.sm}", "16px"),
        },
        /* How its buttons are drawn: on the paper with an edge, or with neither. */
        variant: {
            outline: {},
            subtle: {
                item: { ...subtleButton, _selected: subtleCurrent, "&[data-selected]": subtleCurrent },
                prevTrigger: subtleButton,
                nextTrigger: subtleButton,
            },
        },
    },
    defaultVariants: { size: "sm", variant: "outline" },
});
