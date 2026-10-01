/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query autocomplete slot recipe (#936) — the popover a step card's slot opens
 * in the query builder, as the Query Editor spec draws it (§4.5): its label and
 * filter in a band, the grouped offers, and a footer naming where the offers
 * come from and the keys.
 *
 * It is layered over the core recipes, never instead of them: the chrome is the
 * `popover` recipe's `content`, `header`, `title`, `body` and `footer`; the
 * filter, the groups, their headings, the offers and the empty text are the
 * `combobox` recipe's `input`, `itemGroup`, `itemGroupLabel`, `item`,
 * `itemText` and `empty`. A slot here holds only what those lack, or what this
 * popover sets differently:
 * - `root` hangs in the builder's own coordinates (its measured `left`, `top`
 *   or `bottom` and `maxHeight` are the renderer's one inline style), a fixed
 *   width inside the design system's 240–360 band, and unpadded so its bands
 *   reach its edges;
 * - `header` is the label and filter's band, and `footer` the hint and keys';
 * - `item` keeps a disabled offer hoverable, so its reason's Tooltip opens;
 * - `itemIcon`, `itemBody`, `itemLabel` (`data-mono` reads as data,
 *   `data-typed` is the value typed), `itemSub`, `itemNote` (a case, in the
 *   warning tone) and `itemMeta` (the count or summary at its end) are an
 *   offer's parts.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const queryAutocompleteSlotRecipe = defineSlotRecipe({
    className: "elara-query-autocomplete",
    slots: [
        "root", "header", "label", "body", "list", "item", "itemIcon", "itemBody", "itemLabel", "itemSub", "itemNote", "itemMeta",
        "empty", "footer",
    ],
    base: {
        /* Over the popover's content: absolute in the builder, 320 wide within
         * it, and its bands edge to edge. */
        root: {
            position: "absolute",
            width: "320px",
            minWidth: "0",
            maxWidth: "calc(100% - 16px)",
            padding: "0",
            overflow: "hidden",
        },
        /* Over the popover's header: the label and the filter in one band. */
        header: {
            display: "flex",
            alignItems: "center",
            flexShrink: "0",
            height: "{spacing.10}",
            paddingInline: "{spacing.3}",
            paddingTop: "0",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        /* Over the popover's title, beside the filter. */
        label: {
            marginBottom: "0",
            flexShrink: "0",
            whiteSpace: "nowrap",
        },
        /* Over the popover's body: the offers scroll, at most 300 tall. */
        body: {
            maxHeight: "300px",
        },
        /* The listbox, inset from the popover's edge. */
        list: {
            padding: "{spacing.1}",
        },
        /* Over the combobox's item: a disabled offer stays hoverable — its
         * reason is its Tooltip — and does not light up under the pointer. */
        item: {
            _disabled: {
                pointerEvents: "auto",
                cursor: "default",
                _hover: { background: "transparent" },
            },
        },
        itemIcon: {
            display: "inline-flex",
            justifyContent: "center",
            flexShrink: "0",
            width: "{spacing.4}",
            fontSize: "xs",
            color: "fg.muted",
        },
        /* Over the combobox's itemText: the label over its sub-line. */
        itemBody: {
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
        },
        itemLabel: {
            fontSize: "{fontSizes.control}",
            fontWeight: "medium",
            lineHeight: "1.3",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "&[data-mono]": {
                fontFamily: "mono",
                fontSize: "xs",
                fontVariantNumeric: "tabular-nums",
            },
            "&[data-typed]": { fontWeight: "semibold" },
        },
        /* The detail, then the note after a middle dot. */
        itemSub: {
            fontSize: "xs",
            lineHeight: "1.3",
            color: "fg.muted",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "& > * + *::before": { content: '" · "', color: "fg.muted" },
        },
        itemNote: {
            color: "fg.warning",
        },
        itemMeta: {
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "medium",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        /* Over the combobox's empty. */
        empty: {
            paddingInline: "{spacing.3}",
            paddingBlock: "{spacing.3}",
            fontSize: "{fontSizes.control}",
            color: "fg.muted",
        },
        /* Over the popover's footer: where the offers come from, and the keys. */
        footer: {
            justifyContent: "space-between",
            gap: "{spacing.2}",
            flexShrink: "0",
            paddingInline: "{spacing.3}",
            paddingTop: "{spacing.2}",
            paddingBottom: "{spacing.2}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            background: "bg.panel",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "medium",
            lineHeight: "1",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
    },
});
