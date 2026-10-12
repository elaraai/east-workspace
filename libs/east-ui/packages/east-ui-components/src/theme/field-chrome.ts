/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared input chrome — the single field shape every typed control wears so the
 * plain input, select trigger, combobox, and date inputs can never drift apart.
 * Spread `fieldChrome` into each control's bordered element; edit here to move
 * border / radius / padding / font / focus ring across all of them at once.
 *
 * Height is padding-driven (not a fixed Chakra size var) for a control that
 * declares no size. A control's size variants set its one-line height from
 * {@link fieldHeights} (#1220), so a text, a number, a date and a select of
 * one size land at one height whatever they hold.
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";

/**
 * The font size a text control keeps on a coarse pointer (#346): iOS Safari
 * zooms the page into any focused input set under 16px. It is the one size
 * outside the design system's scale — a platform floor, not a type size —
 * and only `_coarse` styles name it.
 */
export const TOUCH_FONT_FLOOR = "16px";

/**
 * A one-line control's height at each size (#1220): `md` is the design
 * system's Input, 32px (`base-components.md` › Field & forms), `sm` 26px and
 * `lg` 44px. Each control's size variant sets its bordered box to it and
 * centres what it holds — a text, a date's segments, a number beside its
 * steppers, a select's value beside its chevron — so every kind lands on one
 * line. On a coarse pointer every size grows to the 44px touch height (#346).
 */
export const fieldHeights = { sm: "26px", md: "32px", lg: "44px" } as const;

/** Border + soft ring shown while a control holds focus. */
export const fieldFocusRing = {
    borderColor: "brand.solid",
    boxShadow: "focus",
    outline: "none",
} satisfies SystemStyleObject;

/** Border + ring while an invalid control holds focus — the invalid edge is
 *  a mark, the valence base; the ring is the one focus ring (the design
 *  system has no other). */
export const fieldFocusRingError = {
    borderColor: "status.neg",
    boxShadow: "focus",
    outline: "none",
} satisfies SystemStyleObject;

/** The full field shape — border, radius, padding, font, focus/hover/disabled. */
export const fieldChrome = {
    fontFamily: "body",
    fontSize: "{fontSizes.body}",
    lineHeight: "1.3",
    // Drop Chakra's per-control fixed height vars (--input-height etc.) so the
    // box is padding-driven and identical across every control + size.
    height: "auto",
    minHeight: "0",
    background: "bg.surface",
    color: "fg",
    borderRadius: "{radii.sm}",
    borderWidth: "1px",
    borderColor: "border.strong",
    paddingInline: "10px",
    paddingBlock: "7px",
    outline: "none",
    transitionProperty: "border-color, box-shadow, background",
    transitionDuration: "{durations.fast}",
    transitionTimingFunction: "{easings.out}",
    _placeholder: { color: "fg.subtle" },
    _hover: { borderColor: "fg.subtle" },
    _focusVisible: fieldFocusRing,
    _invalid: {
        borderColor: "status.neg",
        _focusVisible: fieldFocusRingError,
    },
    _disabled: { background: "bg.subtle", color: "fg.muted", cursor: "not-allowed" },
} satisfies SystemStyleObject;

/** Numeric figure overlay — mono · tabular · right-aligned · semibold. */
export const numericChrome = {
    fontFamily: "mono",
    fontWeight: "semibold",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontFeatureSettings: '"tnum"',
} satisfies SystemStyleObject;
