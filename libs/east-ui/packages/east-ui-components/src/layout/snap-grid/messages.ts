/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the SnapGrid's editing canvas says itself (#990) — ONE typed
 * message table: the end zone, the handles and the remove button, the names a
 * screen reader hears for a tile and for where a drag rests, what its live
 * region says, and the editing session's own words, so a host translates the
 * canvas's history item where it translates the canvas. What the AUTHOR wrote
 * — a tile's label — is data, and never passes through it.
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
    /** The end zone while a tile or a card that can land is dragged. */
    endZoneDragging: () => string;
    /** The end zone while a drop there would make a new row. */
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
}

/** The SnapGrid's English messages — the default table. */
export const snapGridMessages: SnapGridMessages = {
    ...editingMessages,
    canvasLabel: () => "Page layout",
    endZoneRest: () => "Drag from the library · new 12-col row",
    endZoneDragging: () => "▾ Drop between rows, beside a tile, or here",
    endZoneTarget: () => "▾ Drop component here · snaps to a new 12-col row",
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
