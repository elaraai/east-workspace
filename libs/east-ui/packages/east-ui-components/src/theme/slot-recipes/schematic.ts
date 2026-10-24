/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Schematic slot recipe — the 2D canvas in its builder frame (#1387,
 * `Schematic Builder Spec.md` §6, "The canvas's theme and styles"): the root
 * the frame fills; the canvas filling main, the layer of the area its reads
 * have not drawn yet (#1398) under its metric grid, its paint layer and its
 * card layer; the item cards (icon · label · status dot · meter · metric),
 * each role its details give a placeholder's host while they are read
 * (`data-pending`), and the card a drop lands on (#1390); the zoom and marquee boxes; a refused connection's caption, the
 * shared drag caption placed on the canvas (#1388); the scale bar and the minimap, which
 * stay on the canvas; the theme bridge's probe; the toolbar's tool controls
 * and the View popover's; the library's tabs (#1389) — a tab's body, the
 * Index's search and its tree rows (the design system's tree row), and the
 * Layers tab's rows (its pick-panel row), each layer's swatch in the colour
 * chain, and its Show all; and the footer, on the shared `builder-footer`
 * rail, which never wraps: its live notices one item of it, wrapping within
 * itself and its items their words where it is narrow, beside the shared
 * loading line (#1398). The canvas holds no control of its own: what was its control column
 * is the frame's toolbar, and its navigator and layer panel are the library's
 * Index and Layers tabs.
 *
 * Every colour is a design-system token. An entity's colour — a card's status
 * dot here, and the same entity's marks on the canvas, which the theme bridge
 * reads through the `probe` slot — is one chain of custom properties set from
 * its data attributes: its `color` (a theme colour token, D14), else its
 * `tone`, else its status's, else its pattern's, else its surface's ground.
 * A value naming no theme colour token sets nothing, so it draws its tone. The
 * renderer sets data attributes and geometry; this recipe owns every style.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";
import { fontAwesomeSize } from "../icon-size.js";
import { semanticTokens } from "../semantic-tokens.js";
import { builderFooter, builderFooterItem } from "./builder-footer.js";
import { linkRibbons } from "./links/ribbons.js";
import { schedulePaneBase } from "./schedule-pane.js";

/** The theme's colour groups that hold no design-system role: Chakra's own hues' hovers, and the translucent overlays. */
const NO_ROLE: ReadonlySet<string> = new Set(["gray", "red", "orange", "yellow", "green", "teal", "blue", "cyan", "purple", "pink", "overlay"]);

/**
 * The colour tokens of a group of the theme's semantic tokens, by name: a
 * group's `DEFAULT` is the group's own name, and a key holding a dot
 * (`bg["brand.subtle"]`) is part of the name as written.
 *
 * @param tree - The group
 * @param prefix - The group's name; empty at the top
 * @returns Every token's name
 */
function colourTokens(tree: Readonly<Record<string, unknown>>, prefix: string): string[] {
    return Object.entries(tree).flatMap(([key, node]) => {
        if (prefix === "" && NO_ROLE.has(key)) return [];
        const name = key === "DEFAULT" ? prefix : prefix === "" ? key : `${prefix}.${key}`;
        if (node !== null && typeof node === "object" && "value" in node) return [name];
        return node !== null && typeof node === "object" ? colourTokens(node as Readonly<Record<string, unknown>>, name) : [];
    });
}

/**
 * The theme colour tokens an author's colour may name (D14) — `status.warn`,
 * `heat.3`, `brand.solid`, `fg.muted` — each a design-system role's token or
 * its alias. A colour naming none of them draws its entity's tone.
 */
const COLOR_TOKENS: readonly string[] = colourTokens(semanticTokens.colors as Readonly<Record<string, unknown>>, "");

/**
 * The theme colour tokens an author's colour may name (D14), as the colour
 * chain resolves them: what the Schematic's Issues tab holds an entity's or a
 * layer's colour to (#1391) — one naming none of them draws its tone.
 */
export const schematicColorTokens: readonly string[] = COLOR_TOKENS;

/** A tone's token (`Schematic.Types.Tone`), as an item, a link and a layer draw it. */
const TONE_TOKENS: Readonly<Record<string, string>> = {
    brand: "brand.solid", ink: "fg", muted: "fg.muted", success: "status.pos", warning: "status.warn", danger: "status.neg",
};

/** A tone's token as a zone draws it: its muted is the rule's heavier ink (§4.2). */
const ZONE_TONE_TOKENS: Readonly<Record<string, string>> = { ...TONE_TOKENS, muted: "border.strong" };

/** A status case's token (`StatusToken`): info is the design system's own blue, never the brand's. */
const STATUS_TOKENS: Readonly<Record<string, string>> = {
    success: "status.pos", warning: "status.warn", danger: "status.neg", info: "status.info", neutral: "fg.muted",
};

/** One custom property set from one data attribute's values. */
const byAttribute = (attribute: string, property: string, tokens: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(tokens).map(([value, token]) => [`&[${attribute}="${value}"]`, { [property]: `{colors.${token}}` }]));

/**
 * The colour chain's custom properties, set on the element whose data
 * attributes name an entity's colour: `data-color` (a theme colour token),
 * `data-tone`, `data-status`, `data-pattern` (a zone's pattern's tone) and
 * `data-surface` (`item`, `zone` or `link`), whose ground is the colour when
 * none of the others names one. Each is reset on the element itself, so none
 * is inherited from an ancestor.
 */
const TINT_PROPERTIES = {
    "--schematic-color": "initial",
    "--schematic-tone": "initial",
    "--schematic-status": "initial",
    "--schematic-pattern": "initial",
    "--schematic-ground": "{colors.fg.muted}",
    ...Object.fromEntries(COLOR_TOKENS.map((token) => [`&[data-color="${token}"]`, { "--schematic-color": `{colors.${token}}` }])),
    ...byAttribute("data-tone", "--schematic-tone", TONE_TOKENS),
    "&[data-surface=zone]": { "--schematic-ground": "{colors.border.strong}", ...byAttribute("data-tone", "--schematic-tone", ZONE_TONE_TOKENS) },
    ...byAttribute("data-status", "--schematic-status", STATUS_TOKENS),
    ...byAttribute("data-pattern", "--schematic-pattern", ZONE_TONE_TOKENS),
};

/** An entity's colour: its colour token, else its tone, else its status's, else its pattern's, else its surface's ground. */
const TINT = "var(--schematic-color, var(--schematic-tone, var(--schematic-status, var(--schematic-pattern, var(--schematic-ground)))))";

/** The design-system tokens the canvas's own marks draw in, by the role the theme bridge reads each as. */
const PALETTE_ROLES: Readonly<Record<string, string>> = {
    brandMark: "brandMark", brandSolid: "brand.solid", brandTint: "brandTint",
    fg: "fg", fgStrong: "fg.strong", fgMuted: "fg.muted", fgSubtle: "fg.subtle", fgFaint: "fg.faint",
    bgSurface: "bg.surface", bgCanvas: "bg.canvas",
    borderSubtle: "border.subtle", borderStrong: "border.strong",
    statusPos: "status.pos", statusNeg: "status.neg", statusWarn: "status.warn", statusInfo: "status.info",
    heat1: "heat.1", heat2: "heat.2", heat3: "heat.3", heat4: "heat.4", heat5: "heat.5",
    // The placeholders' fill (#1398): the Skeleton's static `--paper-3`, a marker whose status is unread.
    bgSubtle: "bg.subtle",
};

export const schematicSlotRecipe = defineSlotRecipe({
    className: "elara-schematic",
    slots: [
        "root", "canvas", "washLayer", "paint", "grid", "cardLayer",
        "item", "itemHead", "itemIcon", "itemLabel", "statusDot",
        "itemSublabel", "meterTrack", "meterFill", "itemMetric",
        "selectBox", "selectBoxCount", "draftCaption", "scaleBar", "scaleRuler", "scaleLabel",
        "minimap", "minimapPaint", "minimapViewport",
        "probe", "tools", "viewControls",
        "libraryPane", "indexSearch", "indexTree", "indexRows", "indexRow", "indexChevron", "indexName", "indexCount", "indexDot", "indexMetric", "indexEmpty",
        "layerList", "layerRow", "layerSwatch", "layerName", "layerCount", "layerToggles", "layerToggle", "layerFoot",
        "footer", "footerNotices", "footerItem",
    ],
    base: {
        /* Fills the box it is given and draws no border: the frame inside it
         * fills it in turn (#1387). */
        root: {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            minWidth: "0",
            minHeight: "0",
            position: "relative",
        },
        /* The canvas fills main: its world is fitted to the box main gives it.
         * The cursor follows the tool held — a box tool's crosshair, Move's
         * move, a connection the veto refuses not-allowed — and a keyboard's
         * focus wears the inset ring, inside main's clip. */
        canvas: {
            position: "relative",
            flex: "1",
            minWidth: "0",
            minHeight: "0",
            background: "bg.canvas",
            overflow: "hidden",
            cursor: "grab",
            touchAction: "none",
            userSelect: "none",
            "&:active": { cursor: "grabbing" },
            '&[data-tool="zoom"], &[data-tool="marquee"], &[data-tool="connect"]': { cursor: "crosshair", "&:active": { cursor: "crosshair" } },
            '&[data-tool="move"]': { cursor: "move", "&:active": { cursor: "move" } },
            "&[data-forbidden]": { cursor: "not-allowed", "&:active": { cursor: "not-allowed" } },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
            /* The canvas is the Schematic's one drop cell (#1390): its own marks
             * — a zone's tint, a link's wash, a ring round a marker or a point, a
             * card's brand — stand in for the shared stage's frame and wash over
             * the whole floor, so the stage keeps only its not-allowed cursor
             * where a drop is refused; the ghost's red caption says why. */
            "&[data-drag-cell][data-drop-valid]::before, &[data-drag-cell][data-drop-active]::before, &[data-drag-cell][data-drop-invalid]::before": { content: "none" },
            "&[data-drag-cell][data-drop-active], &[data-drag-cell][data-drop-invalid]": { background: "bg.canvas" },
            "&[data-drag-cell][data-drop-invalid]": { cursor: "not-allowed", "&::after": { content: "none" } },
        },
        /* The area the canvas's reads have not drawn yet (#1398, CL2): the shared region wash, each box placed by the
         * camera's custom properties, as the cards are — the lowest layer, under the grid, the paint and the cards, so
         * the rules and every item drawn stand over it — clipped to the canvas, taking no pointer. */
        washLayer: {
            position: "absolute",
            inset: "0",
            overflow: "hidden",
            pointerEvents: "none",
        },
        /* The paint layer: the Canvas2D surface over the grid. */
        paint: {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
        },
        /* Metric grid per the spec's floor canvas — minor lines with a
         * heavier major rule; the major cell equals the scale legend. The
         * grid is the ground layer of the canvas contrast hierarchy
         * (ground ⇢ annotation ⇢ content): felt, never read. */
        grid: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            backgroundImage: `
                linear-gradient(to right, color-mix(in oklch, {colors.border.strong} 30%, transparent) 1px, transparent 1px),
                linear-gradient(to bottom, color-mix(in oklch, {colors.border.strong} 30%, transparent) 1px, transparent 1px),
                linear-gradient(to right, color-mix(in oklch, {colors.border.subtle} 22%, transparent) 1px, transparent 1px),
                linear-gradient(to bottom, color-mix(in oklch, {colors.border.subtle} 22%, transparent) 1px, transparent 1px)`,
        },
        /* Holds the live `--cam-ppu` / `--cam-tx` / `--cam-ty` custom
         * properties (written by applyCamera each frame). Transparent and
         * click-through; each card re-enables its own pointer events so the
         * full-cover layer never swallows canvas clicks (issue #57). */
        cardLayer: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
        },
        /* An item's card at card zoom. Its layer's opacity is the layer's
         * own (`--schematic-layer-opacity`); a card on a locked layer takes
         * no pointer, so a click falls through to what lies beneath. A card
         * the rail's narrowing draws as context (#1392) fades to the opacity
         * its `narrowed` gives (`--schematic-context-opacity`), drained of
         * colour while it says so, and takes no pointer either. It is no
         * wider than the card layer's widest card (`--schematic-card-max`,
         * the canvas's figure, which a kind read by area pads its window by,
         * #1393), its words ending in an ellipsis; one at its item's own
         * width (`data-boxed`) is held to that instead. */
        item: {
            position: "absolute",
            transform: "translate(-50%, -50%)",
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            paddingX: "{spacing.2}",
            paddingY: "{spacing.1}",
            minWidth: "84px",
            "&:not([data-boxed])": { maxWidth: "var(--schematic-card-max)" },
            cursor: "pointer",
            opacity: "calc(var(--schematic-layer-opacity, 1) * var(--schematic-context-opacity, 1))",
            "&[data-locked]": { pointerEvents: "none" },
            "&[data-context]": { pointerEvents: "none" },
            "&[data-context][data-desaturate]": { filter: "grayscale(1)" },
            /* Selected, a card draws over the cards beside it: a pick from Find, or a selected item the declutter lets
             * take its card where its neighbours' stand (#1393). */
            "&[data-selected]": {
                outline: "2px solid",
                outlineColor: "fg",
                outlineOffset: "-1px",
                zIndex: "1",
            },
            /* Emphasis: a matched card gets a brand ring. `halo` is a static
             * ring; `pulse` breathes — its ring width tracks the `--pulse` var
             * (0..1) the animation loop writes on the card layer each frame. */
            "&[data-emphasis]": {
                borderColor: "{colors.brand.solid}",
                boxShadow: "0 0 0 2px color-mix(in oklch, {colors.brand.solid} 35%, transparent)",
            },
            "&[data-emphasis=pulse]": {
                boxShadow: "0 0 0 calc(2px + var(--pulse, 0) * 5px) color-mix(in oklch, {colors.brand.solid} calc(45% - var(--pulse, 0) * 25%), transparent)",
            },
            /* canConnect veto (#176): the hovered FORBIDDEN target rings danger
             * while a connect draft is over it (dot/label rings are canvas). */
            "&[data-forbidden]": {
                borderColor: "{colors.status.neg}",
                boxShadow: "0 0 0 2px color-mix(in oklch, {colors.status.neg} 45%, transparent)",
            },
            /* A drop's target (#1390): the card a dragged library card would
             * land on — the brand's tint on its paper and the brand's solid
             * edge, 2px as the Flowchart's drop target's, the mark the canvas
             * paints round a marker, a zone or a link; a selected card's ring
             * takes the brand while it is one. */
            "&[data-drop-target]": {
                background: "brandTint",
                borderColor: "{colors.brand.solid}",
                boxShadow: "0 0 0 1px {colors.brand.solid}",
                outlineColor: "{colors.brand.solid}",
            },
        },
        itemHead: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
        },
        itemIcon: {
            color: "fg.muted",
            fontSize: "label.sm",
            flexShrink: "0",
        },
        /* The label gives way in its head's row, so a card held to its width ends it in an ellipsis. */
        itemLabel: {
            minWidth: "0",
            fontFamily: "mono",
            fontSize: "label.lg",
            fontWeight: "semibold",
            color: "fg",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* The card's dot: the item's colour — its colour token, its tone, or
         * its status's — the colour its marker and its footprint draw in on
         * the canvas (D14, SC26). A ring status — a tentative one — is an
         * open ring in it (#1386). */
        statusDot: {
            ...TINT_PROPERTIES,
            width: "7px",
            height: "7px",
            borderRadius: "{radii.full}",
            marginLeft: "auto",
            flexShrink: "0",
            background: TINT,
            "&[data-ring]": { background: "transparent", boxShadow: `inset 0 0 0 1.5px ${TINT}` },
            /* Its status unread (#1398): the placeholder's fill in its place, at its size, and no colour of its own. */
            "&[data-pending]": { background: "transparent" },
        },
        itemSublabel: {
            fontFamily: "mono",
            fontSize: "label.xs",
            letterSpacing: "0.08em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            /* Its details read (#1398): a bar in its place, one line of its own height, so the card stays its size. */
            "&[data-pending]": { display: "flex", alignItems: "center", minHeight: "1lh" },
        },
        meterTrack: {
            height: "4px",
            background: "bg.subtle",
            borderRadius: "{radii.full}",
            overflow: "hidden",
            /* Its details read (#1398): the placeholder's fill in the track, unseen until the reveal — no empty bar. */
            "&[data-pending]": { background: "transparent" },
        },
        meterFill: {
            height: "100%",
            background: "brandMark",
            borderRadius: "{radii.full}",
        },
        itemMetric: {
            fontFamily: "mono",
            fontSize: "label.sm",
            color: "fg.muted",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            /* Its details read (#1398): a short bar in its place, one line of its own height, so the card stays its size. */
            "&[data-pending]": { display: "flex", alignItems: "center", minHeight: "1lh" },
        },
        /* The zoom box (#153) and the marquee (#159): a brand edge around an
         * area fill — the design system's `--brand-tint` at 0.7 — dashed for
         * the zoom box, solid for the marquee. */
        selectBox: {
            position: "absolute",
            pointerEvents: "none",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "{colors.brand.solid}",
            background: "color-mix(in oklch, {colors.brandTint} 70%, transparent)",
            borderRadius: "{radii.xs}",
            zIndex: "5",
            "&[data-mode=marquee]": { borderStyle: "solid" },
        },
        /* The marquee's live count, pinned to its top-left corner (#159). */
        selectBoxCount: {
            position: "absolute",
            top: "0",
            left: "0",
            transform: "translate(-2px, -50%)",
            fontSize: "label.lg",
            fontWeight: "semibold",
            lineHeight: "1",
            paddingInline: "{spacing.1.5}",
            paddingBlock: "{spacing.1}",
            borderRadius: "{radii.sm}",
            background: "{colors.brand.solid}",
            color: "brand.contrast",
            pointerEvents: "none",
        },
        /* A refused connection's caption (#1388, SC9): the shared drag caption
         * (`[data-drag-caption][data-refused]`, the theme's global part) under
         * the item the draft would end at, its place the camera's, as a card's
         * is — clear of the card, over the cards, taking no pointer. */
        draftCaption: {
            position: "absolute",
            left: "0",
            top: "0",
            translate: "-50% 20px",
            pointerEvents: "none",
            zIndex: "4",
        },
        /* Map-style ruler at the canvas's bottom-right — a bare bottom bracket
         * with quarter ticks and the distance floating above it; a text halo
         * keeps it legible (the Mapbox convention). */
        scaleBar: {
            position: "absolute",
            right: "{spacing.3}",
            bottom: "{spacing.2}",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0px",
            pointerEvents: "none",
            height: "20px",
            background: "bg.surface",
            borderColor: "border.subtle",
            borderRadius: "{radii.xs}",
            padding: "2px",
        },
        scaleRuler: {
            display: "block",
            "& path": {
                stroke: "{colors.fg.muted}",
                strokeWidth: "1px",
            },
        },
        scaleLabel: {
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "semibold",
            letterSpacing: "0.08em",
            lineHeight: "1",
            textTransform: "uppercase",
            color: "fg.muted",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            textShadow: "0 0 3px {colors.bg.canvas}, 0 0 3px {colors.bg.canvas}, 0 0 2px {colors.bg.canvas}",
        },
        minimap: {
            position: "absolute",
            left: "{spacing.2}",
            bottom: "{spacing.2}",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            overflow: "hidden",
            cursor: "pointer",
        },
        /* The minimap's paint (#1393): the zones, each kind read by area's whole drawing's density and the items' dots, as
         * the canvas's own paint layer draws them — under the viewport's box. */
        minimapPaint: {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
        },
        minimapViewport: {
            position: "absolute",
            borderWidth: "1.5px",
            borderColor: "{colors.brand.solid}",
            background: "color-mix(in oklch, {colors.brandTint} 70%, transparent)",
            pointerEvents: "none",
        },
        /* The theme bridge's probe (`canvas/theme.tsx`): hidden elements the
         * canvas reads its colours and its fonts from, each named by a data
         * attribute — a role of its own marks (`data-role`), a font
         * (`data-font`), or an entity's colour, through the cards' chain
         * (`data-tint`) — so the canvas draws what the recipe says. Its links
         * (#1403) draw in the shared links part, merged here as the Plan's rows
         * and the Allocation's board merge it, over the part's own elements the
         * probe holds: the Schematic's links read what the Plan's draw with. */
        probe: {
            ...linkRibbons,
            position: "absolute",
            width: "0",
            height: "0",
            overflow: "hidden",
            pointerEvents: "none",
            ...Object.fromEntries(Object.entries(PALETTE_ROLES).map(([role, token]) => [`& [data-role="${role}"]`, { color: token }])),
            /* The canvas's labels — a labelled pin's — and a zone's eyebrow, in the mono face. */
            '& [data-font="label"]': { fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold" },
            '& [data-font="eyebrow"]': { fontFamily: "mono", fontSize: "label.xs", fontWeight: "semibold" },
            "& [data-tint]": { ...TINT_PROPERTIES, color: TINT },
        },
        /* The toolbar's tools: the tool strip, and Connect's menu of the link kinds it draws. */
        tools: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
        },
        /* The View popover's controls (§6.1): the phone's tools, zoom, Fit and steps, over Find's box. */
        viewControls: {
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: "{spacing.2}",
            marginBottom: "{spacing.3}",
        },
        /* A library tab's body (#1389): its pane's height, its parts scrolling inside it. */
        libraryPane: schedulePaneBase.pane,
        /* The Index's search row: the Library's search box over the tree, a hairline under it. */
        indexSearch: {
            flexShrink: "0",
            display: "flex",
            alignItems: "center",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
        },
        /* The Index's tree, around its rows' scroll box: it takes the focus and points at its active row, which wears
         * the inset ring while the keyboard has it. */
        indexTree: {
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            outline: "none",
            "&:focus-visible [data-active]": { boxShadow: "focusInset" },
        },
        /* Its rows' scroll box: the shared virtual rows', which the rows' offsets are measured from. */
        indexRows: {
            position: "relative",
        },
        /* A row of the Index (the design system's tree row): 36px, no rule — the indent carries the structure,
         * 24px a level (`--index-depth`, its geometry); a zone's name 500, an item's 400 with its dot; hover the
         * second paper, selected the third, the zone in view in the strong ink. */
        indexRow: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            width: "100%",
            minHeight: "36px",
            paddingLeft: "calc({spacing.3} + var(--index-depth, 0) * 24px)",
            paddingRight: "{spacing.3}",
            background: "transparent",
            color: "fg",
            fontSize: "body",
            textAlign: "left",
            cursor: "pointer",
            _coarse: { minHeight: "44px" },
            _hover: { background: "bg.canvas" },
            "&[data-selected]": { background: "bg.subtle" },
            "&[data-index-zone]": { fontWeight: "medium" },
            "&[data-current] [data-index-name]": { color: "fg", fontWeight: "semibold" },
        },
        /* A zone's chevron: Font Awesome's angle-right, 14 in its 16 slot, turning a quarter while open. */
        indexChevron: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "16px",
            flexShrink: "0",
            color: "fg.muted",
            background: "transparent",
            cursor: "pointer",
            ...coarseHitArea({ position: true }),
            "& svg": { ...fontAwesomeSize("14px"), transitionProperty: "transform", transitionDuration: "fast", transitionTimingFunction: "ease-in-out" },
            "&[data-open] svg": { transform: "rotate(90deg)" },
            "&[data-leaf]": { visibility: "hidden" },
        },
        indexName: {
            flex: "1",
            minWidth: "0",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* A zone's count: the design system's Count, 16 tall on the third paper, the first on a selected row. */
        indexCount: {
            display: "inline-flex",
            alignItems: "center",
            height: "16px",
            paddingX: "4px",
            flexShrink: "0",
            background: "bg.subtle",
            borderRadius: "{radii.sm}",
            fontFamily: "mono",
            fontSize: "label.sm",
            fontWeight: "semibold",
            fontVariantNumeric: "tabular-nums",
            lineHeight: "1",
            color: "fg.strong",
            "[data-selected] &": { background: "bg.surface" },
        },
        /* An item's dot: its colour, as its card's is, in the row's flow. */
        indexDot: {
            ...TINT_PROPERTIES,
            width: "7px",
            height: "7px",
            flexShrink: "0",
            borderRadius: "{radii.full}",
            background: TINT,
            "&[data-ring]": { background: "transparent", boxShadow: `inset 0 0 0 1.5px ${TINT}` },
        },
        /* An item's figure, at the row's end. */
        indexMetric: {
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "label.sm",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
        },
        indexEmpty: {
            flex: "1",
            minHeight: "0",
            overflowY: "auto",
        },
        /* The Layers tab (the design system's pick-panel rows): a row of 44 at least, a hairline between — on a touch
         * screen 44 exactly, its toggles' squares filling it. */
        layerList: {
            flex: "1",
            minHeight: "0",
            overflowY: "auto",
        },
        layerRow: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minHeight: "44px",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
            _last: { borderBottomWidth: "0" },
            _hover: { background: "bg.canvas" },
            _coarse: { paddingY: "0" },
        },
        /* A layer's swatch: its colour token, else its tone — the colour chain the cards' dots draw in. */
        layerSwatch: {
            ...TINT_PROPERTIES,
            width: "10px",
            height: "10px",
            flexShrink: "0",
            borderRadius: "{radii.xs}",
            background: TINT,
        },
        /* Its name, 600 while shown and the faint ink and 500 while hidden — no opacity, so every part holds its contrast. */
        layerName: {
            flex: "1",
            minWidth: "0",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: "body.sm",
            fontWeight: "semibold",
            color: "fg",
            "[data-hidden] &": { fontWeight: "medium", color: "fg.subtle" },
        },
        layerCount: {
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "medium",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            "[data-hidden] &": { color: "fg.subtle" },
        },
        /* Isolate, Lock and Show or Hide, side by side — on a touch screen edge to edge, each square its own target. */
        layerToggles: {
            display: "inline-flex",
            alignItems: "center",
            flexShrink: "0",
            gap: "{spacing.2}",
            _coarse: { gap: "0" },
        },
        /* Each a glyph of 12 in a 24 button, the brand's while on; a 44 square on a touch screen. */
        layerToggle: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "24px",
            height: "24px",
            flexShrink: "0",
            color: "fg.subtle",
            background: "transparent",
            borderRadius: "{radii.sm}",
            cursor: "pointer",
            "& svg": fontAwesomeSize("12px"),
            _coarse: { width: "44px", height: "44px" },
            _hover: { color: "fg", background: "bg.subtle" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            "&[data-on]": { color: "brand.solid" },
        },
        /* Show all, under the rows while a layer is hidden. */
        layerFoot: {
            flexShrink: "0",
            display: "flex",
            justifyContent: "flex-end",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderTopWidth: "1px",
            borderColor: "border.subtle",
        },
        /* The footer, on the shared builder rail (§6.3), holding only what is live; why the last gesture was refused in the
         * danger ink (#1388). The rail carries the shared loading line (#1398), so it never wraps: its notices are one item
         * of it, taking what the line leaves, which wraps within itself where it is narrow — and there an item wider than
         * it, a density's words on a phone (#1393), wraps its own words, as `useRailWrap` lets it. */
        footer: builderFooter,
        footerNotices: {
            display: "flex",
            alignItems: "center",
            flex: "1 1 auto",
            minWidth: "0",
            gap: "var(--builder-footer-gap)",
            "&[data-builder-narrow]": { flexWrap: "wrap", paddingY: "6px", rowGap: "2px", columnGap: "10px" },
        },
        footerItem: {
            ...builderFooterItem,
            "[data-builder-narrow] > &": { flexShrink: 1, minWidth: 0, whiteSpace: "normal" },
            "&[data-schematic-refused]": { color: "fg.danger" },
        },
    },
});
