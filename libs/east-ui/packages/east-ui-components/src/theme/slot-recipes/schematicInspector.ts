/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Schematic inspector slot recipe — the layout of the Schematic's inspector
 * pane (#1391, `Schematic Builder Spec.md` §9): what is selected on the
 * canvas, in sections padded 16px and ruled off one from the next, as the
 * Plan's, the Sheet's and the Flowchart's inspectors' are.
 *
 * An item, a zone, a link, a net or a net's leg: its head — its kind's icon
 * tile beside its kind, its name, where it stands and its status, and its
 * chip: Pending or New (the Plan's and the Calendar's head) — its kind's form,
 * or the author's own Details in its place, its details record's form, and
 * its gestures, in one fieldset off while its record takes no edit; then what
 * it is joined to — an item's links and nets, each a control that selects it
 * — and facts on lines of their own. Several: how many of each kind, and
 * Delete. Nothing: the counts two to a line and each record's last save. The
 * Issues tab lists the drawing's issues, each a control that selects what it
 * names.
 *
 * Every text stands on a line of its own — never beside another — so none is
 * squeezed to a letter's width in a narrow pane, and a long key breaks only
 * where the pane has no room for it.
 *
 * The parts it lays out as the other inspectors do are the inspector's shared
 * parts (`inspector.ts`); this adds the Schematic's own. Its words take the
 * theme's text styles, its controls are the shared `button`, its form is
 * `fieldForm`'s. The pane — its tab row, its collapse control and its rail —
 * is the Dock's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { INSPECTOR_SECTION, INSPECTOR_STATUS, inspectorBase, inspectorSlots } from "./inspector.js";

export const schematicInspectorSlotRecipe = defineSlotRecipe({
    className: "elara-schematic-inspector",
    slots: [
        ...inspectorSlots,
        "headRow", "kindTile", "headText", "when", "status",
        "edits", "custom", "section", "fact", "why",
        "links", "link", "linkText", "linkMeta",
        "issueList", "issueItem", "issueWhere", "issueMessage",
    ],
    base: {
        ...inspectorBase,
        /* What is selected, in mono caps: a long key breaks where the pane has no room for it. */
        eyebrow: { ...inspectorBase.eyebrow, overflowWrap: "anywhere" },
        /* Nothing selected: the counts, two to a line — each column never narrower than its longest word, so a count's
         * label in caps is never broken, and the two even wherever both fit. */
        stats: { ...inspectorBase.stats, gridTemplateColumns: "repeat(2, minmax(min-content, 1fr))" },
        /* What is selected's head: its kind's tile beside its kind, its name, where it stands and its status. */
        headRow: { display: "flex", alignItems: "flex-start", gap: "{spacing.3}", minWidth: 0 },
        kindTile: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: "0",
            width: "30px",
            height: "30px",
            borderRadius: "{radii.sm}",
            background: "bg.subtle",
            color: "fg.muted",
            fontSize: "12px",
        },
        headText: { flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" },
        /* Where it stands — its zone and its centre, a link's ends, a net's sides: its lines balanced. */
        when: { textStyle: "mono.xs", color: "fg.muted", overflowWrap: "anywhere", textWrap: "balance" },
        /* An item's status, in its tone — open, as a tentative status draws, when it is a ring. */
        status: INSPECTOR_STATUS,
        /* The edit controls' fieldset: no frame of its own. */
        edits: { border: "0", padding: "0", margin: "0", minWidth: 0, display: "flex", flexDirection: "column" },
        /* The author's own Details, in place of the form. */
        custom: { ...INSPECTOR_SECTION, gap: "{spacing.2}" },
        /* A section under the form: what an item is joined to, a leg's item, the counts' facts. */
        section: { ...INSPECTOR_SECTION, gap: "{spacing.2}" },
        /* One fact, a line of its own. */
        fact: { textStyle: "body.sm", color: "fg.muted", overflowWrap: "anywhere", textWrap: "pretty" },
        /* Why a gesture is off, under its button. */
        why: { flexBasis: "100%", textStyle: "body.sm", color: "fg.muted", textWrap: "pretty" },
        /* The links and nets an item is joined to: each a control that selects it. */
        links: { display: "flex", flexDirection: "column", gap: "{spacing.1}", margin: "0", padding: "0", listStyle: "none", minWidth: 0 },
        /* A link or a net: its name, and under it its kind — on a coarse pointer a 44px row. */
        link: {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "1px",
            width: "100%",
            minWidth: 0,
            paddingY: "{spacing.1}",
            border: "0",
            background: "transparent",
            textAlign: "start",
            cursor: "pointer",
            color: "fg.strong",
            _hover: { color: "fg" },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" },
            _coarse: { minHeight: "44px", justifyContent: "center" },
        },
        linkText: {
            textStyle: "mono.md",
            overflowWrap: "anywhere",
            textDecoration: "underline",
            textDecorationColor: "border.strong",
            textUnderlineOffset: "2px",
        },
        linkMeta: { textStyle: "mono.xs", color: "fg.muted", overflowWrap: "anywhere" },
        /* The Issues tab: every issue of the drawing, each a control. */
        issueList: { display: "flex", flexDirection: "column", minWidth: 0, margin: "0", padding: "0", listStyle: "none" },
        /* An issue: what it names, over what is wrong — its two lines in their padding taller than a 44px tap target, on any pointer. */
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
    },
});
