/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Page foot slot recipe — the design system's footer band under rows that
 * page (`parts-pagination`): where the page stands at its start — `Showing
 * 51–100 of 1,482` — and the Pagination's page buttons at `sm`, at its end. A
 * Table's rows page under it, and a Studio visual's.
 *
 * The band is the Frame's: 37 with its `--rule`, on `--paper-2`, padded 0 20.
 * Its 24px pager and its 12px line are each centred in the even 36 under the
 * rule, on one line: the pager's room the rest of the line — the room it reads
 * to draw its strip or its readout (#1268) — and its strip at the room's end,
 * as the room's justification places it. In a foot under 360px the range and
 * the pager each take a line, 4 apart, the pager's room the whole line
 * (#1692).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";

/**
 * Under this width a foot stands its range and its pager on a line each (#1692): under 360px a pager draws its
 * readout (#1268), and its room beside a range would hold neither whole.
 */
const FOOT_STACKED = "@container (max-width: 359.98px)";

/**
 * The band's range voice — where a page stands, and what a view holds of how many: mono 10 `--ink-4`, tabular, on a
 * whole 12px line; one line, ended in an ellipsis where its room is too narrow for it, its whole on hover (#1692). A
 * Studio visual's note is set in it too.
 */
export const PAGE_RANGE = {
    fontFamily: "mono", fontSize: "label.sm", fontVariantNumeric: "tabular-nums", lineHeight: "12px", color: "fg.subtle", flexShrink: "0",
    minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
} satisfies SystemStyleObject;

export const pageFootSlotRecipe = defineSlotRecipe({
    className: "elara-page-foot",
    slots: ["root", "range"],
    base: {
        root: {
            display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", justifyContent: "flex-end", columnGap: "{spacing.3}", rowGap: "{spacing.1}",
            flexShrink: "0", minHeight: "37px", boxSizing: "border-box", paddingInline: "{spacing.5}", paddingBlock: "6px",
            background: "bg.canvas", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
            containerType: "inline-size",
            [FOOT_STACKED]: { "& > *": { gridColumn: "1 / -1" } },
        },
        range: PAGE_RANGE,
    },
});
