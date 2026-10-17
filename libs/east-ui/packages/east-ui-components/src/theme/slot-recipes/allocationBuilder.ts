/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's own slots (`Allocation Spec.md` §8), built from the shared
 * builder parts — the footer rail, the inspector's status chip — and the
 * theme's tokens. The frame, the toolbar, the panes and the session are the
 * shared parts' and keep their own recipes; this recipe owns only what is the
 * board's.
 *
 * Slots:
 * - `root` — the board, filling its parent, no border.
 * - `main` — the main region's box.
 * - `status` — the day's status chip (`data-tone`).
 * - `pickerDot` — a day's mark in the date picker (`data-state`: `published`, `draft`, `empty`).
 * - `controls` — the controls the narrowest toolbar folds into one popover.
 * - `footer`, `footerItem` — the shared rail and its items.
 * - `legendItem`, `legendSwatch` — a legend entry and its swatch (`data-kind`).
 * - `error`, `empty` — a refused action's words, and an empty main.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { builderFooter, builderFooterItem } from "./builder-footer.js";
import { INSPECTOR_STATUS } from "./inspector.js";

export const allocationBuilderSlotRecipe = defineSlotRecipe({
    className: "east-allocation-builder",
    slots: ["root", "main", "status", "pickerDot", "controls", "footer", "footerItem", "legendItem", "legendSwatch", "error", "empty"],
    base: {
        root: { height: "100%", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", background: "bg.surface", color: "fg" },
        main: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" },
        status: INSPECTOR_STATUS,
        // A day's mark under its number in the date picker: published, draft, or not started.
        pickerDot: {
            width: "6px", height: "6px", borderRadius: "50%", border: "1px solid", borderColor: "fg.subtle",
            "&[data-state=published]": { background: "fg.success", borderColor: "fg.success" },
            "&[data-state=draft]": { background: "brand.solid", borderColor: "brand.solid" },
        },
        controls: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
        footer: builderFooter,
        footerItem: builderFooterItem,
        legendItem: { display: "inline-flex", alignItems: "center", gap: "8px", flexShrink: 0 },
        // The mock's swatches, 16 × 10 (a link a 16 × 4 bar, a slot's status an 8px dot).
        legendSwatch: {
            width: "16px", height: "10px", flexShrink: 0, borderRadius: "sm", boxSizing: "border-box",
            "&[data-kind=bin]": { borderWidth: "1px", borderColor: "border.strong", background: "bg.surface" },
            "&[data-kind=draft]": { borderWidth: "1px", borderStyle: "dashed", borderColor: "brand.solid", background: "brandTint" },
            "&[data-kind=load]": { background: "brand.solid" },
            "&[data-kind=prior]": { borderWidth: "1px", borderColor: "border.strong", background: "bg.subtle" },
            "&[data-kind=next]": { borderWidth: "1px", borderStyle: "dashed", borderColor: "fg.subtle" },
            "&[data-kind=overlap]": { borderRadius: 0, borderLeftWidth: "1px", borderRightWidth: "1px", borderColor: "status.warn", background: "status.warnSubtle" },
            "&[data-kind=link]": { height: "4px", borderRadius: 0, background: "fg.muted" },
            "&[data-kind=draftLink]": { height: "4px", borderRadius: 0, background: "brand.solid" },
            "&[data-kind=empty]": { borderWidth: "1px", borderStyle: "dashed", borderColor: "border.strong" },
            "&[data-kind=reserved]": { width: "8px", height: "8px", borderRadius: "full", background: "brandMark" },
            "&[data-kind=free]": { width: "8px", height: "8px", borderRadius: "full", background: "fg.faint" },
        },
        error: { textStyle: "body.sm", color: "fg.danger", overflowWrap: "anywhere" },
        empty: { padding: "16px", textStyle: "body.sm", color: "fg.muted" },
    },
});
