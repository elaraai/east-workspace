/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * PickPanel slot recipe — the per-row half of the pick library (#590).
 *
 * The FRAME is not here: `root` / `header` / `eyebrow` come from the shared
 * `sliceFrame` recipe, because a pick panel is the same bordered, headed
 * surface a slice affordance is and the two must not drift into two borders.
 * This recipe owns only what a row is made of.
 *
 * Every measurement is lifted from the signed-off mock
 * (`docs/proposals/Plan Series Library.html`), which in turn lifted them from
 * the shipped recipes rather than eyeballing them:
 *
 * - the row is `8px 12px` with an `8px` gap and a hairline under it;
 * - the leading kind icon occupies a fixed `14×14` slot, so nothing shifts
 *   between a row that has an icon and one that does not;
 * - the label is `12.5px/600`, the sub-line mono `9.5px/500` — the gutter
 *   rhythm a Plan row already uses;
 * - the count is mono `10.5px` with tabular numerals, so counts stay aligned
 *   down the column while they change.
 *
 * The switched-off look is ONE rule on the row — `opacity: 0.5` — and never a
 * per-part recolouring. That is `Slice.Legend`'s own move
 * (`slice/legend/index.tsx`), and it matters: every child goes with it, so a
 * row can gain a part later without anyone remembering to dim it too.
 *
 * Slots:
 * - `row` — one entry (the whole clickable line).
 * - `kind` — the fixed leading icon slot.
 * - `text` — the label / sub-line stack.
 * - `label` — the series' name.
 * - `sub` — the muted role line.
 * - `count` — how many things this yields, with the `zero` / `narrowed` axes.
 * - `eye` — the on/off affordance, LAST in the row.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const pickPanelSlotRecipe = defineSlotRecipe({
    className: "elara-pick-panel",
    slots: ["headMeta", "row", "kind", "text", "label", "sub", "count", "eye"],
    base: {
        // The header's right-hand count ("2 of 7"). `sliceFrame` has no text
        // slot at this size — its `frameEyebrowMeta` is a flex CONTAINER for
        // controls and its `meta` uppercases at 11px, which would print
        // "2 OF 7". The mock specifies lowercase mono 10.5px, so that is what
        // this is, rather than bending a shared slice slot to suit one panel.
        headMeta: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "medium",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            lineHeight: "1",
            flexShrink: 0,
        },
        // One entry. The hairline fences rows from each other; the LAST row
        // drops it so the frame's own border is the only bottom edge.
        row: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            width: "100%",
            textAlign: "left",
            background: "transparent",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            cursor: "pointer",
            boxSizing: "border-box",
            _last: { borderBottomWidth: "0" },
            _hover: { background: "bg.subtle" },
            // The switched-off row: one rule, every child follows.
            "&[data-on='false']": { opacity: 0.5 },
        },
        // Fixed leading slot — the kind icon. Sized even when empty so a row
        // without an icon still lines its text up with the rows that have one.
        kind: {
            position: "relative",
            width: "14px",
            height: "14px",
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "fg.muted",
            // 12px INSIDE the 14px slot, per the mock. Without this the glyph
            // inherits the body size and overflows the slot it is meant to sit in.
            fontSize: "12px",
        },
        text: {
            display: "flex",
            flexDirection: "column",
            gap: "1px",
            minWidth: 0,
            flex: 1,
        },
        label: {
            fontSize: "12.5px",
            fontWeight: "semibold",
            color: "fg",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        sub: {
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "medium",
            color: "fg.muted",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        // Tabular numerals so the column stays aligned as counts change.
        count: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "medium",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            flex: "none",
            // A series that selects NOTHING is the failure this count exists to
            // surface — switched on to no visible effect. It says so.
            "&[data-zero]": { color: "fg.danger", fontWeight: "semibold" },
            // A narrowed series shows its NARROWED count. The dot marks it as
            // filtered so the fact survives without a sentence beside it.
            "&[data-narrowed]": { color: "link", fontWeight: "semibold" },
            "&[data-narrowed]::after": {
                content: '""',
                display: "inline-block",
                width: "4px",
                height: "4px",
                borderRadius: "{radii.full}",
                background: "link",
                marginLeft: "5px",
                verticalAlign: "1.5px",
            },
        },
        // `Slice.Legend`'s eye, verbatim: 9px, LAST in the row (after the
        // count, not before), `link` when on and `fg.muted` when off.
        eye: {
            fontSize: "9px",
            color: "link",
            display: "inline-flex",
            alignItems: "center",
            flex: "none",
            "&[data-on='false']": { color: "fg.muted" },
        },
    },
});
