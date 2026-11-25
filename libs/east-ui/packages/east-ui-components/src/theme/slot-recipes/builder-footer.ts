/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every builder's footer (east-workspace#1748): one rail and one look, the
 * Plan's, the Calendar's, the Roster's, the Allocation's, the Schematic's, the
 * Flowchart's, the Sheet's and the Record's alike (`builderFooterSlotRecipe`),
 * and its one loading line (#1398, CL3): the line in a slot of its own at the
 * rail's trailing end, so the legend never moves as it comes and goes. The
 * rail of a builder that carries the line never wraps and never cuts a word:
 * its legend's items stay whole, a cut one taken out of the flow whole
 * (`data-footer-cut`) and the legend ended by "…", and the line shows its full
 * text, its short form or its dot alone (`layout/builder-frame/footer-fit.ts`).
 * Each run of words on the rail stands with its capitals at the middle of the
 * 27px under its rule (`centredCapitals`). A builder keeps only its own marks
 * in its recipe: a legend's swatches, icons and chips.
 *
 * @packageDocumentation
 */
import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";
import { centredCapitals } from "../face-capitals.js";
import { centredLine } from "../one-line-box.js";
import { refusedTone } from "../refused-mark.js";

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

/** A part's words in a tone: a status the app gives it. */
const TONES = {
    "&[data-tone='warning']": { color: "{colors.status.warn}" },
    "&[data-tone='danger']":  { color: "{colors.status.neg}" },
    "&[data-tone='success']": { color: "{colors.status.pos}" },
    "&[data-tone='info']":    { color: "{colors.status.info}" },
} satisfies SystemStyleObject;

/** The line's own parts' layout: the dot, the words and the Retry, 8px apart. */
const LINE_FORM = {
    display: "inline-flex",
    alignItems: "center",
    gap: "{spacing.2}",
    whiteSpace: "nowrap",
} satisfies SystemStyleObject;

/** The room a 28px rail has for a line of words, under the 1px rule at its top. */
const RAIL_ROOM = 27;

/** The height of the footer's voice's line: a whole, odd 15px, centred in the rail's odd room (#1638). */
const VOICE_LINE = 15;

/**
 * The line a 28px rail's words stand on (#1638): the footer's voice's 15px, centred in the 27px under the rail's rule —
 * the loading line's, and any words of the rail's own.
 */
export const RAIL_LINE = centredLine(RAIL_ROOM, VOICE_LINE);

/** A status or a legend item's words: mono 10, their capitals at the middle of the rail's room. */
const ITEM_VOICE = centredCapitals("mono", "label.sm", RAIL_ROOM);

/**
 * A mark an odd number of pixels tall beside an item's words — the Record's legend chip, the Calendar's event icon: the
 * item's padding mirrored round it. Mono's capitals stand a row high in their line, so an item pads its words' line a
 * pixel over it (`ITEM_VOICE`), and centres a mark beside them in that line — at half a pixel where the mark is odd and
 * the line even. A pixel under the mark makes it even there, and stands it at the rail's middle, as its words are. An
 * even mark — a swatch — stands on whole pixels as it is, a row from the middle at most: an odd room has no middle row
 * for it.
 */
export const RAIL_ODD_MARK = { marginTop: ITEM_VOICE.paddingBottom, marginBottom: ITEM_VOICE.paddingTop } satisfies SystemStyleObject;

/**
 * The rail itself: 28px on the panel's colour under its rule, padded 12, its items 14 apart — every builder's footer
 * (`builderFooterSlotRecipe`'s root), and the frame's cold-load skeleton's footer, which stands where it will. In a
 * narrow main area (`data-builder-narrow`) it wraps onto as many lines as its items need.
 */
export const FOOTER_RAIL = {
    ...FOOTER_FIT,
    minHeight: "28px",
    display: "flex",
    alignItems: "center",
    // The unwrapped gap, kept as a property while the rail wraps: what a host measures whether its items fit on one line
    // by, whatever form it is in now.
    "--builder-footer-gap": "14px",
    gap: "var(--builder-footer-gap)",
    paddingInline: "12px",
    lineHeight: RAIL_LINE,
    background: "bg.panel",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "border.subtle",
    minWidth: "0",
    "&[data-builder-narrow]": { flexWrap: "wrap", minHeight: "auto", paddingBlock: "6px", rowGap: "2px", columnGap: "10px" },
} satisfies SystemStyleObject;

/**
 * Every builder's footer (east-workspace#1748, ruled 24 Nov 2026: one rail, one look): the 28px rail on the panel's
 * colour under its rule, padded 12, and its words, each run with its capitals at the middle of the 27px under the rule.
 *
 *   - root: the rail — wrapping onto as many lines as its items need in a narrow main area
 *     (`data-builder-narrow`), where there is no 28px band to fit them into; a builder carrying the loading line
 *     never wraps, it fits.
 *   - item: a status or a legend item, mono 10/600 in capitals at 0.1em in `fg.subtle`, in a tone where the app gives
 *     one or in the danger ink while it says a gesture was refused, at the rail's end with `data-end`; a legend item's
 *     mark — the builder's own swatch, icon or chip — 8px before its words, as the design's legend item lays them out,
 *     an odd one with `RAIL_ODD_MARK`.
 *   - count: counts and notes in the footer's voice, mono 10.5 tabular in `fg.muted`, a figure in `<b>` 600 in ink, a
 *     part in a tone where the app gives one, at the rail's end with `data-end`.
 *   - hint, hintSep: a key hint's words, mono 10 at 0.04em in `fg.subtle`, each run on with ` · `, its spaces kept.
 *   - message: the last gesture's words, taking the rail's slack (`data-footer-slack`) and cut with an ellipsis there,
 *     at its end, in the danger ink while they say a gesture was refused. An echo of the toolbar's status line
 *     (`data-echo`) shows only on a phone, whose toolbar has no room for it, or where the toolbar's row cuts it
 *     (`data-band`) — there at its words' own width, leaving the slack to the spacer before a legend.
 *   - spacer: the slack between the counts and a legend at the rail's end.
 *   - legend: a legend fitted as units (`data-footer-units`): its items, the rail's gap apart.
 *   - notices: live notices taking the rail's slack, wrapping within themselves item by item where they are narrow
 *     (`data-builder-narrow`). They clip sideways alone: a notice's Retry keeps its touch halo and its focus ring,
 *     which reach over and under its line.
 */
export const builderFooterSlotRecipe = defineSlotRecipe({
    className: "elara-builder-footer",
    slots: ["root", "item", "count", "hint", "hintSep", "message", "spacer", "legend", "notices"],
    base: {
        root: FOOTER_RAIL,
        item: {
            display: "inline-flex",
            alignItems: "center",
            // A legend item's mark, then its words 8px on: the design's legend item.
            gap: "8px",
            flexShrink: 0,
            ...ITEM_VOICE,
            fontWeight: "semibold",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            ...TONES,
            ...refusedTone,
            "&[data-end]": { marginInlineStart: "auto" },
        },
        count: {
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            flexShrink: 0,
            ...centredCapitals("mono", "label.md", RAIL_ROOM),
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            whiteSpace: "nowrap",
            "& b": { fontWeight: "semibold", color: "fg" },
            "& [data-tone=success]": { color: "status.pos" },
            "& [data-tone=danger]": { color: "status.neg" },
            "& [data-tone=warning]": { color: "status.warn" },
            "& [data-tone=info]": { color: "status.info" },
            "&[data-end]": { marginInlineStart: "auto" },
        },
        hint: {
            flex: "none",
            ...centredCapitals("mono", "label.sm", RAIL_ROOM),
            letterSpacing: "0.04em",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        // The ` · ` before a hint: its spaces kept wherever the hint is laid out, so a hint measures the same cut or shown.
        hintSep: { whiteSpace: "pre" },
        message: {
            flex: "1 1 auto",
            minWidth: "0",
            ...centredCapitals("mono", "label.md", RAIL_ROOM),
            textAlign: "end",
            color: "fg.muted",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            ...refusedTone,
            "&[data-echo]": {
                display: "none",
                "&[data-band]": { display: "block", flex: "0 1 auto" },
                "[data-phone] &": { display: "block", flex: "1 1 auto", textAlign: "start" },
            },
        },
        spacer: { flex: "1", minWidth: "0" },
        legend: { flex: "none", display: "flex", alignItems: "center", gap: "var(--builder-footer-gap)" },
        notices: {
            flex: "1 1 auto",
            minWidth: "0",
            display: "flex",
            alignItems: "center",
            gap: "var(--builder-footer-gap)",
            overflowX: "clip",
            // Narrow: its notices wrap within it, item by item, and a notice wider than it its own words.
            "&[data-builder-narrow]": {
                flexWrap: "wrap", paddingBlock: "6px", rowGap: "2px", columnGap: "10px",
                "& > *": { flexShrink: 1, minWidth: 0, whiteSpace: "normal" },
            },
        },
    },
});

/**
 * How far the rail's foot is below Retry's (#1398): Retry stands on the 28px
 * rail's centre line, its 15px line (28 − 1 − 15) / 2 = 6px above the foot,
 * the 1px its top rule takes aside. The rail sits at its frame's foot, and the
 * frame clips what passes its edge, so Retry's 44px tap target on a touch
 * screen — `coarseHitArea`'s halo, the touch-target rule's (#346) — rises from
 * there, all of it inside the frame: Retry keeps its size, and the rail its
 * height.
 */
const RETRY_FOOT = (RAIL_ROOM - VOICE_LINE) / 2;

/**
 * The footer's voice (the design's `.ff`): mono 10.5 `--ink-3`, tabular, on a
 * 15px line. The loading line speaks in it, and so does the "…" that ends a
 * cut legend — a rail sets no voice of its own, each of its items its own.
 *
 * Its line is the rail's other items' (#1638): the rail centres each in the
 * 27px under its rule, and the design's 16px line leaves an odd pixel over, so
 * the words started half a pixel under the rule and the page painted them a
 * row higher or lower by where it stood the rail. On 15px they start 6px under
 * it, where the legend's do.
 */
const FOOTER_VOICE = {
    fontFamily: "mono",
    fontSize: "{fontSizes.label.md}",
    fontWeight: "normal",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "normal",
    textTransform: "none",
    lineHeight: RAIL_LINE,
    color: "fg.muted",
} satisfies SystemStyleObject;

/**
 * The footer's loading line (#1398, CL3; the design's `.ldl`): one line in its
 * own slot at the rail's trailing end, taking only the room the rail leaves it
 * and at most 64% of it. An 8px `--brand` dot with the live pulse, on whole
 * rows of the rail's room — ten over it and nine under — then the
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
 *   - notice: a Save's notice (#1344) — the rows it moved out of the view, or
 *     the view read again — in the line's voice, never the page's own type;
 *     failed (`data-failed`), its words the danger ink, then `·` and the
 *     line's Retry.
 */
export const builderFooterLineSlotRecipe = defineSlotRecipe({
    className: "elara-builder-footer-line",
    slots: ["root", "dot", "text", "strong", "short", "sep", "aside", "retry", "reason", "measure", "form", "more", "notice"],
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
            // An even dot in the line's odd 15px — and, alone, in the rail's odd room — is centred at half a row, which a
            // page paints a row higher or lower by where it stands the rail. A pixel over it stands it on whole rows, a
            // row under the room's middle: where the rail's other even marks stand, a legend's swatch.
            marginTop: "1px",
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
        notice: {
            ...LINE_FORM,
            ...FOOTER_VOICE,
            flex: "none",
            "&[data-failed]": { color: "fg.danger" },
        },
    },
});
