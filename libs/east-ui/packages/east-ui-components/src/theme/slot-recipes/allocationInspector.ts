/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's inspector (`Allocation Spec.md` §8, §9.8, A55–A64, #1331):
 * the Plan's inspector (`planInspector`) — its head, its sections ruled off one
 * from the next, its facts, its counts and its hints — and the board's own
 * parts beside them. Sizes are the mock's where no shared part has one; where
 * one does, the shared part's (its sections' 16px, the stepper's and the
 * buttons' rows).
 *
 * The board's slots:
 * - `refusal` — a refused drop's note at the top of Details (A40), the shared banner 12px in.
 * - `banner` — an issue's banner (A56, A62): the shared banner in its section.
 * - `section` — one section; `sectionRow` its head with its actions at its end (`sectionActions`: `Split…`, `Open resource →`).
 * - `link` — a brand text action (`Split…`, `Open resource →`, `Show →`).
 * - `parts` — a bin's parts in Assigned to (A70, A71): each part's quantity a field of the shared form; `remainder` what they
 *   leave unallocated, in warn-text; `split` the `Split…` popover's body: its quantity over the Chooser.
 * - `resourceField` — the resource field (A58): 32px, its name in mono, `+ Choose a resource` in warn; `fill` the
 *   fill beside it, in its tone; `meter`, `meterTick` the shared meter's track with the min tick.
 * - `line` — a mono line in ink-4: the group line, the batch line, a hint; `absent` — what is not there
 *   (`no bins today`), italic.
 * - `mates` and `mate` — a resource's bins today, 28px rows on `44px 32px 1fr auto`, the current one bold (A58).
 * - `option` — a fit or a booking in a list, its rank (`rank`, or the drop list's `dropRank`), its name and line,
 *   and its button (A59–A61); `dropRow` — a fit in the drop list, a dashed brand target at least 48px (A34).
 * - `was` — a draft's `was` line on paper-2 (A59, A61).
 * - `statSub`, `note` — a count's line, and the narrowing's note (A63).
 * - `issues`, `issueGroup`, `issueHead`, `issueCount`, `issue`, `issueTop`, `issueDetail`, `issueActions`, `emptyIcon` — the
 *   Issues tab (A64): an issue's fixes in a row (`Choose a resource`, `Find a fit`, A74).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";
import { INSPECTOR_SECTION } from "./inspector.js";
import { planInspectorSlotRecipe } from "./planInspector.js";

/** A mono line's type: the design system's label sizes, tabular figures. */
const mono = { fontFamily: "mono", fontVariantNumeric: "tabular-nums" } as const;
/** A section head's caption in the mock's words (`ASSIGNED TO`): the shared section head's. */
const plan = planInspectorSlotRecipe.base;

export const allocationInspectorSlotRecipe = defineSlotRecipe({
    className: "east-allocation-inspector",
    slots: [
        ...planInspectorSlotRecipe.slots,
        "headActions", "refusal", "banner", "section", "sectionRow", "sectionActions", "link", "resourceField", "resourceName", "fill", "meter", "meterTick",
        "line", "absent", "parts", "remainder", "split", "rows", "rowLabel", "rowValue", "mates", "mate", "option", "optionText", "optionName", "optionLine",
        "rank", "dropRow", "dropRank", "was", "statSub", "note", "error", "issues", "issueGroup", "issueHead", "issueCount", "issue", "issueTop", "issueTitle",
        "issueDetail", "issueActions", "emptyIcon",
    ],
    base: {
        ...plan,
        // A count in its tone (A63): the issues' in warn-text, the drafts' in the brand's.
        statValue: { ...plan?.statValue, "&[data-tone=warning]": { color: "fg.warning" }, "&[data-tone=brand]": { color: "brandPressed" } },
        // A bin's actions under its head (A56): Unlink, Revert, Back to Arrivals.
        headActions: { display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "4px", minWidth: 0 },
        refusal: { margin: "12px 16px 0", minWidth: 0 },
        banner: { ...INSPECTOR_SECTION, paddingY: "12px" },
        section: { ...INSPECTOR_SECTION, gap: "8px" },
        sectionRow: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px", minWidth: 0 },
        // A head's actions at its end: `Split…` before `Open resource →` (A71).
        sectionActions: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "12px", minWidth: 0 },
        link: {
            display: "inline-flex", alignItems: "center", gap: "4px", padding: 0, border: 0, background: "transparent", cursor: "pointer",
            textStyle: "body.sm", fontWeight: "medium", color: "brand.solid", whiteSpace: "nowrap",
            "& svg": fontAwesomeSize("10px"),
            _hover: { color: "brandPressed", textDecoration: "underline" },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" },
        },
        // The resource field (A58): 32px, its name in mono 14 / 600; with none, `+ Choose a resource` in warn.
        resourceField: {
            flex: "none", display: "inline-flex", alignItems: "center", gap: "8px", height: "32px", maxWidth: "100%", boxSizing: "border-box",
            padding: "0 8px 0 12px", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md",
            background: "bg.surface", cursor: "pointer", whiteSpace: "nowrap",
            ...mono, fontSize: "body.lg", fontWeight: "semibold", color: "fg",
            "& > span": { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
            "& svg": { ...fontAwesomeSize("10px"), flex: "none", color: "fg.muted" },
            "&[data-unlinked]": { borderColor: "status.warn", color: "fg.warning" },
            _hover: { borderColor: "fg.muted" },
            _disabled: { cursor: "default", _hover: { borderColor: "border.strong" } },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" },
        },
        // A reservation's resource (A61): its name in mono 14 / 600.
        resourceName: { ...mono, fontSize: "body.lg", fontWeight: "semibold", color: "fg", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        fill: {
            ...mono, fontSize: "label.lg", fontWeight: "medium", color: "fg", whiteSpace: "nowrap",
            "&[data-tone=danger]": { color: "fg.danger", fontWeight: "semibold" },
            "&[data-tone=warning]": { color: "fg.warning", fontWeight: "semibold" },
        },
        // The meter's min tick: 1px of ink, 4px past the track each side (A58).
        meter: { position: "relative", display: "block", minWidth: 0 },
        meterTick: { position: "absolute", top: "-4px", bottom: "-4px", width: "1px", background: "fg", pointerEvents: "none" },
        line: { ...mono, fontSize: "label.sm", color: "fg.subtle", overflowWrap: "anywhere", textWrap: "pretty" },
        absent: { textStyle: "absent", fontSize: "label.lg" },
        // A bin's parts (A71): under their head, the shared form's fields, then the remainder; 8px apart, as the section's parts are.
        parts: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
        // What the parts leave unallocated (A70): `4 m³ unallocated`, warn-text 600.
        remainder: { ...mono, fontSize: "label.lg", fontWeight: "semibold", color: "fg.warning", overflowWrap: "anywhere" },
        // `Split…`'s popover (A71): its quantity over the Chooser, 12px apart, as the popover's body spaces its parts.
        split: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
        // Rows on `88px 1fr` (A57–A59): the app's columns, Before · Hold · Next fill, the arrival's details — a mono caps label, a mono value.
        rows: { display: "grid", gridTemplateColumns: "88px minmax(0, 1fr)", alignItems: "baseline", rowGap: "8px", columnGap: "12px", margin: 0, minWidth: 0 },
        rowLabel: {
            ...mono, fontSize: "label.sm", fontWeight: "semibold", letterSpacing: "widest", textTransform: "uppercase", color: "fg.subtle",
            overflowWrap: "anywhere",
        },
        rowValue: {
            margin: 0, minWidth: 0, ...mono, fontSize: "label.lg", fontWeight: "medium", color: "fg", overflowWrap: "anywhere", textWrap: "pretty",
            "&[data-tone=warning]": { color: "fg.warning", fontWeight: "semibold" },
            "&[data-absent]": { fontStyle: "italic", fontWeight: "normal", color: "fg.subtle" },
            // A detail of the arrival's (`Settings`): running text.
            "&[data-text]": { fontFamily: "body", textStyle: "body.sm", fontWeight: "normal" },
        },
        mates: { display: "flex", flexDirection: "column", minWidth: 0 },
        // A bin on the resource today: its time, lane, code and quantity; the inspected one bold on paper-3.
        mate: {
            display: "grid", gridTemplateColumns: "44px 32px minmax(0, 1fr) auto", alignItems: "center", gap: "8px", height: "28px",
            padding: "0 8px", border: 0, borderRadius: "sm", background: "transparent", textAlign: "left", cursor: "pointer",
            ...mono, fontSize: "label.lg", color: "fg",
            "& > [data-mate=time]": { color: "fg.strong" },
            "& > [data-mate=lane]": { fontSize: "label.sm", color: "fg.subtle" },
            "& > [data-mate=code]": { fontWeight: "medium", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
            "& > [data-mate=quantity]": { whiteSpace: "nowrap" },
            "&[data-current]": { background: "bg.subtle", "& > [data-mate=code]": { fontWeight: "semibold" } },
            _hover: { background: "bg.canvas" },
            "&[data-current]:hover": { background: "bg.subtle" },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "-2px" },
        },
        // A fit or a booking in a list (A59–A61): its rank, its name and line, its button; 36px a fit, 40px a booking.
        option: {
            display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: "12px", minHeight: "40px", minWidth: 0,
            "&[data-ranked]": { gridTemplateColumns: "16px minmax(0, 1fr) auto", minHeight: "36px" },
        },
        optionText: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
        optionName: {
            display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0, ...mono, fontSize: "label.lg", fontWeight: "semibold", color: "fg", whiteSpace: "nowrap",
            "& > [data-option=quantity]": { fontSize: "label.md", fontWeight: "medium", color: "fg.strong" },
        },
        optionLine: {
            ...mono, fontSize: "label.xs", color: "fg.subtle", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            "&[data-tone=warning]": { color: "fg.warning" },
        },
        // An other gap's rank: 16px on paper-3, ink-2 figures (A59).
        rank: {
            display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "16px", height: "16px", boxSizing: "border-box",
            padding: "0 4px", borderRadius: "sm", background: "bg.subtle", ...mono, fontSize: "label.sm", fontWeight: "semibold", color: "fg.strong",
        },
        // A fit in the drop list (A34): a dashed brand target, 48px at least; brand-tint under the pointer.
        dropRow: {
            display: "grid", gridTemplateColumns: "16px minmax(0, 1fr) auto", alignItems: "center", gap: "4px 12px", minHeight: "48px", minWidth: 0,
            boxSizing: "border-box", padding: "8px 12px", borderWidth: "1px", borderStyle: "dashed", borderColor: "brand.solid", borderRadius: "md",
            background: "bg.surface",
            "& > [data-drop-row=name]": { ...mono, fontSize: "body", fontWeight: "semibold", color: "fg", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
            "& > [data-drop-row=why]": { gridColumn: "2", ...mono, fontSize: "label.sm", color: "fg.muted", overflowWrap: "anywhere" },
            "& > [data-drop-row=action]": { gridRow: "span 2", display: "flex", alignItems: "center" },
            // The shared drop stages' frames and washes are off: the row draws its own.
            "&[data-drag-cell][data-drop-valid]::before, &[data-drag-cell][data-drop-active]::before, &[data-drag-cell][data-drop-invalid]::before": { content: "none" },
            "&[data-drag-cell][data-drop-invalid]::after": { content: "none" },
            "&[data-drag-cell][data-drop-active]": { background: "brandTint" },
            "&[data-drag-cell][data-drop-invalid]": { borderColor: "status.warn", cursor: "no-drop" },
        },
        dropRank: {
            display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "16px", height: "16px", boxSizing: "border-box",
            padding: "0 4px", borderRadius: "sm", background: "brand.solid", ...mono, fontSize: "label.sm", fontWeight: "semibold", color: "bg.surface",
        },
        // A draft's `was` line (A59, A61): on paper-2, a reservation's Revert at its end.
        was: {
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "12px 16px", minWidth: 0,
            background: "bg.canvas", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            ...mono, fontSize: "label.sm", color: "fg.muted",
            "& > span": { minWidth: 0, textWrap: "pretty" },
        },
        statSub: { ...mono, fontSize: "label.sm", color: "fg.subtle", overflowWrap: "anywhere" },
        note: {
            padding: "12px 16px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            ...mono, fontSize: "label.sm", color: "fg.muted", textWrap: "pretty", overflowWrap: "anywhere",
        },
        error: { textStyle: "body.sm", color: "fg.danger", overflowWrap: "anywhere" },
        // The Issues tab (A64): its groups 20px apart, each its head and its issues.
        issues: { display: "flex", flexDirection: "column", gap: "20px", padding: "16px", minWidth: 0 },
        issueGroup: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
        issueHead: {
            display: "flex", alignItems: "center", gap: "8px", minHeight: "16px",
            ...mono, fontSize: "label.sm", fontWeight: "semibold", letterSpacing: "label", textTransform: "uppercase", color: "fg",
            "& svg": fontAwesomeSize("11px"),
            "&[data-tone=warning] svg": { color: "status.warn" },
            "&[data-tone=danger] svg": { color: "status.neg" },
        },
        issueCount: {
            display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "16px", height: "16px", boxSizing: "border-box",
            padding: "0 4px", borderRadius: "sm", background: "bg.subtle", ...mono, fontSize: "label.sm", fontWeight: "semibold", letterSpacing: "normal", color: "fg.strong",
        },
        issue: {
            display: "flex", flexDirection: "column", alignItems: "stretch", gap: "4px", minWidth: 0, padding: "8px 12px",
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", background: "bg.surface",
        },
        issueTop: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 },
        issueTitle: { flex: 1, minWidth: 0, ...mono, fontSize: "label.lg", fontWeight: "semibold", color: "fg", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        issueDetail: { ...mono, fontSize: "label.sm", lineHeight: 1.5, color: "fg.muted", textWrap: "pretty", overflowWrap: "anywhere" },
        // An issue's fixes, in a row that wraps: its own, then Find a fit (A74).
        issueActions: { display: "flex", flexWrap: "wrap", gap: "8px", minWidth: 0 },
        emptyIcon: { ...fontAwesomeSize("22px"), color: "border.strong" },
    },
});
