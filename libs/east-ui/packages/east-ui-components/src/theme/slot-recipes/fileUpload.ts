/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * FileUpload slot recipe — dashed dropzone over `bg.canvas`.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const fileUploadSlotRecipe = defineSlotRecipe({
    className: "elara-file-upload",
    slots: [
        "root", "label", "dropzone", "dropzoneContent", "trigger", "clearTrigger",
        "item", "itemGroup", "itemPreview", "itemPreviewImage", "itemName",
        "itemSizeText", "itemDeleteTrigger", "itemContent", "fileText",
    ],
    base: {
        /* bsys §FileUpload (L2352-2400): full-width 1.5px dashed dropzone over
         * paper-2 background. Centred: arrow icon · primary text · mono caption. */
        root: { display: "flex", flexDirection: "column", gap: "{spacing.3}", width: "100%" },
        label: { textStyle: "caption.eyebrow" },
        dropzone: {
            width: "100%",
            borderWidth: "1.5px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "{radii.lg}",
            paddingX: "{spacing.6}",
            paddingY: "{spacing.6}",
            background: "bg.subtle",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "{spacing.2}",
            color: "fg.muted",
            cursor: "pointer",
            transitionProperty: "border-color, background",
            transitionDuration: "{durations.fast}",
            _hover: { borderColor: "border.brand", background: "bg.brand.subtle" },
            "&[data-accept]": { borderColor: "border.brand", background: "bg.brand.subtle" },
        },
        dropzoneContent: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "{spacing.2}",
            textAlign: "center",
        },
        itemGroup: { display: "flex", flexDirection: "column", gap: "{spacing.1}" },
        item: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            background: "bg.surface",
        },
        itemName: { fontSize: "13px", color: "fg", flex: 1 },
        itemSizeText: { fontFamily: "mono", fontSize: "11px", color: "fg.muted" },
        fileText: { fontSize: "13px", color: "fg" },
    },
});
