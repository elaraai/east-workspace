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
 * where the pane has no room for it.
 *
 * The parts it lays out as the Sheet's and the Plan's inspectors do are the
 * inspector's shared parts (`inspector.ts`); this adds the Flowchart's own.
 * Its words take the theme's text styles, its controls are the shared
 * `button`, its form is `fieldForm`'s. The pane — its tab row, its collapse
 * control and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { INSPECTOR_SECTION, inspectorBase, inspectorSlots } from "./inspector.js";

export const flowchartInspectorSlotRecipe = defineSlotRecipe({
    className: "elara-flowchart-inspector",
    slots: [
        ...inspectorSlots,
        "edits", "rowForms", "custom", "section", "fact", "why",
        "links", "linkGroup", "link", "linkText", "linkMeta",
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
        /* A group's head in a state's transitions — In · 2, Out · 1, In place · 1 — nearer the list it heads than the one
         * before it. */
        linkGroup: {
            textStyle: "mono.xs",
            color: "fg.subtle",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            overflowWrap: "anywhere",
            marginTop: "{spacing.1}",
        },
        /* A transition: its ends, and under them its kind — on a coarse pointer a 44px row. */
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
