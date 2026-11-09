/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Flowchart inspector slot recipe — the layout of the Flowchart's inspector
 * pane (#1504, `Flowchart Records Spec.md` R15–R17): what is selected on the
 * canvas, in parts padded 16px and ruled off one from the next, as the
 * Schematic's, the Sheet's and the Plan's inspectors' are.
 *
 * A state, a transition, a decision or a lane: its head — what it is in mono
 * caps (`STATE · SCN`), its name, its chips: Pending, New, No state row — a
 * key no state is keyed by — and Unresolved — a transition naming one — then
 * its fields: its roles' form over its kind's form, or the author's own
 * Details in the second's place; and its gestures, in one fieldset off while
 * its record takes no edit. Then the transitions it has, in their groups —
 * In, Out, In place — or those it governs, each a control that selects it: its
 * ends, and under them its kind; and a transition's evidence, read only. A
 * lane says how many states it holds, and why its Delete is off. Several
 * states: how many, and the lane they move to. Nothing: the flowchart's
 * counts two to a line, its transitions' split, each record's last save, and
 * its hints. The Issues tab lists the flowchart's issues, each a control that
 * selects what it names — under an unsaved change the rail hides, which of
 * its choices hide it.
 *
 * Every text stands on a line of its own — never beside another — so none is
 * squeezed to a letter's width in a narrow pane, and a long key breaks only
 * where the pane has no room for it; a transition's line is the one row, its
 * kind ellipsizing between its ends and its volume, wrapping where the pane
 * has no room for them.
 *
 * Where the details show (#1510, `Flowchart Records Spec.md` R35–R37), after
 * the head come the reads, 20 apart, in the visual spec's looks: figures side
 * by side in a stats grid, each mono 26 over its label; every other read
 * under its title, its total beside it — tags 20 high, wrapping in their looks
 * (the canvas recipe's `tagLooks`); a histogram's bars 64 high on a rule,
 * each in its bin's slot, darkening under the pointer or focus, its axis and
 * its caption under them; a list's rows, each its name and note, its value
 * and its share over a track filled to its share, then Show n more — and a
 * state's transitions grouped In, Out and In place, each line its ends, its
 * kind and its volume.
 *
 * The parts it lays out as the Sheet's and the Plan's inspectors do are the
 * inspector's shared parts (`inspector.ts`); this adds the Flowchart's own.
 * Its words take the theme's text styles, its controls are the shared
 * `button`, its form is `fieldForm`'s. The pane — its tab row, its collapse
 * control and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { tagLooks } from "./flowchart.js";
import { INSPECTOR_SECTION, inspectorBase, inspectorSlots } from "./inspector.js";

/** A read's label in the pane: mono 10/600, 0.12em apart, in capitals, `--ink-4` (the visual spec's). */
const PANE_LABEL = {
    fontFamily: "mono",
    fontSize: "10px",
    fontWeight: "600",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    lineHeight: "14px",
    color: "fg.subtle",
    overflowWrap: "anywhere",
    minWidth: 0,
} as const satisfies SystemStyleObject;

export const flowchartInspectorSlotRecipe = defineSlotRecipe({
    className: "elara-flowchart-inspector",
    slots: [
        ...inspectorSlots,
        "edits", "rowForms", "roleForms", "custom", "section", "fact", "why",
        "links", "linkGroup", "link", "linkText", "linkMeta", "linkVolume",
        "reads", "readsWeighed", "readStats", "readStat", "readStatLine", "readStatValue", "readStatUnit", "readStatLabel",
        "read", "readHead", "readTitle", "readTotal", "readTags", "tag",
        "histogram", "bars", "binSlot", "bin", "axis", "tick", "caption",
        "listRows", "listRow", "listNameLine", "listName", "listNote", "listValue", "listShare", "listTrack", "listFill",
        "showMore", "noData", "placeholder",
        "issueList", "issueItem", "issueWhere", "issueMessage", "issueHidden",
    ],
    base: {
        ...inspectorBase,
        /* What is selected, in mono caps: a long key breaks where the pane has no room for it. */
        eyebrow: { ...inspectorBase.eyebrow, overflowWrap: "anywhere" },
        /* A draft's chip, and the Flowchart's two more: No state row — a key no state is keyed by — and Unresolved — a
         * transition naming one. */
        chip: {
            ...inspectorBase.chip,
            "&[data-state=noRow]": { background: "bg.subtle", borderColor: "border.strong", color: "fg.warning" },
            "&[data-state=unresolved]": { background: "bg.subtle", borderColor: "border.strong", color: "fg.warning" },
        },
        /* Nothing selected: the flowchart's counts, two to a line — each column never narrower than its longest word, so a
         * count's label in caps is never broken (in a phone's 232px pane TRANSITIONS draws 98.8px, an even half 93.5px),
         * and the two even wherever both fit. */
        stats: { ...inspectorBase.stats, gridTemplateColumns: "repeat(2, minmax(min-content, 1fr))" },
        /* The edit controls' fieldset: no frame of its own. */
        edits: { border: "0", padding: "0", margin: "0", minWidth: 0, display: "flex", flexDirection: "column" },
        /* A row's fields: its roles' form over its kind's form, as one part — the two spaced as one form's fields are. */
        rowForms: { ...INSPECTOR_SECTION, gap: "{spacing.4}" },
        /* A row's roles: its key's form — and a key of several parts' Set key — over the roles' own, spaced as one form's
         * fields are, so a changed field's tint never meets the field beside it. */
        roleForms: { display: "flex", flexDirection: "column", gap: "{spacing.4}", minWidth: 0 },
        /* The author's own Details, in place of the kind's form. */
        custom: { ...INSPECTOR_SECTION, gap: "{spacing.2}" },
        /* A part under the form: a row's transitions, a lane's states, the flowchart's split and its last saves, a
         * transition's evidence. */
        section: { ...INSPECTOR_SECTION, gap: "{spacing.2}" },
        /* One fact, a line of its own. */
        fact: { textStyle: "body.sm", color: "fg.muted", overflowWrap: "anywhere", textWrap: "pretty" },
        /* Why a gesture is off — a lane holding states — under its button. */
        why: { flexBasis: "100%", textStyle: "body.sm", color: "fg.muted", textWrap: "pretty" },
        /* The transitions a state has or a decision governs: each a control that selects it. */
        links: { display: "flex", flexDirection: "column", gap: "{spacing.1}", margin: "0", padding: "0", listStyle: "none", minWidth: 0 },
        /* A group's head in a state's transitions — In · 2, Out · 1, In place · 1 — mono 9.5/600, 0.14em apart, nearer
         * the list it heads than the one before it (the visual spec's). */
        linkGroup: {
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            lineHeight: "13.3px",
            color: "fg.subtle",
            overflowWrap: "anywhere",
            marginTop: "{spacing.1}",
        },
        /* A transition (R37): its ends, its kind and its volume on one row — the kind ellipsizing between them, the
         * row wrapping where the pane has no room — on a coarse pointer a 44px row. */
        link: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            columnGap: "8px",
            rowGap: "2px",
            width: "100%",
            minWidth: 0,
            paddingY: "4px",
            paddingX: "0",
            border: "0",
            background: "transparent",
            textAlign: "start",
            cursor: "pointer",
            color: "fg.strong",
            _hover: { color: "fg" },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" },
            _coarse: { minHeight: "44px", alignContent: "center" },
        },
        linkText: {
            flex: "0 1 auto",
            minWidth: 0,
            fontFamily: "mono",
            fontSize: "12.5px",
            fontWeight: "400",
            color: "fg.strong",
            overflowWrap: "anywhere",
        },
        linkMeta: {
            flex: "1 1 0",
            minWidth: "48px",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "400",
            color: "fg.subtle",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        linkVolume: {
            flexShrink: 0,
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "500",
            color: "fg.strong",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
        },
        /* ── the reads (#1510, R35, R36): after the head, 20 apart ─────── */
        reads: { ...INSPECTOR_SECTION, gap: "20px" },
        /* Over reads the rail's picks weigh, the line naming them (#1522, R46): `Service · Standard, Priority`. */
        readsWeighed: { textStyle: "body.sm", color: "fg.muted", overflowWrap: "anywhere", textWrap: "pretty", minWidth: 0 },
        /* Figures side by side, two to a line, sharing the stats grid: each its value and its unit over its label. */
        readStats: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px", minWidth: 0 },
        readStat: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
        /* The value, then its unit on its baseline, 4 after it — under it where the column has no room. */
        readStatLine: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: "4px", minWidth: 0 },
        /* The unit, as a card's: mono 10/400 `--ink-4` — on a 14px line, which reaches no lower than the value's. */
        readStatUnit: { fontFamily: "mono", fontSize: "10px", fontWeight: "400", lineHeight: "14px", color: "fg.subtle", overflowWrap: "anywhere", minWidth: 0 },
        readStatValue: {
            fontFamily: "mono",
            fontSize: "26px",
            fontWeight: "600",
            lineHeight: "26px",
            color: "fg",
            overflowWrap: "anywhere",
            fontVariantNumeric: "tabular-nums",
        },
        readStatLabel: PANE_LABEL,
        /* Every other read: its title and its total over it, 8 apart. */
        read: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
        readHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", minWidth: 0 },
        readTitle: PANE_LABEL,
        readTotal: {
            flexShrink: 0,
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "400",
            color: "fg.muted",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
        },
        /* Every tag, 20 high, wrapping 4 apart. */
        readTags: { display: "flex", flexWrap: "wrap", gap: "4px", minWidth: 0 },
        tag: {
            display: "inline-flex",
            alignItems: "center",
            boxSizing: "border-box",
            height: "20px",
            /* The Tag's own least height never grows it: Chakra's, 20 at its size md. */
            minHeight: "20px",
            paddingX: "8px",
            paddingY: "0",
            gap: "0",
            borderWidth: "1px",
            borderStyle: "solid",
            borderRadius: "4px",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "500",
            lineHeight: "10px",
            whiteSpace: "nowrap",
            ...tagLooks,
        },
        /* A histogram across the pane: its bars 64 high on a rule, its axis, its caption. */
        histogram: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
        bars: {
            position: "relative",
            boxSizing: "border-box",
            height: "64px",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
        },
        /* A bin's slot, the bars' whole height: what the pointer and the keys rest on; its place the pane's. */
        binSlot: {
            position: "absolute",
            top: 0,
            bottom: 0,
            display: "flex",
            alignItems: "flex-end",
            cursor: "default",
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "1px" },
        },
        /* Its bar, `--brand-d`; under the pointer or focus, `--brand-dd`. */
        bin: {
            width: "100%",
            background: "brand.solid",
            "[data-active] > &": { background: "brandPressed" },
        },
        axis: { position: "relative", height: "16px" },
        tick: {
            position: "absolute",
            top: 0,
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "400",
            lineHeight: "16px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        caption: { fontFamily: "body", fontSize: "12.5px", fontWeight: "400", lineHeight: "18.75px", color: "fg.muted", overflowWrap: "anywhere" },
        /* A list's rows, 8 apart: each its name and note, its value and its share, over its track. */
        listRows: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
        listRow: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto 40px",
            columnGap: "12px",
            rowGap: "4px",
            alignItems: "baseline",
        },
        listNameLine: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" },
        listName: {
            flex: "0 1 auto",
            minWidth: 0,
            fontFamily: "body",
            fontSize: "13px",
            fontWeight: "400",
            color: "fg",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        listNote: { flexShrink: 0, fontFamily: "mono", fontSize: "10px", fontWeight: "400", color: "fg.subtle", whiteSpace: "nowrap" },
        listValue: { fontFamily: "mono", fontSize: "11px", fontWeight: "500", color: "fg.muted", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
        listShare: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            color: "fg",
            textAlign: "right",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
        },
        listTrack: { gridColumn: "1 / -1", position: "relative", height: "4px", background: "border.subtle", overflow: "hidden" },
        listFill: { position: "absolute", top: 0, bottom: 0, left: 0, background: "brand.solid" },
        /* Show n more, and Show fewer once open: mono 10.5/600 in the brand, under the rows. */
        showMore: {
            alignSelf: "flex-start",
            padding: "0",
            border: "0",
            background: "transparent",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            letterSpacing: "0.06em",
            color: "brand.solid",
            cursor: "pointer",
            _hover: { color: "brandPressed" },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" },
        },
        /* *No data* and *none* (R33, R41). */
        noData: { fontFamily: "mono", fontSize: "10px", fontWeight: "400", fontStyle: "italic", lineHeight: "16px", color: "fg.subtle" },
        /* A read not landed (R34): the shared placeholder shapes in its place. */
        placeholder: {
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            "&[data-place=stat]": { height: "26px" },
            "&[data-place=tags]": { height: "20px" },
            "&[data-place=bars]": { height: "84px", borderRadius: "2px" },
            "&[data-place=row]": { height: "24px" },
        },
        /* The Issues tab: every issue of the flowchart, each a control. */
        issueList: { display: "flex", flexDirection: "column", minWidth: 0, margin: "0", padding: "0", listStyle: "none" },
        /* An issue: where it is, over what it is — its two lines in their padding taller than a 44px tap target, on any pointer. */
        issueItem: {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "2px",
            width: "100%",
            paddingX: "{spacing.4}",
            paddingY: "10px",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
            background: "transparent",
            textAlign: "left",
            cursor: "pointer",
            _hover: { background: "bg.subtle" },
            _focusVisible: { outline: "none", boxShadow: "{shadows.focusInset}" },
        },
        issueWhere: { textStyle: "mono.xs", color: "fg.subtle", letterSpacing: "0.06em", textTransform: "uppercase", overflowWrap: "anywhere" },
        issueMessage: {
            textStyle: "body.sm",
            color: "fg.warning",
            overflowWrap: "anywhere",
            "&[data-kind=invalid]": { color: "fg.danger" },
        },
        /* Under an unsaved change the rail hides: which of its choices hide it. */
        issueHidden: { textStyle: "body.sm", color: "fg.muted", overflowWrap: "anywhere" },
    },
});
