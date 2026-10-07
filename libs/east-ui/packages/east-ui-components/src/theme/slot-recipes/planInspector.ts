/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan inspector slot recipe — the layout of the Plan's inspector pane
 * (#1197, `Plan Builder Spec.md` §8, §9.8, PB38–PB41): what is selected on
 * the canvas, in sections padded 16px and ruled off one from the next, as the
 * Sheet's and Studio's inspectors' are.
 *
 * One event: its head — its kind's icon tile beside its kind, its title, when
 * it runs and its status — then its facts (where it is, when, its lane, its
 * state and its quantity), its verdict, its fields or its kind's own UI, and
 * its gestures. Several: how many, each kind's count, the list, and the bulk
 * edit. A row: its resource's name and line, its events in the window, and
 * its measures at the bucket a click on it named. Nothing: the window's counts
 * and three hints. The edit controls sit in one fieldset, disabled while the
 * event kinds take no edit (#1194). Under one event's head, and a row's, the
 * overlaps banner (#1198): the shared `Banner` in its guard tone, a line per
 * event the event overlaps — or per pair on the row — each a button that
 * selects it.
 *
 * The parts it lays out as the Sheet's inspector does are the inspector's
 * shared parts (`inspector.ts`); this adds the Plan's own. Its words take the
 * theme's text styles, its controls are the shared `button`, its form is
 * `fieldForm`'s. The pane — its collapse control and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { INSPECTOR_SECTION, inspectorBase, inspectorSlots } from "./inspector.js";

export const planInspectorSlotRecipe = defineSlotRecipe({
    className: "elara-plan-inspector",
    slots: [
        ...inspectorSlots,
        "headRow", "kindTile", "headText", "when", "status",
        "facts", "factLabel", "factValue",
        "verdict", "verdictWord",
        "list", "listItem", "listText", "listTitle", "listWhen",
        "shift", "edits", "custom", "measures",
        "overlaps", "overlapList", "overlapLine", "overlapItem", "overlapWhen", "overlapTitle",
    ],
    base: {
        ...inspectorBase,
        /* Nothing selected: the window's counts, two to a line. */
        stats: { ...inspectorBase.stats, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
        /* One event's head: its kind's tile beside its kind, its title, when it runs and its status. */
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
        when: { textStyle: "mono.xs", color: "fg.muted", overflowWrap: "anywhere" },
        /* An event's status, in its tone — open, as a tentative status draws, when it is a ring. */
        status: {
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "0.12em",
            lineHeight: "normal",
            textTransform: "uppercase",
            paddingX: "{spacing.1}",
            paddingY: "1px",
            borderRadius: "{radii.xs}",
            whiteSpace: "nowrap",
            "&[data-tone=success]": { background: "bg.success.subtle", color: "fg.success" },
            "&[data-tone=warning]": { background: "bg.warning.subtle", color: "fg.warning" },
            "&[data-tone=danger]": { background: "bg.danger.subtle", color: "fg.danger" },
            "&[data-tone=info]": { background: "bg.brand.subtle", color: "brand.fg" },
            "&[data-tone=neutral]": { background: "bg.subtle", color: "fg.muted" },
            "&[data-ring]": { background: "transparent", boxShadow: "inset 0 0 0 1px currentColor" },
        },
        /* Its facts: each its label beside its value. */
        facts: {
            ...INSPECTOR_SECTION,
            display: "grid",
            gridTemplateColumns: "max-content minmax(0, 1fr)",
            alignItems: "baseline",
            columnGap: "{spacing.3}",
            rowGap: "{spacing.2}",
            margin: "0",
        },
        factLabel: { textStyle: "caption.eyebrow" },
        factValue: { textStyle: "body.sm", color: "fg", margin: "0", minWidth: 0, overflowWrap: "anywhere" },
        /* Its verdict, and the review's two buttons. */
        verdict: { ...INSPECTOR_SECTION, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: "{spacing.2}" },
        verdictWord: {
            textStyle: "body.sm",
            color: "fg",
            marginRight: "auto",
            "&[data-verdict=pending]": { color: "fg.warning" },
            "&[data-verdict=approved]": { color: "fg.success" },
            "&[data-verdict=rejected]": { color: "fg.danger" },
        },
        /* Several events: each its kind's icon, its title and when it runs. */
        list: { ...INSPECTOR_SECTION, gap: "{spacing.2}", margin: "0", listStyle: "none" },
        listItem: { display: "flex", alignItems: "flex-start", gap: "{spacing.2}", minWidth: 0, "& > svg": { marginTop: "3px", fontSize: "11px", color: "fg.muted" } },
        listText: { flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" },
        listTitle: { textStyle: "body.sm", color: "fg", overflowWrap: "anywhere" },
        listWhen: { textStyle: "mono.xs", color: "fg.muted" },
        /* The bulk edit's shift in time: its four steps. */
        shift: { display: "flex", flexWrap: "wrap", gap: "{spacing.1}" },
        /* The edit controls' fieldset: no frame of its own. */
        edits: { border: "0", padding: "0", margin: "0", minWidth: 0, display: "flex", flexDirection: "column" },
        /* The kind's own inspector, in place of its form. */
        custom: { display: "flex", flexDirection: "column", gap: "{spacing.2}", minWidth: 0 },
        /* A row's measures at the bucket a click named. */
        measures: { ...INSPECTOR_SECTION, gap: "{spacing.2}" },
        /* The overlaps banner (#1198, the Calendar's §8): its section padded 12px 16px. */
        overlaps: { ...INSPECTOR_SECTION, paddingY: "{spacing.3}" },
        /* Its lines, under the banner's title. */
        overlapList: { display: "flex", flexDirection: "column", gap: "{spacing.1}", margin: "0", padding: "0", paddingTop: "{spacing.1}", listStyle: "none" },
        overlapLine: { display: "flex", minWidth: 0 },
        /* A line: when, then what — a button that selects it. On a coarse pointer
         * each is a 44px row, as the lines stack (#346). */
        overlapItem: {
            display: "flex",
            alignItems: "baseline",
            gap: "{spacing.2}",
            minWidth: 0,
            padding: "0",
            border: "0",
            background: "transparent",
            textAlign: "start",
            cursor: "pointer",
            textStyle: "body.sm",
            color: "fg.strong",
            _hover: { color: "fg" },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" },
            _coarse: { minHeight: "44px", alignItems: "center" },
        },
        overlapWhen: { textStyle: "mono.xs", color: "fg.muted", flexShrink: "0" },
        overlapTitle: {
            minWidth: 0,
            overflowWrap: "anywhere",
            textDecoration: "underline",
            textDecorationColor: "border.strong",
            textUnderlineOffset: "2px",
        },
    },
});
