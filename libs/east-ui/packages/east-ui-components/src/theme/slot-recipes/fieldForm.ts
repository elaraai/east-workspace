/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Field form slot recipe — how `FieldForm` (#1147) lays out its fields. Each
 * field is the shared `Field` around the shared input its type takes, styled
 * by their own recipes (`field`, `input`, `select`, `checkbox`, `numberInput`,
 * `tagsInput`, `dateField`); an Option's Set and Clear are the shared `button`
 * and `iconButton`. This recipe draws only what the form adds: the column of
 * fields, a nested struct's head, the place beside a field for its Set or
 * Clear, a checklist's items, and the tint of a field the drafts changed.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const fieldFormSlotRecipe = defineSlotRecipe({
    className: "elara-field-form",
    slots: ["root", "group", "groupHead", "field", "main", "side", "items", "item"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            minWidth: 0,
        },
        /* A nested struct's fields, under its name. */
        group: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.3}",
            minWidth: 0,
        },
        groupHead: {
            fontFamily: "mono",
            fontSize: "{fontSizes.label.sm}",
            fontWeight: "{fontWeights.semibold}",
            letterSpacing: "{letterSpacings.wider2}",
            lineHeight: "{lineHeights.tight}",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        /* A field, and beside it an Option's Set or Clear. */
        field: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            alignItems: "center",
            columnGap: "6px",
            minWidth: 0,
            borderRadius: "{radii.sm}",
            /* A field the drafts changed: tinted with the brand, as a dirty
             * input is (component-rules §1). The tint spreads past the field
             * without moving it. */
            "&[data-dirty]": {
                background: "brandTint",
                boxShadow: "0 0 0 6px {colors.brandTint}",
            },
        },
        main: {
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            minWidth: 0,
        },
        side: {
            display: "flex",
            alignItems: "center",
        },
        /* A checklist's items, each its checkbox and its remove. */
        items: {
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            minWidth: 0,
        },
        item: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "6px",
            minHeight: "28px",
            minWidth: 0,
        },
    },
});
