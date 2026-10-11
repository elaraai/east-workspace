/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";
import { planRowFocus } from "./plan/focus.js";

/** Shared Calendar/Roster navigation; buttons, segments and popover retain their own recipes. */
export const timeNavigatorSlotRecipe = defineSlotRecipe({
    className: "east-time-navigator",
    slots: ["root", "trigger", "label", "body", "header", "heading", "weeks", "week", "days", "weekday", "day", "choices", "choice", "legend", "controls", "footer"],
    base: {
        root: { display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0, whiteSpace: "nowrap" },
        trigger: { gap: "6px", "& svg": fontAwesomeSize("10px") },
        label: { whiteSpace: "nowrap" },
        body: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
        header: { display: "flex", alignItems: "center", gap: "4px" },
        heading: { flex: 1, minWidth: 0 },
        weeks: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
        week: { display: "flex", alignItems: "center", gap: "10px", padding: "8px", minHeight: "36px", textAlign: "left", textStyle: "mono.sm", borderRadius: "sm", cursor: "pointer",
            "&:hover:not([data-selected])": { background: "bg.subtle" }, "&[data-selected]": { background: "brand.subtle" }, "&[aria-current]": { boxShadow: "inset 3px 0 0 {colors.brand.solid}" }, ...planRowFocus, _coarse: { minHeight: "44px" } },
        days: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "2px", minWidth: 0 },
        weekday: { textStyle: "caption.eyebrow", color: "fg.subtle", textAlign: "center", paddingBlock: "4px" },
        day: { minWidth: 0, minHeight: "36px", textStyle: "mono.sm", textAlign: "center", borderRadius: "sm", cursor: "pointer",
            "&[data-outside]": { color: "fg.subtle" }, "&:hover:not([data-selected])": { background: "bg.subtle" }, "&[data-selected]": { background: "brand.subtle", color: "fg" },
            "&[aria-current]": { boxShadow: "inset 0 -2px 0 {colors.brand.solid}" }, ...planRowFocus, _coarse: { minHeight: "44px" } },
        choices: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "4px" },
        choice: { minWidth: 0, minHeight: "36px", padding: "8px", textStyle: "mono.sm", borderRadius: "sm", cursor: "pointer",
            "&:hover:not([data-selected])": { background: "bg.subtle" }, "&[data-selected]": { background: "brand.subtle" }, ...planRowFocus, _coarse: { minHeight: "44px" } },
        legend: { textStyle: "mono.xs", color: "fg.muted" },
        controls: { paddingTop: "12px", borderTopWidth: "1px", borderColor: "border.subtle" },
        footer: { display: "flex", alignItems: "center", gap: "8px" },
    },
});
