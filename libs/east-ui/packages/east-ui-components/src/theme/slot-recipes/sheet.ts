/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sheet slot recipe — the planning spreadsheet's visual vocabulary
 * (`Sheet Spec.md` §7, B§11), every value a semantic token so the dark theme
 * comes for free.
 *
 *   - Card: `bg.surface`, no border of its own (the host frames a component,
 *     as with Plan); 120 px bottom pad. One rule per seam: toolbar and
 *     header `border.strong` below, strip and footer `border.subtle` above.
 *   - Header: sticky, two lines — label mono 10/600/.16em uppercase
 *     `fg.subtle`; sub mono 9 `fg.subtle` ellipsised; 1 px `border.subtle`
 *     column dividers; `border.strong` bottom.
 *   - Gutter: 128 px = rail 28 ·
 *     number 36 · actions 64, the gutter edge `border.strong`. Rail: a 14 px
 *     r-3 checkbox (1 px ink-5, hover ink-3, checked `brand.solid`, mixed
 *     ink-4) on a 1 px ink-5 connector that turns brand through picked rows.
 *     Number: mono 11/500 right-aligned, ink-4 (ink 600 when picked). Actions:
 *     24 px ghost buttons, Font Awesome 13 px ink-4, colour only on hover as an
 *     8 % wash (check pos · xmark neg · arrow-right brand). Inserts are not
 *     gutter content: two 24 px outlined chips (plus · layer-group) on the body
 *     side of the gutter edge, threaded on a 2 px brand insertion line. States:
 *     hover `bg.panel` · picked `brandTint` · group band `bg.panel` · dirty 8 %
 *     warn. A group's identity is its band and the connector — no per-group colour.
 *   - Cells: min-height 36, padding 6/10, 1 px `border.subtle` bottom and
 *     right; text 13 `fg`; mono values 12; ghosts `fg.subtle`; unit mono 9.5.
 *   - Selection: 2 px inset brand ring at inset −1; range wash brandTint at
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
 *   - Footer: 8/20; counts mono 11; key hint mono 10; message mono 10.5
 *     right-aligned; transport mono 10.
 *   - Tabs: 30 px mono 10.5/600/.12em uppercase; active `inset 0 -2px 0`
 *     ink; counts `fg.subtle`; dirty dot 5 px brand; × 14 px → neg;
 *     `+ TAB` 22 px r-sm 1 px `border.strong` mono 9.5/600.
 *   - Context switch: r-md, options mono 10, active brandTint.
 *   - Bands: 22 px; 1 px dashed `border.strong` at 50 %; pill mono 9
 *     `fg.subtle` on `bg.surface` 1 px `border.subtle` r-sm; the lens band's
 *     pill opens on hover (`shadow.xs`) with brand controls.
 *   - A group's band (#740, G1): 40 px `bg.panel`, no extra top rule,
 *     `border.subtle` below (`border.strong` when folded); a 10 px stroke
 *     chevron, ink-3; count mono 10; title
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
 *     pixel grid. A search hit lights the index and the name in brand. While
 *     an open line's sub rows scroll under the group's band, a copy of the line
 *     sticks under the band, `border.strong` below like the band's own copy,
 *     and its last sub row pushes it up as it leaves.
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
 *     a gutter that stays put (`position: sticky`), the toolbar keeps its one
 *     row through its ladder, and on a coarse pointer the small controls grow
 *     (gutter buttons, ✓ take, × close, the band's controls, the context
 *     options, the strip's chips), the editor's type goes to 16 px so a
 *     phone never zooms into it, and the band's controls — hover-revealed on
 *     a desktop — stay open where nothing can hover (`_hoverNone`).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const sheetSlotRecipe = defineSlotRecipe({
    className: "elara-sheet",
    slots: [
        "root", "frame", "card", "body",
        "insertPoint", "insertHit", "insertChips", "insertButton", "insertStrip", "insertChoice",
        "history", "historyActions", "historyStatus", "historyButton", "historyIssues", "historyError",
        "toolbar", "toolbarRailGroup", "toolbarCluster", "toolbarCount", "toolbarBadge",
        "tabs", "tab", "tabLabel", "tabCount", "tabDot", "tabClose", "tabAdd", "tabMore", "tabRename",
        "contextSwitch", "contextLabel", "contextOption",
        "header", "headerGutter", "headerNumber", "headerCell", "headerLabel", "headerSub",
        "row", "rowBlank", "gutter", "rail", "connector", "checkbox", "gutterNumber", "gutterButton", "gutterBar",
        "cell", "cellIssue", "cellText", "cellMono", "cellWord", "cellNum", "cellUnit", "cellRes", "cellGhost", "cellDot",
        "ring", "rangeWash", "hatch", "nextTarget", "takeButton",
        "editor", "editorField", "editorMirror", "editorGhost", "editorInput", "editorResolve", "editorBadge", "editorError",
        "editorNumber", "editorNumberInput", "editorStepper", "editorDate",
        "editorCombobox", "editorMenu", "editorOption", "editorOptionMeta",
        "editorTime",
        "linkGrid", "half", "halfLabel", "chip", "chipDashed", "chipPicked", "chipMeta", "lockTag", "lockWarn", "arrow",
        "band", "bandRule", "bandPill", "bandControl", "bandCount",
        "gutterAction", "groupSummary",
        "groupRow", "groupChevron", "groupCount", "groupTitle", "groupTitleText", "groupSub", "groupCell",
        "strip", "stripLabel", "stripChips", "stripChip", "stripChipOn", "stripChipFlat", "stripMeta", "stripKeys",
        "stripPager", "stripPage", "stripPageCount", "stripMeasure",
        "footer", "footerCounts", "footerHint", "footerMessage", "footerTransport",
        "diagnostic",
        "subRow", "subRowGutter", "subRowIndex", "subRowStem", "subRowWell", "subRowContent", "subRowLead", "subRowCode", "subRowName",
        "subRowDetail", "subRowChip", "subRowFacet", "subRowFacetLabel", "subRowFacetValue", "subRowId", "subRowChevron",
    ],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
            fontFamily: "body",
            color: "fg",
            fontFeatureSettings: '"tnum" 1',
            // the insertion line: 2 px brand on the row boundary, always from the gutter edge (128) to the right edge — it never enters the gutter, whichever side the chips take.
            "& [data-row][data-insert-preview]::after": { content: '""', position: "absolute", left: "128px", right: "0", top: "-1px", height: "2px", background: "brand.solid", pointerEvents: "none", zIndex: "8" },
            // A picked row is one `brandTint` surface — the cells' own range wash would double it.
            "& [data-row][data-picked] [data-slot=rangeWash]": { display: "none" },
            // the lift follows the SEAM, not the gutter: a seam
            // straddles the boundary, so half of it lies over the row above;
            // lifting a merely hovered gutter would cover the seam below it and
            // make it unreachable from that side. The lift clears the open
            // editor (z 10) and its error ring (z 11): chips on the body side
            // of the gutter edge lie over the first cells, editor included.
            "& [data-slot=gutter]:has([data-slot=insertPoint]:hover), & [data-slot=gutter]:focus-within": { zIndex: "12" },
            // Virtual rows have transformed wrappers; lift that stacking context above the sticky header too.
            "& :has(> [data-row] > [data-slot=gutter] [data-slot=insertPoint]:hover), & :has(> [data-row] > [data-slot=gutter]:focus-within [data-slot=insertPoint])": { zIndex: "9" },
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
        },
        // The seam. The point spans the gutter and the 72 px beside it on the
        // row boundary; it takes no pointer itself. Its HIT band (16 px, the
        // gutter's width) is what a pointer finds. The CHIPS sit in the
        // actions column (x 72) — or, when an action button holds that column
        // on either row of the seam, on the body side of the gutter edge (x 140);
        // there their box starts at the edge so the pointer never leaves the
        // seam on the way to them. Inert and invisible until the seam is
        // hovered.
        insertPoint: {
            position: "absolute", left: "0", right: "-72px", top: "-12px", height: "24px", zIndex: "9", pointerEvents: "none",
        },
        insertHit: {
            position: "absolute", left: "0", width: "128px", top: "4px", height: "16px", pointerEvents: "auto",
        },
        insertChips: {
            position: "absolute", left: "128px", top: "0", height: "24px", paddingLeft: "12px",
            display: "flex", alignItems: "center", gap: "4px",
            opacity: "0", pointerEvents: "none",
            "[data-slot=insertPoint][data-side=gutter] &": { left: "72px", paddingLeft: "0" },
            "[data-slot=insertPoint]:hover &, [data-slot=insertPoint]:focus-within &": { opacity: "1", pointerEvents: "auto" },
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
        // the history controls sit in the toolbar's rail group,
        // right of the search (one bar), not in a row of their own.
        history: {
            flexShrink: "0",
            padding: "0",
            background: "transparent",
        },
        historyActions: {
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            flexWrap: "nowrap",
            gap: "{spacing.2}",
        },
        historyStatus: {
            flex: "none",
            whiteSpace: "nowrap",
            fontFamily: "mono",
            fontSize: "xs",
            color: "fg.muted",
        },
        historyButton: {
            flexShrink: "0",
            _coarse: { minWidth: "11", minHeight: "11" },
        },
        historyIssues: {
            display: "flex",
            flexShrink: "0",
            "&[data-empty]": { visibility: "hidden" },
        },
        historyError: {
            marginTop: "{spacing.2}",
            fontSize: "xs",
            color: "fg.danger",
        },
        frame: {
            display: "flex",
            flexDirection: "column",
            minHeight: "0",
        },
        card: {
            background: "bg.surface",
            overflow: "hidden",
            outline: "none",
            position: "relative",
            minHeight: "0",
        },
        body: {
            paddingBottom: "120px",
        },
        // ONE row, always: nothing wraps and nothing scrolls. The rail group
        // takes whatever is left after the tabs, the context switch and the
        // count, and folds its rail to fit — down to the icon, which is the
        // group's floor. Only past that floor do the tabs shrink (and fold
        // into their `+n` menu); at their own floor they report, and the
        // toolbar climbs its ladder (`data-tight`): 1 drops the count, 2 the
        // context label, 3 the `+ TAB` label and the whole-sheet count, 4
        // caps the tab names, 5 drops the context switch, closes the strip
        // up and drops every count.
        // `clip`, not `hidden`: a scroll container's minimum height is 0,
        // and in a fixed-height frame the column flex would squash the row.
        toolbar: {
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "center",
            gap: "{spacing.3}",
            paddingX: "20px",
            paddingY: "8px",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            overflow: "clip",
            flexShrink: "0",
        },
        // Basis 0 and a `min-content` floor: the group is the leftover's
        // taker, never a claimant — the flex algorithm hands it the slack
        // and takes from the tabs only once the group is at its floor.
        toolbarRailGroup: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "{spacing.3}",
            flex: "1 1 0",
            minWidth: "min-content",
        },
        // Inline-size containment: the rail's content never inflates the
        // group's floor (a nested `min-width: auto` would carry every chip
        // up), so the floor is the icon's width. The rail fills the box and
        // hugs its end; past 640px the box stops growing.
        toolbarCluster: {
            display: "flex",
            flex: "1 1 0",
            // The icon rung's trigger: the pill, its gap, the chevron.
            minWidth: "52px",
            maxWidth: "640px",
            contain: "inline-size",
        },
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
        // The strip never scrolls: it folds its trailing tabs into a `+n` menu.
        tabs: {
            display: "flex",
            alignItems: "stretch",
            gap: "16px",
            minWidth: "0",
            flex: "0 1 auto",
            overflow: "hidden",
            // The toolbar's last rung: the strip closes up and its counts go.
            "[data-tight='5'] &": { gap: "10px" },
        },
        tab: {
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "1",
            gap: "7px",
            height: "30px",
            _coarse: { height: "40px" },
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
        },
        // The name ellipsises past 200px, and past 72px once the toolbar's
        // ladder caps it — the count, the dot and the × always show whole.
        tabLabel: {
            minWidth: "0",
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-tight='4'] &, [data-tight='5'] &": { maxWidth: "72px" },
        },
        tabCount: {
            color: "fg.subtle",
            fontWeight: "500",
            // The whole-sheet tab's count is the first thing a tight toolbar drops from the strip; at the last rung every count goes.
            "[data-tight='3'] [data-tab='all'] &, [data-tight='4'] [data-tab='all'] &, [data-tight='5'] &": { display: "none" },
        },
        tabDot: {
            width: "5px",
            height: "5px",
            flex: "none",
            borderRadius: "{radii.full}",
            background: "brand.solid",
        },
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
            _coarse: { width: "24px", height: "24px", fontSize: "12px" },
        },
        tabAdd: {
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "1",
            gap: "4px",
            alignSelf: "center",
            height: "22px",
            paddingX: "7px",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
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
            _coarse: { height: "32px", paddingX: "10px" },
            // Icon-only from the toolbar's third rung; the title still says what it does.
            "[data-tight='3'] &, [data-tight='4'] &, [data-tight='5'] &": { gap: "0", paddingX: "5px", "& > [data-slot=tabAddLabel]": { display: "none" } },
        },
        tabMore: {
            display: "inline-flex",
            alignItems: "center",
            lineHeight: "1",
            gap: "5px",
            height: "30px",
            _coarse: { height: "40px" },
            paddingX: "2px",
            flex: "none",
            color: "fg.subtle",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            letterSpacing: "0.12em",
            whiteSpace: "nowrap",
            cursor: "pointer",
            userSelect: "none",
            _hover: { color: "fg.muted" },
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
        // the switch is the `+ TAB` button's size and idiom
        // (22 px, r-sm, `border.strong`, mono 9.5/600 uppercase), not a taller
        // box of its own.
        contextSwitch: {
            display: "flex",
            alignItems: "center",
            gap: "2px",
            height: "22px",
            paddingX: "3px",
            flex: "none",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            background: "bg.surface",
            _coarse: { height: "32px" },
            // The toolbar's last rung: the tabs keep the row.
            "[data-tight='5'] &": { display: "none" },
        },
        // the label and the options share ONE line box (the
        // same font size, a 20 px line, no vertical padding) so their
        // baselines coincide and every box lands on a whole pixel inside the
        // 30 px switch; before, a 9 px label in a 13.5 px line sat beside
        // 10 px options in 19 px boxes, and the half-pixel offsets showed.
        contextLabel: {
            display: "inline-flex",
            alignItems: "center",
            height: "16px",
            lineHeight: "16px",
            paddingX: "4px",
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            color: "fg.subtle",
            textTransform: "uppercase",
            _coarse: { height: "26px", lineHeight: "26px" },
        },
        contextOption: {
            display: "inline-flex",
            alignItems: "center",
            height: "16px",
            lineHeight: "16px",
            paddingX: "6px",
            paddingY: "0",
            _coarse: { height: "26px", lineHeight: "26px", paddingX: "10px" },
            border: "none",
            background: "transparent",
            borderRadius: "{radii.sm}",
            color: "fg.subtle",
            fontFamily: "mono",
            fontSize: "9.5px",
            cursor: "pointer",
            _hover: { background: "bg.muted", color: "fg.muted" },
            "&[data-on]": { background: "brandTint", color: "brand.fg", fontWeight: "600" },
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
            display: "grid", gridTemplateColumns: "28px 36px 1fr", alignItems: "stretch",
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
            color: { base: "gray.400", _dark: "gray.600" },
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        // row states per the design: hover `bg.panel`, picked `brandTint`, dirty an 8 % warn wash.
        row: {
            display: "grid",
            position: "relative",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            _hover: { background: "bg.panel" },
            "&[data-draft]": { background: "color-mix(in oklch, var(--chakra-colors-status-warn) 8%, var(--chakra-colors-bg-surface))" },
            "&[data-invalid]": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-surface))" },
            "&[data-picked]": { background: "brandTint" },
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
        // the gutter: three columns, three jobs. It is sticky,
        // so it paints its row's own surface (rest · hover · picked · band ·
        // dirty), and its right edge is the gutter edge, `border.strong`.
        gutter: {
            display: "grid",
            gridTemplateColumns: "28px 36px 1fr",
            alignItems: "stretch",
            position: "sticky",
            left: "0",
            zIndex: "5",
            background: "bg.surface",
            borderRightWidth: "1px",
            borderRightColor: "border.strong",
            cursor: "pointer",
            userSelect: "none",
            "[data-row]:hover > &": { background: "bg.panel" },
            "[data-band-row] > &": { background: "bg.panel" },
            "[data-band-row]:hover > &": { background: "bg.muted" },
            "[data-row][data-draft] > &": { background: "color-mix(in oklch, var(--chakra-colors-status-warn) 8%, var(--chakra-colors-bg-surface))" },
            "[data-row][data-invalid] > &": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-surface))" },
            "[data-row][data-picked] > &": { background: "brandTint" },
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
            background: { base: "gray.400", _dark: "gray.600" },
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
            borderColor: { base: "gray.400", _dark: "gray.600" },
            borderRadius: "{radii.xs}",
            background: "bg.surface",
            color: "fg.subtle",
            fontSize: "9px",
            lineHeight: "1",
            cursor: "pointer",
            "[data-row]:hover &": { borderColor: "fg.muted", background: "bg.panel" },
            "[data-band-row] &": { background: "bg.panel" },
            "[data-band-row]:hover &": { background: "bg.muted" },
            "[data-row][data-picked] &": { background: "brandTint" },
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
            "&[data-blank]": { color: { base: "gray.400", _dark: "gray.600" } },
            "&[data-hit]": { color: "brand.solid", fontWeight: "600" },
            "[data-row][data-picked] &": { color: "fg", fontWeight: "600" },
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
            // the header's fold-all: a disclosure, not a decision — the chevrons' ink-3, ink on hover, no hue. Its double chevron turns like theirs: right while every group is folded, down otherwise.
            "&[data-kind=fold]": {
                color: "fg.muted",
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
        cell: {
            position: "relative",
            minHeight: "36px",
            paddingX: "10px",
            paddingY: "6px",
            display: "flex",
            alignItems: "center",
            overflow: "visible",
            cursor: "default",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            minWidth: "0",
            _hover: { background: "bg.panel" },
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
            color: { base: "gray.400", _dark: "gray.600" },
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
            inset: "-1px",
            boxShadow: "inset 0 0 0 2px var(--chakra-colors-brand-solid)",
            pointerEvents: "none",
            zIndex: "4",
            // The row under the sticky header: the header would cover the ring's top pixel, so it stays inside the cell.
            "[data-first] &": { top: "0" },
            // Keep both pixels visible beside the sticky gutter, including group titles.
            "[data-slot=gutter] + [data-slot=cell] > &": { left: "0" },
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
        editorInput: {
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
        // The common date field inside the ring: the segments in the sheet's mono.
        editorDate: {
            flex: "1",
            minWidth: "0",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontFamily: "mono",
            color: "fg",
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
        band: {
            position: "relative",
            height: "22px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            paddingLeft: "138px",
            _coarse: { height: "32px", paddingLeft: "138px" },
        },
        bandRule: {
            position: "absolute",
            left: "0",
            right: "0",
            top: "50%",
            borderTopWidth: "1px",
            borderTopStyle: "dashed",
            borderTopColor: "border.strong",
            pointerEvents: "none",
        },
        bandPill: {
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            paddingX: "10px",
            paddingY: "1px",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            background: "bg.surface",
            fontFamily: "mono",
            fontSize: "9px",
            letterSpacing: "0.06em",
            color: "fg.subtle",
            cursor: "pointer",
            whiteSpace: "nowrap",
            // The lens band's controls open on hover — the only shadow in the sheet (B§11).
            "& [data-slot=bandControl]": { display: "none" },
            "&[data-lens]:hover": { boxShadow: "xs", "& [data-slot=bandControl]": { display: "inline-flex" } },
            // Where nothing can hover they stay open.
            _hoverNone: { "&[data-lens] [data-slot=bandControl]": { display: "inline-flex" } },
            _coarse: { paddingY: "4px", gap: "10px" },
        },
        bandControl: {
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
            paddingX: "4px",
            _coarse: { paddingX: "8px", paddingY: "4px" },
            borderRadius: "{radii.sm}",
            color: "brand.solid",
            fontWeight: "600",
            cursor: "pointer",
            _hover: { background: "brandTint" },
        },
        bandCount: {
            cursor: "pointer",
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
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            _hover: { background: "bg.muted" },
            "&[data-picked]": { background: "brandTint" },
            "&[data-draft]": { background: "color-mix(in oklch, var(--chakra-colors-status-warn) 8%, var(--chakra-colors-bg-panel))" },
            "&[data-invalid]": { background: "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-panel))" },
            "&[data-folded]": { borderBottomColor: "border.strong" },
            // The copy under the header while the group's lines scroll (G1).
            "&[data-slot=stickyBand]": { borderBottomColor: "border.strong" },
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
            // the chevron: 10 px stroke, ink-3; it turns down as the group opens.
            color: "fg.muted",
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
        footer: {
            display: "flex",
            alignItems: "center",
            gap: "18px",
            paddingX: "20px",
            paddingY: "8px",
            background: "bg.surface",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            minWidth: "0",
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
        footerHint: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
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
        footerTransport: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
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
            "[data-sub-row][data-hit] &": { color: "brand.solid", fontWeight: "600" },
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
            color: { base: "brand.700", _dark: "gray.300" },
            "[data-sub-row][data-hit] &": { color: "brand.solid", fontWeight: "600" },
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
            color: { base: "brand.700", _dark: "gray.300" },
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
            color: { base: "brand.700", _dark: "gray.300" },
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
        // The chevron before a line's number (10 px stroke, ink-3): a disclosure — ink on hover, no hue.
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
            _hover: { color: "fg", background: "bg.muted" },
            _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "-1px" },
            // It turns down as the line opens.
            "& svg": { transition: "transform 180ms cubic-bezier(0.2, 0, 0, 1)", "@media (prefers-reduced-motion: reduce)": { transition: "none" } },
            "&[data-open] svg": { transform: "rotate(90deg)" },
        },
    },
    variants: {
        size: {
            sm: { cell: { minHeight: "27px", paddingY: "3px", paddingX: "8px" }, headerCell: { paddingY: "4px", paddingX: "8px" }, strip: { minHeight: "{sizes.density.row.sm}" } },
            md: {},
            lg: { cell: { minHeight: "42px", paddingY: "9px", paddingX: "12px" }, headerCell: { paddingY: "9px", paddingX: "12px" }, strip: { minHeight: "{sizes.density.row.lg}" } },
        },
    },
    defaultVariants: { size: "md" },
});
