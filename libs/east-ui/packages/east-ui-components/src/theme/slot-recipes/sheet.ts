/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sheet slot recipe — the planning spreadsheet's visual vocabulary
 * (`Sheet Spec.md` §7, B§11), every value a semantic token so the dark theme
 * comes for free.
 *
 *   - Root and card: the sheet fills its frame's main region, and the card
 *     the room the strip leaves, its rows scrolling there (#1216).
 *     `bg.surface`, no border of its own (the host frames a component, as
 *     with Plan); 120 px bottom pad. One rule per seam: the header
 *     `border.strong` below, the strip and the footer `border.subtle` above.
 *   - Header: sticky, two lines — label mono 10/600/.16em uppercase
 *     `fg.subtle`; sub mono 9 `fg.subtle` ellipsised; 1 px `border.subtle`
 *     column dividers; `border.strong` bottom.
 *   - Gutter: 128 px = rail 28 ·
 *     number 36 · actions 64, the gutter edge `border.strong`. The number
 *     column grows to the widest number the sheet shows, measured in the
 *     number's own face (`--sheet-number`, the renderer's geometry), and
 *     every width built on the gutter grows with it — the rows, the header,
 *     the sub rows, the seam lines, the bands and the fold. Rail: a 14 px
 *     r-3 checkbox (1 px ink-5, hover ink-3, checked `brand.solid`, mixed
 *     ink-4) on a 1 px ink-5 connector that turns brand through picked rows.
 *     Number: mono 11/500 right-aligned, ink-4 (ink 600 when picked); a
 *     line's number keeps 18 px clear of its sub rows' chevron. Actions:
 *     24 px ghost buttons, Font Awesome 13 px ink-4, colour only on hover as an
 *     8 % wash (check pos · xmark neg · arrow-right brand). Inserts are not
 *     gutter content: a seam in the gutter is only a hit strip; the hovered
 *     seam's two 24 px outlined chips (plus · layer-group) sit in the sheet's
 *     one insertion layer, over the rows and under the pinned header, threaded
 *     on a 2 px brand insertion line. States:
 *     hover `bg.panel` · picked `brandTint` · group band `bg.panel` · dirty 8 %
 *     warn. A group's identity is its band and the connector — no per-group colour.
 *   - Rows: density height including the 1 px bottom rule. Cells leave room
 *     for that rule, with padding 6/10 and a 1 px `border.subtle` right edge;
 *     text 13 `fg`; mono values 12; ghosts `fg.subtle`; unit mono 9.5.
 *   - Selection: 2 px brand ring inside the cell; range wash brandTint at
 *     .55; the editor overlays at inset −1 with a 2 px ring (z 10); a parse
 *     error ring in the neg hue (z 11). The ring IS the field chrome: the
 *     common fields it holds (the date field's segments, the number field
 *     and its stepper column, the text input) drop their own border and
 *     focus ring inside it.
 *   - Strip: `bg.panel` band as tall as a row (`density.row`), 4/20 padding;
 *     label mono 10/600/.13em uppercase brand; chips mono 12 (armed: 600 on
 *     brandTint + inset ring); the chips page rather than
 *     scroll or clip: `‹ 1/3 ›` ghost chevrons at the row's end, the count
 *     mono 10.5 tabular; meta mono 11 (ellipsis past a third of the band).
 *   - Footer: the shared rail's 28 px, 12 px side padding, as every builder's
 *     (ruled 23 Oct 2026, #1398), so the loading line, coming and going, never
 *     moves it; counts mono 11; key hint mono 10, each of its hints whole — a
 *     rail too narrow ends them at a whole hint, then "…"; message mono 10.5
 *     right-aligned, the shared loading line after it.
 *   - Tabs: 28 px — as tall as every control in the toolbar's row
 *     (`toolbar-row.ts`, ruled 23 Oct 2026) — mono 10.5/600/.12em uppercase;
 *     active `inset 0 -2px 0` ink; counts `fg.subtle`; dirty dot 5 px brand;
 *     × 14 px → neg; `+ TAB` 28 px r-sm 1 px `border.strong` mono 9.5/600. A
 *     tab, `+n` and `+ TAB` reached by the keyboard take a 2 px brand ring
 *     inside themselves — the strip clips its overflow sideways (#860).
 *     Folded into one chip (#1221), the strip is the open view's tab with a
 *     caret.
 *   - A row that could not be drawn is one row of `fg.danger` mono on the
 *     invalid row's wash.
 *   - Runs (#1398, CL2): rows not drawn yet — a paged source's unloaded run,
 *     a stretch the lens is reading, a window whose read failed — are the
 *     shared `UnloadedRun` on the rows' own geometry: rows at the density's
 *     pitch on the surface, each with its 1 px rule (`runRow`); the gutter
 *     as a row's — rail · number · actions, sticky, the gutter edge
 *     `border.strong`, the real row number in the number column
 *     (`runGutter`); each column's cell with its right rule and the cells'
 *     padding (`runCell`); a grouped run's band on the band's panel, past the
 *     gutter as a group band's chevron is (`runBand`). A failed run's line
 *     stays beside the gutter as the columns scroll sideways.
 *   - A group's band (#740, G1): 40 px `bg.panel`, no extra top rule,
 *     `border.subtle` below (`border.strong` when folded); Font Awesome's
 *     chevron-right in a 10 px square (#1263), ink-3; count mono 10; title
 *     body 13/600 `fg` over the eyebrow mono 9.5 uppercase .08em
 *     `fg.subtle`; band cells mono 11 `fg.muted`. Membership is shown by
 *     markers and rails in the gutter.
 *   - A line's SUB ROWS (#844): the same 10 px
 *     chevron before the line's number, ink-3, down when open. Open, the
 *     tree's stem (1 px `border.strong`) starts just under the chevron and
 *     runs down through the sub rows, an elbow of 10 px into each, the last
 *     one's stem stopping at its middle. A sub row is at least 30 px with a
 *     `border.subtle` rule below; it shares none of the line's columns: its
 *     gutter stays on the surface (the group's rail through it, the tree, the
 *     index `{line}.{n}` mono 11 ink-4 tabular), then ONE grey well spans the
 *     rest — `bg.panel` (a step up from the surface in the dark, where the
 *     panel is the surface), a step darker on hover, padding 5/12/5/14; its
 *     content stays beside the gutter as the columns scroll sideways. The
 *     well is a flex row, gap 20: the LEAD, 220 px — a code mono
 *     11/600/.04em ink (an operation's code, or a word for what the row is:
 *     `LABOUR` · `EQUIPMENT`) then its name 12.5 ink-2, which runs on past the 220 px when no detail
 *     sits beside it; the DETAIL, which wraps (gap 6/18) and grows the row,
 *     never truncated — chips (mono 11 ink-2, `border.strong` r-sm on the
 *     surface), then facets (label mono 9.5/600 uppercase ink-4, value 12.5
 *     ink-2); and the ID pinned right, mono 11 ink-4. Every line box in the
 *     well is whole pixels (a chip 19, a line of text 18), so a sub row, one
 *     line or wrapped, is whole pixels tall and the rows under it stay on the
 *     pixel grid. While
 *     an open line's sub rows scroll under the group's band, a copy of the line
 *     sticks under the band, `border.strong` below like the band's own copy,
 *     and its last sub row pushes it up as it leaves.
 *   - Layering: the sheet isolates its stacking, and so does every row, so a
 *     row's layers (the ring, the editor, the sticky gutter) never reach past
 *     it and nothing inside the sheet reaches past the sheet — a drawer or a
 *     dialog that hosts it layers as it always does. Popups (the enum menu)
 *     portal out through Chakra's own layering.
 *   - Motion, only after a gesture that folds or opens: the
 *     chevron turns (180 ms), the rows slide to their new places (240 ms, the
 *     root's `data-moving`), and the rows it brings into view drop in 6 px
 *     and fade up in a short cascade (`useArrival`, 220 ms, 16 ms apart). The
 *     lens, a view switch and a scroll move nothing; reduced motion turns it
 *     all off.
 *   - A date read at a level (#844) prints its resolution as a tag at the
 *     cell's right edge; once its actual is known the tag says `actual`
 *     ink-5 in capitals like the resolution tags; a delta (`+1d` · `−3h`)
 *     keeps its lowercase, late warn, early info.
 *   - A phone (the adaptive contract, #346): the grid scrolls sideways under
 *     a gutter that stays put (`position: sticky`), the frame's toolbar keeps
 *     its one row through its ladder — on a coarse pointer its controls (the
 *     tabs, `+n`, `+ TAB`, the active tab's ×) keep their size and take a
 *     44 px tap target from their halos (#1221) — and in the grid the small
 *     controls grow (gutter buttons, ✓ take, the strip's chips), and the
 *     editor's type goes to 16 px so a phone never zooms into it.
 *   - Drag and drop (#1187): a grip leads the actions column — a
 *     14 px `grip-vertical` in the faintest ink, shown on the row's hover
 *     and always where nothing hovers, a 32 px halo on a coarse pointer; the
 *     row it lifts takes a 1 px brand inset ring, and its ghost is the
 *     library card's (13/600 on the paper in a brand ring). No row lights as
 *     a candidate: where a template or a moved row would land, the 2 px
 *     brand insertion line runs along the seam (`data-drop-seam`); the row
 *     an author's card lands on takes the brand wash and the layer's 2 px
 *     frame; a row that refuses the drop, the invalid wash and the layer's
 *     red frame. The row a drag rests on takes no hover — not its cells,
 *     its gutter, its checkbox or its grip — so what it says is the drop's.
 *   - A folded gutter (#1215): on a coarse pointer, a frame too narrow for
 *     the touch gutter beside a cell folds it to rail 28 · number · one
 *     44 px row-actions button (`data-gutter="folded"` on the card) — a
 *     `ellipsis-vertical` ghost, brand on the copilot's anchor and while its
 *     menu is open, and the row's grip at once: it takes no scroll gesture.
 *     The seam lines start at the gutter's edge wherever it is
 *     (`--sheet-gutter`, the renderer's geometry).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";
import { fieldInRingedControl } from "../field-chrome.js";
import { TOOLBAR_CONTROL_HEIGHT } from "../toolbar-row.js";
import { FOOTER_FIT } from "./builder-footer.js";
import { schedulePaneBase } from "./schedule-pane.js";

export const sheetSlotRecipe = defineSlotRecipe({
    className: "elara-sheet",
    slots: [
        "root", "frame", "card", "body",
        "insertPoint", "insertLayer", "insertChips", "insertButton", "insertStrip", "insertChoice",
        "pane", "toolbarCount", "toolbarBadge",
        "tabs", "tabList", "tab", "tabLabel", "tabCount", "tabDot", "tabClose", "tabAdd", "tabMore", "tabMenu", "tabRename",
        "searchViews", "searchViewsActions",
        "header", "headerGutter", "headerNumber", "headerCell", "headerLabel", "headerSub",
        "row", "rowBlank", "gutter", "rail", "connector", "checkbox", "gutterNumber", "numberMeasure", "gutterButton", "gutterBar", "rowGrip", "rowActions", "dragGhost",
        "cell", "cellIssue", "cellText", "cellMono", "cellWord", "cellNum", "cellUnit", "cellRes", "cellGhost", "cellDot",
        "ring", "rangeWash", "hatch", "nextTarget", "takeButton",
        "editor", "editorField", "editorMirror", "editorGhost", "editorInput", "editorResolve", "editorBadge", "editorError",
        "editorNumber", "editorNumberInput", "editorStepper", "editorDate",
        "editorCombobox", "editorMenu", "editorOption", "editorOptionMeta",
        "editorTime",
        "linkGrid", "half", "halfLabel", "chip", "chipDashed", "chipPicked", "chipMeta", "lockTag", "lockWarn", "arrow",
        "retry", "rowError",
        "run", "runRow", "runGutter", "runCell", "runBand",
        "gutterAction", "groupSummary",
        "groupRow", "groupChevron", "groupCount", "groupTitle", "groupTitleText", "groupSub", "groupCell",
        "strip", "stripLabel", "stripChips", "stripChip", "stripChipOn", "stripChipFlat", "stripMeta", "stripKeys",
        "stripPager", "stripPage", "stripPageCount", "stripMeasure",
        "footer", "footerCounts", "footerHint", "footerHintSep", "footerMessage",
        "diagnostic",
        "subRow", "subRowGutter", "subRowIndex", "subRowStem", "subRowWell", "subRowContent", "subRowLead", "subRowCode", "subRowName",
        "subRowDetail", "subRowChip", "subRowFacet", "subRowFacetLabel", "subRowFacetValue", "subRowId", "subRowChevron",
    ],
    base: {
        // The sheet fills its frame's main region (#1216).
        root: {
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minWidth: "0",
            fontFamily: "body",
            color: "fg",
            fontFeatureSettings: '"tnum" 1',
            // Every z-index inside the sheet stays inside it, wherever it is mounted.
            isolation: "isolate",
            // the insertion line: 2 px brand on the row boundary, always from the gutter edge (`--sheet-gutter`, 128 by default) to the right edge — it never enters the gutter, whichever side the chips take.
            "& [data-row][data-insert-preview]::after": { content: '""', position: "absolute", left: "var(--sheet-gutter, 128px)", right: "0", top: "-1px", height: "2px", background: "brand.solid", pointerEvents: "none", zIndex: "8" },
            // A picked row is one `brandTint` surface — the cells' own range wash would double it.
            "& [data-row][data-picked] [data-slot=rangeWash]": { display: "none" },
            "& [data-row][data-draft] > [data-slot=cell][data-blank][data-editable]": {
                background: "color-mix(in srgb, var(--chakra-colors-status-warn) 17%, var(--chakra-colors-bg-surface))",
            },
            "& [data-row][data-invalid] > [data-slot=cell][data-invalid]": {
                background: "color-mix(in srgb, var(--chakra-colors-status-neg) 17%, var(--chakra-colors-bg-surface))",
            },
            // for a moment after a gesture that folds or opens, the rows slide to their new places rather than jump; never where the viewer asks for less motion.
            "&[data-moving] [data-slot=virtualRow]": {
                transition: "transform 240ms cubic-bezier(0.2, 0, 0, 1)",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            },
            // A drag over the rows (#1187): none lights as a candidate — the
            // seam line, or the row a card lands on, says where.
            "& [data-row][data-drop-valid]:not([data-drop-active]):not([data-drop-invalid])::before": { content: "none" },
            "& [data-row][data-drop-active][data-drop-at=seam]::before": { content: "none" },
            // Where a template or a moved row would land: the insertion line along the seam the drop marks, while a row takes the drag.
            "&:has([data-drop-active]) [data-row][data-drop-seam]::after": {
                content: '""', position: "absolute", left: "var(--sheet-gutter, 128px)", right: "0", height: "2px", background: "brand.solid", pointerEvents: "none", zIndex: "8",
            },
            "&:has([data-drop-active]) [data-row][data-drop-seam=top]::after": { top: "-1px" },
            "&:has([data-drop-active]) [data-row][data-drop-seam=bottom]::after": { bottom: "-1px" },
        },
        // The seam: a 16 px hit strip centred on the row boundary across the
        // gutter. It draws nothing; hovering it shows the chips in the layer.
        insertPoint: {
            position: "absolute", left: "0", right: "0", top: "-8px", height: "16px", zIndex: "6",
        },
        // The insertion layer: one per sheet, over the rows (each an isolated
        // stacking context, so z 1 clears them all) and under the pinned
        // header (z 6). Its top is the seam and its left the chips' start —
        // 8 px into the gutter's actions column, or, when an action button holds
        // that column on either row of the seam, the gutter edge; there the
        // box starts at the edge (12 px of padding before the chips) so the
        // pointer never leaves the seam on the way to them.
        insertLayer: {
            position: "absolute", zIndex: "1", height: "24px", marginTop: "-12px",
            "&[data-side=body]": { paddingLeft: "12px" },
        },
        insertChips: {
            height: "24px", display: "flex", alignItems: "center", gap: "4px",
        },
        insertButton: {
            display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: "0",
            width: "24px", height: "24px", boxSizing: "border-box", padding: "0",
            borderWidth: "1px", borderStyle: "solid", borderColor: "brand.solid", borderRadius: "{radii.sm}",
            background: "bg.surface", color: "brand.solid", fontSize: "13px", cursor: "pointer",
            _hover: { background: "brand.solid", color: "brand.contrast" },
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "1px" },
        },
        // the strip is a flex item under the scrolling rows: without
        // `flex: none` the rows' `flex: 1 1 auto` squeezes it below its content
        // height and the button text overflows its 10 px box. Same idiom as the
        // docked strip and the footer (`flexShrink: 0`).
        insertStrip: { display: "flex", alignItems: "center", gap: "2", paddingX: "5", paddingY: "2", flex: "none", background: "bg.panel", borderTopWidth: "1px", borderColor: "border.subtle", overflowX: "auto" },
        insertChoice: { display: "inline-flex", alignItems: "center", height: "22px", lineHeight: "1", borderWidth: "1px", borderColor: "border.strong", borderRadius: "sm", paddingX: "2", color: "fg.muted", background: "bg.surface", fontFamily: "mono", fontSize: "10.5px", letterSpacing: "0.04em", whiteSpace: "nowrap", cursor: "pointer", _hover: { borderColor: "brand.solid", color: "brand.solid" }, _coarse: { minWidth: "44px", minHeight: "44px" } },
        // The history controls in the toolbar's rail group are the shared
        // editing session's bar — the `editHistory` recipe (#879).
        frame: {
            display: "flex",
            flexDirection: "column",
            minHeight: "0",
        },
        // The card takes the room the strip leaves, and its rows scroll there.
        card: {
            display: "flex",
            flexDirection: "column",
            flex: "1 1 auto",
            background: "bg.surface",
            overflow: "hidden",
            outline: "none",
            position: "relative",
            minHeight: "0",
        },
        body: {
            paddingBottom: "120px",
        },
        // A library tab's body over a source of the rail (#1345): it fills the
        // tab, and takes no gesture while its source resolves — the shared
        // Library pane's part.
        pane: schedulePaneBase.pane,
        toolbarCount: {
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            flex: "none",
        },
        toolbarBadge: {
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
            background: "bg.muted",
            borderRadius: "{radii.sm}",
            paddingX: "6px",
            height: "20px",
            display: "inline-flex",
            alignItems: "center",
            whiteSpace: "nowrap",
        },
        // The strip never scrolls: the toolbar folds its trailing tabs into a
        // `+n` menu, then closes it up (`data-strip`, #952). It clips sideways
        // alone, so its controls' touch halos reach above and below it (#1221).
        tabs: {
            display: "flex",
            alignItems: "stretch",
            gap: "16px",
            minWidth: "0",
            flex: "0 1 auto",
            overflowX: "clip",
            // The toolbar's last rung: the strip closes up and its counts go.
            "&[data-strip='closed']": { gap: "10px" },
        },
        // The tabs themselves — the tablist (#860), apart from `+n` and `+ TAB`,
        // which are buttons beside it — spaced as the strip spaces them.
        tabList: {
            display: "flex",
            alignItems: "stretch",
            gap: "16px",
            flex: "none",
            "[data-strip='closed'] &": { gap: "10px" },
        },
        tab: {
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "1",
            gap: "7px",
            height: TOOLBAR_CONTROL_HEIGHT,
            ...coarseHitArea({ position: true }),
            paddingX: "2px",
            flex: "none",
            color: "fg.subtle",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            cursor: "pointer",
            userSelect: "none",
            _hover: { color: "fg.muted" },
            "&[data-active]": { boxShadow: "inset 0 -2px 0 var(--chakra-colors-fg)", color: "fg", cursor: "default" },
            // A tab of the tablist (#860), reached by the keyboard. The strip clips
            // its overflow sideways, so the ring is drawn inside the tab.
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "-2px" },
        },
        // The name ellipsises past 200px, and past 72px once the toolbar's
        // ladder caps it — the count, the dot and the × always show whole.
        tabLabel: {
            minWidth: "0",
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-strip='capped'] &, [data-strip='closed'] &, [data-strip='menu'] &": { maxWidth: "72px" },
        },
        tabCount: {
            color: "fg.subtle",
            fontWeight: "500",
            // The whole-sheet tab's count is the first thing a tight toolbar drops from the strip; at the last rung every count goes.
            "[data-strip='compact'] [data-tab='all'] &, [data-strip='capped'] [data-tab='all'] &, [data-strip='closed'] &": { display: "none" },
        },
        tabDot: {
            width: "5px",
            height: "5px",
            flex: "none",
            borderRadius: "{radii.full}",
            background: "brand.solid",
        },
        // The × keeps its 14px box. On a coarse pointer it is the active or
        // the focused tab's alone, so its 44px halo never takes a tap that
        // switches to a tab (#1221).
        tabClose: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "14px",
            height: "14px",
            color: "fg.subtle",
            cursor: "pointer",
            fontSize: "9px",
            _hover: { color: "fg.danger" },
            ...coarseHitArea({ position: true }),
            "[data-slot=tab]:not([data-active], :focus-visible) > &": { _coarse: { visibility: "hidden" } },
        },
        tabAdd: {
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "1",
            gap: "4px",
            alignSelf: "center",
            height: TOOLBAR_CONTROL_HEIGHT,
            paddingX: "7px",
            paddingY: "0",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            background: "transparent",
            color: "fg.subtle",
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer",
            whiteSpace: "nowrap",
            userSelect: "none",
            _hover: { borderColor: "brand.solid", color: "brand.solid" },
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "-2px" },
            ...coarseHitArea({ position: true }),
            // Icon-only once the strip closes up at all; the title still says what it does.
            "[data-strip] &": { gap: "0", paddingX: "5px", "& > [data-slot=tabAddLabel]": { display: "none" } },
        },
        tabMore: {
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "1",
            gap: "5px",
            height: TOOLBAR_CONTROL_HEIGHT,
            ...coarseHitArea({ position: true }),
            paddingX: "2px",
            paddingY: "0",
            flex: "none",
            border: "none",
            background: "transparent",
            color: "fg.subtle",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            letterSpacing: "0.12em",
            whiteSpace: "nowrap",
            cursor: "pointer",
            userSelect: "none",
            _hover: { color: "fg.muted" },
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "-2px" },
        },
        // The strip folded into one chip, the toolbar's last rung for it
        // (#1221): the open view's tab — its name capped, the active tab's
        // ink and underline — and a caret, opening a menu of every view and
        // `+ TAB`.
        tabMenu: {
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "1",
            gap: "6px",
            height: TOOLBAR_CONTROL_HEIGHT,
            ...coarseHitArea({ position: true }),
            paddingX: "2px",
            paddingY: "0",
            flex: "none",
            border: "none",
            background: "transparent",
            boxShadow: "inset 0 -2px 0 var(--chakra-colors-fg)",
            color: "fg",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            cursor: "pointer",
            userSelect: "none",
            "& [data-slot=tabMenuCaret]": { fontSize: "8px", opacity: "0.7" },
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "-2px" },
        },
        tabRename: {
            width: "120px",
            border: "none",
            outline: "none",
            borderBottomWidth: "2px",
            borderBottomColor: "fg",
            background: "transparent",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "fg",
            padding: "0",
            // A phone zooms into type under 16 px.
            _coarse: { fontSize: "16px" },
        },
        // The views, folded with the key search into its popover — the strip's
        // last rung where the sheet has a key search (#1345): every view a
        // choice over the search box, as the Flowchart's orientation sits over
        // find state's; then `+ TAB` and the open view's close.
        searchViews: {
            display: "flex",
            flexDirection: "column",
            gap: "2",
            marginBottom: "3",
        },
        searchViewsActions: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "1",
        },
        // the header band: 48 px `bg.panel`, `border.strong` below.
        header: {
            display: "grid",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
        },
        // The gutter's corner — rail · number · actions like every row; the gutters stay put while the grid scrolls sideways.
        headerGutter: {
            display: "grid", gridTemplateColumns: "28px var(--sheet-number, 36px) 1fr", alignItems: "stretch",
            background: "bg.panel",
            borderRightWidth: "1px",
            borderRightColor: "border.strong",
            position: "sticky",
            left: "0",
            zIndex: "1",
            "& [data-slot=checkbox]": { cursor: "default", background: "bg.panel" },
        },
        headerNumber: {
            display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: "10px",
            fontFamily: "mono", fontSize: "10px", fontWeight: "600", letterSpacing: "0.16em", color: "fg.subtle",
        },
        headerCell: {
            height: "48px",
            paddingX: "12px",
            paddingY: "0",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "3px",
            overflow: "hidden",
            minWidth: "0",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
        },
        headerLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: "1.3",
            fontWeight: "600",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        headerSub: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "500",
            lineHeight: "1.3",
            color: "fg.faint",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        // row states per the design: hover `bg.panel`, picked `brandTint`, dirty an 8 % warn wash.
        row: {
            display: "grid",
            position: "relative",
            // The row's layers (ring, editor, sticky gutter) stay inside it.
            isolation: "isolate",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            // The pointer's hover — but the row a drag rests on says what the drop does instead (#1187).
            "&:is(:hover, [data-hover]):not([data-drop-active], [data-drop-invalid])": { background: "bg.panel" },
            "&[data-draft]": { background: "color-mix(in oklch, var(--chakra-colors-status-warn) 8%, var(--chakra-colors-bg-surface))" },
            "&[data-invalid]": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-surface))" },
            "&[data-picked]": { background: "brandTint" },
            // The row an author's card lands on (#1187); a row that refuses the drag.
            "&[data-drop-active][data-drop-at=row]": { background: "brandTint" },
            "&[data-drop-invalid]": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-surface))" },
            // The row a grip lifts — or a folded gutter's row-actions button (#1215): a 1 px brand inset ring, as the design system's dragged row.
            "&:has([data-slot=rowGrip][data-dragging], [data-slot=rowActions][data-dragging])": { boxShadow: "inset 0 0 0 1px var(--chakra-colors-brand-solid)" },
            // an open line's copy under the group's band while its sub rows scroll under it: the band copy's `border.strong` edge, where the sticking stops.
            "&[data-slot=stickyLine]": { borderBottomColor: "border.strong" },
            "&[data-proposed]": {
                "&::before": {
                    content: '""',
                    position: "absolute",
                    left: "0",
                    right: "0",
                    top: "-1px",
                    borderTopWidth: "1px",
                    borderTopStyle: "dashed",
                    borderTopColor: "border.strong",
                    pointerEvents: "none",
                    zIndex: "3",
                },
            },
        },
        rowBlank: {},
        // the gutter: three columns, three jobs — the number column as wide as
        // the widest number the sheet shows (`--sheet-number`). It is sticky,
        // so it paints its row's own surface (rest · hover · picked · band ·
        // dirty), and its right edge is the gutter edge, `border.strong`.
        gutter: {
            display: "grid",
            gridTemplateColumns: "28px var(--sheet-number, 36px) 1fr",
            alignItems: "stretch",
            position: "sticky",
            left: "0",
            zIndex: "5",
            background: "bg.surface",
            borderRightWidth: "1px",
            borderRightColor: "border.strong",
            cursor: "pointer",
            userSelect: "none",
            "[data-row]:hover:not([data-drop-active], [data-drop-invalid]) > &": { background: "bg.panel" },
            "[data-band-row] > &": { background: "bg.panel" },
            "[data-band-row]:hover:not([data-drop-active], [data-drop-invalid]) > &": { background: "bg.muted" },
            "[data-row][data-draft] > &": { background: "color-mix(in oklch, var(--chakra-colors-status-warn) 8%, var(--chakra-colors-bg-surface))" },
            "[data-row][data-invalid] > &": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-surface))" },
            "[data-row][data-picked] > &": { background: "brandTint" },
            // The row an author's card lands on, and one that refuses the drag (#1187): the gutter is sticky, so it washes too.
            "[data-row][data-drop-active][data-drop-at=row] > &": { background: "brandTint" },
            "[data-row][data-drop-invalid] > &": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-surface))" },
        },
        // The rail: the connector runs behind the checkbox, centred in the 28 px column.
        rail: {
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        connector: {
            position: "absolute",
            left: "calc(50% - 0.5px)",
            width: "1px",
            top: "50%",
            bottom: "50%",
            background: "fg.faint",
            zIndex: "1",
            pointerEvents: "none",
            "&[data-above]": { top: "0" },
            "&[data-below]": { bottom: "-1px" },
            "[data-row][data-picked] &": { background: "brand.solid" },
        },
        // The checkbox: 14 × 14, r-3, 1 px ink-5; its fill is the row's surface so it covers the connector.
        checkbox: {
            position: "relative",
            zIndex: "2",
            width: "14px",
            height: "14px",
            boxSizing: "border-box",
            padding: "0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "fg.faint",
            borderRadius: "{radii.xs}",
            background: "bg.surface",
            color: "fg.subtle",
            fontSize: "9px",
            lineHeight: "1",
            cursor: "pointer",
            "[data-row]:hover:not([data-drop-active], [data-drop-invalid]) &": { borderColor: "fg.muted", background: "bg.panel" },
            "[data-band-row] &": { background: "bg.panel" },
            "[data-band-row]:hover:not([data-drop-active], [data-drop-invalid]) &": { background: "bg.muted" },
            "[data-row][data-picked] &": { background: "brandTint" },
            // On the row a card lands on, and one that refuses the drag, the fill is their wash (#1187).
            "[data-row][data-drop-active][data-drop-at=row] &": { background: "brandTint" },
            "[data-row][data-drop-invalid] &": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-surface))" },
            "&[data-mixed], [data-row]:hover &[data-mixed]": { borderColor: "fg.subtle" },
            "&[aria-pressed=true], [data-row]:hover &[aria-pressed=true]": { background: "brand.solid", borderColor: "brand.solid", color: "brand.contrast" },
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "1px" },
        },
        gutterNumber: {
            // relative: a line's sub-row chevron sits at its left edge.
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: "10px",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "500",
            fontFeatureSettings: '"tnum" 1',
            color: "fg.subtle",
            "&[data-blank]": { color: "fg.faint" },
            "&[data-hit]": { color: "brand.solid", fontWeight: "600" },
            "[data-row][data-picked] &": { color: "fg", fontWeight: "600" },
            // A line's number beside its sub rows' chevron (16 px at the column's start) keeps clear of it.
            "&[data-chevron]": { paddingLeft: "18px" },
        },
        // What the number column is measured by: the widest numbers, each laid
        // out at its natural width as a row draws it — never shown, never hit.
        numberMeasure: {
            position: "absolute",
            left: "0",
            top: "0",
            height: "0",
            overflow: "hidden",
            visibility: "hidden",
            pointerEvents: "none",
            display: "flex",
            alignItems: "flex-start",
            width: "max-content",
        },
        // Decisions: one style for all four — a 24 px ghost, Font Awesome 13 px, ink-4; colour only on hover as an 8 % wash.
        gutterButton: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "24px",
            height: "24px",
            flex: "none",
            padding: "0",
            border: "none",
            borderRadius: "{radii.sm}",
            color: "fg.subtle",
            background: "transparent",
            cursor: "pointer",
            fontSize: "13px",
            "&[data-kind=accept]:hover": { color: "status.pos", background: "color-mix(in oklch, var(--chakra-colors-status-pos) 8%, transparent)" },
            "&[data-kind=reject]:hover, &[data-kind=discard]:hover": { color: "status.neg", background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, transparent)" },
            "&[data-kind=apply]:hover": { color: "brand.solid", background: "brandTint" },
            // the header's fold-all: a disclosure, not a decision — the chevrons' ink-3, ink on hover, no hue. Its double chevron — Font Awesome's angles-right in the chevrons' 10 px square (#1263) — turns like theirs: right while every group is folded, down otherwise.
            "&[data-kind=fold]": {
                color: "fg.muted",
                fontSize: "10px",
                "--fa-width": "1em",
                "& svg": { transition: "transform 180ms cubic-bezier(0.2, 0, 0, 1)", "@media (prefers-reduced-motion: reduce)": { transition: "none" } },
                "&[aria-expanded=true] svg": { transform: "rotate(90deg)" },
            },
            "&[data-kind=fold]:hover": { color: "fg", background: "bg.muted" },
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "-1px" },
        },
        gutterBar: {
            position: "absolute",
            left: "0",
            top: "0",
            bottom: "0",
            width: "3px",
            background: "brand.solid",
            pointerEvents: "none",
            zIndex: "4",
        },
        // A row's grip (#1187): the faintest ink, shown on the row's hover —
        // always where nothing hovers — and the drag's touch handle at once,
        // no hold (`data-drag-grip`), with a 32 px halo on a coarse pointer.
        // On the copilot's anchor row its fill and discard take the column.
        rowGrip: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            width: "14px",
            height: "24px",
            color: "fg.faint",
            fontSize: "10px",
            cursor: "grab",
            touchAction: "none",
            opacity: "0",
            ...coarseHitArea({ position: true, size: 32 }),
            _hover: { color: "fg.muted" },
            "&[data-dragging], &:focus-visible, [data-row]:hover:not([data-drop-active], [data-drop-invalid]) &": { opacity: "1" },
            _hoverNone: { opacity: "1" },
            "[data-row][data-anchor] &": { display: "none" },
        },
        // A folded gutter's one control (#1215): the row's actions in a 44 px
        // ghost — its menu on a tap, its grip on a drag (`data-drag-grip="tap"`
        // waits for travel), so it takes no scroll gesture. Brand while its
        // menu is open, and on the copilot's anchor, whose fill waits in it.
        rowActions: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            width: "44px",
            height: "44px",
            padding: "0",
            borderRadius: "{radii.sm}",
            color: "fg.subtle",
            background: "transparent",
            fontSize: "14px",
            cursor: "pointer",
            touchAction: "none",
            userSelect: "none",
            _hover: { color: "fg", background: "bg.muted" },
            "[data-row][data-anchor] &": { color: "brand.solid" },
            "&[data-state=open]": { color: "brand.solid", background: "brandTint" },
            "&[data-dragging]": { cursor: "grabbing" },
        },
        // What a grip carries (#1187): the row's name, as the library's card ghost draws a card.
        dragGhost: {
            width: "max-content",
            fontSize: "{fontSizes.body}",
            fontWeight: "600",
            color: "fg",
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "brand.solid",
            borderRadius: "{radii.md}",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.1}",
            whiteSpace: "nowrap",
        },
        cell: {
            position: "relative",
            // The virtual row height includes its bottom rule. Adding that
            // pixel twice overlaps the next row and hides the selection edge.
            minHeight: "calc({sizes.density.row.md} - 1px)",
            paddingX: "10px",
            paddingY: "6px",
            display: "flex",
            alignItems: "center",
            overflow: "visible",
            cursor: "default",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            minWidth: "0",
            // A cell's hover, but not on the row a drag rests on: the row's wash shows through (#1187).
            "&:is(:hover, [data-hover]):not([data-drop-active] > *, [data-drop-invalid] > *)": { background: "bg.panel" },
            "&[data-invalid]": { background: "color-mix(in srgb, var(--chakra-colors-status-neg) 17%, var(--chakra-colors-bg-surface))", "& [data-slot=cellText]": { color: "fg.danger" } },
        },
        cellIssue: {
            position: "absolute",
            width: "1px",
            height: "1px",
            padding: "0",
            margin: "-1px",
            overflow: "hidden",
            clipPath: "inset(50%)",
            whiteSpace: "nowrap",
            borderWidth: "0",
        },
        cellText: {
            fontSize: "13px",
            color: "fg",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            position: "relative",
            zIndex: "1",
        },
        cellMono: {
            fontFamily: "mono",
            fontSize: "12px",
            color: "fg.muted",
            whiteSpace: "nowrap",
            position: "relative",
            zIndex: "1",
        },
        cellWord: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.08em",
            color: "fg.muted",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            position: "relative",
            zIndex: "1",
        },
        cellNum: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "12px",
            color: "fg.muted",
            whiteSpace: "nowrap",
            position: "relative",
            zIndex: "1",
        },
        cellUnit: {
            fontFamily: "mono",
            fontSize: "9.5px",
            color: "fg.subtle",
            marginLeft: "4px",
            position: "relative",
            zIndex: "1",
        },
        // a date's resolution tag (`wk` · `day` · `range` · `time`), hugging the cell's right edge so the tags read as a column.
        cellRes: {
            marginLeft: "auto",
            paddingLeft: "6px",
            flex: "none",
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.faint",
            whiteSpace: "nowrap",
            position: "relative",
            zIndex: "1",
            // a date's actual tag: how the actual stands against the wanted date. A delta is a measure (`+3h`, `−1d`), so it keeps its case.
            "&[data-actual=late], &[data-actual=early]": { textTransform: "none", letterSpacing: "0.02em" },
            "&[data-actual=late]": { color: "status.warn" },
            "&[data-actual=early]": { color: "status.info" },
        },
        cellGhost: {
            fontSize: "12.5px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            position: "relative",
            zIndex: "1",
            "&[data-mono]": { fontFamily: "mono", fontSize: "12px" },
            "&[data-num]": { fontFamily: "mono", fontSize: "12px", marginLeft: "auto" },
        },
        cellDot: {
            width: "6px",
            height: "6px",
            borderRadius: "{radii.full}",
            marginRight: "6px",
            flex: "none",
            position: "relative",
            zIndex: "1",
            background: "fg.subtle",
            "&[data-tone=success]": { background: "status.pos" },
            "&[data-tone=danger]": { background: "status.neg" },
            "&[data-tone=warning]": { background: "status.warn" },
            "&[data-tone=info]": { background: "brand.solid" },
        },
        ring: {
            position: "absolute",
            // Stay inside every cell edge: adjacent isolated rows and the
            // sticky header/gutter must never cover part of the 2 px ring.
            inset: "0",
            boxShadow: "inset 0 0 0 2px var(--chakra-colors-brand-solid)",
            pointerEvents: "none",
            zIndex: "4",
        },
        rangeWash: {
            position: "absolute",
            inset: "0",
            background: "brandTint",
            opacity: "0.55",
            pointerEvents: "none",
        },
        // a proposal's hatch in ink, not brand (brand is selection and insertion only).
        hatch: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklch, var(--chakra-colors-fg-subtle) 28%, transparent) 5px 6px)",
        },
        nextTarget: {
            position: "absolute",
            left: "9px",
            right: "9px",
            bottom: "3px",
            borderBottomWidth: "1.5px",
            borderBottomStyle: "dotted",
            borderBottomColor: "brand.solid",
            pointerEvents: "none",
            zIndex: "2",
        },
        takeButton: {
            position: "absolute",
            right: "4px",
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: "5",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "18px",
            height: "18px",
            borderWidth: "1px",
            borderColor: "brand.solid",
            borderRadius: "{radii.sm}",
            background: "bg.surface",
            color: "brand.solid",
            cursor: "pointer",
            fontSize: "9px",
            _coarse: { width: "26px", height: "26px", fontSize: "12px" },
            _hover: { background: "brand.solid", color: "brand.contrast" },
        },
        editor: {
            position: "absolute",
            left: "-1px",
            right: "-1px",
            top: "-1px",
            minHeight: "calc(100% + 2px)",
            "[data-first] &": { top: "0", minHeight: "calc(100% + 1px)" },
            "[data-slot=gutter] + [data-slot=cell] > &": { left: "0" },
            zIndex: "10",
            background: "bg.surface",
            boxShadow: "inset 0 0 0 2px var(--chakra-colors-brand-solid)",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            paddingX: "10px",
            "&[data-kind=date], &[data-kind=quantity], &[data-kind=integer]": { paddingX: "4px" },
            // A date editor with a time box grows past its cell rather than clipping it (it sits above the row at z 10).
            "&[data-kind=date]:has([data-slot=editorDate][data-level=time])": { right: "auto", minWidth: "calc(100% + 2px)", width: "max-content", paddingRight: "8px" },
            overflow: "hidden",
        },
        editorField: {
            position: "relative",
            flex: "1",
            minWidth: "36px",
            height: "100%",
            display: "flex",
            alignItems: "center",
        },
        editorMirror: {
            position: "absolute",
            inset: "0",
            display: "flex",
            alignItems: "center",
            pointerEvents: "none",
            whiteSpace: "pre",
            overflow: "hidden",
            fontFamily: "mono",
            fontSize: "12.5px",
            _coarse: { fontSize: "16px" },
        },
        editorGhost: {
            color: "fg.subtle",
        },
        // The text a cell edits — a text's, a choice's, a reference's, a set's and a band title's: the ring is its chrome,
        // so it casts neither the page's focus ring nor Chakra's.
        editorInput: {
            ...fieldInRingedControl,
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "mono",
            fontSize: "12.5px",
            color: "fg",
            padding: "0",
            minWidth: "0",
            // A phone zooms into type under 16 px; the mirror follows, so the ghost keeps its place.
            _coarse: { fontSize: "16px" },
        },
        // The common number field inside the ring: no border, no focus ring
        // of its own, the stepper column kept on its right edge.
        editorNumber: {
            flex: "1",
            minWidth: "0",
            alignSelf: "center",
            borderWidth: "0",
            borderRadius: "0",
            boxShadow: "none",
            background: "transparent",
            _focusWithin: { boxShadow: "none", borderColor: "transparent" },
            _hover: { borderColor: "transparent" },
        },
        editorNumberInput: {
            fontFamily: "mono",
            fontWeight: "400",
            color: "fg",
            paddingInline: "0",
        },
        editorStepper: {
            marginLeft: "6px",
        },
        // The common date field inside the ring: the segments in the sheet's mono. The ring is its chrome: a segment draws
        // no box and no focus ring of its own, and the one being typed into is tinted.
        editorDate: {
            flex: "1",
            minWidth: "0",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontFamily: "mono",
            color: "fg",
            "& [role=spinbutton]": { ...fieldInRingedControl, borderColor: "transparent" },
            "& [role=spinbutton]:focus:not([data-readonly])": { background: "brandTint", color: "fg", borderColor: "transparent" },
        },
        // the common combobox inside the ring: the root and the
        // control are chromeless (the ring is the chrome), the list is the
        // combobox recipe's own popup in the sheet's mono.
        editorCombobox: {
            flex: "1",
            minWidth: "0",
            width: "auto",
            height: "100%",
            display: "flex",
            alignItems: "center",
        },
        editorMenu: {
            zIndex: "1400",
            fontFamily: "mono",
            "& [data-part=content]": { minWidth: "220px", paddingY: "4px" },
        },
        editorOption: {
            gap: "8px",
            paddingX: "10px",
            paddingY: "5px",
            fontFamily: "mono",
            fontSize: "11px",
            letterSpacing: "0.04em",
            color: "fg",
            "& [data-part=item-text]": { fontWeight: "600" },
        },
        editorOptionMeta: {
            marginLeft: "auto",
            paddingLeft: "12px",
            fontFamily: "mono",
            fontSize: "9.5px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "260px",
        },
        editorResolve: {
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        editorBadge: {
            fontFamily: "mono",
            fontSize: "9px",
            letterSpacing: "0.05em",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        editorError: {
            position: "absolute",
            inset: "-1px",
            boxShadow: "inset 0 0 0 2px var(--chakra-colors-status-neg)",
            pointerEvents: "none",
            zIndex: "11",
            "[data-first] &": { top: "0" },
            "[data-slot=gutter] + [data-slot=cell] > &": { left: "0" },
        },
        linkGrid: {
            flex: "1",
            minWidth: "0",
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 16px minmax(0,1fr)",
            alignItems: "stretch",
            position: "relative",
            zIndex: "1",
        },
        half: {
            minWidth: "0",
            display: "flex",
            flexWrap: "wrap",
            gap: "4px",
            alignItems: "flex-start",
            alignContent: "flex-start",
            minHeight: "20px",
            "&[data-half=from]": { paddingRight: "3px", justifyContent: "flex-end" },
            "&[data-half=to]": { paddingLeft: "3px" },
        },
        halfLabel: {
            display: "inline-flex",
            alignItems: "center",
            height: "20px",
            fontFamily: "mono",
            fontSize: "8.5px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        // a chip never leaves its half: it caps at the half's
        // width and clips, and its meta line (the register's description,
        // shown when the half holds one chip) gives way first — ellipsised
        // before the key is touched. A long meta used to run under the
        // neighbouring cell.
        chip: {
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "14px",
            gap: "4px",
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.muted",
            background: "bg.muted",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            paddingX: "4px",
            paddingY: "1px",
            whiteSpace: "nowrap",
            maxWidth: "100%",
            minWidth: "0",
            overflow: "hidden",
        },
        chipDashed: {
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "14px",
            gap: "4px",
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.subtle",
            background: "transparent",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "fg.subtle",
            borderRadius: "{radii.sm}",
            paddingX: "4px",
            paddingY: "1px",
            whiteSpace: "nowrap",
            opacity: "0.85",
            maxWidth: "100%",
            minWidth: "0",
            overflow: "hidden",
        },
        chipPicked: {
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "14px",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            color: "brand.contrast",
            background: "brand.solid",
            borderWidth: "1px",
            borderColor: "brand.solid",
            borderRadius: "{radii.sm}",
            paddingX: "4px",
            paddingY: "1px",
            whiteSpace: "nowrap",
            maxWidth: "100%",
            minWidth: "0",
            overflow: "hidden",
        },
        chipMeta: {
            color: "fg.subtle",
            fontSize: "9px",
            letterSpacing: "0.03em",
            flex: "0 1 auto",
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        lockTag: {
            display: "inline-flex",
            alignItems: "center",
            height: "20px",
            fontFamily: "mono",
            fontSize: "8.5px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
            background: "bg.muted",
            borderRadius: "{radii.sm}",
            paddingX: "6px",
            whiteSpace: "nowrap",
        },
        lockWarn: {
            display: "inline-flex",
            alignItems: "center",
            height: "20px",
            fontFamily: "mono",
            fontSize: "8.5px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "status.warn",
            background: "bg.warning.subtle",
            borderRadius: "{radii.sm}",
            paddingX: "6px",
            whiteSpace: "nowrap",
        },
        arrow: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "20px",
            color: "fg.subtle",
            fontSize: "10px",
        },
        // The whole-sheet message's Retry (#853): brand, a button.
        retry: {
            display: "inline-flex",
            alignItems: "center",
            paddingX: "4px",
            border: "none",
            background: "transparent",
            borderRadius: "{radii.sm}",
            fontFamily: "mono",
            fontSize: "inherit",
            letterSpacing: "0.06em",
            color: "brand.solid",
            fontWeight: "600",
            cursor: "pointer",
            _hover: { background: "brandTint" },
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "1px" },
            _coarse: { paddingX: "8px", paddingY: "4px" },
        },
        // A row that could not be drawn (#853): one row, where it would be, the reason in the danger ink on the invalid row's wash.
        rowError: {
            display: "flex",
            alignItems: "center",
            // Past the fine gutter — rail 28 · number · actions 64 — and 10 px: 138 beside the least number column.
            paddingLeft: "calc(var(--sheet-number, 36px) + 102px)",
            fontFamily: "mono",
            fontSize: "10px",
            letterSpacing: "0.06em",
            color: "fg.danger",
            background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-surface))",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        // ── A run of rows not drawn yet (#1398, CL2): the shared `UnloadedRun`, its rows the sheet's own ──
        // The run's box, the virtual row it is.
        run: {
            position: "relative",
        },
        // A run's row: a row's surface and its 1 px rule — the pitch includes it, as a row's does — and a grouped run's
        // band on the band's panel.
        runRow: {
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
            "&[data-run-band]": { background: "bg.panel" },
        },
        // Its gutter, as a row's: rail · number · actions, sticky while the columns scroll sideways, the gutter edge;
        // the number in the number column, right-aligned.
        runGutter: {
            display: "grid",
            gridTemplateColumns: "28px var(--sheet-number, 36px) 1fr",
            alignItems: "center",
            gap: "0",
            position: "sticky",
            left: "0",
            zIndex: "5",
            background: "bg.surface",
            borderRightWidth: "1px",
            borderRightStyle: "solid",
            borderRightColor: "border.strong",
            "& > [data-shape]": { gridColumn: "2", justifySelf: "end", marginRight: "10px" },
            // A row number set as the gutter sets it.
            "& > [data-shape=rowNumber]": { fontSize: "11px" },
        },
        // A column's cell: the cells' padding and their right rule. A failed run's line stays beside the gutter as the
        // columns scroll sideways: its cell lets it out, and it sticks there.
        runCell: {
            paddingX: "10px",
            borderRightWidth: "1px",
            borderRightStyle: "solid",
            borderRightColor: "border.subtle",
            "&[data-run-failed]": { overflow: "visible", borderRightWidth: "0" },
            "&[data-run-failed] > [data-loading-failed]": { position: "sticky", left: "calc(var(--sheet-gutter, 128px) + 10px)" },
        },
        // A grouped run's band: its chevron past the gutter, where a group band's sits.
        runBand: {
            paddingLeft: "calc(var(--sheet-gutter, 128px) + 12px)",
        },
        // The actions column: the row's decisions, 24 px each, 4 px apart.
        gutterAction: {
            display: "flex", alignItems: "center", gap: "4px", paddingX: "4px", minWidth: "0",
        },
        groupSummary: {
            display: "flex", alignItems: "center", gap: "10px", paddingX: "12px", minWidth: "0", whiteSpace: "nowrap", overflow: "hidden",
        },
        // One summary spans the row columns; membership is the connector in the gutter.
        // A group's band (#740): one grid row on the line columns' template — `bg.panel`, `bg.muted` on hover.
        groupRow: {
            display: "grid",
            position: "relative",
            isolation: "isolate",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            "&:is(:hover, [data-hover]):not([data-drop-active], [data-drop-invalid])": { background: "bg.muted" },
            "&[data-picked]": { background: "brandTint" },
            "&[data-draft]": { background: "color-mix(in oklch, var(--chakra-colors-status-warn) 8%, var(--chakra-colors-bg-panel))" },
            "&[data-invalid]": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-panel))" },
            "&[data-folded]": { borderBottomColor: "border.strong" },
            // The copy under the header while the group's lines scroll (G1).
            "&[data-slot=stickyBand]": { borderBottomColor: "border.strong" },
            // The band an author's group card lands on; a band that refuses the drag; the band a grip lifts (#1187).
            "&[data-drop-active][data-drop-at=row]": { background: "brandTint" },
            "&[data-drop-invalid]": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-panel))" },
            "&:has([data-slot=rowGrip][data-dragging], [data-slot=rowActions][data-dragging])": { boxShadow: "inset 0 0 0 1px var(--chakra-colors-brand-solid)" },
        },
        groupChevron: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "24px",
            height: "24px",
            flex: "none",
            padding: "0",
            border: "none",
            background: "transparent",
            borderRadius: "{radii.sm}",
            // the chevron: Font Awesome's chevron-right in a 10 px square (#1263), ink-3; it turns down as the group opens.
            color: "fg.muted",
            fontSize: "10px",
            "--fa-width": "1em",
            cursor: "pointer",
            _hover: { color: "fg" },
            "& svg": { transition: "transform 180ms cubic-bezier(0.2, 0, 0, 1)", "@media (prefers-reduced-motion: reduce)": { transition: "none" } },
            "&[aria-expanded=true] svg": { transform: "rotate(90deg)" },
        },
        groupCount: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "500",
            fontFeatureSettings: '"tnum" 1',
            color: "fg.subtle",
            whiteSpace: "nowrap",
            marginLeft: "6px",
            "&[data-quiet]": { opacity: "0.6" },
        },
        groupTitle: {
            position: "relative", display: "flex", alignItems: "center", minWidth: "0",
            minHeight: "28px", cursor: "text", overflow: "visible",
            '&:has([data-slot=editorInput])': { width: "240px", flex: "0 0 240px" },
        },
        groupTitleText: {
            fontFamily: "heading",
            fontSize: "14px",
            fontWeight: "600",
            letterSpacing: "-0.01em",
            color: "fg",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            position: "relative",
            zIndex: "1",
        },
        groupSub: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "500",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            position: "relative",
            zIndex: "1",
        },
        groupCell: {
            position: "relative", display: "flex", alignItems: "center", minWidth: "0", minHeight: "28px",
            cursor: "default", overflow: "visible",
            '& > span': { fontSize: "10px", fontFamily: "mono", color: "fg.muted" },
            '&[data-editable]': { cursor: "text" },
            '&:last-child': { marginLeft: "auto" },
        },
        // the strip stands as tall as a row and reads at the cells' size; its chips page (see `stripPager`), never scroll or clip.
        strip: {
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            paddingX: "20px",
            paddingY: "4px",
            minHeight: "{sizes.density.row.md}",
            background: "bg.panel",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            overflow: "hidden",
            minWidth: "0",
        },
        stripLabel: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.13em",
            textTransform: "uppercase",
            color: "brand.solid",
            whiteSpace: "nowrap",
        },
        // The row takes exactly what the label, the meta and the keys leave (basis 0): its width never depends on how many chips it shows, so the page cut is stable.
        stripChips: {
            flex: "1 1 0%",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            overflow: "hidden",
            minWidth: "0",
        },
        stripChip: {
            flex: "0 1 auto",
            minWidth: "0",
            fontFamily: "mono",
            fontSize: "12px",
            _coarse: { paddingY: "6px" },
            color: "fg.subtle",
            paddingX: "8px",
            paddingY: "3px",
            borderRadius: "{radii.sm}",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            cursor: "pointer",
            _hover: { background: "bg.muted", color: "fg.muted" },
        },
        stripChipOn: {
            flex: "0 1 auto",
            minWidth: "0",
            fontFamily: "mono",
            fontSize: "12px",
            _coarse: { paddingY: "6px" },
            fontWeight: "600",
            color: "brand.fg",
            background: "brandTint",
            borderRadius: "{radii.sm}",
            paddingX: "8px",
            paddingY: "3px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            cursor: "pointer",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--chakra-colors-brand-solid) 40%, transparent)",
            _hover: { boxShadow: "inset 0 0 0 1px var(--chakra-colors-brand-solid)" },
            "&[data-pending]": {
                background: "transparent",
                fontWeight: "400",
                color: "fg.subtle",
                boxShadow: "none",
                borderWidth: "1px",
                borderStyle: "dashed",
                borderColor: "border.strong",
            },
        },
        stripChipFlat: {
            flex: "0 1 auto",
            minWidth: "0",
            fontFamily: "mono",
            fontSize: "12px",
            color: "fg.muted",
            paddingX: "8px",
            paddingY: "3px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        stripMeta: {
            flex: "none",
            minWidth: "0",
            maxWidth: "30%",
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.muted",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        stripKeys: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        // the pager at the chips' end: two 22 px ghost chevrons that colour on hover, the page count between them.
        stripPager: {
            flex: "none",
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: "2px",
            paddingLeft: "6px",
        },
        stripPage: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "22px",
            height: "22px",
            borderRadius: "{radii.sm}",
            color: "fg.subtle",
            fontSize: "11px",
            cursor: "pointer",
            background: "transparent",
            _hover: { color: "fg", background: "bg.muted" },
            _disabled: { opacity: "0.3", cursor: "default", _hover: { color: "fg.subtle", background: "transparent" } },
            _coarse: { width: "28px", height: "28px" },
        },
        stripPageCount: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            minWidth: "28px",
            textAlign: "center",
        },
        // The unseen copy of every chip the page cut measures — laid out at its natural width, never shown, never hit.
        stripMeasure: {
            position: "absolute",
            left: "0",
            top: "0",
            height: "0",
            overflow: "hidden",
            visibility: "hidden",
            pointerEvents: "none",
            display: "flex",
            gap: "4px",
            whiteSpace: "nowrap",
            width: "max-content",
        },
        // The footer fits its hints and the shared loading line on one line, cutting a hint whole (#1398, CL3); the
        // line follows the message, which takes the rail's slack. It is the shared rail's 28 px, 12 px side padding
        // (ruled 23 Oct 2026): taller than anything it holds, the line among them, so nothing it shows moves it.
        footer: {
            ...FOOTER_FIT,
            display: "flex",
            alignItems: "center",
            gap: "18px",
            minHeight: "28px",
            paddingX: "12px",
            paddingY: "0",
            background: "bg.surface",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            minWidth: "0",
            "& > [data-footer-line]": { marginInlineStart: "0" },
        },
        footerCounts: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.muted",
            whiteSpace: "nowrap",
            display: "inline-flex",
            gap: "6px",
            "& [data-tone=success]": { color: "status.pos" },
            "& [data-tone=danger]": { color: "status.neg" },
            "& [data-tone=warning]": { color: "status.warn" },
            "& [data-tone=info]": { color: "status.info" },
        },
        // The key hint: its hints run on, each whole — the fit ends them at a whole hint rather than cut a word.
        footerHint: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
        },
        // The ` · ` before a hint: its spaces kept wherever the hint is laid out, so a hint measures the same cut or shown.
        footerHintSep: {
            whiteSpace: "pre",
        },
        footerMessage: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.muted",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        diagnostic: {
            padding: "20px",
            fontFamily: "mono",
            fontSize: "10px",
            letterSpacing: "0.06em",
            color: "fg.danger",
        },
        // ── the sub rows under a line (#844) ────
        // A sub row: its gutter on the surface, then one grey well; at least 30 px, a rule below every one.
        subRow: {
            display: "flex",
            alignItems: "stretch",
            position: "relative",
            isolation: "isolate",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        // Its gutter: sticky like a line's, on the surface so the tree reads on white — the group's rail through the rail track, the tree and the index in the rest, the gutter edge on its right.
        subRowGutter: {
            display: "grid",
            gridTemplateColumns: "28px 1fr",
            alignItems: "stretch",
            flex: "none",
            position: "sticky",
            left: "0",
            zIndex: "5",
            background: "bg.surface",
            borderRightWidth: "1px",
            borderRightColor: "border.strong",
            cursor: "default",
            userSelect: "none",
        },
        // The index `{line}.{n}`, clear of the elbow; the tree in `border.strong` under the line's chevron — the stem through every sub row (the last one's stopping at its middle), an elbow into each.
        subRowIndex: {
            position: "relative",
            display: "flex",
            alignItems: "center",
            paddingLeft: "24px",
            fontFamily: "mono",
            fontSize: "11px",
            fontFeatureSettings: '"tnum" 1',
            color: "fg.subtle",
            whiteSpace: "nowrap",
            "&::before": { content: '""', position: "absolute", left: "8px", top: "0", bottom: "-1px", borderLeftWidth: "1px", borderLeftStyle: "solid", borderLeftColor: "border.strong", pointerEvents: "none" },
            "&::after": { content: '""', position: "absolute", left: "8px", width: "10px", top: "50%", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong", pointerEvents: "none" },
            "[data-sub-row][data-last] &": { "&::before": { bottom: "50%" } },
        },
        // The stem's start on an open line: just under its chevron, down to the line's foot.
        subRowStem: {
            position: "absolute",
            left: "8px",
            top: "calc(50% + 7px)",
            bottom: "-1px",
            borderLeftWidth: "1px",
            borderLeftStyle: "solid",
            borderLeftColor: "border.strong",
            pointerEvents: "none",
        },
        // The well: one content cell from the gutter edge to the sheet's right edge. `bg.panel`, and a step up from the surface in the dark (where the panel IS the surface); a step darker on hover, no lift.
        subRowWell: {
            flex: "1",
            minWidth: "0",
            display: "flex",
            alignItems: "stretch",
            background: { base: "bg.panel", _dark: "bg.muted" },
            "[data-sub-row]:hover > &": { background: { base: "bg.muted", _dark: "bg.emphasized" } },
        },
        // Its content — lead · detail · id — beside the gutter while the columns scroll sideways.
        subRowContent: {
            position: "sticky",
            display: "flex",
            alignItems: "center",
            gap: "20px",
            width: "100%",
            minWidth: "0",
            boxSizing: "border-box",
            paddingTop: "5px",
            paddingBottom: "5px",
            paddingLeft: "14px",
            paddingRight: "12px",
        },
        // The lead: 220 px — a code and a name. With no detail beside it there is nothing to align with, so the name runs on (wrapping only once the row is full) rather than wrap inside the 220.
        subRowLead: {
            flex: "none",
            width: "220px",
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
            minWidth: "0",
            "[data-sub-row]:not([data-detail]) &": { flex: "0 1 auto", width: "auto", minWidth: "220px" },
        },
        // Every line box in the well is a whole number of pixels — chips 19 (a 15 px line), text lines 18, the small mono beside them shorter so a baseline shift stays inside the 18 — so a sub row, one line or wrapped, is a whole number of pixels tall and never puts the rows below it between pixels.
        subRowCode: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "11px",
            lineHeight: "14px",
            fontWeight: "600",
            letterSpacing: "0.04em",
            color: "fg",
            whiteSpace: "nowrap",
        },
        subRowName: {
            minWidth: "0",
            fontSize: "12.5px",
            lineHeight: "18px",
            color: "fg.strong",
        },
        // The detail: chips, then facets; it wraps and grows the row, never truncated.
        subRowDetail: {
            flex: "1",
            minWidth: "0",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            rowGap: "6px",
            columnGap: "18px",
        },
        subRowChip: {
            fontFamily: "mono",
            fontSize: "11px",
            lineHeight: "15px",
            color: "fg.strong",
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            paddingX: "6px",
            paddingY: "1px",
            whiteSpace: "nowrap",
        },
        subRowFacet: {
            display: "inline-flex",
            alignItems: "baseline",
            gap: "6px",
        },
        subRowFacetLabel: {
            fontFamily: "mono",
            fontSize: "9.5px",
            lineHeight: "14px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        subRowFacetValue: {
            fontSize: "12.5px",
            lineHeight: "18px",
            color: "fg.strong",
        },
        // The id, pinned right so ids align down the sheet whatever the detail's length.
        subRowId: {
            flex: "none",
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "11px",
            lineHeight: "16px",
            fontFeatureSettings: '"tnum" 1',
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        // The chevron before a line's number (Font Awesome's chevron-right in a 10 px square, #1263; ink-3): a disclosure — ink on hover, no hue.
        subRowChevron: {
            position: "absolute",
            left: "0",
            top: "50%",
            transform: "translateY(-50%)",
            width: "16px",
            height: "20px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0",
            border: "none",
            borderRadius: "{radii.sm}",
            background: "transparent",
            color: "fg.muted",
            cursor: "pointer",
            zIndex: "2",
            fontSize: "10px",
            "--fa-width": "1em",
            _hover: { color: "fg", background: "bg.muted" },
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "-1px" },
            // It turns down as the line opens.
            "& svg": { transition: "transform 180ms cubic-bezier(0.2, 0, 0, 1)", "@media (prefers-reduced-motion: reduce)": { transition: "none" } },
            "&[data-open] svg": { transform: "rotate(90deg)" },
        },
    },
    variants: {
        size: {
            sm: { cell: { minHeight: "calc({sizes.density.row.sm} - 1px)", paddingY: "3px", paddingX: "8px" }, runCell: { paddingX: "8px" }, headerCell: { paddingY: "4px", paddingX: "8px" }, strip: { minHeight: "{sizes.density.row.sm}" } },
            md: {},
            lg: { cell: { minHeight: "calc({sizes.density.row.lg} - 1px)", paddingY: "9px", paddingX: "12px" }, runCell: { paddingX: "12px" }, headerCell: { paddingY: "9px", paddingX: "12px" }, strip: { minHeight: "{sizes.density.row.lg}" } },
        },
    },
    defaultVariants: { size: "md" },
});
