/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The assignment surfaces' own words (#1263) — words for
 * a chip's state. These chips speak `PlannerStateType`, the shared
 * state vocabulary of the assignment surfaces: a chip that is a proposal to
 * add — an operator's, or a model's suggestion — draws Font Awesome's plus
 * before its label, never a text `+`, and its accessible name says what the
 * plus shows. What the AUTHOR wrote — a person's or a shift's label — is data,
 * and arrives as written.
 *
 * English is the default. A host overrides any subset for a subtree with
 * {@link AssignmentMessagesProvider}.
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

/**
 * The assignment surfaces' message table.
 *
 * @remarks
 * `label` is a chip's label — a person's, a shift's — as its author wrote it.
 */
export interface AssignmentMessages {
    /** An operator's proposal to add, as a chip's accessible name — `Patel, R., added`. */
    added: (p: { label: string }) => string;
    /** A model's suggestion, as a chip's accessible name — `Patel, R., suggested`. */
    suggested: (p: { label: string }) => string;
}

/** The assignment surfaces' English messages — the default table. */
export const assignmentMessages: AssignmentMessages = {
    added: ({ label }) => `${label}, added`,
    suggested: ({ label }) => `${label}, suggested`,
};

const AssignmentMessagesContext = createContext<AssignmentMessages>(assignmentMessages);

/**
 * The message table in effect — {@link assignmentMessages} with every
 * {@link AssignmentMessagesProvider} above overriding it.
 *
 * @returns The table
 */
export function useAssignmentMessages(): AssignmentMessages {
    return useContext(AssignmentMessagesContext);
}

/** Props of {@link AssignmentMessagesProvider}. */
export interface AssignmentMessagesProviderProps {
    /** The messages to override — any subset; the rest come from the table above. */
    messages: Partial<AssignmentMessages>;
    /** The subtree the overrides apply to. */
    children?: ReactNode;
}

/**
 * Override the assignment surfaces' words for a subtree — a translation, or a
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
 * const GERMAN: Partial<AssignmentMessages> = {
 *     added: ({ label }) => `${label}, hinzugefügt`,
 *     suggested: ({ label }) => `${label}, vorgeschlagen`,
 * };
 *
 * <AssignmentMessagesProvider messages={GERMAN}>
 *     <EastChakraComponent value={surface} />
 * </AssignmentMessagesProvider>
 * ```
 */
export function AssignmentMessagesProvider({ messages, children }: AssignmentMessagesProviderProps) {
    const parent = useAssignmentMessages();
    const value = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
    return createElement(AssignmentMessagesContext.Provider, { value }, children);
}
