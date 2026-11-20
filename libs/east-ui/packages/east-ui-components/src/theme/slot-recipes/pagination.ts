/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pagination slot recipe — numbered page chips with prev/next triggers.
 *
 * The root is the room the pagination is given (#1268): its container's full
 * inline size whichever form it draws, never held open by what it draws, so
 * the renderer's compact form — the `page / total` readout below 360px —
 * reads the room. Its bar holds prev, the page strip or the readout, and
 * next, laid out as the root was; the bar sits in the room where the
 * container would place the pagination — a flex container's own
 * justification (the configurator's stage centres it), the start otherwise.
 *
 * A pagination that declares a size draws the design system's
 * (`parts-pagination`): its page chips, its runs of pages left out and its
 * triggers each the size's height — 24 at `sm`, 32 at `md`, 40 at `lg` — the
 * runs and the triggers a square of it. One that declares none keeps the look
 * of the base styles.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

/** A previous or next trigger at a size: a square of its height, its chevron in its middle. */
function trigger(side: number, icon: string) {
    return { display: "inline-flex", alignItems: "center", justifyContent: "center", width: `${side}px`, height: `${side}px`, padding: "0", fontSize: icon };
}

/** A size's page chips, its runs of pages left out and its triggers: each its height, a chip at least a square of it. */
function sized(side: number, paddingX: string, text: string, icon: string) {
    return {
        item: { minWidth: `${side}px`, height: `${side}px`, paddingX, fontSize: text },
        ellipsis: { minWidth: `${side}px`, height: `${side}px` },
        prevTrigger: trigger(side, icon),
        nextTrigger: trigger(side, icon),
    };
}

export const paginationSlotRecipe = defineSlotRecipe({
    className: "elara-pagination",
    slots: ["root", "bar", "item", "ellipsis", "prevTrigger", "nextTrigger"],
    base: {
        root: { display: "flex", justifyContent: "inherit", width: "full", minWidth: 0 },
        bar: { display: "flex", alignItems: "center", gap: "{spacing.1}" },
        item: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "28px",
            height: "28px",
            /* Touch hit target (#346). */
            ...coarseHitArea({ position: true }),
            paddingX: "{spacing.2}",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "bg.surface",
            color: "fg",
            fontFamily: "mono",
            fontSize: "12px",
            fontVariantNumeric: "tabular-nums",
            cursor: "pointer",
            transitionProperty: "background, color, border-color",
            transitionDuration: "{durations.fast}",
            _hover: { borderColor: "fg.muted" },
            _selected: { background: "bg.brand.subtle", color: "brand.fg", borderColor: "border.brand" },
            "&[data-selected]": { background: "bg.brand.subtle", color: "brand.fg", borderColor: "border.brand" },
        },
        ellipsis: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "28px",
            height: "28px",
            background: "transparent",
            borderWidth: "0",
            color: "fg.muted",
            fontFamily: "mono",
        },
        prevTrigger: { color: "fg.muted", cursor: "pointer", padding: "{spacing.1}", ...coarseHitArea({ position: true }), _hover: { color: "fg" }, _disabled: { color: "fg.muted", opacity: 0.4, cursor: "not-allowed" } },
        nextTrigger: { color: "fg.muted", cursor: "pointer", padding: "{spacing.1}", ...coarseHitArea({ position: true }), _hover: { color: "fg" }, _disabled: { color: "fg.muted", opacity: 0.4, cursor: "not-allowed" } },
    },
    variants: {
        /* The size a pagination declares: the design system's three. */
        size: {
            sm: sized(24, "6px", "11px", "12px"),
            md: sized(32, "{spacing.2}", "12px", "14px"),
            lg: sized(40, "{spacing.3}", "13px", "16px"),
        },
    },
});
