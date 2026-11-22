/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio inspector slot recipe — the layout of the builder's inspector pane's
 * body, as the Studio spec draws it under the pane's tab row: the selected
 * placement's name and what it is, the datasets it reads, its description on
 * the quiet panel with its lock, and its layout fields, over the pane's
 * footer; with nothing selected, what to do.
 *
 * Its Configure tab (#1672) is measured from the spec's builder mock and its
 * editor's part cards: sections 16px in, ruled apart, each a stack of fields —
 * a label (Inter 12.5 / 500, `--ink-2`) 6px over its control, a hint under it
 * — or of wells. Its controls are the tab's own slots, drawn as the design
 * system draws them:
 *
 * - **box** — a select's trigger: 32px, `--rule-strong`, radius 6, an icon,
 *   its words and a chevron.
 * - **seg** — a segment group filling its row: 32px of icons, or 24px of mono
 *   10.5 / 600 capitals; the chosen segment on `--brand-tint` in `--brand-dd`.
 *   A group whose names do not fit its row — a pane narrowed by its scroll bar
 *   — stacks them, one 28px row each, so no name is ever cut.
 * - **pill** — what a well holds: 32px, its field's kind, its name, a note in
 *   mono 10, its aggregate on `--paper-3` and its remove; a field its source
 *   lacks dashed in `--neg`. An empty place is the dashed **wellSlot**, which
 *   a field dragged over it tints.
 * - **menu** — a pill's menu: a head, 32px items with their icons, a rule and
 *   its form.
 * - the source's fields, last: a search box and 32px rows — a grip, the kind,
 *   the name, the unit and a check once a well holds it.
 * - a visual's **alerts** (#1674), where the builder was given their record:
 *   the popover list's rows in a box of the tab's own, New alert under them;
 *   one edited, its fields 12px apart over a foot of its actions — its Now's
 *   table edge to edge in the pane, as a narrow Table is drawn to stand.
 *
 * A field or a well an edit changed is tinted until the page is saved
 * (EDT-10), as a changed field of a form is (`fieldForm`). A form drawn inside
 * the tab — a kind's options, a pill's menu — takes the tab's field label.
 *
 * Only the layout is the inspector's own on the Layout tab: its controls there
 * are the shared `stepper`, `input`, `select` and `seg` strip. The pane itself
 * — its tab row, its collapse control and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fieldFocusRing, fieldInRingedControl } from "../field-chrome.js";
import { centredLine, oneLineBox } from "../one-line-box.js";

/** One of the body's sections, ruled off from the next. */
const SECTION = {
    display: "flex",
    flexDirection: "column",
    padding: "{spacing.4}",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "border.subtle",
} as const;

/**
 * A field or a well an edit changed, until the page is saved (EDT-10): tinted
 * with the brand as a changed field of a form is (the `fieldForm` recipe), the
 * tint spread past it without moving it — 4px, inside the 12px between the
 * tab's fields, so two changed fields' tints never meet.
 */
const CHANGED = {
    borderRadius: "{radii.sm}",
    "&[data-changed]": {
        background: "brandTint",
        boxShadow: "0 0 0 4px {colors.brandTint}",
    },
} as const;

/** A small label: mono 10 / 600 capitals in `--ink-4`, on a 12px line. */
const LBL = {
    fontFamily: "mono",
    fontSize: "{fontSizes.label.sm}",
    fontWeight: "{fontWeights.semibold}",
    letterSpacing: "0.12em",
    lineHeight: "12px",
    textTransform: "uppercase",
    color: "fg.subtle",
} as const;

/** A field's label: Inter 12.5 / 500 in `--ink-2`, on a 15px line. */
const FIELD_LABEL = {
    fontFamily: "body",
    fontSize: "{fontSizes.body.sm}",
    fontWeight: "{fontWeights.medium}",
    letterSpacing: "0",
    lineHeight: "15px",
    textTransform: "none",
    color: "fg.strong",
} as const;

/**
 * A form drawn inside the tab (`FieldForm`: a kind's options, a pill's menu):
 * its fields 12px apart, each label the tab's own, 6px over its control, and a
 * control the tab draws itself standing no taller than it is.
 */
const FORM = {
    "& [data-field-form]": { gap: "{spacing.3}" },
    "& [data-scope=field][data-part=label]": { ...FIELD_LABEL, marginBottom: "2px" },
    "& [data-editor=custom] [data-field-line]": { minHeight: "0" },
} as const;

/**
 * A line of words under a control — a hint, what a well says: Inter 12.5 on a
 * whole 19px line (the spec's 18.75px, so what stands under it starts on a
 * whole pixel).
 */
