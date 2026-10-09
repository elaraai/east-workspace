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
 * fields, a nested struct's head, the line a field's control sits on with its
 * Set or Clear at the line's end, a checklist's items, and the tint of a field
 * the drafts changed.
 *
 * One column and one rhythm (#1220): every field spans the form, its control
 * filling the line to the form's edge or to its Set or Clear; fields sit 16px
 * apart, a nested struct's among them, and a struct's head 8px over its first
 * field — the gap inside a field, from its label to its control. The line is
 * the design system's Input, 32px (44px on a coarse pointer): a checkbox's box
 * sits centred on it, as a Set or a Clear does. A text longer than its box
 * ends in an ellipsis.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fieldHeights } from "../field-chrome.js";

export const fieldFormSlotRecipe = defineSlotRecipe({
    className: "elara-field-form",
    slots: ["root", "group", "groupHead", "groupFields", "field", "line", "control", "side", "items", "item"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.4}",
            minWidth: 0,
        },
        /* A nested struct's fields, under its name. */
        group: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
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
        groupFields: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.4}",
            minWidth: 0,
        },
        /* A field: the shared Field, and a checklist's items under it. */
        field: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            minWidth: 0,
            borderRadius: "{radii.sm}",
            /* A field the drafts changed: tinted with the brand, as a dirty
             * input is (component-rules §1). The tint spreads 6px past the
             * field without moving it — inside the 16px between fields, so it
             * never meets a neighbour's. */
            "&[data-dirty]": {
                background: "brandTint",
                boxShadow: "0 0 0 6px {colors.brandTint}",
            },
        },
        /* The control's line: the field's width — the shared Field lays its
         * parts out from their start — the control filling it, and an
         * Option's Set or Clear at its end. */
        line: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            width: "100%",
            minWidth: 0,
            minHeight: fieldHeights.md,
            _coarse: { minHeight: "44px" },
        },
        /* The control filling the line: a text longer than its box ends in an
         * ellipsis where the box cuts it, the whole its title (#1250). */
        control: {
            display: "flex",
            alignItems: "center",
            flex: "1 1 0",
            minWidth: 0,
            "& input": { textOverflow: "ellipsis" },
        },
        side: {
            display: "flex",
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
