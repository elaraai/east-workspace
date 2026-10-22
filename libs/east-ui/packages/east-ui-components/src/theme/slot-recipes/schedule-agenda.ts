/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Calendar's, the Roster's and the Allocation's narrow layout (#1333): a
 * phone's main as a list of explicit-action cards, each its head — its title
 * over its lines, one button — and its actions. Each builder names these parts
 * in its own recipe, as the footer's rail is named (the Allocation's `card` is
 * its Timeline's bin).
 */
import { planElementDrafted, planElementFocus, planElementSelected } from "./plan/focus.js";
import { timeHeaderText } from "./time/axis.js";

/** The list: 12px in, its groups 16px apart, on the panel. */
export const scheduleAgenda = { minWidth: 0, padding: "12px", background: "bg.panel", display: "flex", flexDirection: "column", gap: "16px" } as const;
/** A group of cards — a day's, a band's — 8px apart. */
export const scheduleAgendaGroup = { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 } as const;
/** A group's heading: the time header's caption. */
export const scheduleAgendaHead = { ...timeHeaderText } as const;
/** A card: 12px in on the surface, in the subtle rule, its parts 8px apart; drafted, selected and focused as every builder's marks are. */
export const scheduleCard = {
    ...planElementDrafted, ...planElementSelected, ...planElementFocus, minWidth: 0, padding: "12px", borderWidth: "1px", borderColor: "border.subtle",
    borderRadius: "sm", background: "bg.surface", display: "flex", flexDirection: "column", gap: "8px",
} as const;
/** A card's head: its title over its lines, 4px apart, one button that selects what the card is. */
export const scheduleCardHead = { minWidth: 0, display: "flex", flexDirection: "column", gap: "4px", textAlign: "left" } as const;
/** A card's title, the row's title, wrapping where it must. */
export const scheduleCardTitle = { textStyle: "title.row", overflowWrap: "anywhere", minWidth: 0 } as const;
/** A card's actions, 8px apart, wrapping onto a second row on a narrow card. */
export const scheduleCardActions = { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" } as const;
