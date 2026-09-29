/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the Studio's renderers say themselves (#996) — ONE typed message
 * table: the inspector's section heads, its fields and its controls' names,
 * its footer, and what it says with nothing selected. What the AUTHOR wrote —
 * a component's name, key, reads and description, a placement's title — is
 * data, and never passes through it.
 *
 * English is the default. A host overrides any subset for a subtree with
 * {@link StudioMessagesProvider}; numbers format in the locale react-aria's
 * `I18nProvider` above the app sets (the browser's otherwise).
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

/**
 * The Studio's message table.
 *
 * @remarks
 * `span` and `px` arrive already formatted for the locale.
 */
export interface StudioMessages {
    /** The inspector's selection block — its eyebrow. */
    selectedComponent: () => string;
    /** The placement's component's code changed since the page went live. */
    logicChanged: () => string;
    /** The Data block's eyebrow. */
    data: () => string;
    /** A component whose code reads no dataset. */
    readsNothing: () => string;
    /** The Configuration block's eyebrow. */
    configuration: () => string;
    /** Beside it, what the lock says. */
    fixedByDeveloper: () => string;
    /** A component with no description. */
    noDescription: () => string;
    /** The Layout block's eyebrow. */
    layout: () => string;
    /** The span stepper's label. */
    columnSpan: () => string;
    /** The span as the stepper shows it — `8 / 12`. */
    spanOf: (p: { span: string }) => string;
    /** The stepper's minus button. */
    decreaseSpan: () => string;
    /** The stepper's plus button. */
    increaseSpan: () => string;
    /** The row field's label. */
    row: () => string;
    /** The height field's label. */
    height: () => string;
    /** A height that is its content's own. */
    auto: () => string;
    /** A height in px — `240 px`. */
    px: (p: { px: string }) => string;
    /** The alignment's label. */
    align: () => string;
    /** At the row's top. */
    alignTop: () => string;
    /** Centred in the row. */
    alignCenter: () => string;
    /** As tall as the row. */
    alignStretch: () => string;
    /** The inspector's footer. */
    published: () => string;
    /** The inspector with nothing selected — its heading. */
    nothingSelected: () => string;
    /** Under it, what to do. */
    nothingSelectedHint: () => string;
}

/** The Studio's English messages — the default table. */
export const studioMessages: StudioMessages = {
    selectedComponent: () => "Selected component",
    logicChanged: () => "logic changed since this page went live",
    data: () => "Data",
    readsNothing: () => "reads no data",
    configuration: () => "Configuration",
    fixedByDeveloper: () => "fixed by developer",
    noDescription: () => "No description",
    layout: () => "Layout",
    columnSpan: () => "Column span",
    spanOf: ({ span }) => `${span} / 12`,
    decreaseSpan: () => "Decrease span",
    increaseSpan: () => "Increase span",
    row: () => "Row",
    height: () => "Height",
    auto: () => "Auto",
    px: ({ px }) => `${px} px`,
    align: () => "Align",
    alignTop: () => "Top",
    alignCenter: () => "Center",
    alignStretch: () => "Stretch",
    published: () => "Published component · logic immutable",
    nothingSelected: () => "Nothing selected",
    nothingSelectedHint: () => "Click a component on the grid to see what it reads and its layout.",
};

const StudioMessagesContext = createContext<StudioMessages>(studioMessages);

/**
 * The message table in effect — {@link studioMessages} with every
 * {@link StudioMessagesProvider} above overriding it.
 *
 * @returns The table
 */
export function useStudioMessages(): StudioMessages {
    return useContext(StudioMessagesContext);
}

/** Props of {@link StudioMessagesProvider}. */
export interface StudioMessagesProviderProps {
    /** The messages to override — any subset; the rest come from the table above. */
    messages: Partial<StudioMessages>;
    /** The subtree the overrides apply to. */
    children?: ReactNode;
}

/**
 * Override the Studio's words for a subtree — a translation, or a house style.
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
 * const GERMAN: Partial<StudioMessages> = {
 *     nothingSelected: () => "Nichts ausgewählt",
 *     columnSpan: () => "Spaltenbreite",
 * };
 *
 * <I18nProvider locale="de-DE">
 *     <StudioMessagesProvider messages={GERMAN}>
 *         <EastChakraComponent value={builder} />
 *     </StudioMessagesProvider>
 * </I18nProvider>
 * ```
 */
export function StudioMessagesProvider({ messages, children }: StudioMessagesProviderProps) {
    const parent = useStudioMessages();
    const value = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
    return createElement(StudioMessagesContext.Provider, { value }, children);
}
