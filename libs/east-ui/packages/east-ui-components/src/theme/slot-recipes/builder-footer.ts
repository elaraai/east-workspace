/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared status rail used by framed builders, extracted from Plan — and
 * its one loading line (#1398, CL3): the line in a slot of its own at the
 * rail's trailing end, so the legend never moves as it comes and goes. The
 * rail of a builder that carries the line never wraps and never cuts a word:
 * its legend's items stay whole, a cut one taken out of the flow whole
 * (`data-footer-cut`) and the legend ended by "…", and the line shows its full
 * text, its short form or its dot alone (`layout/builder-frame/footer-fit.ts`).
 *
 * @packageDocumentation
 */
import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

/**
 * What a rail's item the fit cut takes: out of the flow and unseen, but still
 * laid out at its own width, so the fit measures it whole — a legend item, the
 * "…" while nothing is cut, a form of the line not shown. It hangs from the
 * inline end of what holds it, so one wider than the rail runs back over the
 * rail's start, never past its end: an unseen copy takes no room a page could
 * scroll to.
 */
export const FOOTER_CUT = {
    position: "absolute",
    insetInlineEnd: "0",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
    whiteSpace: "nowrap",
} satisfies SystemStyleObject;

/** Text kept for screen readers alone: the loading line's full text while its short form or its dot shows. */
export const VISUALLY_HIDDEN = {
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    padding: "0",
    borderWidth: "0",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
} satisfies SystemStyleObject;

/**
 * What lets a rail fit by cutting (#1398): its items placed from it, and a
 * unit the fit cut — a legend item of the rail, or a hint running on in one
 * item of it (`data-footer-units`) — taken out of the flow whole. The shared
 * rail has it, and so does a builder's own rail that carries the loading line
 * (the Sheet's).
 */
export const FOOTER_FIT = {
    position: "relative",
    "& > [data-footer-cut], & > [data-footer-units] > [data-footer-cut]": FOOTER_CUT,
} satisfies SystemStyleObject;

/** The 28px panel rail, wrapping only when the host's main is narrow, or its items do not fit on one line. */
export const builderFooter = {
    ...FOOTER_FIT,
    minHeight: "28px",
    display: "flex",
    alignItems: "center",
    // The unwrapped gap, kept as a property while the rail wraps: what a host
    // measures whether its items fit on one line by, whatever form it is in now.
    "--builder-footer-gap": "14px",
    gap: "var(--builder-footer-gap)",
    padding: "0 12px",
    background: "bg.panel",
    borderTopWidth: "1px",
    borderTopColor: "border.subtle",
    // In a narrow main area there is no 28px band to fit a
    // status line into — the same items wrap onto as many lines as they
    // need. (A builder carrying the loading line never wraps: it fits.)
    "&[data-builder-narrow]": { flexWrap: "wrap", minHeight: "auto", padding: "6px 12px", rowGap: "2px", columnGap: "10px" },
} satisfies SystemStyleObject;

/** Status text and end-aligned/tone variants within the rail. */
export const builderFooterItem = {
    fontFamily: "mono",
    fontSize: "10px",
    fontWeight: "semibold",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "fg.subtle",
    whiteSpace: "nowrap",
    "&[data-tone='warning']": { color: "{colors.status.warn}" },
    "&[data-tone='danger']":  { color: "{colors.status.neg}" },
    "&[data-tone='success']": { color: "{colors.status.pos}" },
    "&[data-tone='info']":    { color: "{colors.status.info}" },
    "&[data-end]": { marginLeft: "auto" },
} satisfies SystemStyleObject;

/** The line's own parts' layout: the dot, the words and the Retry, 8px apart. */
const LINE_FORM = {
    display: "inline-flex",
    alignItems: "center",
    gap: "{spacing.2}",
    whiteSpace: "nowrap",
} satisfies SystemStyleObject;

/**
 * How far the rail's foot is below Retry's (#1398): Retry stands on the 28px
 * rail's centre line, its 16px line (28 − 1 − 16) / 2 = 5.5px above the foot,
 * the 1px its top rule takes aside. The rail sits at its frame's foot, and the
 * frame clips what passes its edge, so Retry's 44px tap target on a touch
 * screen — `coarseHitArea`'s halo, the touch-target rule's (#346) — rises from
 * there, all of it inside the frame: Retry keeps its size, and the rail its
 * height.
 */
const RETRY_FOOT = 5.5;

/**
 * The footer's voice (the design's `.ff`): mono 10.5 `--ink-3`, tabular, on a
 * 16px line. The loading line speaks in it, and so does the "…" that ends a
 * cut legend — a rail sets no voice of its own, each of its items its own.
 */
const FOOTER_VOICE = {
    fontFamily: "mono",
    fontSize: "{fontSizes.label.md}",
    fontWeight: "normal",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "normal",
    textTransform: "none",
    lineHeight: "16px",
    color: "fg.muted",
} satisfies SystemStyleObject;

/**
 * The footer's loading line (#1398, CL3; the design's `.ldl`): one line in its
 * own slot at the rail's trailing end, taking only the room the rail leaves it
 * and at most 64% of it. An 8px `--brand` dot with the live pulse, then the
 * line's words in the footer's voice — mono 10.5 `--ink-3`, tabular — the
 * range or the period 600 `--ink`. A failed read's dot is `--neg` and still,
 * its words `--neg-text`, then `·` and Retry, the footer's link (`--brand-d`
 * 500) — on a touch screen a 44px tap target by its halo, risen from the
 * rail's foot, the rail as tall as ever. Its form (`data-form`) shows its full
 * text, its short form, or its dot alone — a failure's dot and Retry — its
 * full text kept for screen readers while it does not show. Idle (`data-idle`), it is an empty live region out
 * of the flow, so it takes no width and no gap.
 *
 * A run of the app's optimiser out (#1409, `busy`) takes the same slot: the
 * Elara dot — `elara`, ringed `elara.ink` so it reads in light — with the live
 * pulse, the line's words, and beside them what ticks, the seconds, unheard
 * (`aside`), so the line is announced once. Stopped (`note`), its dot is still
 * and neutral.
 *
 *   - root: the slot, and the polite live region.
 *   - dot / text / strong / short / sep / retry: its parts.
 *   - aside: what ticks beside the words, in the full form alone — `· 7 s`.
 *   - reason: why a read failed, heard with its words and never drawn — the
 *     failed run's own line draws it in place (CL11).
 *   - measure: its forms laid out unseen at their own widths, for the fit.
 *   - form: one form in the measure, laid out as the line lays it.
 *   - more: the "…" that ends a legend the fit cut, in the line's voice;
 *     unseen while none is.
 */
export const builderFooterLineSlotRecipe = defineSlotRecipe({
    className: "elara-builder-footer-line",
    slots: ["root", "dot", "text", "strong", "short", "sep", "aside", "retry", "reason", "measure", "form", "more"],
    base: {
        root: {
            ...LINE_FORM,
            ...FOOTER_VOICE,
            position: "relative",
            flex: "0 1 auto",
            minWidth: "0",
            maxWidth: "64%",
            marginInlineStart: "auto",
            "&[data-idle]": VISUALLY_HIDDEN,
        },
        dot: {
            position: "relative",
            flex: "none",
            width: "8px",
            height: "8px",
            borderRadius: "full",
            background: "brandMark",
            // The live pulse: the dot's copy grows and fades — the line's one motion.
            "&::after": {
                content: '""',
                position: "absolute",
                inset: "0",
                borderRadius: "full",
                background: "inherit",
                animation: "elara-live-pulse calc({durations.slow} * 4) {easings.out} infinite",
            },
            "[data-failed] &": { background: "status.neg", "&::after": { display: "none" } },
            // The optimiser's run (#1409): the Elara dot, ringed so it reads in light; stopped, a still neutral dot.
            "[data-loading-line=busy] &": { background: "elara", boxShadow: "0 0 0 1px {colors.elara.ink}" },
            "[data-loading-line=note] &": { background: "fg.subtle", "&::after": { display: "none" } },
            _motionReduce: { "&::after": { animation: "none", opacity: 0 } },
        },
        text: {
            minWidth: "0",
            overflow: "hidden",
            "[data-failed] > &": { color: "fg.danger" },
            // Its short form or its dot shows: the full text is the screen reader's alone.
            "[data-form=short] > &, [data-form=dot] > &": VISUALLY_HIDDEN,
        },
        strong: {
            fontWeight: "semibold",
            color: "fg",
            "[data-failed] &": { color: "fg.danger" },
        },
        short: {
            flex: "none",
            "[data-failed] > &": { color: "fg.danger" },
            "[data-form=full] > &, [data-form=dot] > &": { display: "none" },
        },
        sep: {
            flex: "none",
            "[data-form=dot] > &": { display: "none" },
        },
        // The seconds a run has been out, in the full form alone: tabular, padded by the line's words so they never shift.
        aside: {
            ...LINE_FORM,
            flex: "none",
            "[data-form=short] > &, [data-form=dot] > &": { display: "none" },
        },
        // On a touch screen Retry keeps its size, and its 44px tap target is its halo — never a taller rail.
        retry: {
            ...coarseHitArea({ position: true, foot: RETRY_FOOT }),
            flex: "none",
            padding: "0",
            borderWidth: "0",
            background: "transparent",
            font: "inherit",
            fontWeight: "medium",
            color: "brand.solid",
            cursor: "pointer",
            borderRadius: "sm",
            _hover: { color: "brandPressed", textDecoration: "underline", textUnderlineOffset: "2px" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        reason: VISUALLY_HIDDEN,
        measure: {
            ...FOOTER_CUT,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
        },
        form: {
            ...LINE_FORM,
            width: "max-content",
        },
        more: {
            ...FOOTER_VOICE,
            flex: "none",
            "&[data-footer-cut]": FOOTER_CUT,
        },
    },
});
