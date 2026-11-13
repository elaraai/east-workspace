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
 * A field drawn on one line (#1534) is that line: its label at the start, as
 * strong as a field's label, one line and an ellipsis, and its radios at the
 * end, which hold the line to the Input's height — under the label where they
 * can't sit beside it, and wrapping where the form is narrower than they are,
 * so no choice is cut; its help, where it has one, wraps under it, the shared
 * `Field`'s help line (#1561). Lines that follow
 * one another sit closer than fields do, rows of choices. A field an issue
 * names takes the warn wash a Record's empty required cell wears, spread as
 * the drafts' tint is — so a new row's empty lines read as one block — and
 * what its issue says of it sits in its help line on a line of its own, in
 * the warn's ink (the `field` recipe). A
 * number its bounds don't hold takes the tone its host says it in (#1585): as
 * stored (`data-breach=warn`), the warn's edge on its box and the warn ink on
 * its help line; a changed row's (`error`), the field invalid — the danger's
 * edge — and the danger ink. A printed number's bound sits in its help line on
 * a line of its own, under the help its host gives it.
 *
 * A variant whose case holds data has a block under its choice (#1549): the
 * case's fields, a column of the form's rhythm, set in from the choice along
 * a rule, so they read as the choice's — a block inside a block for a case
 * holding a variant of its own.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fieldHeights } from "../field-chrome.js";

/** The warn wash around a field an issue names: a new row's empty required cell's (`record`'s ST8). */
const ISSUE_WASH = "color-mix(in srgb, {colors.status.warn} 17%, {colors.bg.surface})";

export const fieldFormSlotRecipe = defineSlotRecipe({
    className: "elara-field-form",
    slots: ["root", "group", "groupHead", "groupFields", "field", "block", "line", "control", "side", "items", "item", "lines", "lineLabel", "lineChoices", "lineValue", "lineHelp"],
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
            /* A field an issue names: the warn wash, spread as the tint is — over a change's. */
            "&[data-issue]": {
                background: ISSUE_WASH,
                boxShadow: `0 0 0 6px ${ISSUE_WASH}`,
            },
            /* A number its bounds don't hold, as stored: its box the warn's edge, focused too, as an invalid box keeps the
             * danger's — never over a box a refusal makes invalid. Its help line takes the warn ink (the `field` recipe). */
            "&[data-breach=warn] :is([data-scope=number-input][data-part=root], [data-scope=field][data-part=input]):not([data-invalid])": {
                borderColor: "status.warn",
            },
            /* The bound a printed number breaks, in its help line under the help its host gives it: a line of its own. */
            "& [data-field-breach]": { display: "block" },
            /* What an issue says of the field, in its help line after its help: a line of its own. */
            "& [data-field-issue]": { display: "block" },
            /* Drawn on one line: its label at the start, its choices at the end, on the Input's line — its help
             * wrapping under it, as far from the line as a Field's help sits from its control. */
            "&[data-layout=line]": {
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                columnGap: "{spacing.3}",
                rowGap: "{spacing.1}",
                minHeight: fieldHeights.md,
                _coarse: { minHeight: "44px" },
            },
        },
        /* A variant's block: the fields of the case it holds, under its choice,
         * set in along a rule — the form's column and rhythm inside it. */
        block: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.4}",
            minWidth: 0,
            paddingInlineStart: "{spacing.3}",
            borderInlineStartWidth: "1px",
            borderInlineStartStyle: "solid",
            borderInlineStartColor: "border.subtle",
        },
        /* Fields drawn on one line, one after another: rows of choices, closer than fields sit. */
        lines: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            minWidth: 0,
        },
        lineLabel: {
            flex: "1 1 0",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "body.sm",
            fontWeight: "semibold",
            color: "fg",
        },
        /* The choices hold the line to the Input's height, with a help under it as without — never wider than the form:
         * more than its width holds wrap onto a line of their own, as close as lines of choices sit. */
        lineChoices: {
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: "100%",
            display: "flex",
            alignItems: "center",
            minHeight: fieldHeights.md,
            _coarse: { minHeight: "44px" },
            "& [role=radiogroup] > *": { flexWrap: "wrap", rowGap: "{spacing.1}" },
        },
        /* Read only: the choice made, where the radios would be, on the same line. */
        lineValue: {
            flex: "none",
            display: "flex",
            alignItems: "center",
            minHeight: fieldHeights.md,
            _coarse: { minHeight: "44px" },
            fontSize: "body",
            color: "fg",
            whiteSpace: "nowrap",
        },
        /* A line's help: the line's whole width, under it — the words the `field` recipe's help line takes. */
        lineHelp: {
            flex: "1 0 100%",
            minWidth: 0,
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
         * ellipsis where the box cuts it — a choice's words, in the select's
         * own value text — the whole its title (#1250). */
        control: {
            display: "flex",
            alignItems: "center",
            flex: "1 1 0",
            minWidth: 0,
            "& input": { textOverflow: "ellipsis" },
        },
        side: {
            display: "flex",
            /* A phone's Clear: a touch target of its own beside the touch-sized line, its icon the second row's (FR6). */
            "[data-phone] &": { _coarse: { "& [data-field-clear]": { width: "44px", height: "44px", fontSize: "16px" } } },
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
