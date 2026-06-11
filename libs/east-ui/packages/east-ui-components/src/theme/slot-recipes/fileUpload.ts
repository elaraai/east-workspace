/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * FileUpload slot recipe — content-sized dashed dropzone + bordered file rows.
 * Dropzone content layout (stacked vs inline) is driven by the renderer.
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
        root: { display: "flex", flexDirection: "column", gap: "{spacing.3}", width: "100%" },
        label: { textStyle: "caption.eyebrow" },
        dropzone: {
            width: "100%",
            // Chakra's default dropzone forces a tall fixed min-height; the spec
            // box is content-sized, so drop the min and let it stay compact — a
            // flex parent can still stretch it when a large drop target is wanted.
            minHeight: "0",
            borderWidth: "1.5px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "{radii.lg}",
            paddingX: "{spacing.6}",
            paddingY: "{spacing.6}",
            background: "bg.panel",
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
        itemGroup: { display: "flex", flexDirection: "column", gap: "{spacing.1}" },
        item: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.3}",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            background: "bg.surface",
        },
        itemName: { fontSize: "{fontSizes.control}", color: "fg", flex: 1 },
        itemSizeText: { fontFamily: "mono", fontSize: "11px", color: "fg.muted" },
        fileText: { fontSize: "{fontSizes.control}", color: "fg" },
    },
});
