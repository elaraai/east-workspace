/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's words in React (#935) — the model's message table
 * (`model/messages.ts`) in effect for a subtree, with the locale's formatters,
 * and the editing session's words, the shared table every builder's history
 * item speaks: its commit is **Save** (#1260).
 *
 * English is the default. A host overrides any subset for a subtree with
 * {@link QueryMessagesProvider}; numbers format in the locale react-aria's
 * `I18nProvider` above the app sets (the browser's otherwise).
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { editingMessages, useFormatters, type EditingWords } from "@elaraai/east-ui-components";
import { queryMessages, type QueryMessages } from "./model/messages.js";
import { queryWords, type QueryWords } from "./model/words.js";

const QueryMessagesContext = createContext<QueryMessages>(queryMessages);

/**
 * The message table in effect — {@link queryMessages} with every
 * {@link QueryMessagesProvider} above overriding it.
 *
 * @returns The table
 */
export function useQueryMessages(): QueryMessages {
    return useContext(QueryMessagesContext);
}

/** Props of {@link QueryMessagesProvider}. */
export interface QueryMessagesProviderProps {
    /** The messages to override — any subset; the rest come from the table above. */
    messages: Partial<QueryMessages>;
    /** The subtree the overrides apply to. */
    children?: ReactNode;
}

/**
 * Override the query builder's words for a subtree — a translation, or a
 * house style. Providers nest: each overrides the table the one above it
 * resolved.
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
 * const GERMAN: Partial<QueryMessages> = {
 *     tab: ({ tab }) => (tab === "query" ? "Abfrage" : tab === "datasets" ? "Datensätze" : "Bibliothek"),
 *     saveAs: () => "Speichern…",
 * };
 *
 * <I18nProvider locale="de-DE">
 *     <QueryMessagesProvider messages={GERMAN}>
 *         <EastChakraComponent value={builder} />
 *     </QueryMessagesProvider>
 * </I18nProvider>
 * ```
 */
export function QueryMessagesProvider({ messages, children }: QueryMessagesProviderProps) {
    const parent = useQueryMessages();
    const value = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
    return createElement(QueryMessagesContext.Provider, { value }, children);
}

/**
 * The words the builder says: the message table in effect, and the locale's
 * formatters — what the model's functions take.
 *
 * @returns The words
 */
export function useQueryWords(): QueryWords {
    const formatters = useFormatters();
    const messages = useQueryMessages();
    return useMemo(() => queryWords(formatters, messages), [formatters, messages]);
}

/**
 * The editing session's words for the builder's history item: the shared
 * table, whose commit is Save in every builder (#1260), with the locale's
 * formatters.
 *
 * @returns The words the history item speaks
 */
export function useQueryEditingWords(): EditingWords {
    const formatters = useFormatters();
    return useMemo(() => ({ ...formatters, m: editingMessages }), [formatters]);
}
