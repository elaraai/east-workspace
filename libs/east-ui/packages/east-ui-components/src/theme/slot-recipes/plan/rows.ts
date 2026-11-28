/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan recipe's ROWS — the alignment contract (gutter cell + plot), the
 * gutter vocabulary, the row-focus controls, strips and what a links focus's
 * bands say (R1 / R2), the expand-in-place render, and the group band — whose
 * look a links focus's bands wear.
 *
 * One part of the Plan slot recipe (`../plan.ts`, #817), over semantic tokens
 * and the canvas's geometry variables (e3-ui-components' `plan/geometry.ts`).
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";
import { fontAwesomeSize } from "../../icon-size.js";
import { centredLine } from "../../one-line-box.js";
import { planElementFocus, planRowFocus } from "./focus.js";
import { timeHeaderText } from "../time/axis.js";
import { linkRibbons, linkSelectedInk } from "../links/ribbons.js";
import { wholeOrNone } from "./whole-or-none.js";

/** The slots this part styles. */
export const rowsSlots = [
    "row", "gutterCell", "plot", "gridSep", "dropPreview", "dropPreviewText", "gutterName", "gutterNameCell", "gutterLabel",
    "gutterSub", "gutterSlot", "gutterValue", "gutterMeta", "gutterSwatches", "gutterSwatch", "gutterLane", "gutterLaneCaption", "gutterAxis", "railCell", "railAxis",
    "gutterHandle", "caret",
    "statusIcon", "statusDot", "rowControls", "rowControl", "ribbons", "expandRowBand",
    "expandRenderBody", "expandGutterBody", "toneCell", "groupBand", "groupName", "groupMeta", "focusNone", "laneBand",
    "stickyParent", "stickyPath",
] as const;

/** The value slot's width: a status and a value, at one x down the canvas — and the column a chart row's legend leaves
 *  to its left axis's numbers (#1750). */
export const GUTTER_SLOT_W = "56px";

/**
 * The gutter's line, one grid (#1749): caret · name · value slot. A row that folds has its caret's cell; a leaf has
 * none (`data-leaf`), its name at its level's indent. Every line keeps its value slot — a status at its start, a value
 * at its end — whether it has them or not, so every status and value stands at one x, down the canvas, whichever rows
 * are loaded. Only the name gives way. A level indents by the caret's cell and the gap after it, which the renderer
 * sets, so a member's words start where its parent's do.
 */
const GUTTER_COLUMNS = `14px minmax(0, 1fr) ${GUTTER_SLOT_W}`;

/** A leaf's line: no caret's cell. */
const GUTTER_COLUMNS_LEAF = `minmax(0, 1fr) ${GUTTER_SLOT_W}`;

/**
 * Where a row's controls show (#1749): on its hover, on a focus within it and on its selection — the one selector
 * the controls and what gives way to them both read, so the two can never disagree.
 */
export const PLAN_ROW_CONTROLS_SHOWN = "[data-plan-row]:is(:hover, :focus-within, [data-selected]) &";

/** The gutter's line as one grid: its columns, the gap between them, and its cells centred on the line. */
const gutterGrid = {
    display: "grid",
    gridTemplateColumns: GUTTER_COLUMNS,
    columnGap: "6px",
    alignItems: "center",
    "&[data-leaf]": { gridTemplateColumns: GUTTER_COLUMNS_LEAF },
} satisfies SystemStyleObject;

/**
 * A name's cell (#1680's review): the label, then its meta inline. The label's column is its words, up to the whole
 * cell, and the meta has what the label leaves it — so the meta gives way first, wholly, and only then the label,
 * which is cut for nothing less than its own length: a share of the shortfall, as two shrinking items split it, cut
 * a label to its ellipsis for a fraction of a pixel while its meta still stood. The gap before the meta is the meta's
 * own padding, inside its column, so it goes as the meta does.
 */
const nameCell = {
    display: "grid",
    gridTemplateColumns: "fit-content(100%) minmax(0, 1fr)",
    alignItems: "center",
    minWidth: 0,
    overflow: "hidden",
    "& > * + *": { paddingInlineStart: "6px" },
} satisfies SystemStyleObject;

