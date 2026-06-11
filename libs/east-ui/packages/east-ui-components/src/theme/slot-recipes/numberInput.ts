/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * NumberInput slot recipe — the bordered numeric field with the in-flow
 * stepper column on its right edge: two stacked chevron triggers that split
 * the field height, divided by hairline rules, disabling at the bound.
 * The root carries the shared field chrome; the inner input is borderless
 * and wears the numeric figure treatment.
 *
 * Chakra's default numberInput recipe deep-merges beneath this one, so the
 * styles here explicitly override its layout decisions — the absolutely
 * positioned control, the `--stepper-width` sizing vars, the 1em trigger
 * icons, and every `size` variant (all four collapse to the single field
 * shape shared by the other inputs).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fieldChrome, fieldFocusRing, numericChrome } from "../field-chrome.js";

/** One stepper chevron — both triggers share this shape. */
const stepperTrigger = {
    flex: "1",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "0",
    background: "bg.canvas",
    color: "fg.muted",
    cursor: "pointer",
    padding: "0",
    lineHeight: "1",
    borderTopEndRadius: "0",
    borderBottomEndRadius: "0",
    _icon: { boxSize: "9px" },
    _hover: { background: "bg.muted", color: "fg" },
    _active: { background: "bg.muted" },
    _disabled: {
        opacity: "1",
        color: "fg.subtle",
        cursor: "not-allowed",
        _hover: { background: "bg.canvas", color: "fg.subtle" },
    },
};

/** All sizes collapse to the one padding-driven field shape. */
const sizeOverride = {
    input: {
        fontSize: "{fontSizes.control}",
        paddingX: "10px",
        paddingY: "7px",
        "--input-height": "auto",
    },
    control: {
        fontSize: "inherit",
        "--stepper-width": "22px",
    },
};

export const numberInputSlotRecipe = defineSlotRecipe({
    className: "elara-number-input",
    slots: [
        "root", "label", "input", "control",
        "incrementTrigger", "decrementTrigger", "valueText", "scrubber",
    ],
    base: {
        root: {
            ...fieldChrome,
            display: "inline-flex",
            alignItems: "stretch",
            paddingInline: "0",
            paddingBlock: "0",
            overflow: "hidden",
            width: "100%",
            position: "relative",
            _focusWithin: fieldFocusRing,
        },
        input: {
            ...numericChrome,
            flex: "1",
            minWidth: "0",
            minW: "0",
            width: "100%",
            height: "auto",
            border: "0",
            borderRadius: "0",
            outline: "none",
            background: "transparent",
            color: "inherit",
            fontSize: "{fontSizes.control}",
            ps: "10px",
            pe: "10px",
            paddingBlock: "7px",
            _disabled: { cursor: "not-allowed" },
        },
        /* In-flow column on the field's right edge, wrapped by the root
         * border — not the default's absolutely-pinned overlay. */
        control: {
            position: "static",
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            margin: "0",
            width: "22px",
            height: "auto",
            zIndex: "auto",
            flexShrink: 0,
            divideY: "0px",
            borderStartWidth: "1px",
            borderColor: "border.subtle",
        },
        incrementTrigger: {
            ...stepperTrigger,
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        decrementTrigger: { ...stepperTrigger },
    },
    variants: {
        variant: {
            default: {},
            /** Uncommitted edit — brand-tint field, paper steppers. */
            dirty: {
                root: { background: "bg.brand.subtle" },
                input: { color: "brand.700" },
                incrementTrigger: { background: "bg.surface" },
                decrementTrigger: { background: "bg.surface" },
            },
        },
        size: {
            xs: sizeOverride,
            sm: sizeOverride,
            md: sizeOverride,
            lg: sizeOverride,
        },
    },
    defaultVariants: { variant: "default", size: "md" },
});
