/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the SnapGrid's editing canvas says itself (#990, #995) — ONE
 * typed message table: the end zone, the handles and the remove button, the
 * toolbar's own items and the selection bar, the names a screen reader hears
 * for a tile and for where a drag rests, what its live region says, why an
 * Apply a screen asked for cannot run, and the editing session's own words, so a host translates the canvas's history item
 * where it translates the canvas. What the AUTHOR wrote — a tile's label, its
 * meta, a design width's name — is data, and never passes through it.
 *
 * English is the default. A host overrides any subset for a subtree with
 * {@link SnapGridMessagesProvider}; numbers format in the locale react-aria's
 * `I18nProvider` above the app sets (the browser's otherwise).
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { useLocale } from "@react-aria/i18n";
import { editingMessages, type EditingMessages, type EditingWords } from "../../editing/messages.js";
import { formatters } from "../../format/index.js";

/**
 * The SnapGrid's message table.
 *
 * @remarks
 * `span`, `row` and `n` arrive already formatted for the locale; `label` is a
 * tile's name, as its author wrote it.
 */
export interface SnapGridMessages extends EditingMessages {
    /** The canvas's accessible name. */
    canvasLabel: () => string;
    /** The end zone at rest. */
    endZoneRest: () => string;
    /** The end zone while a tile or a card that can land is dragged — words only: the canvas draws Font Awesome's caret beside them (#1263). */
    endZoneDragging: () => string;
    /** The end zone while a drop there would make a new row — words only, the caret beside them. */
    endZoneTarget: () => string;
    /** The selected tile's remove button. */
    remove: () => string;
    /** The right-edge handle. */
    spanHandle: () => string;
    /** The bottom-edge handle. */
    heightHandle: () => string;
    /** The bottom-right corner, which drags both. */
    bothHandle: () => string;
    /** A tile's accessible name — `Revenue trend, span 8, row 2`. */
    tileName: (p: { label: string; span: string; row: string }) => string;
    /** Where a drag rests beside a tile — `beside Revenue trend, row 2`. */
    besideTile: (p: { label: string; row: string }) => string;
    /** Where a drag rests at a row's end — `at the end of row 2`. */
    rowEnd: (p: { row: string }) => string;
    /** Where a drag rests between rows — `a new row 3`. */
    newRow: (p: { row: string }) => string;
    /** A tile selected. */
    announceSelected: (p: { label: string }) => string;
    /** A tile's span changed from the keyboard. */
    announceSpan: (p: { label: string; span: string }) => string;
    /** A tile removed. */
    announceRemoved: (p: { label: string }) => string;
    /** The selection cleared. */
    announceCleared: () => string;
    /** The toolbar's grid chip — `12 col · snap on`. */
    gridChip: () => string;
    /** When the source last confirmed a Save — `Saved · 14:32`; `time` is formatted for the locale. */
    saved: (p: { time: string }) => string;
    /** The design width readout — `1440 px`; `px` is formatted for the locale. */
    widthReadout: (p: { px: string }) => string;
    /** The zoom control's accessible name. */
    zoomLabel: () => string;
    /** The zoom-out button. */
    zoomOut: () => string;
    /** The zoom-in button. */
    zoomIn: () => string;
    /** The design widths' accessible name. */
    widthsLabel: () => string;
    /** The View chip a row short of room folds the zoom and the widths into (#1229) — its accessible name. */
    viewLabel: () => string;
    /** The selection bar with nothing selected. */
    noSelection: () => string;
    /** Beside it, what to do. */
    noSelectionHint: () => string;
    /** An Apply a screen asked for that cannot run here, when nothing else says why (#998). */
    applyRefused: () => string;
    /** A phone's row eyebrow — `Row 2`. */
    phoneRow: (p: { row: string }) => string;
    /** After it, while the row is short — `4 columns free`. */
    phoneFree: (p: { n: number; count: string }) => string;
    /** A tile's span as a phone's caption and stepper read it — `8 / 12`. */
    phoneSpan: (p: { span: string }) => string;
    /** A tile's caption while a conflict waits. */
    phoneConflict: () => string;
    /** The page's last control, and a card's way in. */
    phoneAdd: () => string;
    /** The tile bar's eyebrow — `Row 2 · Orders by week`. */
    phoneBarHead: (p: { row: string; label: string }) => string;
    /** Closing the tile bar. */
    phoneBarClose: () => string;
    /** The tile bar's Move. */
    phoneMove: () => string;
    /** The tile bar's Remove. */
    phoneRemove: () => string;
    /** The span stepper's name. */
    phoneSpanLabel: () => string;
    /** The stepper's minus. */
    phoneNarrower: () => string;
    /** The stepper's plus. */
    phoneWider: () => string;
    /** What a span comes to — `Columns 1–4 of 12 · 4 free in row 2`, `Columns 1–8 of 12 · row 2 is full`. */
    phoneColumns: (p: { first: string; last: string; free: number; freeCount: string; row: string }) => string;
    /** A slot making a new row. */
    phoneNewRow: () => string;
    /** A slot in a row — `Into row 2`, `Into row 2 · narrows to 3`. */
    phoneInto: (p: { row: string; narrows?: string | undefined }) => string;
    /** The place bar's head while moving. */
    phoneMoving: (p: { label: string }) => string;
    /** The place bar's head while adding. */
    phoneAdding: (p: { label: string }) => string;
    /** The place bar's Cancel. */
    phoneCancel: () => string;
    /** What the place bar says while moving. */
    phoneMoveLine: () => string;
    /** What the place bar says while adding. */
    phoneAddLine: () => string;
    /** The place bar's count — `7 slots · span 4 of 12 · a new row always fits`. */
    phoneSlots: (p: { n: number; count: string; span: string }) => string;
    /** A page of no tiles — its heading; `page` its name, when it has one. */
    phoneEmpty: (p: { page?: string | undefined }) => string;
    /** Under it: what to do first. */
    phoneEmptyFirst: () => string;
    /** Then. */
    phoneEmptyThen: () => string;
    /** The band once a Save lands — `Saved 2 changes`. */
    phoneSaved: (p: { n: number; count: string }) => string;
}

/** The SnapGrid's English messages — the default table. */
export const snapGridMessages: SnapGridMessages = {
    ...editingMessages,
    // A tile's span, as a builder's side panel names it; its other fields read as they are named.
    conflictField: ({ field }) => (field === "span" ? "Column span" : editingMessages.conflictField({ field })),
    canvasLabel: () => "Page layout",
    endZoneRest: () => "Drag from the library · new 12-col row",
    endZoneDragging: () => "Drop between rows, beside a tile, or here",
    endZoneTarget: () => "Drop component here · snaps to a new 12-col row",
    remove: () => "Remove from page",
    spanHandle: () => "Drag to change span",
    heightHandle: () => "Drag to change height",
    bothHandle: () => "Drag to change span and height",
    tileName: ({ label, span, row }) => `${label}, span ${span}, row ${row}`,
    besideTile: ({ label, row }) => `beside ${label}, row ${row}`,
    rowEnd: ({ row }) => `at the end of row ${row}`,
    newRow: ({ row }) => `a new row ${row}`,
    announceSelected: ({ label }) => `Selected ${label}`,
    announceSpan: ({ label, span }) => `${label}, span ${span}`,
    announceRemoved: ({ label }) => `Removed ${label}`,
    announceCleared: () => "Selection cleared",
    gridChip: () => "12 col · snap on",
    saved: ({ time }) => `Saved · ${time}`,
    widthReadout: ({ px }) => `${px} px`,
    zoomLabel: () => "Zoom",
    zoomOut: () => "Zoom out",
    zoomIn: () => "Zoom in",
    widthsLabel: () => "Design width",
    viewLabel: () => "View",
    noSelection: () => "No selection",
    noSelectionHint: () => "Click a component on the grid to arrange it",
    applyRefused: () => "The drafts could not be saved",
    phoneRow: ({ row }) => `Row ${row}`,
    phoneFree: ({ n, count }) => `${count} ${n === 1 ? "column" : "columns"} free`,
    phoneSpan: ({ span }) => `${span} / 12`,
    phoneConflict: () => "Conflict",
    phoneAdd: () => "Add a component",
    phoneBarHead: ({ row, label }) => `Row ${row} · ${label}`,
    phoneBarClose: () => "Clear the selection",
    phoneMove: () => "Move",
    phoneRemove: () => "Remove",
    phoneSpanLabel: () => "Column span",
    phoneNarrower: () => "Decrease span",
    phoneWider: () => "Increase span",
    phoneColumns: ({ first, last, free, freeCount, row }) => `Columns ${first}–${last} of 12 · ${free === 0 ? `row ${row} is full` : `${freeCount} free in row ${row}`}`,
    phoneNewRow: () => "New row",
    phoneInto: ({ row, narrows }) => (narrows === undefined ? `Into row ${row}` : `Into row ${row} · narrows to ${narrows}`),
    phoneMoving: ({ label }) => `Moving · ${label}`,
    phoneAdding: ({ label }) => `Adding · ${label}`,
    phoneCancel: () => "Cancel",
    phoneMoveLine: () => "Tap a dashed slot to move it there. Nothing moves until you do.",
    phoneAddLine: () => "Tap a dashed slot to add it there. Nothing is added until you do.",
    phoneSlots: ({ n, count, span }) => `${count} ${n === 1 ? "slot" : "slots"} · span ${span} of 12 · a new row always fits`,
    phoneEmpty: ({ page }) => (page === undefined ? "No components" : `No components on ${page}`),
    phoneEmptyFirst: () => "Tap Add a component and pick one.",
    phoneEmptyThen: () => "Tap a dashed slot to place it.",
    phoneSaved: ({ n, count }) => `Saved ${count} ${n === 1 ? "change" : "changes"}`,
};

const SnapGridMessagesContext = createContext<SnapGridMessages>(snapGridMessages);

/**
 * The message table in effect — {@link snapGridMessages} with every
 * {@link SnapGridMessagesProvider} above overriding it.
 *
 * @returns The table
 */
export function useSnapGridMessages(): SnapGridMessages {
    return useContext(SnapGridMessagesContext);
}

/** Props of {@link SnapGridMessagesProvider}. */
export interface SnapGridMessagesProviderProps {
    /** The messages to override — any subset; the rest come from the table above. */
    messages: Partial<SnapGridMessages>;
    /** The subtree the overrides apply to. */
    children?: ReactNode;
}

/**
 * Override the SnapGrid's words for a subtree — a translation, or a house style.
 * Providers nest: each overrides the table the one above it resolved.
 *
 * @remarks
 * The overrides are read by identity: define them once (module scope, or a
 * memo), as below.
 *
 * @param props - The overrides and the subtree
 * @returns The provider
 *
 * @example
 * ```tsx
 * const GERMAN: Partial<SnapGridMessages> = {
 *     remove: () => "Von der Seite entfernen",
 *     endZoneRest: () => "Aus der Bibliothek ziehen · neue 12-Spalten-Zeile",
 * };
 *
 * <I18nProvider locale="de-DE">
 *     <SnapGridMessagesProvider messages={GERMAN}>
 *         <EastChakraComponent value={builder} />
 *     </SnapGridMessagesProvider>
 * </I18nProvider>
 * ```
 */
export function SnapGridMessagesProvider({ messages, children }: SnapGridMessagesProviderProps) {
    const parent = useSnapGridMessages();
    const value = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
    return createElement(SnapGridMessagesContext.Provider, { value }, children);
}

/** The SnapGrid's words: its message table, and its locale's formatters. */
export interface SnapGridWords extends EditingWords {
    /** The message table in effect. */
    m: SnapGridMessages;
}

/**
 * The canvas's words — its locale (react-aria's `useLocale`) and the message
 * table in effect, resolved once per change.
 *
 * @returns The words
 */
export function useSnapGridWords(): SnapGridWords {
    const { locale } = useLocale();
    const m = useSnapGridMessages();
    return useMemo(() => ({ ...formatters(locale), m }), [locale, m]);
}