/**
 * The line of a row's name, and of what stands on it — its value, its unit — a whole number of pixels (#1638). The
 * gutter cell centres the name in the row's height less its 1px rule and its 4px of padding above and below: an odd
 * room, 23px in a 32px row. So the line is an odd 17px, three above the words and three below. The theme's line of
 * 1.5 is a fraction of a pixel at the name's face, which started the words a fraction of a pixel under the row's edge,
 * and the page painted them a row higher or lower by where it stood the row. A buckets row's lane is 25px with its
 * rule (#1735), an even room, where the line stands a pixel low ({@link EVEN_ROOM}).
 */
const GUTTER_LINE = centredLine(23, 17);

/**
 * A line of the gutter alone in a room of an even height (#1735), which the renderer marks `data-plan-even-room`: a
 * buckets row's lane, 25px with its rule — 16px of room in its cell, 24 for a laned row's line. The name's face has a
 * 13px glyph box, which no line centres on a whole pixel in an even room (#1638): a pixel over the line stands it a
 * pixel low, so the glyph box starts 6px under the lane's top — its digits on the rows a tile's stand on.
 */
const EVEN_ROOM = { "&[data-plan-even-room]": { paddingTop: "1px" } } satisfies SystemStyleObject;

/** The line of a group band's caption: a whole 15px (#1638). */
const HEADING_LINE = centredLine(23, 15);

/**
 * A row's name voice, one for every row whatever its kind (#949, the production Planner's `.planner-rh` name): mono
 * 11 / 500 in the ink, tabular, on the East scale (#1680's review) — its line's, and each of a laned row's lines'.
 * The line clips nothing itself: its name's cell and its value slot do, and the row's controls stand over it.
 */
const gutterVoice = {
    fontFamily: "mono",
    fontSize: "11px",
    fontWeight: "medium",
    color: "fg.default",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
} satisfies SystemStyleObject;

/** A row's room: its height less its rule. */
const ROW_ROOM = "calc(var(--plan-row-h) - var(--plan-rule-h))";

/**
 * A row control's height: an sm button's — or the row's room where that is less, a dense row's, so a control never
 * stands over its row's rule.
 */
const CONTROL_H = `min(24px, ${ROW_ROOM})`;

/**
 * Where the row's controls start against their line's top (#1749): their box is a control's height, taller than the
 * line by an odd number of pixels, and the odd one goes over the line — so in a row's room, where the line stands on a
 * whole pixel, the box does too, with a pixel more under it than over it, as every part of the line has. Where the
 * room is less than a control — a dense row — the box is the room, from its top.
 */
const CONTROLS_OVER_LINE = `max(-4px, calc((${GUTTER_LINE} - ${ROW_ROOM}) / 2))`;

/**
 * The focused row's tint coming in (#591): the row's ground, and its controls' over the value slot, which wear it — so
 * the two change as one.
 */
const TINT_IN = {
    transition: "background 380ms cubic-bezier(0.16, 1, 0.3, 1)",
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
} satisfies SystemStyleObject;

/**
 * The gutter's handle across (#1680's review): the gutter's right rule and the padding before it — 8px under a fine
 * pointer, and under a coarse one the padding whole, 12px, which every line of the gutter leaves empty. Inside the
 * gutter, so it never lies over the plot: a cell keeps its taps to its first pixel.
 */
const GUTTER_HANDLE_W = "8px";
const GUTTER_HANDLE_COARSE_W = "12px";

