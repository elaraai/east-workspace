/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optimise slot recipe (#1409; `Optimise Spec.md` §8) — the Elara eye and
 * what a run of the app's optimiser leaves on a builder: the eye button in
 * its toolbar, the banner that says what the run changed, the legend's
 * `Elara change`, and the landing and highlight on the builder's own entries
 * (`src/optimise/`). Every style is here, over the `elara` tokens; the parts
 * set data attributes and geometry only.
 *
 *   - eye: the Elara mark — the ring and the iris as two paths, each its own
 *     colour; the iris's echo, unseen until a run.
 *   - button: an icon-only Default button, 32 × 32 with a 16px mark (`md`),
 *     24 × 24 with 14 (`sm`), or 32 × 28 with 14 in a builder's toolbar row,
 *     whose every control stands 28px (`toolbar`, ruled 23 Oct 2026). Rest:
 *     ring and iris `--ink-2`. Hover: `--paper-2`, the iris
 *     `elara.ink`. Focus: the focus ring. Running (`data-running`): edge and
 *     ring `elara.ink`, iris `elara`, the echo and the halo on the live-pulse
 *     cycle; hovered, the eye hides and Stop shows on `--paper`. No changes
 *     (`data-blink`): one blink, 560ms. Disabled: `--rule` edge, `--ink-5`
 *     mark. Under reduced motion the running state is its colours alone.
 *   - stop: the 11px stop glyph a running eye shows on hover.
 *   - banner / bannerBox: the result's banner in the frame's banners slot —
 *     the shared banner as every other tone draws it, flush with the frame's
 *     other banners, in the Elara tone (`banner.elara`), fading in over
 *     `--dur-base` and collapsing over it (`data-leaving`: height and
 *     opacity). The mock's inset card and brand-face title are the mock's:
 *     one banner style in a frame (ruled 26 Oct 2026).
 *   - legendSwatch: the legend's `Elara change` — a 14 × 8 swatch of the dirty
 *     fill with the steady ring and glow.
 *   - landing: the builder's main — or, for a builder with no root of its
 *     own around its frame, the frame's root (the Sheet's, through
 *     `BuilderFrame`'s `rootCss`) — over the attributes its entries carry —
 *     `data-op="add|chg|del|from"`, `data-fill="own|cell"`, `data-opn` on a
 *     total — and the run's state on main itself: `data-optimise-landing`
 *     while the result lands (each entry's flare, 1400ms from its cascade
 *     delay, `--optimise-delay`), `data-optimise-lit` for the highlight (the
 *     steady glow, the ghosts), the dirty fill as long as the entries carry
 *     an operation. At the highlight's end the glow fades over 600ms and the
 *     ghosts go. Under reduced motion nothing cascades: the steady highlight
 *     shows at once.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

/** The live-pulse cycle the eye's echo and halo run on (§8): 1440ms. */
const PULSE = "calc({durations.slow} * 4)";

/** The steady highlight on an entry a run added or changed, kept for the highlight. */
const STEADY = "0 0 0 1px {colors.elara.edge}, 0 0 8px 1px {colors.elara.soft}";

/** The same, inset, on a Sheet cell. */
const STEADY_INSET = "inset 0 0 0 1px {colors.elara.edge}, inset 0 0 8px 0 {colors.elara.soft}";

/** A ghost — an entry a run removed, or moved from — for the highlight: dashed, the dirty fill, its words `--ink-4`. */
const GHOST = {
    borderStyle: "dashed",
    borderColor: "elara.edge",
    background: "brandTint",
    color: "fg.subtle",
} satisfies SystemStyleObject;

/**
 * The landing and the highlight on a builder's entries (§8, R13–R18): what the `landing` slot draws on a builder's
 * own root, or on its frame's.
 */
const LANDING = {
    // The dirty fill, as long as an entry carries an operation (R16): an entry with its own fill keeps it.
    "& [data-op=add]:not([data-fill=own]), & [data-op=chg]:not([data-fill=own])": { backgroundColor: "brandTint" },
    // The glow fades over 600ms at the highlight's end.
    "& [data-op=add], & [data-op=chg]": { transitionProperty: "box-shadow", transitionDuration: "600ms", transitionTimingFunction: "{easings.out}" },
    "& [data-opn]": { borderRadius: "sm" },
    // The landing: each entry's flare from its cascade delay, by its operation and its fill (§8).
    "&[data-optimise-landing] [data-op]": {
        animationDuration: "1400ms",
        animationTimingFunction: "{easings.out}",
        animationDelay: "var(--optimise-delay, 0ms)",
        animationFillMode: "both",
    },
    "&[data-optimise-landing] [data-op=add]": { animationName: "optimise-land-add" },
    "&[data-optimise-landing] [data-op=chg]": { animationName: "optimise-land-change" },
    "&[data-optimise-landing] [data-op=add][data-fill=own]": { animationName: "optimise-land-add-own" },
    "&[data-optimise-landing] [data-op=chg][data-fill=own]": { animationName: "optimise-land-change-own" },
    "&[data-optimise-landing] [data-op=add][data-fill=cell], &[data-optimise-landing] [data-op=chg][data-fill=cell]": { animationName: "optimise-land-cell" },
    "&[data-optimise-landing] [data-fill=cell] [data-op-value]": { animation: "optimise-value-in 160ms linear var(--optimise-delay, 0ms) both" },
    "&[data-optimise-landing] [data-op=del], &[data-optimise-landing] [data-op=from]": { animationName: "optimise-ghost-out", animationFillMode: "forwards" },
    // A total the result changed flashes the wash once, after the cascade.
    "&[data-optimise-landing] [data-opn]": {
        animationName: "optimise-flash",
        animationDuration: "1400ms",
        animationTimingFunction: "{easings.out}",
        animationDelay: "var(--optimise-delay, 0ms)",
        animationFillMode: "both",
    },
    // The highlight: the steady glow on every add and change, and the ghosts, for 8s (R16).
    "&[data-optimise-lit] [data-op=add], &[data-optimise-lit] [data-op=chg]": { boxShadow: STEADY },
    "&[data-optimise-lit] [data-fill=cell][data-op=add], &[data-optimise-lit] [data-fill=cell][data-op=chg]": { boxShadow: STEADY_INSET },
    "&[data-optimise-lit] [data-op=del]": { ...GHOST, textDecoration: "line-through" },
    "&[data-optimise-lit] [data-op=from]": GHOST,
    "&[data-optimise-lit] [data-op=del] *, &[data-optimise-lit] [data-op=from] *": { color: "inherit" },
    // A ghost lives for the highlight alone (R15).
    "&:not([data-optimise-lit]) [data-op=del], &:not([data-optimise-lit]) [data-op=from]": { display: "none" },
    // Reduced motion (R18): no cascade, the steady highlight at once.
    _motionReduce: {
        "&[data-optimise-landing] [data-op], &[data-optimise-landing] [data-opn], &[data-optimise-landing] [data-op-value]": { animation: "none" },
        "& [data-op=add], & [data-op=chg]": { transition: "none" },
    },
} satisfies SystemStyleObject;

export const optimiseSlotRecipe = defineSlotRecipe({
    className: "elara-optimise",
    slots: ["eye", "button", "stop", "banner", "bannerBox", "legendSwatch", "landing"],
    base: {
        eye: {
            display: "block",
            flex: "none",
            overflow: "visible",
            fill: "currentColor",
            "&[data-eye-size='16']": { width: "16px", height: "16px" },
            "&[data-eye-size='14']": { width: "14px", height: "14px" },
            "& [data-eye-iris], & [data-eye-echo]": { transformBox: "fill-box", transformOrigin: "center" },
            "& [data-eye-echo]": { opacity: 0 },
        },
        button: {
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            boxSizing: "border-box",
            padding: "0",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "md",
            background: "bg.surface",
            color: "fg.strong",
            cursor: "pointer",
            userSelect: "none",
            ...coarseHitArea(),
            // The mock's: the fill and the edge ease; the mark's colour, the focus ring and the halo change at once.
            transitionProperty: "background, border-color",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            _hover: {
                background: "bg.canvas",
                "& [data-eye-iris]": { fill: "elara.ink" },
            },
            _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
            "&[data-running]": {
                borderColor: "elara.ink",
                color: "elara.ink",
                animation: `optimise-halo ${PULSE} {easings.out} infinite`,
                "& [data-eye-iris]": { fill: "elara" },
                "& [data-eye-echo]": { fill: "elara", animation: `optimise-echo ${PULSE} {easings.out} infinite` },
                _hover: {
                    background: "bg.surface",
                    "& [data-eye]": { opacity: 0 },
                    "& [data-eye-stop]": { opacity: 1 },
                },
            },
            "&[data-blink] [data-eye-ring], &[data-blink] [data-eye-iris]": {
                transformBox: "view-box",
                transformOrigin: "center",
                animation: "optimise-blink 560ms {easings.inOut} 1",
            },
            _disabled: {
                borderColor: "border.subtle",
                background: "bg.surface",
                color: "fg.faint",
                cursor: "default",
                "& [data-eye-iris]": { fill: "fg.faint" },
                _hover: { background: "bg.surface", "& [data-eye-iris]": { fill: "fg.faint" } },
            },
            // Reduced motion: no echo, no halo — the running state is the colour change alone (R18).
            _motionReduce: {
                "&[data-running]": { animation: "none", "& [data-eye-echo]": { animation: "none", opacity: 0 } },
            },
        },
        stop: {
            position: "absolute",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            lineHeight: 1,
            opacity: 0,
            pointerEvents: "none",
            "& svg": { width: "1em", height: "1em" },
        },
        banner: {
            display: "grid",
            gridTemplateRows: "1fr",
            minWidth: "0",
            animation: "optimise-fade-in {durations.normal} {easings.out} both",
            transitionProperty: "grid-template-rows, opacity",
            transitionDuration: "{durations.normal}",
            transitionTimingFunction: "{easings.out}",
            "&[data-leaving]": { gridTemplateRows: "0fr", opacity: 0 },
            // The eye's iris takes `elara`; everything else is the shared banner's own.
            "& [data-banner-mark] [data-eye-iris]": { fill: "elara" },
            _motionReduce: { animation: "none" },
        },
        bannerBox: {
            minHeight: "0",
            minWidth: "0",
            overflow: "hidden",
        },
        legendSwatch: {
            display: "inline-block",
            flex: "none",
            width: "14px",
            height: "8px",
            boxSizing: "border-box",
            borderRadius: "2px",
            background: "brandTint",
            boxShadow: "0 0 0 1px {colors.elara.edge}, 0 0 4px 1px {colors.elara.soft}",
        },
        // On a builder's own root, or on its frame's root for a builder with none around the frame (the Sheet's): never
        // on a wrapper of its own around the frame — a host sizes and measures a builder through the frame's parent,
        // and a wrapper there is either no box at all (`display: contents`) or a box of its own that lays the builder
        // out unlike its peers (the Sheet's grip drag lost its seam to that, #1442).
        landing: LANDING,
    },
    variants: {
        size: {
            md: { button: { width: "32px", height: "32px" } },
            sm: { button: { width: "24px", height: "24px" } },
            toolbar: { button: { width: "32px", height: "28px" } },
        },
    },
    defaultVariants: { size: "md" },
});