const SAID = { fontFamily: "body", fontSize: "{fontSizes.body.sm}", lineHeight: "19px" } as const;

/** An icon's box: the mark sized by its font, as wide as it is tall. */
const icon = (size: string) => ({ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size, "--fa-width": "1em" }) as const;

export const studioInspectorSlotRecipe = defineSlotRecipe({
    className: "elara-studio-inspector",
    slots: [
        "root", "selection", "eyebrow", "lbl", "name", "meta",
        "data", "reads", "read", "noReads",
        "config", "configHead", "lockNote", "description",
        "layout", "field", "fieldLabel", "rowField", "heightField",
        "footer", "empty", "emptyTitle", "emptyHint",
        "part", "form", "fld", "fldLabel", "fldHint",
        "box", "boxIcon", "boxName", "boxCaret", "match", "matchEquals", "stop",
        "seg", "segItem",
        "wells", "well", "wellSlots", "wellSlot", "wellHelp", "wellError",
        "pill", "pillKind", "pillOpen", "pillName", "pillNote", "pillAgg", "pillRemove",
        "menu", "menuHead", "menuItem", "menuItemIcon", "menuRule", "menuForm",
        "fields", "fieldsHead", "count", "fieldSearch", "fieldSearchIcon", "fieldSearchInput", "fieldRows", "fieldRow", "fieldGrip", "fieldKind", "fieldName",
        "fieldUnit", "fieldCheck", "fieldNone",
        "alerts", "alertEditor", "alertFoot", "alertFootStart", "alertFootActions",
    ],
    base: {
        root: {
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            background: "bg.surface",
        },
        /* The selected placement: its name and its component's key. */
        selection: { ...SECTION, gap: "{spacing.1}" },
        eyebrow: { textStyle: "caption.eyebrow" },
        /* The tab's small label: the head's, a well's, a menu's and the fields' — a group of fields' 6px further under what is over it. */
        lbl: { ...LBL, "&[data-fields-group]": { paddingTop: "6px" } },
        /* The placement's name: DM Sans 16 / 600 on a 21px line. */
        name: { fontFamily: "heading", fontSize: "{fontSizes.title.sm}", fontWeight: "{fontWeights.semibold}", lineHeight: "21px", color: "fg", overflowWrap: "anywhere" },
        /* What it is — `chart · column · orders` — mono 10.5 on a 13px line. */
        meta: { fontFamily: "mono", fontSize: "{fontSizes.label.md}", lineHeight: "13px", color: "fg.subtle", overflowWrap: "anywhere" },
        /* What its component's code reads, each named in words: the body's face, as a name, never a keypath's. */
        data: { ...SECTION, gap: "10px" },
        reads: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            margin: "0",
            padding: "0",
            listStyle: "none",
        },
        read: { textStyle: "body.sm", color: "fg", overflowWrap: "anywhere" },
        noReads: { textStyle: "body.sm", color: "fg.subtle" },
        /* Its description, fixed by its developer, on the quiet panel. */
        config: { ...SECTION, gap: "9px", background: "bg.panel" },
        configHead: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.3}",
        },
        lockNote: {
            textStyle: "mono.xs",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            color: "fg.subtle",
            "& svg": { fontSize: "9px" },
        },
        description: {
            textStyle: "body.sm",
            margin: "0",
            /* Strong secondary ink, `--ink-2`. */
            color: "fg.strong",
            "&[data-empty]": { color: "fg.subtle" },
        },
        /* Its layout: one row per field, its label and its control. */
        layout: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.3}",
            padding: "{spacing.4}",
        },
        field: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.3}",
        },
        fieldLabel: { textStyle: "body.sm", color: "fg" },
        rowField: { flex: "none", width: "72px" },
        heightField: { flex: "none", width: "96px" },
        footer: {
            textStyle: "mono.xs",
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.3}",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "border.subtle",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "fg.subtle",
            "& svg": { fontSize: "9px" },
        },
        /* Nothing selected: what to do. */
        empty: {
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "{spacing.2}",
            padding: "{spacing.6}",
            textAlign: "center",
        },
        emptyTitle: { textStyle: "caption.eyebrow" },
        emptyHint: { textStyle: "body.sm", maxWidth: "220px", color: "fg.muted", textWrap: "pretty" },
        /* The Configure tab's sections (#1672): fields 12px apart, ruled off from the next section. */
        part: { ...SECTION, gap: "{spacing.3}", ...FORM },
        /* A form among a section's fields: a kind's options. */
        form: { display: "flex", flexDirection: "column", minWidth: 0 },
        /* A field: its label 6px over its control, its hint under it; tinted while changed. */
        fld: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, ...CHANGED },
        fldLabel: FIELD_LABEL,
        fldHint: { ...SAID, color: "fg.subtle" },
        /* A select's trigger: 32px, its icon, its words and a chevron. */
        box: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            width: "100%",
            height: "{spacing.8}",
            paddingInline: "{spacing.3} 10px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            background: "bg.surface",
            color: "fg",
            textAlign: "start",
            cursor: "pointer",
            _hover: { background: "bg.canvas" },
            /* The one focus ring, as every field of a form wears it — and while its choices are open. */
            _focusVisible: fieldFocusRing,
            "&[aria-expanded=true]": fieldFocusRing,
        },
        boxIcon: { ...icon("14px"), color: "fg.subtle" },
        /* Its words: Inter 13 on a 16px line, 7px under the box's edge. */
        boxName: {
            flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "body", fontSize: "{fontSizes.body}", lineHeight: centredLine(30, 16),
        },
        boxCaret: { ...icon("10px"), color: "fg.subtle" },
        /* A match (#1673): the leader's field's box and this visual's, sharing the row, an equals sign between them. */
        match: {
            display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: "{spacing.2}", minWidth: "0",
        },
        matchEquals: { fontFamily: "mono", fontSize: "label.sm", color: "fg.subtle" },
        /* Stop following: a small button at its block's start, never as wide as its row. */
        stop: { alignSelf: "flex-start" },
        /* A segment group filling its row: 32px of icons, or 24px of words. */
        seg: {
            display: "grid",
            gridAutoFlow: "column",
            gridAutoColumns: "minmax(0, 1fr)",
            width: "100%",
            minWidth: 0,
            height: "{spacing.8}",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            background: "bg.surface",
            "&[data-size=sm]": { height: "{spacing.6}" },
            /* Inside a pill — a combo's value's side — it is as wide as its words. */
            "&[data-fit]": { width: "auto", flex: "none", gridAutoColumns: "auto" },
            /* Its names wider than its row: one row a segment. */
            "&[data-stack]": { display: "flex", flexDirection: "column", height: "auto" },
        },
        segItem: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            minWidth: 0,
            paddingInline: "{spacing.2}",
            fontFamily: "mono",
            fontSize: "{fontSizes.label.md}",
            fontWeight: "{fontWeights.semibold}",
            letterSpacing: "0.16em",
            /* One line of words at the middle of the 22px inside a small group's edge, the 30px inside a group of icons', or a
             * stacked group's 28px row. */
            lineHeight: centredLine([22, 28, 30], 14),
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            color: "fg.subtle",
            background: "transparent",
            cursor: "pointer",
            "& > span": { overflow: "hidden", textOverflow: "ellipsis" },
            "& svg": { flex: "none", fontSize: "14px", "--fa-width": "1em" },
            "& + &": { borderInlineStartWidth: "1px", borderInlineStartStyle: "solid", borderInlineStartColor: "border.strong" },
            /* The group's 6px corner, less its edge, on its end segments. */
            "&:first-of-type": { borderStartStartRadius: "5px", borderEndStartRadius: "5px" },
            "&:last-of-type": { borderStartEndRadius: "5px", borderEndEndRadius: "5px" },
            _hover: { background: "bg.canvas", color: "fg.strong" },
            '&[data-state="on"]': { background: "brandTint", color: "brand.fg" },
            _disabled: { color: "fg.faint", cursor: "not-allowed", background: "transparent" },
            /* The segments sit edge to edge inside the group's edge: the ring is drawn inside the segment. */
            "&:focus-visible": { outlineWidth: "2px", outlineStyle: "solid", outlineColor: "border.focus", outlineOffset: "-2px" },
            "[data-fit] > &": { paddingInline: "6px" },
            /* Stacked: a 28px row, its icon and name from the start, ruled from the row over it; the group's corners on its
             * first and last rows. */
            "[data-stack] > &": {
                flex: "none", height: "28px", justifyContent: "flex-start", paddingInline: "10px", borderRadius: "0",
                /* A row under another: its rule over its own 28px, so its name still starts on a whole pixel. */
                "&:not(:first-of-type)": {
                    height: "29px", borderInlineStartWidth: "0", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong",
                },
                "&:first-of-type": { borderStartStartRadius: "5px", borderStartEndRadius: "5px" },
                "&:last-of-type": { borderEndStartRadius: "5px", borderEndEndRadius: "5px" },
            },
        },
        /* A visual's wells: one section, 14px apart. */
        wells: { ...SECTION, gap: "14px" },
        /* One well: its label 6px over its pills, then what it says under them; tinted while changed. */
        well: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, ...CHANGED },
        wellSlots: { display: "flex", flexDirection: "column", gap: "{spacing.1}", minWidth: 0, borderRadius: "{radii.md}" },
        /* An empty place: dashed, as a placeholder is — `Add a value`; a field dragged over its well tints it. */
        wellSlot: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            width: "100%",
            height: "{spacing.8}",
            paddingInline: "10px",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            fontFamily: "body",
            fontSize: "{fontSizes.body.sm}",
            lineHeight: centredLine(30, 16),
            color: "fg.subtle",
            textAlign: "start",
            cursor: "pointer",
            "& svg": { flex: "none", fontSize: "11px", "--fa-width": "1em" },
            _hover: { color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            "&[data-drop]": { background: "brandTint", borderColor: "brand.solid", color: "brand.fg" },
        },
        wellHelp: { ...SAID, color: "fg.subtle" },
        /* A pill whose field the source does not have: what it says replaces the well's help. */
        wellError: { ...SAID, color: "fg.danger" },
        /* One pill: 32px, its kind, its name and what it is set to, and its remove. */
        pill: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minWidth: 0,
            height: "{spacing.8}",
            paddingInline: "10px {spacing.1}",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            background: "bg.surface",
            /* A field its source does not have: dashed in the danger's edge, its name in the danger's ink. */
            "&[data-missing]": { borderStyle: "dashed", borderColor: "status.neg" },
            /* A field dragged over it, which a drop would put in its place. */
            "&[data-drop-active]": { borderStyle: "dashed", borderColor: "brand.solid", background: "brandTint" },
        },
        /* Its field's kind, 11px in a 14px box; a list well's pill moves by it. */
        pillKind: {
            ...icon("11px"),
            width: "14px",
            height: "{spacing.6}",
            color: "fg.subtle",
            "[data-missing] > &": { color: "status.neg" },
            borderRadius: "{radii.xs}",
            _focusVisible: { outline: "none", boxShadow: "focus" },
            "&[data-pill-grip]": { cursor: "grab" },
            /* A single well's: it opens the chooser of another field. */
            "&[data-pill-field]": { cursor: "pointer", _hover: { color: "fg" } },
        },
        /* Its name and what it is set to: one button, which opens its menu. */
        pillOpen: {
            flex: 1,
            minWidth: 0,
            alignSelf: "stretch",
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            textAlign: "start",
            cursor: "pointer",
            borderRadius: "{radii.sm}",
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        pillName: {
            flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "body", fontSize: "{fontSizes.body}", lineHeight: centredLine(30, 16), color: "fg",
            "[data-missing] &": { color: "fg.danger" },
        },
        /* What it is set to beyond its aggregate — `goal 450k`, `top 2 + Other` — mono 10 on a 12px line. */
        pillNote: { flex: "none", fontFamily: "mono", fontSize: "{fontSizes.label.sm}", lineHeight: centredLine(30, 12), color: "fg.subtle", whiteSpace: "nowrap" },
        /* Its aggregate, or a date's bucket: 22px on `--paper-3`, mono 10 / 600 capitals and a chevron. */
        pillAgg: {
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1}",
            ...oneLineBox(22, 0),
            paddingInline: "6px",
            borderRadius: "{radii.sm}",
            background: "bg.subtle",
            color: "fg.muted",
            fontFamily: "mono",
            fontSize: "{fontSizes.label.sm}",
            fontWeight: "{fontWeights.semibold}",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            "& svg": { flex: "none", fontSize: "8px", "--fa-width": "1em" },
        },
        pillRemove: {
            ...icon("14px"),
            width: "{spacing.6}",
            height: "{spacing.6}",
            color: "fg.muted",
            borderRadius: "{radii.md}",
            cursor: "pointer",
            _hover: { background: "bg.subtle", color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        /* A pill's menu: a head, its items, a rule and its form. */
        menu: { display: "flex", flexDirection: "column", minWidth: 0, padding: "{spacing.1}", ...FORM },
        menuHead: { ...LBL, padding: "{spacing.2} {spacing.2} {spacing.1}" },
        menuItem: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            width: "100%",
            height: "{spacing.8}",
            paddingInline: "{spacing.2}",
            borderRadius: "{radii.sm}",
            fontFamily: "body",
            fontSize: "{fontSizes.body}",
            lineHeight: centredLine(32, 16),
            color: "fg",
            textAlign: "start",
            cursor: "pointer",
            _hover: { background: "bg.canvas" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            '&[aria-checked="true"]': { background: "brandTint", color: "brand.fg" },
        },
        menuItemIcon: { ...icon("11px"), width: "14px", color: "fg.subtle", '[aria-checked="true"] > &': { color: "brand.fg" } },
        menuRule: { height: "1px", marginBlock: "{spacing.1}", background: "border.subtle" },
        menuForm: { display: "flex", flexDirection: "column", gap: "10px", padding: "6px {spacing.2} {spacing.2}", minWidth: 0 },
        /* The source's fields, last: a section 8px apart, with no rule under it. */
        fields: { ...SECTION, gap: "{spacing.2}", borderBottomWidth: "0" },
        fieldsHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "{spacing.3}", minHeight: "{spacing.4}" },
        /* How many: a 16px chip on `--paper-3`, mono 9.5 / 500. */
        count: {
            flex: "none", display: "inline-block", minWidth: "{spacing.4}", ...oneLineBox(16, 0), paddingInline: "{spacing.1}", borderRadius: "{radii.sm}",
            background: "bg.subtle", color: "fg.muted", fontFamily: "mono", fontSize: "{fontSizes.label.xs}", fontWeight: "{fontWeights.medium}", textAlign: "center",
        },
        /* The fields' search: a 32px box, a magnifier and what is typed. */
        fieldSearch: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            height: "{spacing.8}",
            paddingInline: "{spacing.3} 10px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            background: "bg.surface",
            _focusWithin: fieldFocusRing,
        },
        fieldSearchIcon: { ...icon("14px"), color: "fg.subtle" },
        /* What is typed: the box around it carries the one focus ring, so it draws none of its own. */
        fieldSearchInput: {
            flex: 1, minWidth: 0, alignSelf: "stretch", background: "transparent", outline: "none", appearance: "none",
            fontFamily: "body", fontSize: "{fontSizes.body}", color: "fg",
            _placeholder: { color: "fg.subtle" },
            ...fieldInRingedControl,
            "&::-webkit-search-cancel-button": { display: "none" },
        },
        fieldRows: { display: "flex", flexDirection: "column", minWidth: 0, margin: "0", padding: "0", listStyle: "none" },
        /* One field: 32px — its grip, its kind, its name, its unit and a check once a well holds it. */
        fieldRow: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            minWidth: 0,
            height: "{spacing.8}",
            borderRadius: "{radii.sm}",
            "&[data-draggable]": { cursor: "grab" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        fieldGrip: { ...icon("11px"), width: "7px", color: "fg.faint" },
        fieldKind: { ...icon("11px"), width: "14px", color: "fg.subtle" },
        fieldName: {
            flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "body", fontSize: "{fontSizes.body}", lineHeight: centredLine(32, 16), color: "fg",
        },
        fieldUnit: { flex: "none", fontFamily: "mono", fontSize: "{fontSizes.label.sm}", lineHeight: centredLine(32, 12), color: "fg.subtle", whiteSpace: "nowrap" },
        fieldCheck: { ...icon("12px"), color: "status.pos" },
        fieldNone: { ...SAID, color: "fg.subtle" },
        /* A visual's alerts, listed (#1674): the popover list's rows — edge to edge, fenced by a hairline — in a box of the
           tab's own edge, as a select's is. */
        alerts: {
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "{radii.md}", background: "bg.surface",
            overflow: "hidden", minWidth: 0,
        },
        /* One alert, edited in place: its fields 12px apart, as its popover's body runs them, then its foot. */
        alertEditor: {
            display: "flex", flexDirection: "column", gap: "{spacing.3}", minWidth: 0,
            /* Now's table runs edge to edge in the pane, past the section's 16 either side, with no edge of its own there: a
               narrow Table keeps 16 before its first column's words and after its last's, so they stand on the section's own
               edges, and its columns have the pane's whole width — a row of three stands side by side, which the 32 an
               inset box took put a page of columns away. */
            "& [data-studio-alert-rows]": { marginInline: "calc(-1 * {spacing.4})", borderInlineWidth: "0" },
        },
        /* Its foot: Delete at its start, Cancel and Save at its end — over a hairline, 12px under its fields. */
        alertFoot: {
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "{spacing.2}", minWidth: 0,
            paddingTop: "{spacing.3}", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
        },
        alertFootStart: { display: "inline-flex", alignItems: "center", minWidth: 0 },
        alertFootActions: { display: "inline-flex", alignItems: "center", gap: "{spacing.2}", marginInlineStart: "auto" },
    },
});