/** Their base styles. */
export const rowsBase = {
    // ── The alignment contract: gutter cell + plot per row ──
    row: {
        display: "grid",
        position: "relative",
        // A click on a row selects it, or — a strip — returns from the focus.
        cursor: "pointer",
        // Inside the row's height — its plot cell is the row less this (#818).
        borderBottomWidth: "var(--plan-rule-h)",
        borderBottomColor: "border.subtle",
        // Its ground, as one variable each state below sets (#1749): the row's
        // controls, drawn over its value slot, are filled with it, so they
        // cover what is under them in whatever the row wears. The recipe's
        // own, never one of the geometry variables the canvas writes.
        "--row-bg": "{colors.bg.surface}",
        background: "var(--row-bg)",
        "&[data-collapsible]": { "--row-bg": "{colors.bg.panel}" },
        // The last visible member of an open group (#949): a closing rule
        // in the strong ink, so the rows after it read as outside it.
        "&[data-group-end]": { borderBottomColor: "border.strong" },
        // A drafted row (#880) — the Sheet's marks: an 8 % warn wash while a
        // draft of its entry changed it, danger while a check refuses the
        // entry. Before the selection tint, which wins over both.
        "&[data-draft]": { "--row-bg": "color-mix(in oklch, {colors.status.warn} 8%, {colors.bg.surface})" },
        "&[data-invalid]": { "--row-bg": "color-mix(in oklch, {colors.status.neg} 8%, {colors.bg.surface})" },
        // Selection tint — the one selection colour.
        "&[data-selected]": { "--row-bg": "{colors.brandTint}" },
        // Table-row emphasis (K5): footer = 2px top rule; header = panel wash.
        "&[data-emphasis='footer']": { borderTopWidth: "2px", borderTopColor: "border.strong" },
        "&[data-emphasis='header']": { "--row-bg": "{colors.bg.panel}" },
        // ── R2 context strip (#591) ──
        // "Collapse, never remove": an unfocused row keeps its place, its
        // order and its marks — it just stops competing for attention.
        // The 16px height comes from `rowHeight`; this is the rest.
        "&[data-ctx]": {
            "--row-bg": "{colors.bg.panel}",
            cursor: "pointer",
            overflow: "hidden",
            "&:hover": { "--row-bg": "{colors.brandTint}" },
        },
        // ── R2 the FOCUSED row (#591) ──
        // The row grows to hold its render, so the tint runs across the
        // gutter AND the plot as one band — that continuity is what reads
        // as "this row has the canvas" rather than "a panel opened below
        // a row".
        "&[data-expanded]": { "--row-bg": "{colors.brandTint}", ...TINT_IN },
        // The grid's one tab stop, on the keyboard (#819).
        ...planRowFocus,
    },
    gutterCell: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "4px 12px",
        borderRightWidth: "1px",
        borderRightColor: "border.subtle",
        minWidth: 0,
        overflow: "hidden",
        position: "relative",
        // ── R2 (#591) ── The expanded row's gutter is ONE TALL CELL
        // spanning the row and its render. Its content stops centring and
        // stacks from the top, which is what opens the space `expandGutter`
        // fills; the right border picks up the brand so the grown cell
        // reads as part of the focused band.
        "&[data-expanded]": {
            justifyContent: "flex-start",
            paddingTop: "11px",
            borderRightColor: "color-mix(in srgb, {colors.brand.solid} 30%, {colors.border.subtle})",
        },
        // A chart taller than its gutter's lines (#1750) stands them from its
        // top, never in the middle of the chart: its name on the row's first
        // line, centred in the room a one-line row has, where that row's
        // stands — and with a sub line, the two where a two-line row's do,
        // from the cell's own padding.
        "&[data-plan-gutter-top]": { justifyContent: "flex-start" },
        "&[data-plan-gutter-top='']": { paddingTop: `calc((${ROW_ROOM} - ${GUTTER_LINE}) / 2)` },
    },
    plot: {
        position: "relative",
        minWidth: 0,
        overflow: "hidden",
        // R2 `axis` (#591) — the shared grid + now-line are real elements
        // in this cell, so the treatment applies HERE, to the row that
        // declared it. `dim` washes them behind dense render content;
        // `off` suppresses them inside this row only. The ruler is a
        // different element entirely and never moves either way.
        "&[data-axis='dim'] [data-plan-axisline]": { opacity: 0.4 },
        "&[data-axis='off'] [data-plan-axisline]": { display: "none" },
        // An element's press is a pick-up, never the start of a text selection — a locked one's too, which no drag
        // takes, so a press dragged off it selected the canvas's words (#1680's review).
        "& :is([data-run], [data-chip], [data-event], [data-mark], [data-plan-mark])": { userSelect: "none" },
    },
    // The plot's rules as ONE element (#616): an SVG the plot's size, its
    // lines on whole pixels (#1735) — each day's rule its last pixel, in the
    // rule's ink, over a buckets row's lane rules, the rule's ink mixed half
    // into the paper. The renderer writes only the SVG's size and its paths.
    // The expand render's `axis` treatment washes / suppresses them INSIDE the
    // expanded row only ("keep" is the bare default).
    gridSep: {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        "& > svg": { display: "block", fill: "none", strokeWidth: 1, shapeRendering: "crispEdges" },
        "& [data-plan-day-rules]": { stroke: "{colors.border.subtle}" },
        "& [data-plan-lane-rules]": { stroke: "color-mix(in srgb, {colors.border.subtle} 50%, {colors.bg.surface})" },
        // The last day's rule, on the plot's last pixel as every day's is, where the canvas has the right axis's rail
        // after its plots (#1750): the plot's edge is no longer the canvas's, and the rule parts it from the rail. With
        // no rail the edge is the canvas's own, and nothing draws it.
        "[data-plan-railed] &": {
            "&::after": {
                content: '""',
                position: "absolute",
                top: 0,
                bottom: 0,
                right: 0,
                width: "1px",
                background: "border.subtle",
            },
        },
        "[data-axis='dim'] &": { opacity: 0.4 },
        "[data-axis='off'] &": { display: "none" },
    },
    // The landing band — where a dragged library card would come to rest if
    // it were dropped right now. It spans the BUCKET the drop coordinate
    // resolves to, so it is truthful by construction: the same bucket
    // `resolveCoord` names is the one painted.
    //
    // Visibility is driven entirely by the cell's own stage attribute, not
    // by a second piece of JS state that could disagree with it. The layer
    // sets `data-drop-active` on exactly the destination cell and never
    // sets it alongside `data-drop-invalid`, so a refused row shows no
    // landing band without anything here having to know why.
    //
    // Dashed edges over a faint wash — "dashed = ephemeral" in the stage
    // vocabulary, the same reading as the candidate frame.
    dropPreview: {
        position: "absolute",
        top: 0,
        bottom: 0,
        display: "none",
        pointerEvents: "none",
        zIndex: 5,
        // Read against the ACTIVE cell's own brand wash, not against the
        // bare row — the band only ever appears inside `[data-drop-active]`,
        // which is already tinted, so a faint fill disappears into it.
        background: "color-mix(in srgb, {colors.brand.solid} 30%, transparent)",
        borderLeftWidth: "1.5px",
        borderRightWidth: "1.5px",
        borderTopWidth: "0",
        borderBottomWidth: "0",
        borderStyle: "dashed",
        borderColor: "{colors.brand.solid}",
        "[data-drop-active] &": { display: "block" },
    },
    // A moved element's span, printed in its landing band (#825) — what the
    // band stands for, in words. Empty for a card's bucket.
    dropPreviewText: {
        position: "absolute",
        top: "50%",
        left: "4px",
        transform: "translateY(-50%)",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        color: "brand.fg",
        background: "bg.surface",
        borderRadius: "2px",
        padding: "0 3px",
        whiteSpace: "nowrap",
        "&:empty": { display: "none" },
    },
    // ── Gutter vocabulary ──
    // ONE voice for every row's name (`gutterVoice`). A collapsible row keeps
    // the row's voice: only a group band's name is its caption. The line is
    // one grid (`gutterGrid`); a leaf's has no caret's cell, so its name starts
    // at its level's indent.
    gutterName: {
        ...gutterVoice,
        ...gutterGrid,
        lineHeight: GUTTER_LINE,
        // Alone in a room of an even height — a buckets row's lane, 24px (#1735) — a pixel low: the face's 13px glyph box
        // centres on no whole pixel there (#1638), and a pixel over the line starts it 6px under the room's top, its
        // digits on the rows a tile's stand on.
        ...EVEN_ROOM,
        // In a strip every name reads as an id — one 10px mono line is
        // all 16px can carry, and uniformity is what makes the stack
        // scannable.
        "&[data-ctx]": {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            lineHeight: "15px",
            color: "fg.muted",
        },
    },
    // The name's cell (#1680's review): the label, then its meta inline — the
    // meta gives way first, then the label.
    gutterNameCell: nameCell,
    // The row's label — the one item of its line that gives way: it
    // truncates before the value, the status and the row's controls (#1258).
    gutterLabel: {
        flex: "0 1 auto",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    // The unit / sub-line slot (#949) — mono 10 / 400 in the label ink. It
    // starts under the name, past the caret's cell and the gap where the row
    // has one (#1680's review): line 2 holds the sub and nothing else.
    gutterSub: {
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "normal",
        color: "fg.subtle",
        marginTop: "1px",
        paddingLeft: "20px",
        "&[data-leaf]": { paddingLeft: 0 },
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        "&[data-ctx]": { display: "none" },
    },
    // The value slot (#1749), the line's last cell: a status at its start,
    // then a value — or a lane's caption — at its end, each at one x on every
    // line of the canvas.
    gutterSlot: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        minWidth: 0,
        // What the row's controls are placed against: they cover the slot.
        position: "relative",
        // The value in it: at its end, in the room its status leaves — whole,
        // or not drawn. Its line is the name's, which a value wider than its
        // room wraps off, out of sight, so a number is never cut short. Never
        // in a band's capitals.
        "& > [data-plan-gutter='value']": {
            flex: "1 1 0%",
            minWidth: 0,
            height: GUTTER_LINE,
            lineHeight: GUTTER_LINE,
            display: "flex",
            justifyContent: "flex-end",
            ...wholeOrNone,
            textOverflow: "clip",
            textTransform: "none",
            letterSpacing: "normal",
        },
    },
    // A value's voice (#949) — the name's face, semibold, tabular: a row's
    // and a band's in the gutter's value slot, which draws it whole or not at
    // all, and a phone card's in its head. A strip drops it, but for a pinned
    // row a links focus does not gather, which keeps it (`data-keep`).
    gutterValue: {
        fontFamily: "mono",
        fontSize: "11px",
        fontWeight: "semibold",
        color: "fg.default",
        fontVariantNumeric: "tabular-nums",
        textAlign: "right",
        justifySelf: "end",
        maxWidth: "100%",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        "&[data-ctx]:not([data-keep])": { display: "none" },
    },
    // The unit slot, inline after the label in the name's cell — mono 10 /
    // 400 in the label ink (#949), box-centred (never baseline-aligned against
    // the name). It gives way before the label does.
    gutterMeta: {
        textStyle: "mono.xs",
        textTransform: "none",
        letterSpacing: "normal",
        fontWeight: "normal",
        color: "fg.subtle",
        whiteSpace: "nowrap",
        flex: "0 100 auto",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        "&[data-ctx]": { display: "none" },
    },
    // A row's swatches, under its lines: each its colour and its words, in a line.
    gutterSwatches: {
        display: "flex",
        gap: "7px",
        marginTop: "1px",
    },
    gutterSwatch: {
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        fontFamily: "mono",
        fontSize: "10px",
        color: "fg.subtle",
        "& > i": { width: "7px", height: "7px", borderRadius: "1.5px", display: "inline-block" },
        "&[data-ctx]": { display: "none" },
    },
    // A laned row's gutter (#1680's review): one gutter line per lane, the
    // lane's height, laid over the cell where the lane's cells are — its
    // caption in the line's value slot — in the row's voice.
    gutterLane: {
        ...gutterVoice,
        ...gutterGrid,
        lineHeight: GUTTER_LINE,
        // Its one 17px line in the middle of the lane's room, which the renderer sets on whole pixels (#1735) — a pixel
        // low in an even room, as a name alone in one is.
        alignContent: "center",
        position: "absolute",
        left: "12px",
        right: "12px",
        minWidth: 0,
        boxSizing: "border-box",
        ...EVEN_ROOM,
    },
    // A lane's caption (#1749): semibold in the label ink at the value slot's end, beside its lane — in the room the
    // row's status leaves it on the first line.
    gutterLaneCaption: {
        flex: "1 1 0%",
        minWidth: 0,
        textAlign: "right",
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "semibold",
        color: "fg.subtle",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    // A chart row's left axis, down its gutter's value slot (#1750): a column the slot's width, ending where the slot
    // does, the cell's height — on a row open on its render, its band's, which the renderer sets — that its tick
    // labels stand in, each at its tick's share of it. It takes no part in the gutter's lines, and no pointer.
    gutterAxis: {
        position: "absolute",
        top: 0,
        bottom: 0,
        right: "12px",
        width: GUTTER_SLOT_W,
        pointerEvents: "none",
    },
    // The right axis's rail (#1750), where the Plan declares one: the row's last track, after its plot and as tall as it,
    // the row's ground and rule running under it — which a chart row's right axis reads its numbers in. It takes no
    // pointer: a click there is the row's.
    railCell: {
        position: "relative",
        minWidth: 0,
        overflow: "hidden",
        pointerEvents: "none",
    },
    // A chart row's right axis, down its rail (#1750): the cell's width and height — on a row open on its render, its
    // band's, which the renderer sets — that its tick labels stand in, each at its tick's share of it, as the left axis's
    // stand in the gutter's value slot.
    railAxis: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
    },
    // The gutter's right rule, as a handle (#1680's review): a drag moves it,
    // and the gutter with it — the arrow keys too. Over the rows and their
    // header, the whole canvas tall, inside the gutter's right edge
    // (`--plan-gutter-w`, which the grid's template reads too), never over the
    // plot. Hovered, dragged or focused, the rule itself is drawn in the brand.
    gutterHandle: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: `calc(var(--plan-gutter-w) - ${GUTTER_HANDLE_W})`,
        width: GUTTER_HANDLE_W,
        zIndex: 7,
        cursor: "col-resize",
        touchAction: "none",
        outline: "none",
        _coarse: { left: `calc(var(--plan-gutter-w) - ${GUTTER_HANDLE_COARSE_W})`, width: GUTTER_HANDLE_COARSE_W },
        "&::after": {
            content: '""',
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: "1px",
            background: "transparent",
            transition: "background 120ms",
        },
        "&:hover::after, &[data-dragging]::after": { background: "{colors.brand.solid}" },
        "&:focus-visible::after": { background: "{colors.brand.solid}", width: "2px" },
    },
    caret: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "11px",
        color: "fg.subtle",
        width: "14px",
        flexShrink: 0,
        transition: "transform 0.15s",
        "&[data-collapsed]": { transform: "rotate(-90deg)" },
    },
    // A row's status, and a group band's (#1749): its tone's icon at the value
    // slot's start, one x down the canvas, told by its shape as by its ink. A
    // neutral status draws none. A pixel under it stands it on a whole pixel
    // of its line, the odd one below. A strip's is its marks' height, but for
    // a pinned row a links focus does not gather, which keeps its icon as it
    // is (`data-keep`).
    statusIcon: {
        ...fontAwesomeSize("12px"),
        display: "inline-flex",
        flex: "none",
        marginBottom: "1px",
        "&[data-tone='warning']": { color: "{colors.status.warn}" },
        "&[data-tone='danger']":  { color: "{colors.status.neg}" },
        "&[data-tone='success']": { color: "{colors.status.pos}" },
        "&[data-tone='info']":    { color: "{colors.status.info}" },
        // Its marks' height centres on the strip's line as it is.
        "&[data-ctx]:not([data-keep])": { ...fontAwesomeSize("var(--plan-strip-mark-h)"), marginBottom: 0 },
    },
    // A phone card's status: a dot in its head, in its tone's colour.
    statusDot: {
        width: "8px",
        height: "8px",
        borderRadius: "full",
        flexShrink: 0,
        justifySelf: "center",
        "&[data-tone='warning']": { background: "{colors.status.warn}" },
        "&[data-tone='danger']":  { background: "{colors.status.neg}" },
        "&[data-tone='success']": { background: "{colors.status.pos}" },
        "&[data-tone='info']":    { background: "{colors.status.info}" },
        "&[data-tone='neutral']": { background: "fg.subtle" },
    },
    // ── Row focus (R1 links / R2 expand) — the row-scoped controls
    //    (`Plan links.html`, #1258): sm ghost buttons that take no column of
    //    the gutter's line (#1749). They stand over its value slot, at its
    //    end, two places in a fixed order — links, then expand — whether a row
    //    has one or both, so a pointer moving down the rows finds each at one
    //    x; their box is the slot's width, filled with the row's own ground,
    //    so it covers the status and the value under it. Shown on the row's
    //    hover, on a focus within it, on its selection, and on the focal row
    //    of an open focus (`data-focal`), where a pressed one wears the brand
    //    tint; hidden otherwise, and never in a strip. ──
    rowControls: {
        position: "absolute",
        insetInline: 0,
        top: CONTROLS_OVER_LINE,
        height: CONTROL_H,
        display: "grid",
        gridTemplateColumns: "24px 24px",
        justifyContent: "end",
        background: "var(--row-bg)",
        // Over the links (z 5): a loopback turning in the gutter passes under them.
        zIndex: 6,
        visibility: "hidden",
        [PLAN_ROW_CONTROLS_SHOWN]: { visibility: "visible" },
        "&[data-focal]": { visibility: "visible" },
        // On the focused row its ground comes in with the row's, never ahead of it.
        "[data-plan-row][data-expanded] &": TINT_IN,
        // A strip is one click target — returning. Row controls inside it
        // would compete with that, and there is no room for them anyway.
        "&[data-ctx]": { display: "none" },
    },
    // An sm ghost icon button, the muted ink; hovered the subtle paper and the
    // ink; pressed the brand tint and the brand's pressed ink.
    rowControl: {
        width: "24px",
        height: CONTROL_H,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid transparent",
        background: "transparent",
        color: "fg.muted",
        borderRadius: "md",
        cursor: "pointer",
        fontSize: "14px",
        padding: 0,
        "&:hover": { color: "fg", background: "bg.subtle" },
        "&[data-active]": { color: "{colors.brandPressed}", background: "{colors.brandTint}" },
        ...planElementFocus,
    },
    // ── R1 links (`Plan links.html`, #1258) — drawn over the rows in
    //    their own coordinates (the frame's overlay box, in the rows' own
    //    stacking context), under the now line and the row controls; they
    //    fade in once the rows have gathered.
    //    Geometry is the only thing the renderer writes: the paths and each
    //    link's weight. ──
    ribbons: {
        position: "absolute",
        inset: 0,
        zIndex: 5,
        pointerEvents: "none",
        animation: "plan-settle-in {durations.normal} {easings.out} {durations.slow} backwards",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        // While the gutter's rule is dragged the links stand where it was: they go until it is let go (#1680's review).
        "[data-plan-gutter-dragging] &": { visibility: "hidden" },
        // The links themselves: the shared links layer's look (#1321).
        ...linkRibbons,
        // A link kind's link selected (#1541, U10): in the ink, whether or not it has a caption to outline.
        ...linkSelectedInk,
    },
    // The developer render region (R2) — fills the canvas below the
    // focused row (every other row hides for the focus); fades in once
    // the gather settles (the 300ms choreography).
    // The band an expanded row's OWN marks keep at the top of its plot
    // cell. Without it a 20px bar in a 200px row centres on the row and
    // drifts into the render; with it the marks position against their
    // natural height exactly as they do at rest. Only the height is
    // dynamic (the row's kind height) — the rest is fixed geometry.
    expandRowBand: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
    },
    // ── R2 developer render (#591) ──
    // Absolutely placed inside the FOCUSED ROW's plot cell, beneath the
    // band its own marks hold. Being in the plot cell is what puts it in
    // the canvas's x-space, so a time-based component lines up with the
    // buckets; being in the ROW is what lets the gutter grow with it.
    expandRenderBody: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "8px",
        minWidth: 0,
        overflow: "hidden",
        animation: "plan-settle-in 0.22s ease-out 0.3s backwards",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    },
    // The author's content in the grown gutter cell. Carries the gutter's
    // OWN sub-line vocabulary (mono 9.5 / medium / muted, stacked on 3px)
    // rather than inheriting body type — the expanded gutter is a
    // continuation of the row's identity, not a fresh surface, so plain
    // text dropped in here lands on the sheet without the author
    // restyling it. Settles in with the render on the same 300ms wait.
    expandGutterBody: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "3px",
        marginTop: "5px",
        minWidth: 0,
        overflow: "hidden",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "medium",
        // 1.35 of the face, in whole pixels (#1638): each line under the first starts on one.
        lineHeight: "13px",
        color: "fg.subtle",
        animation: "plan-settle-in 0.22s ease-out 0.3s backwards",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    },
    // ── R2 VALUE → TONE STRIP (#591) ──
    // What a chart or table row collapses to: one block per bucket, depth
    // tracking the value. A numeral and a 2px stroke are both illegible at
    // 7px, so the encoding changes rather than the size — into the
    // vocabulary a heat row already speaks.
    toneCell: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: "var(--plan-strip-mark-h)",
        borderRadius: "1px",
        zIndex: 2,
        // The value's depth, on the heat row's own steps (#949): the heat
        // ramp, a level counting from 0 and a step from 1.
        "&[data-level='0']": { background: "heat.1" },
        "&[data-level='1']": { background: "heat.2" },
        "&[data-level='2']": { background: "heat.3" },
        "&[data-level='3']": { background: "heat.4" },
        "&[data-level='4']": { background: "heat.5" },
        "&[data-tone='neg']": { background: "{colors.status.neg}", opacity: 0.85 },
        "&[data-tone='warn']": { background: "{colors.status.warn}", opacity: 0.9 },
        "&[data-nodata]": {
            backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 2px, color-mix(in srgb, {colors.fg} 10%, transparent) 2px 4px)",
        },
    },

    // ── Group band (26px) ──
    // No `alignItems: center` here — grid items must STRETCH so the plot
    // cell keeps the band's height and the collapsed summary strip's
    // absolute cells stay visible; the name cell centers its own content.
    // A heading that lies across the whole row — a links focus's band's —
    // is over its empty plot, which stays in the row's first line under it
    // for the now line (#1680's review).
    groupBand: {
        display: "grid",
        minHeight: "var(--plan-group-h)",
        background: "bg.panel",
        borderBottomWidth: "1px",
        borderBottomColor: "border.subtle",
        cursor: "pointer",
        // A nested group's band can be the last member of the one around it.
        "&[data-group-end]": { borderBottomColor: "border.strong" },
        "&:not([data-collapsed]) > [data-plan-band-plot]": { gridColumn: 2, gridRow: 1 },
        // A links focus's role band (#1680's review) opens nothing: no hand.
        "&[data-static]": { cursor: "default" },
        ...planRowFocus,
    },
    // A group band's name — the band caption, the one heading voice (only a
    // group's: a collapsible row keeps the row's, #1680's review). Its line is
    // 15px for whatever stands on it (#1638), centred in the band's 25px over
    // its rule. It is the rows' gutter grid, open or collapsed (#1749) — its
    // caret, its caption and meta in the name's cell, its status and value in
    // the value slot — so a band's words, its status and its value stand where
    // a row's do at its level. A heading that says no value — a links focus's
    // band's, the sticky parent's path (`data-across`) — lies across the whole
    // row instead, left to right, so nothing truncates.
    groupName: {
        ...timeHeaderText,
        lineHeight: HEADING_LINE,
        position: "relative",
        ...gutterGrid,
        padding: "0 12px",
        // The gutter's rule is not drawn on a band; its place is kept, so a
        // band's value slot ends where a row's does.
        borderRightWidth: "1px",
        borderRightColor: "transparent",
        whiteSpace: "nowrap",
        overflow: "hidden",
        // The caption and its meta: the name's cell, one line.
        "& > [data-plan-gutter='title']": nameCell,
        "&[data-across]": {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            gridColumn: "1 / -1",
            gridRow: 1,
            zIndex: 1,
        },
    },
    // The unit slot on a group band — the row metas' 10 / 400 label ink;
    // the group name's uppercase/tracking must NOT leak into it. It gives way
    // before the caption does, as a row's meta before its label (#1749): the
    // name's cell gives it what the caption leaves.
    groupMeta: {
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "normal",
        color: "fg.subtle",
        whiteSpace: "nowrap",
        textTransform: "none",
        letterSpacing: "normal",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    // What a links focus's role band with no rows says beside its caption —
    // `none` (#1680's review): the design system's word for a value that is
    // absent, at the meta's 10px, never the caption's capitals.
    focusNone: {
        textStyle: "absent",
        fontSize: "10px",
        whiteSpace: "nowrap",
        textTransform: "none",
        letterSpacing: "normal",
    },
    // A rule a links focus opens for its family's lanes (#1680's review): room between two rows, the rows' surface, the
    // gutter's rule down its gutter cell, and no rule of its own — the tracks run along it.
    laneBand: {
        display: "grid",
        background: "bg.surface",
        "& > [data-plan-lane-gutter]": { borderRightWidth: "1px", borderRightColor: "border.subtle" },
    },

    // ── Sticky parent (#823) ──
    // The group band's look, pinned under the header while the rows in view
    // belong to a parent whose own row has scrolled off — which section or
    // entry they are. Opaque, so rows never paint through it; its 1px rule
    // parts it from the row it covers — no shadow (the design system shadows
    // nothing but the focus ring). A click takes the reader to the parent's
    // row.
    stickyParent: {
        display: "grid",
        height: "var(--plan-group-h)",
        background: "bg.panel",
        borderBottomWidth: "1px",
        borderBottomColor: "border.subtle",
        cursor: "pointer",
        "&:hover": { background: "{colors.brandTint}" },
    },
    // An ancestor above the parent, on a deep tree — muted, then a separator.
    stickyPath: {
        color: "fg.subtle",
        flexShrink: 1,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        "&::after": { content: "'›'", marginLeft: "6px" },
    },
} satisfies Record<(typeof rowsSlots)[number], SystemStyleObject>;
